/** 차트 표시 (§1-4 ③, §3-1) — PDF 차트 비트맵 / 직접 그린 배색 격자 */
import { chartFor, findCharts, rowH, rowY, type Chart } from "./pdfgeom";
import { MAX_PIXELS, renderPage, renderRegion, textItems, pageSize, type Pdf } from "./pdf";
import { cellAspect, dominantColors, getCell, hasRow, rowIndex } from "./drawing";
import type { Drawing, Side, Yarn } from "./types";

export const MARK = "rgba(232, 62, 140, 0.28)";
export const MARK_LINE = "#E83E8C";
const DONE = "rgba(60, 60, 60, 0.16)";

export type Bitmap = { canvas: HTMLCanvasElement; scale: number; charts: Chart[]; w: number; h: number };
const bmpCache = new Map<string, Promise<Bitmap>>();

/** 차트 쪽 비트맵: 한 단이 약 20px, 전체 1000만 픽셀 이하 */
export function chartBitmap(pdf: Pdf, pdfKey: string, page: number): Promise<Bitmap> {
  const k = pdfKey + ":" + page;
  let p = bmpCache.get(k);
  if (!p) {
    p = (async () => {
      const t = await textItems(pdf, page);
      const charts = findCharts(t.items, t.w);
      const b = charts.length ? Math.min(...charts.map(rowH)) : 6;
      let scale = 20 / b;
      const maxScale = Math.sqrt(MAX_PIXELS / (t.w * t.h));
      scale = Math.max(1, Math.min(scale, maxScale));
      const canvas = await renderPage(pdf, page, scale);
      // 휴대폰에서 줄여서 그렸을 수 있으니 실제 배율로
      return { canvas, scale: canvas.width / t.w, charts, w: t.w, h: t.h };
    })();
    bmpCache.set(k, p);
    p.catch(() => bmpCache.delete(k));
  }
  return p;
}
export const clearBitmaps = () => bmpCache.clear();

export type ViewOpts = { n: number; side: Side; round: boolean; rowPx: number; below?: number; above?: number; range?: [number, number] | null }; // range: 내 사이즈 차트 범위 (pt)

/** 화살표가 단 번호를 가리지 않게: 바깥 경계에서 축 숫자 너머까지 (pt) */
/** 왼쪽·오른쪽 축 숫자 너머 (축이 그쪽에 없으면 작게) */
const axisInset = (c: Chart): [number, number] => {
  const mid = (c.x0 + c.x1) / 2;
  const left = c.axes.filter((x) => x < mid), right = c.axes.filter((x) => x >= mid);
  return [left.length ? (left[0] - c.x0) * 2 + 3 : 4, right.length ? (c.x1 - right[right.length - 1]) * 2 + 3 : 4];
};

/** 현재 단 주변(아래 3단 ~ 위 6단)을 잘라 크게, 띠·음영·화살표 */
export type PdfView = { chart: Chart | null; startX: "left" | "right"; x0: number; yTop: number; k: number };
export function drawPdfRows(out: HTMLCanvasElement, bmp: Bitmap, o: ViewOpts, hi?: { canvas: HTMLCanvasElement; scale: number; y0: number }): PdfView {
  const c = chartFor(bmp.charts, o.n);
  const ctx = out.getContext("2d")!;
  if (!c) {
    out.width = out.height = 0;
    return { chart: null, startX: "right", x0: 0, yTop: 0, k: 1 };
  }
  const below = o.below ?? 3, above = o.above ?? 6;
  const h = rowH(c);
  const yTop = Math.max(rowY(c, Math.min(o.n + above, c.nMax + 1)) - h / 2, 0);
  const yBot = Math.min(rowY(c, Math.max(o.n - below, c.nMin - 1)) + h / 2, bmp.h);
  const k = o.rowPx / h; // pt → 화면 px
  const sx = c.x0 * bmp.scale, sy = yTop * bmp.scale, sw = (c.x1 - c.x0) * bmp.scale, sh = (yBot - yTop) * bmp.scale;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  out.width = Math.round((c.x1 - c.x0) * k * dpr);
  out.height = Math.round((yBot - yTop) * k * dpr);
  out.style.width = out.width / dpr + "px";
  out.style.height = out.height / dpr + "px";
  ctx.imageSmoothingQuality = "high";
  if (hi) ctx.drawImage(hi.canvas, c.x0 * hi.scale, (yTop - hi.y0) * hi.scale, (c.x1 - c.x0) * hi.scale, (yBot - yTop) * hi.scale, 0, 0, out.width, out.height);
  else ctx.drawImage(bmp.canvas, sx, sy, sw, sh, 0, 0, out.width, out.height);
  const toY = (y: number) => (y - yTop) * k * dpr;
  const xr = o.range ? (o.range.map((x) => (x - c.x0) * k * dpr) as [number, number]) : null;
  overlay(ctx, out.width, (n) => [toY(rowY(c, n) - h / 2), toY(rowY(c, n) + h / 2)], o, Math.max(o.n - below, c.nMin - 1), dpr, axisInset(c).map((v) => v * k * dpr) as [number, number], xr);
  return { chart: c, startX: o.side === "RS" || o.round ? "right" : "left", x0: c.x0, yTop, k };
}

