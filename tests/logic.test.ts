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

import { quantize, gridFromImage, colorCounts, cellAspect, rowsForWidth } from "../src/drawing";
describe("image import", () => {
  it("quantize finds the main colors, most used first", () => {
    const px: [number, number, number][] = [...Array(60).fill([240, 238, 230]), ...Array(30).fill([15, 22, 35]), ...Array(10).fill([20, 25, 40])];
    const pal = quantize(px, 2);
    expect(pal).toHaveLength(2);
    expect(parseInt(pal[0].slice(1, 3), 16)).toBeGreaterThan(200);
  });
  it("grid from image crop (top of image = top row)", () => {
    const get = (_x: number, y: number): [number, number, number] => (y < 50 ? [0, 0, 0] : [255, 255, 255]);
    const d = gridFromImage(get, { x: 0, y: 0, w: 100, h: 100 }, 2, 2, ["#ffffff", "#000000"]);
    expect(d.cells).toBe("0011"); // 아래 단(흰) → 위 단(검정)
    expect(colorCounts(d)).toEqual([2, 2]);
  });
  it("gauge aspect", () => {
    expect(cellAspect({ w: 1, h: 1, start: 1, cells: ".", opt: { gauge: { st: 18, rows: 23 } } })).toBeCloseTo(0.783, 2);
    expect(rowsForWidth(20, 100, 100, { st: 18, rows: 23 })).toBe(26);
  });
});

import { compare, washChange, convertSt, findGauges, myGauge, cmToRows } from "../src/gauge";
describe("gauge", () => {
  it("compare & advice", () => {
    const c = compare({ st: 18, rows: 23 }, { st: 20, rows: 23 });
    expect(c.stOk).toBe(false);
    expect(c.stPct).toBe(11.1);
    expect(c.advice).toMatch(/굵게/);
    expect(compare({ st: 18, rows: 23 }, { st: 18.2, rows: 23.3 }).advice).toBe("게이지가 맞아요.");
  });
  it("wash, convert, pick", () => {
    expect(washChange({ st: 18, rows: 22 }, { st: 19, rows: 24 })).toEqual({ widthPct: -5.3, lengthPct: -8.3 });
    expect(convertSt(110, { st: 18, rows: 23 }, { st: 20, rows: 24 })).toBe(122);
    expect(cmToRows(10, { st: 18, rows: 23 })).toBe(23);
    expect(myGauge({ label: "", pattern: null, before: { st: 1, rows: 1 }, after: null })).toEqual({ st: 1, rows: 1 });
  });
  it("finds gauges in pattern text", () => {
    expect(findGauges("게이지 : 20코 26단 (5.5mm 바늘, 10 x 10cm 메리야스뜨기) 42코 30단 (5.5mm 바늘, 19 x 13cm 무늬게이지)")).toEqual([
      { label: "메리야스", st: 18, rows: 23, needle: "5.5mm" },
      { label: "무늬 (원문 42코 30단 / 19×13cm)", st: 22.1, rows: 23.1, needle: "5.5mm" }]);
    expect(findGauges("Knitting tension: 22 sts and 30 rows = 10 cm in stockinette").map((g) => [g.st, g.rows])).toEqual([[22, 30]]);
  });
});

