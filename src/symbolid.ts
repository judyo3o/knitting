/** 차트에서 누른 칸의 기호 → 기법 이름 (기기에서) */
import { cellKeyColor, type Bitmap } from "./chart";
import { renderPage, renderRegion, textItems, type Pdf } from "./pdf";
import { rowH, rowY, stitchAxis, type Chart } from "./pdfgeom";
import { rowText, type RowStitch } from "./symbols";
export { rowText };
import { boundaries, gridLattice, symbolScore, legendEntries, matchToken, textAt, unreadable, type Box, type LegendEntry } from "./symbols";
import type { Pattern } from "./types";

/** 시작 화살표로 쓰는 글자 (→ ˃ › ▶ …) — 코가 아님 */
const ARROW = /^[\s\-–—=]*[→←⟵⟶➜➔➝▶◀►◄▷◁˃˂›‹»«<>⇒⇐][\s\-–—=]*$/;

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
type LegendData = { entries: LegendEntry[]; tmpls: Tmpl[]; page: HTMLCanvasElement | null; lg: Box | null; sc?: number };
const legendCache = new Map<string, Promise<LegendData>>();
const T_SCALE = 3;

function legendData(p: Pattern, pdf: Pdf): Promise<LegendData> {
  const lg = p.legend && "page" in p.legend ? p.legend : null;
  const key = p.id + ":" + (lg ? [lg.page, lg.x0, lg.y0, lg.x1, lg.y1].join(",") : "none");
  let c = legendCache.get(key);
  if (!c) {
    c = (async () => {
      if (!lg) return { entries: [], tmpls: [], page: null, lg: null, sc: T_SCALE };
      const t = await textItems(pdf, lg.page);
      const entries = legendEntries(t.items, lg);
      const page = await renderPage(pdf, lg.page, T_SCALE); // 크면 renderPage가 알아서 줄임
      const ctx = page.getContext("2d", { willReadFrequently: true })!;
      const sc = page.width / (await pdf.getPage(lg.page)).getViewport({ scale: 1 }).width;
      const tmpls = entries.map((entry) => ({ entry, canvas: entry.abbr ? null : tightCrop(ctx, entry.area, sc) })); // 약어표 항목은 그림 기호가 아님
      return { entries, tmpls, page, lg, sc };
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
  const sym = tightCrop(ctx, { x0: L.lg.x0, x1: e.area.x1, y0: e.area.y0, y1: e.area.y1 }, L.sc || T_SCALE);
  const name = tightCrop(ctx, { x0: e.area.x1, x1: L.lg.x1, y0: e.area.y0, y1: e.area.y1 }, L.sc || T_SCALE);
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

const stripCache = new Map<string, Promise<HTMLCanvasElement>>();
function stripOf(pdf: Pdf, page: number, scale: number, y0: number, y1: number) {
  const k = `${page}:${Math.round(y0)}:${Math.round(y1)}`;
  let p = stripCache.get(k);
  if (!p) {
    if (stripCache.size > 6) stripCache.clear(); // 메모리 아끼기
    p = renderRegion(pdf, page, scale, y0, y1);
    stripCache.set(k, p);
    p.catch(() => stripCache.delete(k));
  }
  return p;
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
/**
 * 교차뜨기 방향: 가운데 둘레에서 '\\' 쪽(왼위·오른아래) 잉크와 '/' 쪽(오른위·왼아래) 잉크의 차이.
 * 위로 지나가는 선은 가운데에서 끊기지 않아 그쪽이 많다. 둘 다 비슷하면(교차가 아님) null
 */
function crossDir(m: Uint8ClampedArray, W: number, H: number): number | null {
  const ink = (x: number, y: number) => {
    const xx = Math.round(x), yy = Math.round(y);
    return xx >= 0 && yy >= 0 && xx < W && yy < H && !!m[(yy * W + xx) * 4];
  };
  // 한 방향 사선들 중 잉크가 끊기지 않고 이어지는 가장 긴 길이 (가로 길이 기준, 0~1)
  // 위로 지나가는 선은 교차점에서 끊기지 않아 길고, 아래로 지나가는 선은 반쯤에서 끊긴다
  const run = (sign: number) => {
    let best = 0;
    for (const f of [0.6, 0.8, 1, 1.25, 1.5, 2, 3]) {
      const k = (sign * f * H) / W;
      for (let c = -H; c <= 2 * H; c += 1) {
        let cur = 0, mx = 0;
        for (let x = 0; x < W; x += 0.5) {
          const y = (sign > 0 ? 0 : H) + c + k * x;
          if (ink(x, y) || ink(x, y - 1) || ink(x, y + 1)) { cur += 0.5; if (cur > mx) mx = cur; } else cur = 0;
        }
        if (mx > best) best = mx;
      }
    }
    return best / W;
  };
  const back = run(1), slash = run(-1); // y가 아래로 커지므로 +기울기가 '\\'
  if (Math.max(back, slash) < 0.3 || Math.abs(back - slash) < 0.1) return null;
  return back - slash;
}

/** 안뜨기 교차의 가로줄: 평평한 가로 잉크(위아래 두 줄에는 잉크가 거의 없음)가 폭의 12% 넘게 이어지면 */
function purlDash(m: Uint8ClampedArray, W: number, H: number): boolean {
  const ink = (x: number, y: number) => y >= 0 && y < H && !!m[(y * W + x) * 4];
  const need = Math.max(5, W * 0.14);
  for (let y = Math.floor(H * 0.35); y < H; y++) {
    let x = 0;
    while (x < W) {
      if (!ink(x, y)) { x++; continue; }
      let e = x;
      while (e < W && ink(e, y)) e++;
      if (e - x >= need) {
        let off = 0;
        for (let k = x; k < e; k++) if (ink(k, y - 3) || ink(k, y + 3)) off++;
        if (off / (e - x) < 0.2) return true;
      }
      x = e;
    }
  }
  return false;
}

/** 교차뜨기 칸 수: 이름의 "2/1"처럼 a/b면 a+b칸 (기호표 상자 크기는 칸 수에 비례하지 않을 때가 많다) */
function spanOf(e: LegendEntry): number | null {
  const m = (e.sym + " " + e.name).match(/(?<![\d/])(\d)\s*\/\s*(\d)(?![\d/])/);
  return m ? +m[1] + +m[2] : null;
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
/** 기호표 그림의 교차 방향·가로줄 (칸 수별) */
const tmplDir = new WeakMap<HTMLCanvasElement, Record<string, { dir: number | null; dash: boolean }>>();
function tpix(c: HTMLCanvasElement) {
  let d = tmplPix.get(c);
  if (!d) tmplPix.set(c, (d = c.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height)));
  return d;
}

type RowCtx = {
  h: number; yTop: number; S: number; OY: number; img: ImageData;
  dark: (x: number, y: number) => boolean;
  lat: { w: number; off: number; xs: number[] } | null; B: number[]; M: number;
};
const ctxCache = new Map<string, Promise<RowCtx>>();
/** 한 단 둘레를 높은 배율로 그리고 격자선(칸 경계)을 찾는다. 같은 단이면 다시 계산하지 않음 */
function rowCtx(pdf: Pdf, page: number, bmp: Bitmap, c: Chart, n: number): Promise<RowCtx> {
  const key = `${page}:${c.a}:${c.b}:${n}`;
  let pr = ctxCache.get(key);
  if (pr) return pr;
  if (ctxCache.size > 12) ctxCache.clear();
  pr = (async () => {
    const h = rowH(c);
    const yTop = rowY(c, n) - h / 2;
    // 이 단 위아래 몇 단만 높은 배율로 따로 그린다 (화면용 차트 그림은 휴대폰 때문에 작게 그려서 가는 선이 사라짐)
    const ry0 = Math.max(0, rowY(c, Math.min(c.nMax, n + 6)) - h);
    const ry1 = Math.min(bmp.h, rowY(c, Math.max(c.nMin, n - 6)) + h);
    const strip = await stripOf(pdf, page, Math.max(bmp.scale, 26 / h), ry0, ry1);
    const S = strip.width / bmp.w;
    const OY = ry0 * S;
    const img = pixels(strip);
    const dark = (px: number, py: number) => {
      const i = (Math.round(py - OY) * img.width + Math.round(px)) * 4;
      const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2]; return r + g + b < 3 * 236 && Math.max(r, g, b) - Math.min(r, g, b) < 14; // 회색·검정 선만 (색칠된 칸 바탕은 아님)
    };
    // 격자: 이 단 위아래 몇 단에 걸쳐 찾는다
    const yA = Math.max(rowY(c, Math.min(c.nMax, n + 6)) - h / 2, rowY(c, c.nMax) - h / 2) * S;
    const yB = Math.min(rowY(c, Math.max(c.nMin, n - 6)) + h / 2, rowY(c, c.nMin) + h / 2) * S;
    // 격자선은 가는 선: 좌우 몇 점보다 확실히 진해야 한다 (배색 차트의 넓은 진한 칸 바탕을 선으로 보지 않게)
    const lum = (px: number, py: number) => { const i = (Math.round(py - OY) * img.width + Math.round(px)) * 4; return img.data[i] + img.data[i + 1] + img.data[i + 2]; };
    const gap = Math.max(2, Math.round(S * 0.9));
    const thinLine = (px: number, py: number) => dark(px, py) && lum(px, py) < Math.min(lum(px - gap, py), lum(px + gap, py)) - 20;
    const lat = gridLattice(thinLine, c.x0 * S, c.x1 * S, yA, yB);
    // 칸 경계는 실제로 찾은 격자선 위치로 (너비×번호로 계산하면 칸이 많을 때 오차가 쌓인다)
    const B = lat ? boundaries(lat.xs, lat.w) : [];
    return { h, yTop, S, OY, img, dark, lat, B, M: B.length - 1 };
  })();
  ctxCache.set(key, pr);
  pr.catch(() => ctxCache.delete(key));
  return pr;
}

/** 칸 안에 글자 기호가 있나 (화살표·숫자 제외) — 코 번호 밖의 감아코 같은 칸 */
function cellHasMark(R: RowCtx, k: number, items: { str: string; x: number; y: number; w: number; h: number }[], axes: number[] = []): boolean {
  const { B, S, h, yTop, dark } = R;
  const x0 = B[k] / S, x1 = B[k + 1] / S;
  if (axes.some((a) => a > x0 - (x1 - x0) * 0.3 && a < x1 + (x1 - x0) * 0.3)) return false; // 단 번호 칸
  if (items.some((i) => i.str.trim() && !/^\s*\d{1,3}\s*$/.test(i.str) && !ARROW.test(i.str) && i.x + i.w / 2 > x0 && i.x + i.w / 2 < x1 && i.y - i.h / 2 > yTop && i.y - i.h / 2 < yTop + h)) return true;
  void dark;
  return false;
}

/** 칸이 있나: 위·아래 테두리에 모두 선이 있으면 (경사뜨기로 안 뜨는 곳·모양 낸 가장자리 바깥은 아래 단의 윗선만 있다) */
function cellExists(R: RowCtx, k: number): boolean {
  const { B, S, h, yTop, dark } = R;
  const edge = (yy: number, x: number) => { for (let d = -2; d <= 2; d++) if (dark(x, yy + d)) return true; return false; };
  const xs = [0.3, 0.5, 0.7].map((f) => B[k] + (B[k + 1] - B[k]) * f);
  const top = Math.round(yTop * S), bot = Math.round((yTop + h) * S);
  return xs.filter((x) => edge(top, Math.round(x)) && edge(bot, Math.round(x))).length >= 2;
}

/**
 * 한 단 전체를 기기에서 읽는다: 뜨기 시작하는 쪽부터 칸마다 기호 → 이름.
 * 이 단에 없는 칸(모양 낸 가장자리·경사뜨기로 안 뜨는 곳 — 위아래 격자선이 없음)은 건너뛴다.
 * 결과는 차트(겉면) 기호 그대로. 안면 뜨기 변환은 rowText에서.
 */
export async function readRow(p: Pattern, pdf: Pdf, page: number, bmp: Bitmap, n: number, fromLeft: boolean, range: [number, number] | null = null, key: { code: string; rgb: [number, number, number] }[] = []): Promise<RowStitch[] | null> {
  const c = bmp.charts.find((ch) => n >= ch.nMin - 1 && n <= ch.nMax + 1);
  if (!c) return null;
  // 배색 차트 + 내 사이즈 범위: 칸은 정사각형이라(단 높이 = 칸 너비) 범위를 단 높이로 나눠 칸을 정한다
  // (진한 색 칸 바탕 때문에 격자선 찾기가 흔들려서)
  if (key.length && range) {
    const hh = rowH(c), yT = rowY(c, n) - hh / 2;
    const cnt = Math.round((range[1] - range[0]) / hh);
    if (cnt >= 1) {
      const cw = (range[1] - range[0]) / cnt;
      const order = [...Array(cnt).keys()];
      if (!fromLeft) order.reverse();
      return order.map((i) => ({ name: cellKeyColor(bmp, { x0: range[0] + i * cw, x1: range[0] + (i + 1) * cw, y0: yT, y1: yT + hh }, key) || "?", sym: "", cells: 1, yarn: true, x0: range[0] + i * cw, x1: range[0] + (i + 1) * cw }));
    }
  }
  const R = await rowCtx(pdf, page, bmp, c, n);
  if (!R.lat || R.M < 2) return null;
  const { B, M, S, h, yTop, dark } = R;
  // 칸이 있나: 위·아래 테두리에 모두 선이 있으면 (안 뜨는 곳은 아래 단의 윗선만 있다)
  const exists = (k: number) => cellExists(R, k);
  const yMid = rowY(c, n);
  const items = (await textItems(pdf, page)).items;
  // 코 번호 축(차트 아래·위의 "38 … 5 1")이 있으면 그 사이 칸만 코다 — 바깥 칸은 시작 화살표(→ ←) 같은 표시용
  const ax = stitchAxis(items, c);
  const span: [number, number] | null = ax ? [ax.x0, ax.x1] : null;
  const cw = (B[M] - B[0]) / M / S;
  const inSpan = (k: number) => {
    const cx = (B[k] + B[k + 1]) / 2 / S;
    if (range) return cx >= range[0] && cx <= range[1]; // 내 사이즈 범위
    if (!span) return true;
    return cx >= span[0] - cw * 0.6 && cx <= span[1] + cw * 0.6;
  };
  const arrowIn = (k: number) => items.some((i) => ARROW.test(i.str) && i.x + i.w / 2 > B[k] / S && i.x + i.w / 2 < B[k + 1] / S && i.y - i.h / 2 > yTop - 1 && i.y - i.h / 2 < yTop + h + 1);
  const out: RowStitch[] = [];
  const order = [...Array(M).keys()];
  if (!fromLeft) order.reverse();
  const seen = new Set<number>();
  for (const k of order) {
    if (seen.has(k)) continue;
    if ((!inSpan(k) && (range || !cellHasMark(R, k, items, c.axes))) || arrowIn(k) || !exists(k)) { seen.add(k); continue; } // 코 번호 밖이라도 감아코처럼 표시가 있으면 읽는다
    // 배색 차트(색 KEY가 있음): 칸 색 → 실 기호
    if (key.length) {
      seen.add(k);
      const code = cellKeyColor(bmp, { x0: B[k] / S, x1: B[k + 1] / S, y0: yTop, y1: yTop + h }, key);
      if (code) { out.push({ name: code, sym: code, cells: 1, yarn: true, x0: B[k] / S, x1: B[k + 1] / S }); continue; }
    }
    const hit = await identify(p, pdf, page, bmp, (B[k] + B[k + 1]) / 2 / S, yMid, range);
    let cells = 1, xa = B[k] / S, xb = B[k + 1] / S;
    if (hit?.rect) {
      const near = (v: number) => B.reduce((bi, bv, i) => (Math.abs(bv - v * S) < Math.abs(B[bi] - v * S) ? i : bi), 0);
      const a = Math.min(k, near(hit.rect.x0)), b = Math.max(k, near(hit.rect.x1) - 1);
      for (let j = a; j <= b; j++) seen.add(j);
      cells = Math.max(1, b - a + 1);
      xa = B[a] / S; xb = B[b + 1] / S;
    } else seen.add(k);
    out.push({ name: hit?.name || "", sym: hit?.sym || "", cells, x0: xa, x1: xb });
  }
  return out;
}


/** 누른 점 (차트 쪽 pt 좌표) → 기호 */
/** 점검용 */
export async function debugTemplates(p: Pattern, pdf: Pdf) {
  const L = await legendData(p, pdf);
  return L.tmpls.map((t) => (t.canvas ? t.canvas.toDataURL("image/png") : ""));
}

export async function identify(p: Pattern, pdf: Pdf, page: number, bmp: Bitmap, x: number, y: number, range: [number, number] | null = null): Promise<SymHit | null> {
  const c: Chart | undefined = bmp.charts.find((ch) => {
    const n = (y - ch.a) / ch.b;
    return n >= ch.nMin - 1.6 && n <= ch.nMax + 1.6 && x >= ch.x0 && x <= ch.x1; // 번호가 없는 끝 단(예: 코잡기 1단)까지
  });
  if (!c) return null;
  const n = Math.round((y - c.a) / c.b);
  const R = await rowCtx(pdf, page, bmp, c, n);
  const { h, yTop, S, OY, img, dark, lat, B, M } = R;
  let rect: Box | null = null, st: number | null = null, k = 0;
  if (lat) {
    const X = x * S;
    if (M < 1 || X < B[0] - 1 || X > B[M] + 1) return null; // 격자 밖
    k = 0;
    while (k < M - 1 && X >= B[k + 1]) k++;
    rect = { x0: B[k] / S, x1: B[k + 1] / S, y0: yTop, y1: yTop + h };
    st = M - k;
  }
  const items = (await textItems(pdf, page)).items;
  // 코 번호 축이 있으면 그 번호로 센다. 번호 밖 칸(단 번호 상자·시작 화살표 칸)은 코가 아님
  const ax = stitchAxis(items, c);
  const vAt = (px: number) => (ax ? Math.round((px - ax.a) / ax.b) : 0);
  if (range && rect) {
    const cx = (rect.x0 + rect.x1) / 2;
    if (cx < range[0] || cx > range[1]) return null; // 내 사이즈 범위 밖
  } else if (ax && rect) {
    // 코 번호 밖 칸: 단 번호 상자·시작 화살표 같은 빈 칸은 코가 아니다. 다만 글자나 그림 기호가 있으면(가장자리 감아코 등) 읽는다
    const v = vAt((rect.x0 + rect.x1) / 2);
    if ((v < 1 || v > ax.max) && !cellHasMark(R, k, items, c.axes)) return null;
  }
  if (lat && rect && !cellExists(R, k)) return null; // 이 단에 없는 칸 (경사뜨기로 안 뜨는 곳 등)
  const L = await legendData(p, pdf);
  const { entries, tmpls } = L;
  // 기호 칸 범위 → 오른쪽/왼쪽에서 몇 번째 (뜨기 시작하는 쪽에서 세려고 둘 다)
  const idx = (r: Box | null) => {
    if (!lat || !r) return { fromRight: st, fromLeft: null };
    const near = (v: number) => B.reduce((bi, bv, i) => (Math.abs(bv - v * S) < Math.abs(B[bi] - v * S) ? i : bi), 0);
    const a = near(r.x0), b = near(r.x1) - 1;
    if (range) {
      // 내 사이즈 범위 안에서 센다
      const ins = B.slice(0, -1).map((bv, i) => (bv + B[i + 1]) / 2 / S).map((cx, i) => (cx >= range[0] && cx <= range[1] ? i : -1)).filter((i) => i >= 0);
      const kL = ins[0], kR = ins[ins.length - 1];
      return { fromRight: kR - b + 1, fromLeft: a - kL + 1 };
    }
    if (ax) {
      const cw = Math.abs(ax.b);
      const vl = vAt(r.x0 + cw / 2), vr = vAt(r.x1 - cw / 2); // 기호의 왼쪽 끝 칸, 오른쪽 끝 칸 번호
      return ax.b < 0 ? { fromRight: vr, fromLeft: ax.max - vl + 1 } : { fromLeft: vl, fromRight: ax.max - vr + 1 };
    }
    return { fromRight: M - b, fromLeft: a + 1 };
  };
  const out = (sym: string, e: LegendEntry | null, guess: boolean, r: Box | null): SymHit => ({
    sym, name: e ? (unreadable(e.name) ? "" : e.name) : "", guess, rect: r, n, st, ...idx(r), entry: e, img: e && unreadable(e.name) ? lineImage(L, e) : null,
  });
  // 1) 글자 기호
  const t = textAt(items, x, y);
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
    return n2 / Math.max(1, yb - ya) > 0.85; // 진짜 격자선은 끊김이 없다 (교차뜨기 사선이 경계를 지나면 30~70%)
  };
  let cL = k, cR = k;
  // 글자가 든 칸은 한 칸짜리 기호
  if (!token) {
    while (cL > 0 && cL > k - 8 && !lineAt(B[cL])) cL--;
    while (cR < M - 1 && cR < k + 8 && !lineAt(B[cR + 1])) cR++;
  }
  // 교차뜨기도 6칸(3/3)이 가장 넓다: 더 넓게 이어지면 격자선을 못 찾은 것 → 누른 칸 하나로
  if (cR - cL + 1 > 8) { cL = k; cR = k; }
  // 여러 칸 기호 안에 글자(SSK, k2tog…)가 있으면 그 글자로 (누른 자리가 글자 옆이어도)
  if (!token) {
    const bx0 = B[cL] / S, bx1 = B[cR + 1] / S;
    const inBox = items.filter((i) => i.str.trim() && !/^\s*\d{1,3}\s*$/.test(i.str) && i.x + i.w / 2 > bx0 && i.x + i.w / 2 < bx1 && i.y - i.h / 2 > yTop - 1 && i.y - i.h / 2 < yTop + h + 1);
    for (const it of inBox) {
      const e = matchToken(it.str.trim(), entries);
      if (e) return out(it.str.trim(), e, false, { x0: bx0, x1: bx1, y0: yTop, y1: yTop + h });
    }
  }
  const cells = cR - cL + 1;
  // 글자 칸인데 글자 기호표에 없으면(예: '|') 그림 기호 중에서만 고른다
  const cands = token ? tmpls.filter((tm) => !tm.entry.sym && tm.canvas && tm.canvas.width / tm.canvas.height / cellRatio < 1.5) : tmpls;
  const IN = 0.16; // 테두리·격자선을 빼고 안쪽만 비교
  const DIN = IN;
  const W = 12 * cells, H = 12;
  const sx = B[cL], cw = B[cR + 1] - B[cL], chh = h * S;
  // 글자 칸(기호표엔 그림으로만 있는 '|' 등)은 그 글자를 칸 가운데에 그려서 비교 — 칸 안 위치와 상관없게
  const b = token ? features(glyphCell(token, cellRatio), 0, 0, 0, 0, W, H, true) : features(img, sx + lat.w * IN, yTop * S - OY + chh * IN, cw - 2 * lat.w * IN, chh * (1 - 2 * IN), W, H);
  // 격자선도 획도 없는 넓은 빈 곳(모양 낸 가장자리 바깥)은 칸이 아니다
  if (!token && cells > 1 && !b.some((v, i) => i % 4 === 0 && v > 0)) return null;
  // 교차뜨기 방향: 칸 가운데를 끊기지 않고 지나가는 선이 \\ 인가 / 인가
  const bigB = token ? null : features(img, sx + lat.w * IN, yTop * S - OY + chh * IN, cw - 2 * lat.w * IN, chh * (1 - 2 * IN), W * 2, H * 2);
  const dirB = bigB ? crossDir(bigB, W * 2, H * 2) : null;
  const dashB = !token && cells > 1 ? purlDash(features(img, sx + lat.w * IN, yTop * S - OY + chh * DIN, cw - 2 * lat.w * IN, chh * (1 - 2 * DIN), W * 2, H * 2), W * 2, H * 2) : null;
  for (const tm of cands) {
    if (!tm.canvas) continue;
    const tw = tm.canvas.width, th = tm.canvas.height;
    // 기호표 상자가 차트 칸 비율과 크게 다르면(1칸 기호를 3칸에 맞추는 등) 감점
    const want = tw / th / cellRatio;
    const a = features(tpix(tm.canvas), (tw * IN) / cells, th * IN, tw * (1 - (2 * IN) / cells), th * (1 - 2 * IN), W, H);
    const tk = `${cells}`;
    let tc = tmplDir.get(tm.canvas)?.[tk];
    if (!tc) {
      const bigA = features(tpix(tm.canvas), (tw * IN) / cells, th * IN, tw * (1 - (2 * IN) / cells), th * (1 - 2 * IN), W * 2, H * 2);
      tc = { dir: crossDir(bigA, W * 2, H * 2), dash: purlDash(features(tpix(tm.canvas), (tw * IN) / cells, th * DIN, tw * (1 - (2 * IN) / cells), th * (1 - 2 * DIN), W * 2, H * 2), W * 2, H * 2) };
      tmplDir.set(tm.canvas, { ...(tmplDir.get(tm.canvas) || {}), [tk]: tc });
    }
    const da = tc.dir;
    // 안뜨기 교차(PC)는 아래에 짧은 가로줄이 있다
    const dashPen = dashB != null && spanOf(tm.entry) != null && tc.dash !== dashB ? 0.25 : 0;
    const dirPen = dirB != null && da != null && Math.sign(da) !== Math.sign(dirB) ? 0.25 : 0;
    // 허용 오차 없는 비교를 조금 더해 좌우 대칭인 교차뜨기(LC/RC)를 가른다 (위로 지나가는 선은 끊기지 않음)
    const d = symbolScore(a, b, W, H) + 0.35 * symbolScore(a, b, W, H, 0) + dirPen + dashPen + 0.08 * Math.abs(Math.log(Math.max(0.3, want) / cells)) + (!token && spanOf(tm.entry) != null && spanOf(tm.entry) !== cells ? 0.4 : 0) + (!token && cells > 1 && spanOf(tm.entry) == null && /[a-z]/i.test(tm.entry.sym) ? 0.25 : 0); // 여러 칸인데 글자 기호(L, R…)는 거의 아님 // 칸 수가 다른 교차뜨기는 아님
    if (!best || d < best.d) best = { e: tm.entry, d, start: cL, cells };
  }
  if (!best) return { ...out(token, null, true, rect), name: "기호표 그림을 찾지 못했어요" };
  const r2 = { x0: B[best.start] / S, x1: B[best.start + best.cells] / S, y0: yTop, y1: yTop + h };
  return out(token || best.e.sym, best.e, true, r2);
}

