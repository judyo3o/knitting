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

/* ---------- 이미지 → 팔레트 (k-평균) ---------- */

type RGB = [number, number, number];
const d2 = (a: RGB, b: RGB) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/** 픽셀들을 k개 대표색으로 (k-means, 가장 먼 점 초기화 — 결과가 매번 같다) */
export function quantize(px: RGB[], k: number, iters = 12): string[] {
  if (!px.length) return [];
  k = Math.max(1, Math.min(k, px.length));
  const centers: RGB[] = [];
  // 첫 중심: 가장 흔한 색 근처(평균), 다음부터 가장 먼 점
  const mean: RGB = [0, 1, 2].map((i) => px.reduce((s, p) => s + p[i], 0) / px.length) as RGB;
  centers.push(px.reduce((best, p) => (d2(p, mean) < d2(best, mean) ? p : best), px[0]));
  while (centers.length < k) {
    let far = px[0], fd = -1;
    for (const p of px) {
      const m = Math.min(...centers.map((c) => d2(p, c)));
      if (m > fd) { fd = m; far = p; }
    }
    if (fd <= 0) break;
    centers.push(far);
  }
  for (let it = 0; it < iters; it++) {
    const sum = centers.map(() => [0, 0, 0, 0]);
    for (const p of px) {
      let bi = 0, bd = Infinity;
      centers.forEach((c, i) => { const v = d2(p, c); if (v < bd) { bd = v; bi = i; } });
      sum[bi][0] += p[0]; sum[bi][1] += p[1]; sum[bi][2] += p[2]; sum[bi][3]++;
    }
    let moved = false;
    sum.forEach((s, i) => {
      if (!s[3]) return;
      const n: RGB = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
      if (d2(n, centers[i]) > 0.5) moved = true;
      centers[i] = n;
    });
    if (!moved) break;
  }
  // 많이 쓰인 색부터
  const count = centers.map(() => 0);
  for (const p of px) {
    let bi = 0, bd = Infinity;
    centers.forEach((c, i) => { const v = d2(p, c); if (v < bd) { bd = v; bi = i; } });
    count[bi]++;
  }
  return centers.map((c, i) => ({ c, n: count[i] })).filter((x) => x.n).sort((a, b) => b.n - a.n).map((x) => rgbToHex(...x.c));
}

/** 이미지 영역(crop, 원본 픽셀)을 w×h칸으로: 칸마다 3×3 점 평균 → 가장 가까운 팔레트 */
export function gridFromImage(get: (x: number, y: number) => RGB, crop: { x: number; y: number; w: number; h: number }, w: number, h: number, palette: (string | null)[], start = 1): Drawing {
  const cw = crop.w / w, ch = crop.h / h;
  return gridFromPixels((c, r) => {
    const x0 = crop.x + c * cw, y0 = crop.y + (h - 1 - r) * ch;
    const acc = [0, 0, 0];
    for (const fx of [0.25, 0.5, 0.75]) for (const fy of [0.25, 0.5, 0.75]) {
      const v = get(x0 + cw * fx, y0 + ch * fy);
      acc[0] += v[0]; acc[1] += v[1]; acc[2] += v[2];
    }
    return [acc[0] / 9, acc[1] / 9, acc[2] / 9];
  }, w, h, palette, start);
}

/** 색별 코 수 (범례용) */
export function colorCounts(d: Drawing): number[] {
  const out: number[] = [];
  for (const ch of d.cells) {
    if (ch === ".") continue;
    const v = IDX.indexOf(ch);
    out[v] = (out[v] || 0) + 1;
  }
  return out;
}

/** 게이지 → 칸 높이/너비 (뜨개 코는 보통 납작하다) */
export const cellAspect = (d: Drawing) => {
  const g = d.opt?.gauge;
  return g && g.st > 0 && g.rows > 0 ? Math.max(0.4, Math.min(2, g.st / g.rows)) : 1;
};

/** 게이지를 지키며 너비에 맞는 단수 */
export function rowsForWidth(w: number, imgW: number, imgH: number, gauge?: { st: number; rows: number } | null) {
  const ratio = gauge && gauge.st > 0 ? gauge.rows / gauge.st : 1;
  return Math.max(1, Math.round((w * imgH * ratio) / imgW));
}

/* ---------- 사진 속 차트의 격자 찾기 ---------- */