/** 차트 전체(페이지 전체)에 같은 표시 */
export function drawPdfFull(out: HTMLCanvasElement, bmp: Bitmap, o: ViewOpts, width: number) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const k = width / bmp.w;
  out.width = Math.round(bmp.w * k * dpr);
  out.height = Math.round(bmp.h * k * dpr);
  out.style.width = out.width / dpr + "px";
  out.style.height = out.height / dpr + "px";
  const ctx = out.getContext("2d")!;
  ctx.drawImage(bmp.canvas, 0, 0, out.width, out.height);
  const c = chartFor(bmp.charts, o.n);
  if (!c) return;
  const h = rowH(c);
  const f = k * dpr;
  ctx.save();
  ctx.beginPath();
  ctx.rect(c.x0 * f, 0, (c.x1 - c.x0) * f, out.height);
  ctx.clip();
  ctx.translate(c.x0 * f, 0);
  const xr = o.range ? (o.range.map((x) => (x - c.x0) * f) as [number, number]) : null;
  overlay(ctx, (c.x1 - c.x0) * f, (n) => [(rowY(c, n) - h / 2) * f, (rowY(c, n) + h / 2) * f], o, c.nMin - 1, dpr, axisInset(c).map((v) => v * f) as [number, number], xr);
  ctx.restore();
}

function overlay(ctx: CanvasRenderingContext2D, w: number, band: (n: number) => [number, number], o: ViewOpts, fromN: number, dpr: number, inset: [number, number] = [4 * dpr, 4 * dpr], xr: [number, number] | null = null) {
  // 내 사이즈 범위가 있으면 띠·음영은 그 안에만, 바깥은 흐리게
  const L = xr ? Math.max(0, xr[0]) : 0, R = xr ? Math.min(w, xr[1]) : w;
  for (let n = Math.max(1, fromN); n < o.n; n++) {
    const [y0, y1] = band(n);
    ctx.fillStyle = DONE;
    ctx.fillRect(L, y0, R - L, y1 - y0);
  }
  if (xr) {
    ctx.fillStyle = "rgba(255,255,255,0.62)";
    const H = ctx.canvas.height;
    ctx.fillRect(0, 0, L, H);
    ctx.fillRect(R, 0, w - R, H);
    ctx.strokeStyle = MARK_LINE;
    ctx.lineWidth = 1.5 * dpr;
    ctx.setLineDash([5 * dpr, 4 * dpr]);
    for (const x of [L, R]) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    ctx.setLineDash([]);
  }
  const [y0, y1] = band(o.n);
  ctx.fillStyle = MARK;
  ctx.fillRect(L, y0, R - L, y1 - y0);
  ctx.strokeStyle = MARK_LINE;
  ctx.lineWidth = 2 * dpr;
  ctx.strokeRect(L + 1 * dpr, y0, R - L - 2 * dpr, y1 - y0);
  // 진행 방향 화살표 (시작하는 쪽에서 안쪽으로)
  const rs = o.side === "RS" || o.round;
  const mid = (y0 + y1) / 2;
  const s = Math.max(6 * dpr, Math.min((y1 - y0) * 0.45, 14 * dpr));
  const x = xr ? (rs ? R + s * 1.4 : L - s * 1.4) : rs ? w - inset[1] - s * 1.2 : inset[0] + s * 1.2;
  ctx.fillStyle = MARK_LINE;
  ctx.beginPath();
  if (rs) {
    ctx.moveTo(x - s, mid); ctx.lineTo(x + s, mid - s); ctx.lineTo(x + s, mid + s);
  } else {
    ctx.moveTo(x + s, mid); ctx.lineTo(x - s, mid - s); ctx.lineTo(x - s, mid + s);
  }
  ctx.closePath();
  ctx.fill();
}

