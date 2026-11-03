/**
 * PDF 텍스트 레이어 기반 순수 계산 (pdf.js 없이 테스트할 수 있게 분리)
 * 좌표는 모두 scale 1 viewport 기준 pt, 원점 왼쪽 위, y 아래로 증가.
 */
export type TItem = { str: string; x: number; y: number; w: number; h: number };

/* ---------------- §3-3 서술 페이지 자동 선택 ---------------- */

export type PageInfo = { n: number; rowItems: number; ko: number; sizes: Set<string>; gauge: boolean };

export function pageInfo(n: number, items: TItem[]): PageInfo {
  const all = items.map((i) => i.str || "").join(" ");
  const rowItems = items.filter((i) => /^\s*\*?\d{1,3}\s*단(\s*\((RS|WS)\)|\s*[~\-]|\s|$)/i.test(i.str || "")).length;
  const ko = (all.match(/[가-힣]/g) || []).length;
  const sizes = new Set<string>();
  for (const m of all.matchAll(/((\d?XL|S|M|L)(\s*,\s*(\d?XL|S|M|L))*)\s*사이즈/g)) m[1].split(/\s*,\s*/).forEach((x) => sizes.add(x));
  const gauge = /게이지|gauge/i.test(all) && /\d+\s*코\s*\d+\s*단/.test(all);
  return { n, rowItems, ko, sizes, gauge };
}

export function normSize(v: string): string {
  const m = (v || "").toUpperCase().replace(/\s/g, "").match(/^(\d?XL|XXXL|XXL|S|M|L)/);
  if (!m) return "";
  return ({ XXL: "2XL", XXXL: "3XL" } as Record<string, string>)[m[1]] || m[1];
}

export function autoPick(info: PageInfo[], sizeIn: string, alreadyRead: number[] = []): { pages: number[]; scanned: boolean } {
  const size = normSize(sizeIn);
  const done = new Set(alreadyRead);
  if (!info.some((x) => x.ko > 0)) return { pages: info.map((x) => x.n).filter((n) => !done.has(n)), scanned: true };
  const pick = new Set(
    info
      .filter((x) => x.rowItems >= 2 && x.ko >= 60 && (!size || x.sizes.size < 2 || x.sizes.has(size)) && !done.has(x.n))
      .map((x) => x.n),
  );
  const g = info.find((x) => x.gauge);
  if (g && !done.has(g.n)) pick.add(g.n);
  return { pages: [...pick].sort((a, b) => a - b), scanned: false };
}

/* ---------------- §3-1 차트 축 감지 ---------------- */

export type Chart = {
  a: number; // y = a + b·n  (n = 단 번호, y = 그 단 세로 중심)
  b: number; // < 0
  nMin: number;
  nMax: number;
  axes: number[]; // 축 열의 x 중심들
  x0: number;
  x1: number;
};

type Pt = { x: number; y: number; n: number; w: number };

function fit(pts: Pt[]) {
  const k = pts.length;
  const mx = pts.reduce((s, p) => s + p.n, 0) / k;
  const my = pts.reduce((s, p) => s + p.y, 0) / k;
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of pts) {
    sxx += (p.n - mx) ** 2;
    sxy += (p.n - mx) * (p.y - my);
    syy += (p.y - my) ** 2;
  }
  const b = sxx ? sxy / sxx : 0;
  const a = my - b * mx;
  const r = sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
  return { a, b, r };
}

