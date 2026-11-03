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