import { sizeOrder, resolveSizes, chartRef, localParseLines, localGoodEnough } from "../src/parse";
describe("on-device reading", () => {
  it("size order & numbers", () => {
    const order = sizeOrder("사이즈 S (M) L (XL) 2XL (3XL)");
    expect(order).toEqual(["S", "M", "L", "XL", "2XL", "3XL"]);
    expect(resolveSizes("100 (104) 110 (114) 124 (134)코가 되도록, 겉2 (3)", "L", order)).toBe("110코가 되도록, 겉2 (3)");
    expect(resolveSizes("5 (5) 6 (6) - (7)회", "2XL", order)).toBe("-회");
  });
  it("chart refs", () => {
    expect(chartRef("16단~58단까지 [차트 S:p13 / M:p18 / L:p23]를 따라", "L")).toBe(23);
    expect(chartRef("차트 p26 참고", "")).toBe(26);
    expect(chartRef("겉뜨기 p2", "")).toBeNull();
  });
  it("parses lines across pages with chart & stitches", () => {
    const secs = localParseLines([
      { t: "뒷판 경사뜨기 — L, XL 사이즈", pg: 5 }, { t: "1단(RS) 110코 기초코, 겉11, DS, 턴", pg: 5 }, { t: "2단(WS) 안뜨기 (110코)", pg: 5 },
      { t: "3단 겉뜨기", pg: 7 }, { t: "16단~58단까지 [차트 S:p13 / M:p18 / L:p23]를 따라 진행", pg: 7 },
      { t: "소매", pg: 10 }, { t: "1단 원통으로 연결해 겉뜨기", pg: 10 },
    ], "L");
    expect(secs.map((s) => s.name)).toEqual(["뒷판 경사뜨기", "소매"]);
    expect(secs[0].chart).toBe(23);
    expect(secs[0].rows[1].stitches).toBe("110코");
    expect(secs[0].rows[2].page).toBe(7);
    expect(secs[1].round).toBe(true);
    expect(localGoodEnough(secs, "").ok).toBe(true);
    expect(localGoodEnough(secs, "3단: 1단과 동일").ok).toBe(false);
  });
});

import { toLines } from "../src/pdfgeom";
describe("text lines", () => {
  it("joins same-height items left to right, drops axis numbers", () => {
    expect(toLines([t("겉11, DS", 110, 100, 40), t("1단(RS)", 40, 100.5, 30), t("2", 5, 100), t("2단(WS)", 40, 124, 30), t("안뜨기", 110, 124, 30)]))
      .toEqual(["1단(RS) 겉11, DS", "2단(WS) 안뜨기"]);
  });
});

describe("real-world formats", () => {
  it("English & crochet rows, counts, sizes", () => {
    const secs = localParseLines([
      { t: "★얼굴, 몸", pg: 1 }, { t: "1단: 사슬3개, 기둥코포함 한길긴뜨기12개", pg: 1 }, { t: "2단: 사슬1개, 짧은뜨기 1개씩(12개)", pg: 1 },
      { t: "EARS (make 2 – worked in continuous spirals)", pg: 3 }, { t: "1st round: [1dc in next dc, inc in next dc] 3 times … 9dc.", pg: 3 },
      { t: "Rnd 2: *K1, p1*; rep * to * around.", pg: 3 },
    ]);
    expect(secs.map((s) => s.name)).toEqual(["얼굴, 몸", "EARS"]);
    expect(secs[0].rows[1].stitches).toBe("12코");
    expect(secs[1].rows[0].stitches).toBe("9코");
    expect(secs[1].rows[1].from).toBe(2);
    const order = sizeOrder("SIZES - WOMEN’S XS (S, M, L, XL, 2XL, 3XL, 4XL)");
    expect(order).toEqual(["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL"]);
    expect(resolveSizes("CO 46 (46, 46, 48, 48, 48, 48, 48) sts", "L", order)).toBe("CO 48 sts");
    expect(resolveSizes("cast on 96-104-112-120-128-136 sts", "L", ["S", "M", "L", "XL", "2XL", "3XL"])).toBe("cast on 112 sts");
    expect(localGoodEnough(secs, "Rep 2nd round once.").ok).toBe(false);
  });
  it("splits two-column pages", () => {
    const L = (s: string, x: number, y: number) => t(s, x, y, s.length * 4);
    const items = [0, 1, 2, 3, 4].flatMap((k) => [L(`${k + 1}단: 왼쪽 ${k}`, 40, 100 + k * 20), L(`오른쪽 ${k}`, 330, 100 + k * 20)]);
    const lines = toLines(items, 595);
    expect(lines.slice(0, 5).every((l) => l.includes("왼쪽"))).toBe(true);
    expect(lines[5]).toBe("오른쪽 0");
  });
});