export function findCharts(items: TItem[], pageW: number): Chart[] {
  const nums: Pt[] = items
    .filter((i) => /^\s*\d{1,3}\s*$/.test(i.str))
    .map((i) => ({ x: i.x + i.w / 2, y: i.y - i.h * 0.35, n: parseInt(i.str, 10), w: i.w }))
    .sort((p, q) => p.x - q.x);
  // x 간격 ≤ 6pt면 같은 열
  const cols: Pt[][] = [];
  for (const p of nums) {
    const c = cols[cols.length - 1];
    if (c && p.x - c[c.length - 1].x <= 6) c.push(p);
    else cols.push([p]);
  }
  type ColFit = { a: number; b: number; pts: Pt[]; x: number };
  const fits: ColFit[] = [];
  for (const col of cols) {
    // 한 열 안에 서로 다른 차트(위·아래)가 있을 수 있어 y 순서로 큰 간격에서 끊는다
    for (const seg of splitByGap(col)) {
      if (seg.length < 8) continue;
      let f = fit(seg);
      if (!(f.b < 0)) continue;
      const kept = seg.filter((p) => Math.abs(p.y - (f.a + f.b * p.n)) <= 0.6 * Math.abs(f.b));
      if (kept.length < 8) continue;
      f = fit(kept);
      if (!(f.b < 0) || Math.abs(f.r) < 0.995) continue;
      fits.push({ a: f.a, b: f.b, pts: kept, x: kept.reduce((s, p) => s + p.x, 0) / kept.length });
    }
  }
  // 기울기·절편이 같은 열(왼쪽·오른쪽 축)은 하나의 차트
  const charts: { a: number; b: number; cols: ColFit[] }[] = [];
  for (const f of fits) {
    const hit = charts.find((c) => Math.abs(c.b - f.b) <= 0.03 * Math.abs(c.b) && Math.abs(c.a + c.b * mid(f) - (f.a + f.b * mid(f))) <= 0.5 * Math.abs(c.b));
    if (hit) hit.cols.push(f);
    else charts.push({ a: f.a, b: f.b, cols: [f] });
  }
  return charts.map((c) => {
    const pts = c.cols.flatMap((f) => f.pts);
    const f = fit(pts);
    const nMin = Math.min(...pts.map((p) => p.n));
    const nMax = Math.max(...pts.map((p) => p.n));
    const axes = c.cols.map((x) => x.x).sort((p, q) => p - q);
    const yTop = f.a + f.b * (nMax + 0.5);
    const yBot = f.a + f.b * (nMin - 0.5);
    let x0: number, x1: number;
    const axisW = Math.max(...pts.map((p) => p.w), 6);
    if (axes.length >= 2 && axes[axes.length - 1] - axes[0] > 50) {
      x0 = axes[0] - axisW / 2 - 2;
      x1 = axes[axes.length - 1] + axisW / 2 + 2;
    } else {
      // 축이 한쪽뿐: 그 세로 구간 안 모든 텍스트 x 범위 + 축
      const inside = items.filter((i) => i.y >= yTop && i.y - i.h <= yBot);
      x0 = Math.min(axes[0] - axisW, ...inside.map((i) => i.x));
      x1 = Math.max(axes[0] + axisW, ...inside.map((i) => i.x + i.w));
      if (x1 - x0 < 80) {
        x0 = Math.min(x0, 0);
        x1 = Math.max(x1, pageW);
      }
    }
    return { a: f.a, b: f.b, nMin, nMax, axes, x0, x1 };
  });
}

const mid = (f: { pts: Pt[] }) => f.pts[Math.floor(f.pts.length / 2)].n;

function splitByGap(col: Pt[]): Pt[][] {
  const s = [...col].sort((p, q) => p.y - q.y);
  if (s.length < 3) return [s];
  const gaps = s.slice(1).map((p, i) => p.y - s[i].y).sort((a, b) => a - b);
  const med = gaps[Math.floor(gaps.length / 2)] || 1;
  const out: Pt[][] = [[s[0]]];
  for (let i = 1; i < s.length; i++) {
    if (s[i].y - s[i - 1].y > Math.max(med * 4, 20)) out.push([]);
    out[out.length - 1].push(s[i]);
  }
  return out;
}

/** 단 n에 맞는 차트 (범위 안 우선, 없으면 2단 여유, 그래도 없으면 가장 가까운 것) */
export function chartFor(charts: Chart[], n: number): Chart | null {
  if (!charts.length) return null;
  const inside = charts.find((c) => n >= c.nMin && n <= c.nMax);
  if (inside) return inside;
  const near = charts.find((c) => n >= c.nMin - 2 && n <= c.nMax + 2);
  if (near) return near;
  return [...charts].sort((p, q) => dist(p, n) - dist(q, n))[0];
}
const dist = (c: Chart, n: number) => (n < c.nMin ? c.nMin - n : n > c.nMax ? n - c.nMax : 0);

export const rowY = (c: Chart, n: number) => c.a + c.b * n;
export const rowH = (c: Chart) => Math.abs(c.b);

/* ---------------- §3-2 기호표 찾기 ---------------- */

export const LEGEND_RE = /기법\s*설명|기호\s*(설명|표|안내|보는)|약어|범례|legend|abbreviation|chart\s*key|symbol/i;

export function findLegend(items: TItem[]): { x0: number; y0: number; x1: number; y1: number } | null {
  const title = items.find((i) => LEGEND_RE.test(i.str) && i.str.trim().length <= 30);
  if (!title) return null;
  const below = items.filter((i) => i.y > title.y + 1 && i.str.trim()).sort((p, q) => p.y - q.y);
  const take: TItem[] = [];
  let lastY = title.y;
  for (const i of below) {
    if (i.y - lastY > 60) break;
    take.push(i);
    lastY = i.y;
  }
  if (!take.length) return null;
  const x0 = Math.min(title.x, ...take.map((i) => i.x)) - 40;
  const x1 = Math.max(title.x + title.w, ...take.map((i) => i.x + i.w)) + 8;
  return { x0: Math.max(0, x0), y0: title.y - title.h - 4, x1, y1: lastY + 8 };
}