/** 현재 단 띠의 실제 색 (배색 차트용, 흰 배경·검은 선 제외) */
export function sampleRowColors(bmp: Bitmap, n: number): { hex: string; share: number }[] {
  const c = chartFor(bmp.charts, n);
  if (!c) return [];
  const h = rowH(c);
  const y0 = Math.round((rowY(c, n) - h * 0.3) * bmp.scale);
  const y1 = Math.round((rowY(c, n) + h * 0.3) * bmp.scale);
  const x0 = Math.round((c.x0 + 12) * bmp.scale), x1 = Math.round((c.x1 - 12) * bmp.scale);
  if (x1 <= x0 || y1 <= y0) return [];
  const data = bmp.canvas.getContext("2d")!.getImageData(x0, y0, x1 - x0, y1 - y0).data;
  const px: [number, number, number][] = [];
  const step = Math.max(1, Math.floor(data.length / 4 / 6000));
  for (let i = 0; i < data.length / 4; i += step) px.push([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]);
  return dominantColors(px);
}

/** 차트 풀기용 띠: 현재 단 ±2단, 한 단 40px 이상, 현재 단 분홍 테두리 */
export async function explainStrip(pdf: Pdf, page: number, n: number): Promise<HTMLCanvasElement | null> {
  const t = await textItems(pdf, page);
  const c = chartFor(findCharts(t.items, t.w), n);
  if (!c) return null;
  const h = rowH(c);
  const full = await renderPage(pdf, page, Math.min(48 / h, Math.sqrt(MAX_PIXELS / (t.w * t.h))));
  const scale = full.width / t.w;
  const yTop = rowY(c, n + 2) - h / 2, yBot = rowY(c, n - 2) + h / 2;
  const pad = 4;
  const out = document.createElement("canvas");
  out.width = Math.round((c.x1 - c.x0 + pad * 2) * scale);
  out.height = Math.round((yBot - yTop + pad * 2) * scale);
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(full, (c.x0 - pad) * scale, (yTop - pad) * scale, out.width, out.height, 0, 0, out.width, out.height);
  ctx.strokeStyle = MARK_LINE;
  ctx.lineWidth = Math.max(3, scale * 0.6);
  ctx.strokeRect(2, (rowY(c, n) - h / 2 - yTop + pad) * scale, out.width - 4, h * scale);
  return out;
}