/** 가장자리 세기 → 주기(칸 크기)·시작점 */
function periodOf(profile: Float64Array, minP: number, maxP: number): { p: number; score: number } | null {
  const n = profile.length;
  const mean = profile.reduce((s, v) => s + v, 0) / n;
  const z = profile.map((v) => v - mean);
  let best: { p: number; score: number } | null = null;
  const ac = (p: number) => {
    let s = 0;
    for (let i = 0; i + p < n; i++) s += z[i] * z[i + p];
    return s / (n - p);
  };
  const ac0 = ac(0) || 1;
  const scores: number[] = [];
  for (let p = minP; p <= maxP; p++) {
    const s = ac(p) / ac0;
    // 주기의 배수(2p)도 강해야 진짜 격자
    const s2 = 2 * p < n ? ac(2 * p) / ac0 : s;
    scores[p] = s + 0.5 * s2;
  }
  const top = Math.max(...scores.filter((v) => v != null));
  // 칸 몇 개 묶음(배수)이 아니라 가장 작은 주기: 최고점에 가까운 첫 봉우리
  for (let p = minP; p <= maxP; p++) {
    const v = scores[p];
    const peak = v >= (scores[p - 1] ?? -Infinity) && v >= (scores[p + 1] ?? -Infinity);
    if (peak && v >= top * 0.7) { best = { p, score: v }; break; }
  }
  if (!best) return null;
  // 정수 주기 근처를 소수점까지 다듬기 (칸 수가 많으면 오차가 쌓임)
  let fine = best.p, fs = -Infinity;
  for (let q = best.p - 0.9; q <= best.p + 0.9; q += 0.05) {
    let s = 0;
    for (let k = 1; k * q < n - 1; k++) {
      const i = Math.round(k * q);
      for (let i0 = 0; i0 + i < n; i0 += Math.max(1, Math.floor(n / 64))) s += z[i0] * z[i0 + i];
    }
    if (s > fs) { fs = s; fine = q; }
  }
  return { p: fine, score: best.score };
}

/** 주기 p인 격자선의 위치(위상)와, 선이 실제로 이어지는 범위 */
function gridSpan(profile: Float64Array, p: number): { start: number; count: number } {
  const n = profile.length;
  let bestPhase = 0, bestS = -Infinity;
  for (let ph = 0; ph < p; ph += 0.25) {
    let s = 0;
    for (let x = ph; x < n; x += p) s += profile[Math.round(x)] || 0;
    if (s > bestS) { bestS = s; bestPhase = ph; }
  }
  // 선마다 세기 → 바깥쪽 약한 선은 버린다 (여백·글자)
  const lines: { x: number; v: number }[] = [];
  for (let x = bestPhase; x < n; x += p) {
    const i = Math.round(x);
    let v = 0;
    for (let d = -1; d <= 1; d++) v = Math.max(v, profile[i + d] || 0);
    lines.push({ x, v });
  }
  const sorted = [...lines].map((l) => l.v).sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length * 0.6)] || 0;
  const strong = lines.map((l) => l.v >= med * 0.45);
  // 가장 긴 연속 구간
  let bs = 0, bl = 0;
  for (let i = 0; i < lines.length; ) {
    if (!strong[i]) { i++; continue; }
    let j = i;
    while (j + 1 < lines.length && strong[j + 1]) j++;
    if (j - i + 1 > bl) { bl = j - i + 1; bs = i; }
    i = j + 1;
  }
  return { start: lines[bs]?.x ?? 0, count: Math.max(1, bl - 1) };
}

/**
 * 사진(밝기 함수)에서 차트 격자 찾기: 가로·세로 가장자리 세기의 주기로 칸 크기를, 선이 이어지는 범위로 칸 수를.
 * 찾으면 {x, y, w, h, cols, rows} (원본 픽셀), 못 찾으면 null.
 */
export function detectGrid(lum: (x: number, y: number) => number, W: number, H: number): { x: number; y: number; w: number; h: number; cols: number; rows: number } | null {
  if (W < 20 || H < 20) return null;
  const px = new Float64Array(W), py = new Float64Array(H);
  const sy = Math.max(1, Math.floor(H / 400)), sx = Math.max(1, Math.floor(W / 400));
  for (let y = 0; y < H; y += sy)
    for (let x = 1; x < W; x++) {
      const d = Math.abs(lum(x, y) - lum(x - 1, y));
      px[x] += d;
    }
  for (let x = 0; x < W; x += sx)
    for (let y = 1; y < H; y++) {
      const d = Math.abs(lum(x, y) - lum(x, y - 1));
      py[y] += d;
    }
  const cx = periodOf(px, 4, Math.floor(W / 3)), cy = periodOf(py, 4, Math.floor(H / 3));
  if (!cx || !cy || cx.score < 0.15 || cy.score < 0.15) return null;
  const gx = gridSpan(px, cx.p), gy = gridSpan(py, cy.p);
  if (gx.count < 2 || gy.count < 2) return null;
  return { x: gx.start, y: gy.start, w: gx.count * cx.p, h: gy.count * cy.p, cols: gx.count, rows: gy.count };
}

/** 색 수 자동: 2~8색 중, 색을 하나 더 늘려도 오차가 별로 안 줄면 거기서 멈춘다 */
export function quantizeAuto(px: [number, number, number][], maxK = 8): string[] {
  const err = (pal: string[]) => {
    const cs = pal.map(hexToRgb);
    let s = 0;
    for (const p of px) s += Math.sqrt(Math.min(...cs.map((c) => (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2)));
    return s / Math.max(1, px.length);
  };
  let best = quantize(px, 2), e = err(best);
  for (let k = 3; k <= maxK; k++) {
    const pal = quantize(px, k);
    if (pal.length < k) break;
    const e2 = err(pal);
    if (e - e2 < Math.max(4, e * 0.25)) break; // 더 나눠도 별 차이 없음
    best = pal;
    e = e2;
  }
  return best;
}
