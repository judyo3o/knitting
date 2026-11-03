import { describe, expect, it } from "vitest";
import { expand, mergeSections, newPattern, stepNext, stepPrev, currentRow, sideOf, directionText, partProgress, colorsInText, mergeYarns } from "../src/model";
import { chunksOf, countChunk, stitchesThrough } from "../src/chunks";
import { localParse, needsClaude, parseRange, toRanges } from "../src/parse";
import { autoPick, pageInfo, findCharts, chartFor, rowY, findLegend, type TItem } from "../src/pdfgeom";
import { newDrawing, setCell, fillRow, describeRow, rowColors, resize, dominantColors, nearest } from "../src/drawing";
import type { AiSection } from "../src/types";

const secs: AiSection[] = [
  { name: "뒷판", chart: 23, round: false, rows: [
    { from: 1, to: 1, side: "RS", text: "110코 기초코. 겉뜨기", stitches: "110코", page: 5 },
    { from: 2, to: 3, text: "안뜨기", stitches: "110코" },
  ] },
  { name: "스와치", chart: 2, rows: [{ from: 1, to: 2, text: "무늬" }] },
  { name: "카라", rows: [{ from: 1, to: 1, side: "WS", text: "코줍기" }, { from: 2, to: 2, text: "겉" }] },
];

describe("expand / merge", () => {
  it("swatch first, ranges expanded, stitches on last, chart from section", () => {
    const m = mergeSections([], secs);
    expect(m[0].name).toBe("스와치");
    const { rows, secs: info } = expand(m);
    const back = rows.filter((r) => r.s === "뒷판");
    expect(back.map((r) => r.n)).toEqual([1, 2, 3]);
    expect(back[1].st).toBeNull();
    expect(back[2].st).toBe("110코");
    expect(back[1].span).toEqual([2, 3]);
    expect(back[1].ch).toBe(23);
    expect(info["카라"].odd).toBe("WS");
    expect(info["뒷판"].odd).toBe("RS");
  });
  it("merges same-name parts across batches", () => {
    const m = mergeSections(mergeSections([], [{ name: "몸통", rows: [{ from: 1, to: 2, text: "a" }] }]), [{ name: "몸통", chart: 26, rows: [{ from: 3, to: 3, text: "b" }] }]);
    expect(m).toHaveLength(1);
    expect(m[0].rows).toHaveLength(2);
    expect(m[0].chart).toBe(26);
  });
});

describe("navigation & records", () => {
  const mk = () => {
    const { rows, secs: info } = expand(mergeSections([], secs));
    return newPattern({ id: "t", name: "t", rows, secs: info });
  };
  it("per-part position, completion, next part, undo", () => {
    const p = mk();
    p.tab = "뒷판";
    expect(currentRow(p)!.n).toBe(1);
    expect(stepNext(p, 1000)).toBe("moved");
    expect(p.done["뒷판#1"]).toBe(1000);
    p.tab = "카라";
    expect(currentRow(p)!.n).toBe(1);
    p.tab = "뒷판";
    expect(currentRow(p)!.n).toBe(2);
    stepNext(p, 2000);
    expect(stepNext(p, 3000)).toBe("finished");
    expect(p.fin["뒷판"]).toBe(3000);
    expect(partProgress(p, "뒷판")).toEqual({ done: 3, total: 3, finished: true });
    expect(stepPrev(p)).toBe("moved");
    expect(p.fin["뒷판"]).toBeUndefined();
    expect(p.done["뒷판#3"]).toBeUndefined();
    stepNext(p, 4000);
    expect(stepNext(p, 4100)).toBe("next-part");
    expect(p.tab).toBe("카라");
    expect(p.log).toHaveLength(1); // 뒷판 이동은 모두 30분 안 → 한 세션
    expect(p.log[0]).toMatchObject({ s: "뒷판", from: 1 });
  });
  it("session splits after 30 minutes", () => {
    const p = mk(); p.tab = "뒷판";
    stepNext(p, 0); stepNext(p, 31 * 60 * 1000);
    expect(p.log).toHaveLength(2);
  });
  it("side & direction", () => {
    const p = mk();
    const kara = p.rows.filter((r) => r.s === "카라");
    expect(sideOf(p, kara[1])).toBe("RS");
    expect(sideOf(p, kara[0])).toBe("WS");
    expect(directionText(p, kara[0])).toContain("기호 반대로");
    p.secs["카라"].round = true;
    expect(directionText(p, kara[0])).toContain("원통");
  });
});

