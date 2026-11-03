/** 차트에서 누른 칸의 기호 → 기법 이름 (기기에서) */
import type { Bitmap } from "./chart";
import { renderPage, textItems, type Pdf } from "./pdf";
import { rowH, rowY, type Chart } from "./pdfgeom";
import { gridLattice, symbolScore, legendEntries, matchToken, textAt, unreadable, type Box, type LegendEntry } from "./symbols";
import type { Pattern } from "./types";

export type SymHit = {
  sym: string;
  name: string;
  guess: boolean; // 그림 비교로 추정
  rect: Box | null; // 기호 칸 (pt)
  n: number; // 단
  st: number | null; // 오른쪽에서 몇 번째 칸
  fromRight: number | null; // 기호의 오른쪽 끝 칸이 오른쪽에서 몇 번째
  fromLeft: number | null; // 기호의 왼쪽 끝 칸이 왼쪽에서 몇 번째
  entry: LegendEntry | null;
  img: HTMLCanvasElement | null; // 기호표의 그 줄 (기호 + 이름 그대로)
};

type Tmpl = { entry: LegendEntry; canvas: HTMLCanvasElement | null };
type LegendData = { entries: LegendEntry[]; tmpls: Tmpl[]; page: HTMLCanvasElement | null; lg: Box | null };
const legendCache = new Map<string, Promise<LegendData>>();
const T_SCALE = 3;

function legendData(p: Pattern, pdf: Pdf): Promise<LegendData> {
  const lg = p.legend && "page" in p.legend ? p.legend : null;
  const key = p.id + ":" + (lg ? [lg.page, lg.x0, lg.y0, lg.x1, lg.y1].join(",") : "none");
  let c = legendCache.get(key);
  if (!c) {
    c = (async () => {
      if (!lg) return { entries: [], tmpls: [], page: null, lg: null };
      const t = await textItems(pdf, lg.page);
      const entries = legendEntries(t.items, lg);
      const page = await renderPage(pdf, lg.page, T_SCALE);
      const ctx = page.getContext("2d", { willReadFrequently: true })!;
      const tmpls = entries.map((entry) => ({ entry, canvas: tightCrop(ctx, entry.area, T_SCALE) }));
      return { entries, tmpls, page, lg };
    })();
    legendCache.set(key, c);
  }
  return c;
}

/** 기호표의 한 줄(기호 + 이름)을 그림으로 */
function lineImage(L: LegendData, e: LegendEntry | null): HTMLCanvasElement | null {
  if (!e || !L.page || !L.lg) return null;
  // 기호 + 이름이 있는 부분만 꼭 맞게 (+ 여백)
  const ctx = L.page.getContext("2d", { willReadFrequently: true })!;
  // 기호와 이름 사이 빈 공간은 빼고 [기호] [이름]으로 붙인다
  const sym = tightCrop(ctx, { x0: L.lg.x0, x1: e.area.x1, y0: e.area.y0, y1: e.area.y1 }, T_SCALE);
  const name = tightCrop(ctx, { x0: e.area.x1, x1: L.lg.x1, y0: e.area.y0, y1: e.area.y1 }, T_SCALE);
  const parts = [sym, name].filter(Boolean) as HTMLCanvasElement[];
  if (!parts.length) return null;
  const pad = 6, gap = 16;
  const out = document.createElement("canvas");
  out.width = parts.reduce((w, c) => w + c.width, 0) + gap * (parts.length - 1) + pad * 2;
  out.height = Math.max(...parts.map((c) => c.height)) + pad * 2;
  const g = out.getContext("2d")!;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, out.width, out.height);
  let x = pad;
  for (const c of parts) {
    g.drawImage(c, x, (out.height - c.height) / 2);
    x += c.width + gap;
  }
  return out;
}

/** 영역 안에서 흰색이 아닌 부분만 잘라낸다 (기호 그림) */
function tightCrop(ctx: CanvasRenderingContext2D, a: Box, s: number): HTMLCanvasElement | null {
  const x0 = Math.max(0, Math.floor(a.x0 * s)), y0 = Math.max(0, Math.floor(a.y0 * s));
  const w = Math.max(1, Math.floor((a.x1 - a.x0) * s)), h = Math.max(1, Math.floor((a.y1 - a.y0) * s));
  const d = ctx.getImageData(x0, y0, w, h).data;
  let mx = w, my = h, Mx = -1, My = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (d[i] + d[i + 1] + d[i + 2] < 3 * 235) { if (x < mx) mx = x; if (x > Mx) Mx = x; if (y < my) my = y; if (y > My) My = y; }
    }
  if (Mx < 0) return null;
  const out = document.createElement("canvas");
  out.width = Mx - mx + 1;
  out.height = My - my + 1;
  out.getContext("2d")!.drawImage(ctx.canvas, x0 + mx, y0 + my, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

const pixCache = new WeakMap<HTMLCanvasElement, ImageData>();
function pixels(c: HTMLCanvasElement) {
  let d = pixCache.get(c);
  if (!d) pixCache.set(c, (d = c.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height)));
  return d;
}