describe("real-world fixes", () => {
  it("keeps number lists in one chunk; skips non-part headings", () => {
    expect(chunksOf("한길긴뜨기 1,1,1,2 순서 (45개)")).toEqual(["한길긴뜨기 1,1,1,2 순서 (45개)"]);
    const secs = localParseLines([{ t: "SPECIAL ABBREVIATION", pg: 1 }, { t: "1st round: Inc once in each dc … 10dc.", pg: 1 }, { t: "HEAD", pg: 1 }, { t: "1st round: Inc once … 12dc.", pg: 1 }]);
    expect(secs.map((s) => s.name)).toEqual(["HEAD"]);
  });
});

import { legendEntries, matchToken, gridLattice, textAt } from "../src/symbols";
describe("symbol names", () => {
  const lgItems = [
    t("기법 설명", 30, 318, 50), t("안뜨기", 280, 336, 30), t("|", 200, 368, 3), t("겉뜨기", 280, 368, 30),
    t("R", 200, 400, 6), t("오른코 늘림 (M1R)", 280, 400, 70), t("SSK", 195, 432, 16), t("오른코 2코 모아 겉뜨기", 280, 432, 90),
    t("K2tog tbl", 180, 464, 40), t("2코 한 번에 뒷쪽 실에 찔러", 280, 464, 120), t("겉뜨기 (꼬아뜨기)", 280, 476, 60),
    t("오른코 위 2코와 1코(겉뜨기) 교차뜨기 - 2/1 LC", 280, 508, 180),
  ];
  const entries = legendEntries(lgItems, { x0: 30, y0: 300, x1: 470, y1: 520 });
  it("reads legend rows (symbol text / name, wrapped names, graphic symbols)", () => {
    expect(entries.map((e) => [e.sym, e.name])).toEqual([
      ["", "안뜨기"], ["|", "겉뜨기"], ["R", "오른코 늘림 (M1R)"], ["SSK", "오른코 2코 모아 겉뜨기"],
      ["K2tog tbl", "2코 한 번에 뒷쪽 실에 찔러 겉뜨기 (꼬아뜨기)"], ["", "오른코 위 2코와 1코(겉뜨기) 교차뜨기 - 2/1 LC"]]);
  });
  it("matches chart text to entries", () => {
    expect(matchToken("ssk", entries)?.name).toBe("오른코 2코 모아 겉뜨기");
    expect(matchToken("|", entries)?.name).toBe("겉뜨기");
    expect(matchToken("M1R", entries)?.sym).toBe("R");
    expect(matchToken("cut", entries)).toBeNull();
    expect(textAt([t("SSK", 100, 50, 16, 6), t("12", 90, 50)], 108, 47)?.str).toBe("SSK");
  });
  it("finds grid lattice and ignores knit bars at cell centers", () => {
    // 칸 너비 10, 격자선 x=5,15,25…; 칸 가운데(10, 30)에 '|' 획
    const dark = (x: number) => x % 10 === 5 || x === 10 || x === 30;
    const lat = gridLattice((x) => dark(x), 0, 100, 0, 40)!;
    expect(lat.w).toBeCloseTo(10, 0);
    expect(lat.off).toBeCloseTo(5, 0);
  });
});

import { parseToUnicode, makeDecoder } from "../src/fontfix";
import { unreadable } from "../src/symbols";
describe("font rescue", () => {
  it("reads ToUnicode and fills gaps in unicode-ordered runs", () => {
    const m = parseToUnicode("beginbfchar\n<31B0> <C548>\n<238F> <B728>\n<1A98> <AE30>\nendbfchar\nbeginbfrange\n<0030> <0032> <0041>\nendbfrange");
    expect(m.get(0x31b0)).toBe("안");
    expect(m.get(0x31)).toBe("B");
    m.set(0x18f1, "겉");
    const dec = makeDecoder(m);
    // 겉(6385=0x18F1)…기(6808=0x1A98) 사이가 유니코드와 같은 간격 → 그 사이 글자 번호도 읽힌다
    expect(dec(6385 + 10)).toBe(String.fromCharCode("겉".charCodeAt(0) + 10));
    expect(unreadable("ㆰ⎐᪘")).toBe(true);
    expect(unreadable("안뜨기")).toBe(false);
  });
});