describe("chunks", () => {
  it("splits at top level only", () => {
    const c = chunksOf("겉1, (안1, 겉1) 4번 반복, 2/2RC, 안3 / k2tog, YO, 겉2 (20코)");
    expect(c).toEqual(["겉1", "(안1, 겉1) 4번 반복", "2/2RC", "안3", "k2tog", "YO", "겉2 (20코)"]);
    expect(c.map(countChunk)).toEqual([1, 8, 4, 3, 2, 0, 2]);
    expect(stitchesThrough(c, 6)).toBe(20);
  });
  it("unknown → null", () => {
    expect(countChunk("끝까지 겉뜨기")).toBeNull();
    expect(countChunk("[겉2, 안2] 총 3번 반복")).toBe(12);
    expect(countChunk("DS")).toBe(1);
    expect(countChunk("A 3코")).toBe(3);
  });
});

describe("local parser", () => {
  it("parses rows, sections, stitches", () => {
    const s = localParse("[뒷판]\n1단(RS): 겉뜨기 끝까지\n2단(WS): 안뜨기 끝까지\n3~6단: 1~2단 반복 (48코)\n소매\n1단: 겉");
    expect(s.map((x) => x.name)).toEqual(["뒷판", "소매"]);
    expect(s[0].rows[2]).toMatchObject({ from: 3, to: 6, stitches: "48코" });
    expect(s[0].rows[0].side).toBe("RS");
    expect(needsClaude("3~6단: 1~2단 반복", s)).toBe(true);
  });
  it("ranges", () => {
    expect([...parseRange("2, 5, 7-12", 42)]).toEqual([2, 5, 7, 8, 9, 10, 11, 12]);
    expect(toRanges([2, 5, 7, 8, 9, 10, 11, 12])).toBe("2, 5, 7-12");
  });
});

/* synthetic text layer imitating the cardigan PDF */
const t = (str: string, x: number, y: number, w = 8, h = 7): TItem => ({ str, x, y, w, h });
function chartItems(n0: number, n1: number, b: number, a: number, left: number, right: number): TItem[] {
  const out: TItem[] = [];
  for (let n = n0; n <= n1; n++) {
    const yc = a + b * n;
    const y = yc + 7 * 0.35;
    if (n % 2 === 0) out.push(t(String(n), left, y, String(n).length * 3.5));
    else out.push(t(String(n), right, y, String(n).length * 3.5));
  }
  return out;
}

describe("page auto-select", () => {
  const ko = "가나다라마바사아자차".repeat(8);
  const pages = [
    [t("표지", 0, 0)],
    [t("게이지 20코 26단 " + ko, 0, 0)],
    [t("차트 보는 법 기법 설명 " + ko, 0, 0)],
    [t("S, M 사이즈 " + ko, 0, 0), t("1단", 0, 10), t("2단(WS)", 0, 20)],
    [t("L, XL 사이즈 " + ko, 0, 0), t("1단", 0, 10), t("2단(WS)", 0, 20)],
    [t("2XL, 3XL 사이즈 " + ko, 0, 0), t("1단", 0, 10), t("2단", 0, 20)],
    ...[7, 8, 9, 10, 11, 12].map((n) => [t((n === 9 ? "L사이즈 샘플 " : "") + ko, 0, 0), t("1단", 0, 10), t("16단~58단", 0, 20)]),
    [t("2", 0, 0), t("3", 0, 10)],
  ];
  const info = pages.map((it, i) => pageInfo(i + 1, it));
  it("L → 2, 5, 7-12", () => expect(toRanges(autoPick(info, "L").pages)).toBe("2, 5, 7-12"));
  it("M → 2, 4, 7-12", () => expect(toRanges(autoPick(info, "m").pages)).toBe("2, 4, 7-12"));
  it("scanned → all", () => expect(autoPick([pageInfo(1, []), pageInfo(2, [t("12", 0, 0)])], "L")).toEqual({ pages: [1, 2], scanned: true }));
});