/**
 * 영역을 W×H 칸으로 줄인 특징: 칸마다 가장 진한 밝기(가는 획도 살아남게) + 평균 색.
 * 결과는 RGBA 배열 모양 [진하기, 평균R, 평균G, 평균B] (imageDiff에 그대로 씀)
 */
function features(img: ImageData, sx: number, sy: number, sw: number, sh: number, W: number, H: number, inner = false): Uint8ClampedArray {
  if (inner) {
    const IN = 0.16;
    sx = img.width * IN; sy = img.height * IN; sw = img.width * (1 - 2 * IN); sh = img.height * (1 - 2 * IN);
  }
  const out = new Uint8ClampedArray(W * H * 4);
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const x0 = Math.floor(sx + (i * sw) / W), x1 = Math.max(x0 + 1, Math.floor(sx + ((i + 1) * sw) / W));
      const y0 = Math.floor(sy + (j * sh) / H), y1 = Math.max(y0 + 1, Math.floor(sy + ((j + 1) * sh) / H));
      let minL = 255, r = 0, g = 0, b = 0, n = 0;
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
          const k = (y * img.width + x) * 4;
          const L = (img.data[k] + img.data[k + 1] + img.data[k + 2]) / 3;
          if (L < minL) minL = L;
          r += img.data[k]; g += img.data[k + 1]; b += img.data[k + 2]; n++;
        }
      const o = (j * W + i) * 4;
      n = n || 1;
      out[o] = 255 - minL > 35 ? 255 : 0; // 획이 있나 없나 (진하기 차이는 무시)
      out[o + 1] = r / n; out[o + 2] = g / n; out[o + 3] = b / n;
    }
  return out;
}
/** 글자 하나를 칸 모양 그림으로 (가운데, 칸 높이의 60%) */
function glyphCell(token: string, cellRatio: number): ImageData {
  const H = 60, W = Math.round(H * cellRatio);
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);
  g.fillStyle = "#333"; g.textAlign = "center"; g.textBaseline = "middle";
  g.font = `${Math.round(H * 0.6)}px sans-serif`;
  g.fillText(token, W / 2, H / 2);
  return g.getImageData(0, 0, W, H);
}

const tmplPix = new WeakMap<HTMLCanvasElement, ImageData>();
function tpix(c: HTMLCanvasElement) {
  let d = tmplPix.get(c);
  if (!d) tmplPix.set(c, (d = c.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height)));
  return d;
}

/** 누른 점 (차트 쪽 pt 좌표) → 기호 */
/** 점검용 */
export async function debugTemplates(p: Pattern, pdf: Pdf) {
  const L = await legendData(p, pdf);
  return L.tmpls.map((t) => (t.canvas ? t.canvas.toDataURL("image/png") : ""));
}