/** 기호표 영역 잘라내기 */
export async function legendCanvas(pdf: Pdf, lg: { page: number; x0: number; y0: number; x1: number; y1: number }, scale = 2) {
  const { w, h } = await pageSize(pdf, lg.page);
  const x0 = Math.max(0, lg.x0), y0 = Math.max(0, lg.y0), x1 = Math.min(w, lg.x1), y1 = Math.min(h, lg.y1);
  // 기호표 높이만큼의 띠만 그린다 (쪽 전체보다 작아서 크게 보기에서도 선명하게, 휴대폰 그림 크기 제한 안에서)
  const strip = await renderRegion(pdf, lg.page, scale, y0, y1);
  const sc = strip.width / w; // 줄여서 그렸으면 실제 배율로
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round((x1 - x0) * sc));
  out.height = Math.max(1, Math.min(strip.height, Math.round((y1 - y0) * sc)));
  out.getContext("2d")!.drawImage(strip, x0 * sc, 0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

/* ---------------- 직접 그린 배색 격자 ---------------- */

export const yarnHex = (y: Yarn | undefined, i: number) => y?.hex || ["#E8E2D4", "#B23A48", "#2F5D8A", "#E0A526", "#3E7C59", "#6B4E9B"][i % 6];

export type GridGeom = { cell: number; ch: number; rows: [number, number]; ox: number; oy: number; w: number; h: number };
type Sel = { c0: number; r0: number; c1: number; r1: number };

const shade = (hex: string, f: number) => {
  const v = parseInt(hex.slice(1), 16);
  const m = (x: number) => Math.max(0, Math.min(255, Math.round(x * f)));
  return `rgb(${m(v >> 16)},${m((v >> 8) & 255)},${m(v & 255)})`;
};

/**
 * 격자 그리기. rows = [아래 단 r0, 위 단 r1] (drawing 인덱스, 포함). 위가 높은 단.
 * 양옆에 단 번호, 위·아래에 코 번호(기본 오른쪽부터). 칸 비율·코 모양·경계선·반복 단위는 d.opt.
 */
export function drawGrid(out: HTMLCanvasElement, d: Drawing, yarns: Yarn[], cell: number, o: Partial<ViewOpts> & { rows?: [number, number]; sel?: Sel | null; numbers?: boolean }): GridGeom {
  const opt = d.opt || {};
  const r0 = o.rows ? o.rows[0] : 0, r1 = o.rows ? o.rows[1] : d.h - 1;
  const nr = r1 - r0 + 1;
  const ch = Math.max(4, cell * cellAspect(d));
  const showNum = o.numbers !== false;
  const num = showNum ? Math.max(20, Math.min(30, cell * 1.4)) : 0;
  const top = showNum ? 14 : 0, bottom = showNum ? 14 : 0;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = num * 2 + d.w * cell, H = top + nr * ch + bottom;
  out.width = Math.round(W * dpr);
  out.height = Math.round(H * dpr);
  out.style.width = W + "px";
  out.style.height = H + "px";
  const ctx = out.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);
  const X = (c: number) => num + c * cell;
  const Y = (r: number) => top + (r1 - r) * ch;
  const stitch = opt.view === "stitch";
  for (let r = r0; r <= r1; r++)
    for (let c = 0; c < d.w; c++) {
      const v = getCell(d, c, r);
      if (v < 0) continue;
      const hex = yarnHex(yarns[v], v);
      if (!stitch) {
        ctx.fillStyle = hex;
        ctx.fillRect(X(c), Y(r), cell, ch);
      } else {
        // 코 모양: 바탕은 조금 어둡게, 그 위에 V 두 다리
        ctx.fillStyle = shade(hex, 0.72);
        ctx.fillRect(X(c), Y(r), cell, ch);
        ctx.fillStyle = hex;
        const x = X(c), y = Y(r), w2 = cell / 2;
        for (const side of [0, 1]) {
          ctx.beginPath();
          const xo = side ? x + w2 : x;
          ctx.ellipse(xo + w2 / 2 + (side ? -w2 * 0.08 : w2 * 0.08), y + ch * 0.55, w2 * 0.42, ch * 0.62, side ? -0.5 : 0.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  // 격자선 (굵은 선 간격 opt.bold, 기본 10) — 코 모양에선 아주 옅게
  const bold = opt.bold || 10;
  const thin = stitch ? "rgba(0,0,0,.06)" : "rgba(0,0,0,.18)";
  ctx.lineWidth = 1;
  for (let c = 0; c <= d.w; c++) {
    const k = opt.colsFromLeft ? c : d.w - c;
    ctx.strokeStyle = k % bold === 0 && c > 0 && c < d.w ? "rgba(0,0,0,.6)" : thin;
    ctx.beginPath(); ctx.moveTo(X(c) + 0.5, top); ctx.lineTo(X(c) + 0.5, top + nr * ch); ctx.stroke();
  }
  for (let r = r0; r <= r1 + 1; r++) {
    const n = r + d.start - 1; // 이 선 아래 단 번호
    ctx.strokeStyle = n % bold === 0 && r > r0 && r <= r1 ? "rgba(0,0,0,.6)" : thin;
    const y = Y(r) + ch;
    ctx.beginPath(); ctx.moveTo(num, y - 0.5); ctx.lineTo(num + d.w * cell, y - 0.5); ctx.stroke();
  }
  ctx.strokeStyle = "rgba(0,0,0,.7)";
  ctx.strokeRect(num + 0.5, top + 0.5, d.w * cell - 1, nr * ch - 1);
  // 색 경계선
  if (opt.outline) {
    ctx.strokeStyle = "#111";
    ctx.lineWidth = Math.max(1.5, cell / 10);
    ctx.beginPath();
    for (let r = r0; r <= r1; r++)
      for (let c = 0; c < d.w; c++) {
        const v = getCell(d, c, r);
        if (c + 1 < d.w && getCell(d, c + 1, r) !== v) { ctx.moveTo(X(c + 1), Y(r)); ctx.lineTo(X(c + 1), Y(r) + ch); }
        if (r + 1 <= r1 && getCell(d, c, r + 1) !== v) { ctx.moveTo(X(c), Y(r)); ctx.lineTo(X(c) + cell, Y(r)); }
      }
    ctx.stroke();
    ctx.lineWidth = 1;
  }
  // 반복 단위
  if (opt.rep) {
    const q = opt.rep;
    const ra = Math.max(r0, Math.min(q.r0, q.r1)), rb = Math.min(r1, Math.max(q.r0, q.r1));
    if (ra <= rb) {
      ctx.strokeStyle = "#D7263D";
      ctx.lineWidth = 2.5;
      ctx.strokeRect(X(Math.min(q.c0, q.c1)) + 1, Y(rb) + 1, (Math.abs(q.c1 - q.c0) + 1) * cell - 2, (rb - ra + 1) * ch - 2);
      ctx.lineWidth = 1;
    }
  }
  // 번호
  if (showNum) {
    ctx.fillStyle = "#333";
    ctx.font = `${Math.min(12, Math.max(9, Math.min(cell, ch) * 0.6))}px ui-monospace, monospace`;
    ctx.textBaseline = "middle";
    const every = opt.numEvery || (Math.min(cell, ch) < 12 ? 5 : 1);
    for (let r = r0; r <= r1; r++) {
      const n = r + d.start;
      if (n % every && n !== d.start) continue;
      const y = Y(r) + ch / 2;
      ctx.textAlign = "right"; ctx.fillText(String(n), num - 3, y);
      ctx.textAlign = "left"; ctx.fillText(String(n), num + d.w * cell + 3, y);
    }
    ctx.textAlign = "center";
    const cEvery = opt.numEvery || (cell < 16 ? 5 : 1);
    for (let c = 0; c < d.w; c++) {
      const st = opt.colsFromLeft ? c + 1 : d.w - c;
      if (st % cEvery && st !== 1) continue;
      const x = X(c) + cell / 2;
      ctx.fillText(String(st), x, top / 2);
      ctx.fillText(String(st), x, top + nr * ch + bottom / 2);
    }
  }
  if (o.n != null && hasRow(d, o.n)) {
    ctx.save();
    ctx.translate(num, 0);
    overlay(ctx, d.w * cell, (n: number): [number, number] => [Y(rowIndex(d, n)), Y(rowIndex(d, n)) + ch], { n: o.n, side: o.side || "RS", round: !!o.round, rowPx: ch }, Math.max(d.start, r0 + d.start), 1);
    ctx.restore();
  }
  if (o.sel) {
    const s = o.sel;
    ctx.strokeStyle = "#1D4ED8";
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 2;
    ctx.strokeRect(X(Math.min(s.c0, s.c1)), Y(Math.max(s.r0, s.r1)), (Math.abs(s.c1 - s.c0) + 1) * cell, (Math.abs(s.r1 - s.r0) + 1) * ch);
    ctx.setLineDash([]);
  }
  return { cell, ch, rows: [r0, r1], ox: num, oy: top, w: d.w, h: nr };
}

/** 화면 좌표 → 칸 (격자 밖이면 null) */
export function hitCell(g: GridGeom, x: number, y: number): { c: number; r: number } | null {
  const c = Math.floor((x - g.ox) / g.cell);
  const ry = Math.floor((y - g.oy) / g.ch);
  if (c < 0 || c >= g.w || ry < 0 || ry >= g.h) return null;
  return { c, r: g.rows[1] - ry };
}

/** 픽셀 보기: 1코 = 1픽셀 PNG (색만) */
export function pixelCanvas(d: Drawing, yarns: Yarn[], scale = 1): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = d.w * scale;
  c.height = d.h * scale;
  const ctx = c.getContext("2d")!;
  for (let r = 0; r < d.h; r++)
    for (let x = 0; x < d.w; x++) {
      const v = getCell(d, x, r);
      ctx.fillStyle = v < 0 ? "#ffffff" : yarnHex(yarns[v], v);
      ctx.fillRect(x * scale, (d.h - 1 - r) * scale, scale, scale);
    }
  return c;
}

/** 지금 보이는 단들(drawPdfRows와 같은 범위)만 화면 배율로 PDF에서 다시 그린다 — 전체 쪽 그림은 휴대폰 때문에 작아서 흐림 */
export async function sharpRows(pdf: Pdf, page: number, bmp: Bitmap, o: ViewOpts): Promise<{ canvas: HTMLCanvasElement; scale: number; y0: number } | null> {
  const c = chartFor(bmp.charts, o.n);
  if (!c) return null;
  const below = o.below ?? 3, above = o.above ?? 6;
  const h = rowH(c);
  const yTop = Math.max(rowY(c, Math.min(o.n + above, c.nMax + 1)) - h / 2, 0);
  const yBot = Math.min(rowY(c, Math.max(o.n - below, c.nMin - 1)) + h / 2, bmp.h);
  const k = o.rowPx / h;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const want = k * dpr * 1.1;
  if (want <= bmp.scale * 1.05) return null; // 이미 충분히 선명
  const canvas = await renderRegion(pdf, page, want, yTop, yBot);
  return { canvas, scale: canvas.width / bmp.w, y0: yTop };
}
