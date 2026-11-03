/** 직접 그리는 배색 격자 — 순수 로직 (UI는 drawui.ts) */
import type { Drawing, Side, Yarn } from "./types";

const IDX = "0123456789abcdefghijklmnopqrstuvwxyz";
export const MAX_W = 400;
export const MAX_H = 400;

export function newDrawing(w: number, h: number, start = 1): Drawing {
  w = clamp(w, 1, MAX_W);
  h = clamp(h, 1, MAX_H);
  return { w, h, start, cells: ".".repeat(w * h) };
}
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, Math.round(v) || a));

/** r = 0이 맨 아래 단(start), c = 0이 왼쪽 */
export function getCell(d: Drawing, c: number, r: number): number {
  const ch = d.cells[r * d.w + c];
  return ch == null || ch === "." ? -1 : IDX.indexOf(ch);
}
export function setCell(d: Drawing, c: number, r: number, color: number): Drawing {
  if (c < 0 || r < 0 || c >= d.w || r >= d.h) return d;
  const i = r * d.w + c;
  const ch = color < 0 ? "." : IDX[color] ?? ".";
  if (d.cells[i] === ch) return d;
  return { ...d, cells: d.cells.slice(0, i) + ch + d.cells.slice(i + 1) };
}
export function fillRow(d: Drawing, r: number, color: number): Drawing {
  const ch = color < 0 ? "." : IDX[color];
  return { ...d, cells: d.cells.slice(0, r * d.w) + ch.repeat(d.w) + d.cells.slice((r + 1) * d.w) };
}
/** 칸 크기 바꾸기 — 왼쪽 아래 기준으로 기존 칸 유지 */
export function resize(d: Drawing, w: number, h: number): Drawing {
  const nd = newDrawing(w, h, d.start);
  let cells = nd.cells.split("");
  for (let r = 0; r < Math.min(d.h, nd.h); r++) for (let c = 0; c < Math.min(d.w, nd.w); c++) cells[r * nd.w + c] = d.cells[r * d.w + c];
  return { ...nd, cells: cells.join("") };
}
/** 한 단(아래에서 r번째)을 위로 복사 — 반복 무늬 그릴 때 */
export function copyRow(d: Drawing, from: number, to: number): Drawing {
  if (to < 0 || to >= d.h) return d;
  const src = d.cells.slice(from * d.w, (from + 1) * d.w);
  return { ...d, cells: d.cells.slice(0, to * d.w) + src + d.cells.slice((to + 1) * d.w) };
}

export const rowIndex = (d: Drawing, n: number) => n - d.start;
export const hasRow = (d: Drawing, n: number) => n - d.start >= 0 && n - d.start < d.h;

/**
 * 그린 단 → 서술. RS(원통 포함)는 오른쪽→왼쪽, WS는 왼쪽→오른쪽으로 읽는다.
 * 같은 색이 이어지면 묶어서 "A 3코, B 1코 (40코)".
 */
export function describeRow(d: Drawing, n: number, side: Side, yarns: Yarn[]): string | null {
  if (!hasRow(d, n)) return null;
  const r = rowIndex(d, n);
  const order = [...Array(d.w).keys()];
  if (side === "RS") order.reverse();
  const runs: { c: number; k: number }[] = [];
  for (const c of order) {
    const v = getCell(d, c, r);
    const last = runs[runs.length - 1];
    if (last && last.c === v) last.k++;
    else runs.push({ c: v, k: 1 });
  }
  if (runs.length === 1 && runs[0].c < 0) return null;
  const name = (i: number) => (i < 0 ? "빈칸" : yarns[i]?.code || `색${i + 1}`);
  return runs.map((x) => `${name(x.c)} ${x.k}코`).join(", ") + ` (${d.w}코)`;
}

/** 그 단에서 쓰는 색 인덱스 (등장 순) */
export function rowColors(d: Drawing, n: number): number[] {
  if (!hasRow(d, n)) return [];
  const r = rowIndex(d, n);
  const s = new Set<number>();
  for (let c = 0; c < d.w; c++) {
    const v = getCell(d, c, r);
    if (v >= 0) s.add(v);
  }
  return [...s];
}

/* ---------- PDF 차트 색 → 격자 ---------- */