describe("written swatch", () => {
  it("swatch instructions become the 스와치 tab, first", () => {
    const secs = localParseLines([
      { t: "뒷판", pg: 3 }, { t: "1단: 겉뜨기", pg: 3 }, { t: "2단: 안뜨기", pg: 3 },
      { t: "[게이지 스와치]", pg: 2 }, { t: "1단: 30코 기초코, 겉뜨기", pg: 2 }, { t: "2~30단: 메리야스뜨기 (30코)", pg: 2 },
    ]);
    const merged = mergeSections([], secs);
    expect(merged[0].name).toBe("스와치");
    expect(merged[0].rows[1]).toMatchObject({ from: 2, to: 30, stitches: "30코" });
  });
});

import { detectGrid } from "../src/drawing";
describe("photo grid detection", () => {
  it("finds cell count and area of a chart with margins", () => {
    // 여백 30px, 칸 11.3px, 24코 × 18단, 칸 색은 두 가지 무늬, 1px 회색 격자선
    const cw = 11.3, cols = 24, rows = 18, ox = 30, oy = 22;
    const W = Math.round(ox * 2 + cols * cw), H = Math.round(oy * 2 + rows * cw);
    const lum = (x: number, y: number) => {
      const gx = (x - ox) / cw, gy = (y - oy) / cw;
      if (gx < 0 || gy < 0 || gx >= cols || gy >= rows) return 250; // 여백
      if (gx % 1 < 1 / cw || gy % 1 < 1 / cw) return 120; // 격자선
      return (Math.floor(gx) * 7 + Math.floor(gy) * 3) % 5 < 2 ? 40 : 235;
    };
    const g = detectGrid(lum, W, H)!;
    expect(g.cols).toBe(cols);
    expect(g.rows).toBe(rows);
    expect(Math.abs(g.x - ox)).toBeLessThan(3);
    expect(Math.abs(g.w - cols * cw)).toBeLessThan(cw);
  });
});

import { quantizeAuto } from "../src/drawing";
describe("auto color count", () => {
  it("finds 3 colors (red, blue, white) and 2 for two-tone", () => {
    const n = (c: [number, number, number], k: number) => Array.from({ length: k }, (_, i) => [c[0] + (i % 7) - 3, c[1] + (i % 5) - 2, c[2] + (i % 3) - 1] as [number, number, number]);
    expect(quantizeAuto([...n([245, 245, 245], 300), ...n([178, 58, 72], 120), ...n([47, 93, 138], 90)])).toHaveLength(3);
    expect(quantizeAuto([...n([245, 245, 245], 300), ...n([20, 22, 35], 200)])).toHaveLength(2);
  });
});

describe("cast-on row and start side", () => {
  it("코잡기가 1단 + 2단 안면부터 → row1 cast-on, row2 WS, odd rows RS", () => {
    const { rows, secs } = expand([{ name: "스와치", rows: [
      { from: 1, to: 1, text: "◈ 코잡기가 1단이에요. 2단은 안면에서 시작해요." }, { from: 2, to: 31, text: "차트대로" }] }]);
    expect(rows[0].castOn).toBe(true);
    expect(rows[1].side).toBe("WS");
    expect(secs["스와치"].odd).toBe("RS");
    const p = newPattern({ id: "x", name: "x", rows, secs });
    expect(sideOf(p, rows[1])).toBe("WS");
    expect(sideOf(p, rows[2])).toBe("RS");
  });
});

