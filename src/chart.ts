/** 차트 표시 (§1-4 ③, §3-1) — PDF 차트 비트맵 / 직접 그린 배색 격자 */
import { chartFor, findCharts, rowH, rowY, type Chart } from "./pdfgeom";
import { renderPage, textItems, pageSize, type Pdf } from "./pdf";
import { dominantColors, getCell, hasRow, rowIndex } from "./drawing";
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
      const maxScale = Math.sqrt(1e7 / (t.w * t.h));
      scale = Math.max(1, Math.min(scale, maxScale));
      const canvas = await renderPage(pdf, page, scale);
      return { canvas, scale, charts, w: t.w, h: t.h };
    })();
    bmpCache.set(k, p);
    p.catch(() => bmpCache.delete(k));
  }
  return p;
}
export const clearBitmaps = () => bmpCache.clear();

export type ViewOpts = { n: number; side: Side; round: boolean; rowPx: number; below?: number; above?: number };

/** 화살표가 단 번호를 가리지 않게: 바깥 경계에서 축 숫자 너머까지 (pt) */
const axisInset = (c: Chart) => (c.axes.length > 1 ? Math.min(c.axes[0] - c.x0, c.x1 - c.axes[c.axes.length - 1]) * 2 + 3 : 4);

/** 현재 단 주변(아래 3단 ~ 위 6단)을 잘라 크게, 띠·음영·화살표 */
export function drawPdfRows(out: HTMLCanvasElement, bmp: Bitmap, o: ViewOpts): { chart: Chart | null; startX: "left" | "right" } {
  const c = chartFor(bmp.charts, o.n);
  const ctx = out.getContext("2d")!;
  if (!c) {
    out.width = out.height = 0;
    return { chart: null, startX: "right" };
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
  ctx.drawImage(bmp.canvas, sx, sy, sw, sh, 0, 0, out.width, out.height);
  const toY = (y: number) => (y - yTop) * k * dpr;
  overlay(ctx, out.width, (n) => [toY(rowY(c, n) - h / 2), toY(rowY(c, n) + h / 2)], o, Math.max(o.n - below, c.nMin - 1), dpr, axisInset(c) * k * dpr);
  return { chart: c, startX: o.side === "RS" || o.round ? "right" : "left" };
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
  overlay(ctx, (c.x1 - c.x0) * f, (n) => [(rowY(c, n) - h / 2) * f, (rowY(c, n) + h / 2) * f], o, c.nMin - 1, dpr, axisInset(c) * f);
  ctx.restore();
}

function overlay(ctx: CanvasRenderingContext2D, w: number, band: (n: number) => [number, number], o: ViewOpts, fromN: number, dpr: number, inset = 4 * dpr) {
  for (let n = Math.max(1, fromN); n < o.n; n++) {
    const [y0, y1] = band(n);
    ctx.fillStyle = DONE;
    ctx.fillRect(0, y0, w, y1 - y0);
  }
  const [y0, y1] = band(o.n);
  ctx.fillStyle = MARK;
  ctx.fillRect(0, y0, w, y1 - y0);
  ctx.strokeStyle = MARK_LINE;
  ctx.lineWidth = 2 * dpr;
  ctx.strokeRect(1 * dpr, y0, w - 2 * dpr, y1 - y0);
  // 진행 방향 화살표 (시작하는 쪽에서 안쪽으로)
  const rs = o.side === "RS" || o.round;
  const mid = (y0 + y1) / 2;
  const s = Math.max(6 * dpr, Math.min((y1 - y0) * 0.45, 14 * dpr));
  const x = rs ? w - inset - s * 1.2 : inset + s * 1.2;
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
  const scale = Math.min(48 / h, Math.sqrt(1.6e7 / (t.w * t.h)));
  const full = await renderPage(pdf, page, scale);
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
  const full = await renderPage(pdf, lg.page, scale);
  const { w, h } = await pageSize(pdf, lg.page);
  const x0 = Math.max(0, lg.x0), y0 = Math.max(0, lg.y0), x1 = Math.min(w, lg.x1), y1 = Math.min(h, lg.y1);
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round((x1 - x0) * scale));
  out.height = Math.max(1, Math.round((y1 - y0) * scale));
  out.getContext("2d")!.drawImage(full, x0 * scale, y0 * scale, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

/* ---------------- 직접 그린 배색 격자 ---------------- */

export const yarnHex = (y: Yarn | undefined, i: number) => y?.hex || ["#E8E2D4", "#B23A48", "#2F5D8A", "#E0A526", "#3E7C59", "#6B4E9B"][i % 6];

export type GridGeom = { cell: number; rows: [number, number]; ox: number; oy: number; w: number; h: number };

/**
 * 격자 그리기. rows = [아래 단 r0, 위 단 r1] (drawing 인덱스, 포함). 위가 높은 단.
 * 왼쪽·오른쪽에 단 번호를 붙인다(차트처럼).
 */
export function drawGrid(out: HTMLCanvasElement, d: Drawing, yarns: Yarn[], cell: number, o: Partial<ViewOpts> & { rows?: [number, number]; sel?: { c0: number; r0: number; c1: number; r1: number } | null; numbers?: boolean }): GridGeom {
  const r0 = o.rows ? o.rows[0] : 0, r1 = o.rows ? o.rows[1] : d.h - 1;
  const nr = r1 - r0 + 1;
  const num = o.numbers === false ? 0 : Math.max(18, cell * 1.4);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = num * 2 + d.w * cell, H = nr * cell + (o.numbers === false ? 0 : 14);
  out.width = Math.round(W * dpr);
  out.height = Math.round(H * dpr);
  out.style.width = W + "px";
  out.style.height = H + "px";
  const ctx = out.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);
  const yOf = (r: number) => (r1 - r) * cell;
  for (let r = r0; r <= r1; r++)
    for (let c = 0; c < d.w; c++) {
      const v = getCell(d, c, r);
      if (v < 0) continue;
      ctx.fillStyle = yarnHex(yarns[v], v);
      ctx.fillRect(num + c * cell, yOf(r), cell, cell);
    }
  // 격자선 (10칸마다 굵게)
  ctx.lineWidth = 1;
  for (let c = 0; c <= d.w; c++) {
    ctx.strokeStyle = c % 10 === 0 ? "rgba(0,0,0,.55)" : "rgba(0,0,0,.18)";
    ctx.beginPath(); ctx.moveTo(num + c * cell + 0.5, 0); ctx.lineTo(num + c * cell + 0.5, nr * cell); ctx.stroke();
  }
  for (let r = r0; r <= r1 + 1; r++) {
    ctx.strokeStyle = (r + d.start - 1) % 10 === 0 ? "rgba(0,0,0,.55)" : "rgba(0,0,0,.18)";
    const y = yOf(r) + cell;
    ctx.beginPath(); ctx.moveTo(num, y - 0.5); ctx.lineTo(num + d.w * cell, y - 0.5); ctx.stroke();
  }
  if (num) {
    ctx.fillStyle = "#333";
    ctx.font = `${Math.min(12, Math.max(9, cell * 0.6))}px ui-monospace, monospace`;
    ctx.textBaseline = "middle";
    for (let r = r0; r <= r1; r++) {
      const n = r + d.start;
      if (cell < 12 && n % 5 && n !== d.start) continue;
      const y = yOf(r) + cell / 2;
      ctx.textAlign = "right"; ctx.fillText(String(n), num - 3, y);
      ctx.textAlign = "left"; ctx.fillText(String(n), num + d.w * cell + 3, y);
    }
    ctx.textAlign = "center";
    for (let c = 0; c < d.w; c++) {
      const st = d.w - c; // 코 번호는 오른쪽부터
      if (st % 5 && st !== 1) continue;
      ctx.fillText(String(st), num + c * cell + cell / 2, nr * cell + 7);
    }
  }
  if (o.n != null && hasRow(d, o.n)) {
    const geom = { band: (n: number): [number, number] => [yOf(rowIndex(d, n)), yOf(rowIndex(d, n)) + cell] };
    ctx.save();
    ctx.translate(num, 0);
    overlay(ctx, d.w * cell, geom.band, { n: o.n, side: o.side || "RS", round: !!o.round, rowPx: cell }, Math.max(d.start, r0 + d.start), 1);
    ctx.restore();
  }
  if (o.sel) {
    const s = o.sel;
    ctx.strokeStyle = "#1D4ED8";
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 2;
    ctx.strokeRect(num + Math.min(s.c0, s.c1) * cell, yOf(Math.max(s.r0, s.r1)), (Math.abs(s.c1 - s.c0) + 1) * cell, (Math.abs(s.r1 - s.r0) + 1) * cell);
    ctx.setLineDash([]);
  }
  return { cell, rows: [r0, r1], ox: num, oy: 0, w: d.w, h: nr };
}

/** 화면 좌표 → 칸 (격자 밖이면 null) */
export function hitCell(g: GridGeom, x: number, y: number): { c: number; r: number } | null {
  const c = Math.floor((x - g.ox) / g.cell);
  const ry = Math.floor((y - g.oy) / g.cell);
  if (c < 0 || c >= g.w || ry < 0 || ry >= g.h) return null;
  return { c, r: g.rows[1] - ry };
}