export function hexToRgb(h: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(h || "");
  if (!m) return [128, 128, 128];
  const v = parseInt(m[1], 16);
  return [v >> 16, (v >> 8) & 255, v & 255];
}
export const rgbToHex = (r: number, g: number, b: number) => "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

/** 픽셀 색들을 k개 대표색으로 (흰 배경·검은 격자선 근처는 버린다) */
export function dominantColors(px: [number, number, number][], k = 6): { hex: string; share: number }[] {
  const bins = new Map<string, { r: number; g: number; b: number; n: number }>();
  let total = 0;
  for (const [r, g, b] of px) {
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (min > 235) continue; // 흰 배경
    if (max < 40) continue; // 격자선·글자
    const key = `${r >> 5},${g >> 5},${b >> 5}`;
    const bin = bins.get(key) || { r: 0, g: 0, b: 0, n: 0 };
    bin.r += r; bin.g += g; bin.b += b; bin.n++;
    bins.set(key, bin);
    total++;
  }
  return [...bins.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, k)
    .filter((x) => x.n / Math.max(1, total) > 0.02)
    .map((x) => ({ hex: rgbToHex(x.r / x.n, x.g / x.n, x.b / x.n), share: x.n / total }));
}

/** 가장 가까운 팔레트 색 인덱스 (팔레트에 hex가 없으면 -1) */
export function nearest(rgb: [number, number, number], palette: (string | null)[]): number {
  let best = -1, bd = Infinity;
  palette.forEach((h, i) => {
    if (!h) return;
    const [r, g, b] = hexToRgb(h);
    const d = (r - rgb[0]) ** 2 * 0.3 + (g - rgb[1]) ** 2 * 0.59 + (b - rgb[2]) ** 2 * 0.11;
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

/* ---------- 편집 도구 (채우기·선택·반전·반복·행열 삽입/삭제) ---------- */

export type Rect = { c0: number; r0: number; c1: number; r1: number }; // 포함 범위
export const normRect = (a: Rect): Rect => ({ c0: Math.min(a.c0, a.c1), c1: Math.max(a.c0, a.c1), r0: Math.min(a.r0, a.r1), r1: Math.max(a.r0, a.r1) });

/** 같은 색으로 이어진 칸 채우기 (4방향) */
export function floodFill(d: Drawing, c: number, r: number, color: number): Drawing {
  const target = getCell(d, c, r);
  if (target === color) return d;
  const cells = d.cells.split("");
  const ch = color < 0 ? "." : IDX[color];
  const tch = d.cells[r * d.w + c];
  const st = [[c, r]];
  while (st.length) {
    const [x, y] = st.pop()!;
    if (x < 0 || y < 0 || x >= d.w || y >= d.h) continue;
    const i = y * d.w + x;
    if (cells[i] !== tch) continue;
    cells[i] = ch;
    st.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  return { ...d, cells: cells.join("") };
}

export type Clip = { w: number; h: number; cells: string };
export function copyRect(d: Drawing, rect: Rect): Clip {
  const q = normRect(rect);
  let cells = "";
  for (let r = q.r0; r <= q.r1; r++) cells += d.cells.slice(r * d.w + q.c0, r * d.w + q.c1 + 1);
  return { w: q.c1 - q.c0 + 1, h: q.r1 - q.r0 + 1, cells };
}
/** (c, r) = 붙일 자리의 왼쪽 아래. transparent면 빈칸은 덮지 않는다 */
export function paste(d: Drawing, clip: Clip, c: number, r: number, transparent = false): Drawing {
  const cells = d.cells.split("");
  for (let y = 0; y < clip.h; y++)
    for (let x = 0; x < clip.w; x++) {
      const X = c + x, Y = r + y;
      if (X < 0 || Y < 0 || X >= d.w || Y >= d.h) continue;
      const v = clip.cells[y * clip.w + x];
      if (transparent && v === ".") continue;
      cells[Y * d.w + X] = v;
    }
  return { ...d, cells: cells.join("") };
}
export function flipClip(clip: Clip, axis: "h" | "v"): Clip {
  let cells = "";
  for (let y = 0; y < clip.h; y++) {
    const yy = axis === "v" ? clip.h - 1 - y : y;
    const row = clip.cells.slice(yy * clip.w, (yy + 1) * clip.w);
    cells += axis === "h" ? row.split("").reverse().join("") : row;
  }
  return { ...clip, cells };
}
/** 선택 영역을 좌우로 반전해 제자리에 */
export function mirrorRect(d: Drawing, rect: Rect, axis: "h" | "v"): Drawing {
  const q = normRect(rect);
  return paste(d, flipClip(copyRect(d, q), axis), q.c0, q.r0);
}
/** 선택 영역(반복 단위)을 가로로 끝까지, 세로로도 끝까지 이어 붙인다 */
export function tileRepeat(d: Drawing, rect: Rect, dir: "x" | "y" | "xy"): Drawing {
  const q = normRect(rect);
  const clip = copyRect(d, q);
  let out = d;
  const xs = dir === "y" ? [q.c0] : range(q.c0 % clip.w - clip.w, d.w, clip.w);
  const ys = dir === "x" ? [q.r0] : range(q.r0 % clip.h - clip.h, d.h, clip.h);
  for (const y of ys) for (const x of xs) out = paste(out, clip, x, y);
  return out;
}
const range = (a: number, b: number, step: number) => {
  const o: number[] = [];
  for (let v = a; v < b; v += step) o.push(v);
  return o;
};

export function insertRow(d: Drawing, at: number): Drawing {
  if (d.h >= MAX_H) return d;
  const src = d.cells.slice(Math.min(at, d.h - 1) * d.w, (Math.min(at, d.h - 1) + 1) * d.w) || ".".repeat(d.w);
  return { ...d, h: d.h + 1, cells: d.cells.slice(0, at * d.w) + src + d.cells.slice(at * d.w) };
}
export function deleteRow(d: Drawing, at: number): Drawing {
  if (d.h <= 1) return d;
  return { ...d, h: d.h - 1, cells: d.cells.slice(0, at * d.w) + d.cells.slice((at + 1) * d.w) };
}
export function insertCol(d: Drawing, at: number): Drawing {
  if (d.w >= MAX_W) return d;
  let cells = "";
  for (let r = 0; r < d.h; r++) {
    const row = d.cells.slice(r * d.w, (r + 1) * d.w);
    cells += row.slice(0, at) + (row[Math.min(at, d.w - 1)] ?? ".") + row.slice(at);
  }
  return { ...d, w: d.w + 1, cells };
}
export function deleteCol(d: Drawing, at: number): Drawing {
  if (d.w <= 1) return d;
  let cells = "";
  for (let r = 0; r < d.h; r++) {
    const row = d.cells.slice(r * d.w, (r + 1) * d.w);
    cells += row.slice(0, at) + row.slice(at + 1);
  }
  return { ...d, w: d.w - 1, cells };
}

/**
 * 가로 배색(스트랜디드) 플로트: 단에서 각 색이 안 쓰이는 칸이 가장 길게 이어지는 길이.
 * 원통이 아니면 단 양끝은 실을 끊지 않고 이어지지 않는다고 본다.
 */
export function longestFloat(d: Drawing, n: number): { color: number; len: number } | null {
  if (!hasRow(d, n)) return null;
  const r = rowIndex(d, n);
  const used = rowColors(d, n);
  if (used.length < 2) return null;
  let best = { color: -1, len: 0 };
  for (const col of used) {
    let first = -1, last = -1;
    for (let c = 0; c < d.w; c++) if (getCell(d, c, r) === col) { if (first < 0) first = c; last = c; }
    let run = 0;
    for (let c = first; c <= last; c++) {
      if (getCell(d, c, r) === col) run = 0;
      else if (++run > best.len) best = { color: col, len: run };
    }
  }
  return best.len ? best : null;
}

/** 사진/차트 이미지 → 격자: 칸마다 가운데 색을 팔레트 가장 가까운 색으로 */
export function gridFromPixels(get: (x: number, y: number) => [number, number, number], w: number, h: number, palette: (string | null)[], start = 1): Drawing {
  let d = newDrawing(w, h, start);
  const cells = d.cells.split("");
  for (let r = 0; r < h; r++)
    for (let c = 0; c < w; c++) {
      const rgb = get(c, r);
      const k = nearest(rgb, palette);
      cells[r * w + c] = k < 0 ? "." : IDX[k];
    }
  return { ...d, cells: cells.join("") };
}