describe("도안 정보", () => {
  it("치수·실·바늘·게이지 줄만 모으고 단은 빼요", async () => {
    const { extractInfo } = await import("../src/parse");
    const t = ["L 사이즈: 가슴둘레 110cm(실제 가슴둘레보다 +20cm 여유 권장)", "사용 실: 메리노 DK 6볼", "바늘: 4mm 줄바늘", "게이지", "1단: 겉뜨기 (110코)", "뒷판", "게이지: 메리야스 22코 30단", "Using 3.00mm hook and CC, work 6dc into mr.", "바늘에 100코가 있습니다. 실을 자르고 코를 쉼코로 둡니다."].join("\n");
    const info = extractInfo(t).split("\n");
    expect(info).toEqual(["L 사이즈: 가슴둘레 110cm(실제 가슴둘레보다 +20cm 여유 권장)", "사용 실: 메리노 DK 6볼", "바늘: 4mm 줄바늘", "게이지: 메리야스 22코 30단"]);
  });
  it("사이즈를 고르면 내 사이즈 숫자만, 다른 사이즈 줄은 빼요", async () => {
    const { extractInfo } = await import("../src/parse");
    const t = ["사이즈 : S (M) L (XL) 2XL (3XL)", "가슴둘레 : 96 (104) 110 (1 0) 126 (136) cm", "S사이즈 [차트 p13]", "M사이즈: 소매 길이 44cm"].join("\n");
    expect(extractInfo(t, "L")).toBe("사이즈 : L\n가슴둘레 : 118 cm");
  });
  it("옛 데이터의 notes는 도안 정보로 옮기고 앱 안내만 남겨요", async () => {
    const { normalize } = await import("../src/model");
    const p = normalize({ id: "x", name: "a", notes: "기기에서 읽었어요 (Claude 안 씀).\nL 사이즈: 가슴둘레 110cm" } as any);
    expect(p.info).toBe("L 사이즈: 가슴둘레 110cm");
    expect(p.notes).toBe("기기에서 읽었어요 (Claude 안 씀).");
  });
});

describe("차트 한 단 → 서술", () => {
  it("겉·안은 개수로 묶고, 안면이면 겉↔안을 바꾸고, 교차뜨기는 약어로", async () => {
    const { rowText } = await import("../src/symbols");
    const st = [
      { name: "겉뜨기", sym: "|", cells: 1 }, { name: "겉뜨기", sym: "|", cells: 1 },
      { name: "안뜨기", sym: "", cells: 1 },
      { name: "오른코 위 2코 교차뜨기 - 2/2 LC", sym: "", cells: 4 },
      { name: "왼코 2코 모아 겉뜨기", sym: "K2tog", cells: 1 },
    ];
    expect(rowText(st, false)).toBe("겉2, 안1, 2/2 LC, K2tog");
    expect(rowText(st.slice(0, 3), true)).toBe("안2, 겉1");
    const k = { name: "겉뜨기", sym: "|", cells: 1 }, pu = { name: "안뜨기", sym: "", cells: 1 };
    expect(rowText([pu, pu, k, pu, k, pu, k, pu, k, pu, k], false)).toBe("안2, (겉1, 안1) 4번 반복, 겉1");
  });
});

describe("배색 격자 크기", () => {
  it("기초코 문장 > 단 끝 콧수에서 파트 콧수", async () => {
    const { partStitches } = await import("../src/model");
    const R = (n: number, t: string, st: string | null = null) => ({ s: "a", n, t, st, side: null, pg: null, ch: null, span: null });
    expect(partStitches([R(1, "5.5mm 바늘로 38코 기초코. 코잡기가 1단입니다.")])).toBe(38);
    expect(partStitches([R(1, "5.5mm 바늘로 110 코를 만듭니다.")])).toBe(110);
    expect(partStitches([R(1, "Cast on 60 sts")])).toBe(60);
    expect(partStitches([R(1, "겉뜨기", "48코"), R(2, "안뜨기", "48코"), R(3, "늘림", "50코")])).toBe(48);
    expect(partStitches([R(1, "겉뜨기")])).toBe(null);
  });
});