describe("chart axis", () => {
  it("finds a two-axis chart and maps rows to y", () => {
    const items = [...chartItems(2, 116, -4.5, 800, 60, 772), t("230", 100, 815), t("220", 140, 815), t("210", 180, 815), t("L 뒷판", 300, 30, 30)];
    const charts = findCharts(items, 842);
    expect(charts).toHaveLength(1);
    const c = charts[0];
    expect(c.nMin).toBe(2);
    expect(c.nMax).toBe(116);
    expect(c.b).toBeCloseTo(-4.5, 2);
    expect(rowY(c, 50)).toBeCloseTo(800 - 4.5 * 50, 1);
    expect(c.x0).toBeLessThan(62);
    expect(c.x1).toBeGreaterThan(772);
    expect(chartFor(charts, 1)).toBe(c);
  });
  it("separates two charts on one page", () => {
    const items = [...chartItems(1, 31, -6, 400, 40, 300), ...chartItems(1, 20, -6, 800, 40, 300)];
    const charts = findCharts(items, 595);
    expect(charts).toHaveLength(2);
  });
});

describe("legend", () => {
  it("crops below the heading", () => {
    const items = [t("차트 보는 법", 85, 100, 60), t("기법 설명", 85, 318, 50), ...Array.from({ length: 20 }, (_, i) => t("2/1LC 설명", 120, 336 + i * 25, 200)), t("페이지 바닥", 85, 1000)];
    const l = findLegend(items)!;
    expect(l.y0).toBeLessThan(318);
    expect(l.y1).toBeGreaterThan(810);
    expect(l.y1).toBeLessThan(900);
    expect(l.x0).toBeCloseTo(45, 0);
  });
});

describe("colorwork", () => {
  it("drawing → description with reading direction", () => {
    let d = newDrawing(5, 2);
    d = fillRow(d, 0, 0);
    d = setCell(d, 0, 0, 1);
    const yarns = [{ code: "A", name: null, hex: "#ffffff" }, { code: "B", name: null, hex: "#ff0000" }];
    expect(describeRow(d, 1, "WS", yarns)).toBe("B 1코, A 4코 (5코)");
    expect(describeRow(d, 1, "RS", yarns)).toBe("A 4코, B 1코 (5코)");
    expect(describeRow(d, 2, "RS", yarns)).toBeNull();
    expect(rowColors(d, 1)).toEqual([1, 0]);
    expect(chunksOf(describeRow(d, 1, "RS", yarns)!).map(countChunk)).toEqual([4, 1]);
    const r = resize(d, 3, 3);
    expect(r.cells).toBe("100......");
  });
  it("colors in text & yarn merge", () => {
    expect(colorsInText("A색 겉3, B색 겉1", [])).toEqual(["A", "B"]);
    expect(mergeYarns([{ code: "A", name: null, hex: null }], [{ code: "A", name: "아이보리", hex: "#fff8e7" }, { code: "B", hex: "bad" }])).toEqual([
      { code: "A", name: "아이보리", hex: "#fff8e7" }, { code: "B", name: null, hex: null }]);
  });
  it("dominant colors / nearest", () => {
    const px: [number, number, number][] = [...Array(50).fill([250, 250, 250]), ...Array(30).fill([200, 30, 40]), ...Array(20).fill([20, 60, 180])];
    const d = dominantColors(px);
    expect(d).toHaveLength(2);
    expect(nearest([210, 20, 30], ["#1e3cb4", "#c81e28"])).toBe(1);
  });
});

import { floodFill, copyRect, paste, mirrorRect, tileRepeat, insertRow, deleteCol, longestFloat, gridFromPixels } from "../src/drawing";
describe("drawing tools", () => {
  it("fill, copy/paste, mirror, repeat, insert/delete, floats", () => {
    let d = newDrawing(4, 2);
    d = floodFill(d, 0, 0, 0);
    expect(d.cells).toBe("00000000");
    d = setCell(d, 0, 0, 1);
    expect(mirrorRect(d, { c0: 0, r0: 0, c1: 3, r1: 0 }, "h").cells.slice(0, 4)).toBe("0001");
    const clip = copyRect(d, { c0: 0, r0: 0, c1: 1, r1: 0 });
    expect(paste(d, clip, 2, 1).cells.slice(4)).toBe("0010");
    expect(tileRepeat(d, { c0: 0, r0: 0, c1: 1, r1: 0 }, "x").cells.slice(0, 4)).toBe("1010");
    expect(insertRow(d, 1).h).toBe(3);
    expect(deleteCol(d, 0).cells).toBe("000000");
    let f = newDrawing(10, 1);
    f = fillRow(f, 0, 0); f = setCell(f, 0, 0, 1); f = setCell(f, 9, 0, 1);
    expect(longestFloat(f, 1)).toEqual({ color: 1, len: 8 });
    const g = gridFromPixels((x) => (x ? [255, 0, 0] : [0, 0, 255]), 2, 1, ["#0000ff", "#ff0000"]);
    expect(g.cells).toBe("01");
  });
});