export async function identify(p: Pattern, pdf: Pdf, page: number, bmp: Bitmap, x: number, y: number): Promise<SymHit | null> {
  const c: Chart | undefined = bmp.charts.find((ch) => {
    const n = (y - ch.a) / ch.b;
    return n >= ch.nMin - 0.6 && n <= ch.nMax + 0.6 && x >= ch.x0 && x <= ch.x1;
  });
  if (!c) return null;
  const n = Math.round((y - c.a) / c.b);
  const h = rowH(c);
  const yTop = rowY(c, n) - h / 2;
  const S = bmp.scale;
  const img = pixels(bmp.canvas);
  const dark = (px: number, py: number) => {
    const i = (Math.round(py) * img.width + Math.round(px)) * 4;
    const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2]; return r + g + b < 3 * 236 && Math.max(r, g, b) - Math.min(r, g, b) < 14; // 회색·검정 선만 (색칠된 칸 바탕은 아님)
  };
  // 격자: 이 단 위아래 몇 단에 걸쳐 찾는다
  const yA = Math.max(rowY(c, Math.min(c.nMax, n + 6)) - h / 2, rowY(c, c.nMax) - h / 2) * S;
  const yB = Math.min(rowY(c, Math.max(c.nMin, n - 6)) + h / 2, rowY(c, c.nMin) + h / 2) * S;
  const lat = gridLattice(dark, c.x0 * S, c.x1 * S, yA, yB);
  let rect: Box | null = null, st: number | null = null, k = 0;
  if (lat) {
    k = Math.floor((x * S - lat.off) / lat.w);
    if (x * S < Math.min(...lat.xs) - 1 || x * S > Math.max(...lat.xs) + 1) return null; // 격자 밖
    const left = lat.off + k * lat.w;
    rect = { x0: left / S, x1: (left + lat.w) / S, y0: yTop, y1: yTop + h };
    const right = Math.max(...lat.xs);
    if (left + lat.w <= right + 1) st = Math.round((right - (left + lat.w)) / lat.w) + 1;
  }
  const L = await legendData(p, pdf);
  const { entries, tmpls } = L;
  // 기호 칸 범위 → 오른쪽/왼쪽에서 몇 번째 (뜨기 시작하는 쪽에서 세려고 둘 다)
  const idx = (r: Box | null) => {
    if (!lat || !r) return { fromRight: st, fromLeft: null };
    const first = Math.round((Math.min(...lat.xs) - lat.off) / lat.w), last = Math.round((Math.max(...lat.xs) - lat.off) / lat.w) - 1;
    const a = Math.round((r.x0 * S - lat.off) / lat.w), b = Math.round((r.x1 * S - lat.off) / lat.w) - 1;
    return { fromRight: last - b + 1, fromLeft: a - first + 1 };
  };
  const out = (sym: string, e: LegendEntry | null, guess: boolean, r: Box | null): SymHit => ({
    sym, name: e ? (unreadable(e.name) ? "" : e.name) : "", guess, rect: r, n, st, ...idx(r), entry: e, img: e && unreadable(e.name) ? lineImage(L, e) : null,
  });
  // 1) 글자 기호
  const t = textAt((await textItems(pdf, page)).items, x, y);
  const token = t ? t.str.trim() : "";
  if (t) {
    const e = matchToken(token, entries);
    if (e) return out(token, e, false, rect);
  }
  if (!lat || !rect) return { ...out(token, null, true, null), name: token ? "기호표에서 찾지 못했어요" : "칸을 찾지 못했어요" };
  // 2) 그림 기호: 기호표 그림과 비교 (기호가 여러 칸이면 누른 칸을 포함하는 자리마다)
  const cellRatio = lat.w / (h * S);
  let best: { e: LegendEntry; d: number; start: number; cells: number } | null = null;
  // 기호 폭: 이 단에서 칸 사이 격자선이 끊긴 만큼(교차뜨기처럼 여러 칸에 걸친 기호)
  const lineAt = (xb: number) => {
    const ya = Math.round((yTop + h * 0.25) * S), yb = Math.round((yTop + h * 0.75) * S);
    let n2 = 0;
    for (let yy = ya; yy < yb; yy++) if (dark(xb - 1, yy) || dark(xb, yy) || dark(xb + 1, yy)) n2++;
    return n2 / Math.max(1, yb - ya) > 0.6;
  };
  let cL = k, cR = k;
  // 글자가 든 칸은 한 칸짜리 기호
  if (!token) {
    while (cL > k - 8 && !lineAt(lat.off + cL * lat.w)) cL--;
    while (cR < k + 8 && !lineAt(lat.off + (cR + 1) * lat.w)) cR++;
  }
  const cells = cR - cL + 1;
  // 글자 칸인데 글자 기호표에 없으면(예: '|') 그림 기호 중에서만 고른다
  const cands = token ? tmpls.filter((tm) => !tm.entry.sym && tm.canvas && tm.canvas.width / tm.canvas.height / cellRatio < 1.5) : tmpls;
  const IN = 0.16; // 테두리·격자선을 빼고 안쪽만 비교
  const W = 12 * cells, H = 12;
  const sx = lat.off + cL * lat.w, cw = lat.w * cells, chh = h * S;
  // 글자 칸(기호표엔 그림으로만 있는 '|' 등)은 그 글자를 칸 가운데에 그려서 비교 — 칸 안 위치와 상관없게
  const b = token ? features(glyphCell(token, cellRatio), 0, 0, 0, 0, W, H, true) : features(img, sx + lat.w * IN, yTop * S + chh * IN, cw - 2 * lat.w * IN, chh * (1 - 2 * IN), W, H);
  // 격자선도 획도 없는 넓은 빈 곳(모양 낸 가장자리 바깥)은 칸이 아니다
  if (!token && cells > 1 && !b.some((v, i) => i % 4 === 0 && v > 0)) return null;
  for (const tm of cands) {
    if (!tm.canvas) continue;
    const tw = tm.canvas.width, th = tm.canvas.height;
    // 기호표 상자가 차트 칸 비율과 크게 다르면(1칸 기호를 3칸에 맞추는 등) 감점
    const want = tw / th / cellRatio;
    const a = features(tpix(tm.canvas), (tw * IN) / cells, th * IN, tw * (1 - (2 * IN) / cells), th * (1 - 2 * IN), W, H);
    const d = symbolScore(a, b, W, H) + 0.08 * Math.abs(Math.log(Math.max(0.3, want) / cells));
    if (!best || d < best.d) best = { e: tm.entry, d, start: cL, cells };
  }
  if (!best) return { ...out(token, null, true, rect), name: "기호표 그림을 찾지 못했어요" };
  const bx = lat.off + best.start * lat.w;
  const r2 = { x0: bx / S, x1: (bx + best.cells * lat.w) / S, y0: yTop, y1: yTop + h };
  return out(token || best.e.sym, best.e, true, r2);
}