describe("서술 줄 나누기", () => {
  it("안내 문장은 따로, 코 지시만 묶음, ' / '는 마커", async () => {
    const { splitNarrative } = await import("../src/chunks");
    const t = "2단에서 표시한 칸 위에 마커를 양쪽에 하나씩 겁니다. (나중에 코 줍는 위치)\n안4, 겉2, 안2 / 안2, 겉9 / 안1, 턴\n차트를 따라 진행 (양쪽 가장자리 'T' 표시 위치 차트대로)";
    const r = splitNarrative(t);
    expect(r.notes.length).toBe(2);
    expect(r.chunks).toEqual(["안4", "겉2", "안2", "마커", "안2", "겉9", "마커", "안1", "턴"]);
    expect(splitNarrative("겉뜨기 2, 안뜨기 2").chunks).toEqual(["겉뜨기 2", "안뜨기 2"]);
  });
});

describe("원본 쪽에서 이 단 자리", () => {
  it("한 쪽에 다른 사이즈가 섞여 있어도 내 사이즈 구역의 그 단", async () => {
    const { findRowSpot } = await import("../src/pdfgeom");
    const I = (str: string, y: number) => ({ str, x: 40, y, w: 60, h: 10 });
    const items = [I("15단(RS)", 60), I("16단~58단까지 차트를 따라 진행합니다.", 100), I("L사이즈", 160), I("2단(WS)", 200), I("3단(RS)", 230), I("16단~58단까지 차트를 따라 진행합니다.", 400), I("XL사이즈", 500), I("2단(WS)", 540)];
    expect(findRowSpot(items as any, 2, null, "L")).toEqual({ y0: 188, y1: 220 });
    expect(findRowSpot(items as any, 20, [16, 58], "L")!.y0).toBe(388);
    expect(findRowSpot(items as any, 2, null, "M")).toBe(null);
  });
});

describe("여러 단 공통 지시", () => {
  it("매 단 할 일과 다 뜬 뒤 할 일을 나누고, 다른 범위 줄은 뺀다", async () => {
    const { spanParts } = await import("../src/model");
    const t = "16단~58단까지 차트를 따라 진행합니다. 이제 바늘에 96코예요. 실을 자르고 코를 쉼코로 둡니다.\n16단~66단까지 차트를 따라 진행합니다. 실을 자르고 코를 쉼코로 둡니다.\n차트를 따라 진행";
    const r = spanParts(t, [16, 58]);
    expect(r.each).toBe("차트를 따라 진행합니다.");
    expect(r.end).toBe("이제 바늘에 96코예요. 실을 자르고 코를 쉼코로 둡니다.");
    expect(spanParts("차트를 따라 진행", [59, 116]).each).toBe("차트를 따라 진행");
  });
});

describe("사이즈별 치수 표", () => {
  it("사이즈 수만큼 숫자가 있는 치수 줄을 모은다", async () => {
    const { sizeTable } = await import("../src/parse");
    const t = ["사이즈 : S (M) L (XL) 2XL (3XL)", "가슴둘레 : 96 (104) 110 (1 0) 126 (136) cm", "(실제 가슴둘레보다 +20cm 정도 여유를 권장합니다.)", "총 기장 : 55 (57) 59 (61) 63 (66) cm *카라포함", "게이지 : 20코 26단"].join("\n");
    const r = sizeTable(t)!;
    expect(r.order).toEqual(["S", "M", "L", "XL", "2XL", "3XL"]);
    expect(r.rows.map((x) => x.label)).toEqual(["가슴둘레", "총 기장"]);
    expect(r.rows[0].values.map(String)).toEqual(["96", "104", "110", "NaN", "126", "136"]);
    expect(r.rows[1].unit).toBe("cm");
  });
});

describe("스와치로 사이즈 다시 고르기", () => {
  it("내 콧수가 적으면(헐렁) 작은 사이즈를 권한다", async () => {
    const { sizeAdvice } = await import("../src/gauge");
    const r = sizeAdvice(["S", "M", "L", "XL"], [96, 104, 110, NaN], "L", { st: 18, rows: 23 }, { st: 17, rows: 23 });
    expect(r.list.map((x) => x.mine).slice(0, 3)).toEqual([101.6, 110.1, 116.5]);
    expect(r.best).toBe("M");
    expect(sizeAdvice(["S", "M", "L"], [96, 104, 110], "L", { st: 18, rows: 23 }, { st: 18, rows: 23 }).best).toBe("L");
  });
});

describe("기호표 범위", () => {
  it("약어표 블록 아래 다른 내용(머리말·큰 간격)은 넣지 않는다", async () => {
    const { findLegend } = await import("../src/pdfgeom");
    const I = (str: string, x: number, y: number, w = 120) => ({ str, x, y, w, h: 9 });
    const items = [I("ABBREVIATIONS", 40, 100)];
    for (let k = 0; k < 9; k++) items.push(I(`Alt = Alternate ${k}`, 40, 112 + k * 11), I(`P = Purl ${k}`, 200, 112 + k * 11), I(`Ssk = Slip ${k}`, 360, 112 + k * 11));
    items.push(I("SIZES", 40, 225), I("To fit bust measurement 32-34 in", 40, 237, 500), I("Finished bust 40 in", 40, 248, 500));
    const lg = findLegend(items as any)!;
    expect(lg.y1).toBeLessThan(220);
    expect(lg.x1).toBeLessThan(500);
  });
});

describe("길이로 정한 반복 풀기", () => {
  it("Rep last 2 rows for 2\" [5 cm], ending on a 2nd row → 게이지 16단/10cm면 8단까지, 뒤 단은 밀린다", async () => {
    const { newPattern, expandLengthRepeats, partRows } = await import("../src/model");
    const R = (s: string, n: number, t: string) => ({ s, n, t, st: null, side: null, pg: null, ch: null, span: null });
    const p = newPattern({ id: "x", name: "x", rows: [
      R("rib", 1, "1st row: (RS). *K2. P2. Rep from * to last 2 sts. K2."),
      R("rib", 2, "2nd row: *P2. K2. Rep from * to last 2 sts. P2."),
      R("rib", 3, "Rep last 2 rows (K2. P2) ribbing for 2\" [5 cm], ending on a 2nd row and dec 1 st."),
      R("rib", 4, "Bind off."),
    ] as any, gauges: [{ label: "st", pattern: { st: 12, rows: 16 }, before: null, after: null }] });
    p.done["rib#4"] = 1;
    expandLengthRepeats(p);
    const rows = partRows(p, "rib");
    expect(rows.map((r) => r.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(rows[2].t).toBe("*K2. P2. Rep from * to last 2 sts. K2.");
    expect(rows[3].t).toBe("*P2. K2. Rep from * to last 2 sts. P2.");
    expect(rows[7].t).toMatch(/dec 1 st/);
    expect(rows[8].t).toBe("Bind off.");
    expect(p.done["rib#9"]).toBe(1);
    expandLengthRepeats(p); // 다시 해도 그대로
    expect(partRows(p, "rib").length).toBe(9);
  });
});

describe("완성 시간·페이스", () => {
  it("작업 기록으로 걸린 시간, 단 끝 콧수로 뜬 코 수", async () => {
    const { newPattern, finishText, partStats } = await import("../src/model");
    const R = (n: number, t: string, st: string | null = null) => ({ s: "a", n, t, st, side: null, pg: null, ch: null, span: null });
    const p = newPattern({ id: "x", name: "x", rows: [R(1, "40코 기초코"), R(2, "겉뜨기"), R(3, "겉뜨기", "40코"), R(4, "안뜨기", "40코")] as any });
    const t0 = 1_000_000;
    // 단마다 10분, 3단과 4단 사이에 2시간 쉼
    p.done["a#1"] = t0; p.done["a#2"] = t0 + 600000; p.done["a#3"] = t0 + 1200000; p.done["a#4"] = t0 + 1200000 + 600000 + 7200000;
    p.fin["a"] = p.done["a#4"];
    const st = partStats(p, "a");
    expect(Math.round(st.ms / 60000)).toBe(40);
    expect(Math.round(st.rest / 60000)).toBe(120);
    expect(st.stitches).toBe(160);
    expect(finishText(p, "a")).toBe("실제 뜬 시간 40분 · 쉰 시간까지 2시간 40분 · 시간당 약 240코 페이스 (총 160코 · 4단)");
    // 시작·중지 버튼을 썼으면 켜 둔 시간만
    const { workStart, workStop } = await import("../src/model");
    workStart(p, p.done["a#1"] - 600000); workStop(p, p.done["a#3"]);
    workStart(p, p.done["a#4"] - 900000); workStop(p, p.done["a#4"]);
    expect(Math.round(partStats(p, "a").ms / 60000)).toBe(45);
  });
});

describe("사이즈별 차트 범위", () => {
  it("차트 아래 XL · 2/3XL · 4/5XL 선 → 내 사이즈 시작선부터", async () => {
    const { sizeMarks, sizeRange } = await import("../src/pdfgeom");
    const c = { a: 300, b: -10, nMin: 1, nMax: 20, x0: 20, x1: 520, axes: [515] } as any; // 1단 y=290
    const I = (str: string, x: number, y: number) => ({ str, x, y, w: 14, h: 6 });
    const items = [I("XL", 393, 305), I("2/3XL", 450, 305), I("4/5XL", 497, 305), I("Start Here", 480, 318)];
    expect(sizeMarks(items as any, c).map((m) => m.sizes.join(","))).toEqual(["XL", "2XL,3XL", "4XL,5XL"]);
    const r = sizeRange(items as any, c, "2XL")!;
    expect(r[1]).toBe(457);
    expect(r[0]).toBe(20);
    expect(sizeRange(items as any, c, "M")).toBe(null);
  });
});

describe("스트레칭 알림", () => {
  it("10분 넘게 빈 곳에서 끊어 쉬지 않고 뜬 시간을 센다", async () => {
    const { newPattern, continuousKnitMs } = await import("../src/model");
    const p = newPattern({ id: "x", name: "x" });
    const now = 10_000_000;
    p.done = { "a#1": now - 3600000, "a#2": now - 35 * 60000, "a#3": now - 25 * 60000, "a#4": now - 15 * 60000, "a#5": now - 5 * 60000 };
    expect(continuousKnitMs(p, now) / 60000).toBe(35);
    expect(continuousKnitMs(p, now + 20 * 60000)).toBe(0);
  });
});

describe("원하는 만큼 뜨는 단 늘리고 줄이기", () => {
  it("두 단 반복이면 번갈아 더하고, 뒤 단과 완료 기록이 밀린다", async () => {
    const { newPattern, addRowAfter, removeRow, partRows } = await import("../src/model");
    const R = (n: number, t: string, ln?: string) => ({ s: "a", n, t, st: null, side: null, pg: null, ch: null, span: null, ...(ln ? { ln } : {}) });
    const p = newPattern({ id: "x", name: "x", rows: [R(1, "K2. P2."), R(2, "P2. K2."), R(3, "K2. P2.", "길이"), R(4, "P2. K2.\nRep for 2in", "길이"), R(5, "Bind off.")] as any });
    p.done["a#5"] = 9;
    addRowAfter(p, "a", 4);
    expect(partRows(p, "a").map((r) => r.t.split("\n")[0])).toEqual(["K2. P2.", "P2. K2.", "K2. P2.", "P2. K2.", "K2. P2.", "Bind off."]);
    expect(p.done["a#6"]).toBe(9);
    removeRow(p, "a", 5);
    expect(partRows(p, "a").map((r) => r.n)).toEqual([1, 2, 3, 4, 5]);
    expect(p.done["a#5"]).toBe(9);
  });
});
