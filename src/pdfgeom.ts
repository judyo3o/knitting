/**
 * PDF 텍스트 레이어 기반 순수 계산 (pdf.js 없이 테스트할 수 있게 분리)
 * 좌표는 모두 scale 1 viewport 기준 pt, 원점 왼쪽 위, y 아래로 증가.
 */
export type TItem = { str: string; x: number; y: number; w: number; h: number };

/* ---------------- §3-3 서술 페이지 자동 선택 ---------------- */

export type PageInfo = { n: number; rowItems: number; ko: number; sizes: Set<string>; gauge: boolean; instr: number };

export function pageInfo(n: number, items: TItem[]): PageInfo {
  const all = items.map((i) => i.str || "").join(" ");
  const rowItems = items.filter((i) => /^\s*\*?\d{1,3}\s*단(\s*\((RS|WS)\)|\s*[~\-:：.)]|\s|$)|^\s*(?:rounds?|rnds?|rows?)\s*\d{1,3}\b|^\s*\d{1,3}(?:st|nd|rd|th)\s+(?:rounds?|rows?|rnds?)\b/i.test(i.str || "")).length;
  // 글자 수: 한글 + 영문(라틴) — 영어 도안도 '글자 있는 PDF'로
  const ko = (all.match(/[가-힣]/g) || []).length + Math.round((all.match(/[A-Za-zÀ-ÿ]/g) || []).length / 2);
  const sizes = new Set<string>();
  for (const m of all.matchAll(/((\d?XL|S|M|L)(\s*,\s*(\d?XL|S|M|L))*)\s*사이즈/g)) m[1].split(/\s*,\s*/).forEach((x) => sizes.add(x));
  const gauge = /게이지|gauge|tension/i.test(all) && /\d+\s*코\s*\d+\s*단|\d+\s*(?:sts?|stitches)\b/i.test(all);
  // 서술형(줄글) 도안용: 뜨개 지시 낱말 수
  const instr = (all.match(/\b(?:knit|purl|k2tog|ssk|cast on|bind off|rep|rnds?|rows?|sts|inc|dec|dc|sc|ch|sl st)\b|겉뜨기|안뜨기|코잡기|코막음|코줄임|코늘림|사슬|짧은뜨기|한길긴뜨기/gi) || []).length;
  return { n, rowItems, ko, sizes, gauge, instr };
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
  // 단 번호 표가 거의 없는 줄글 도안이면 지시 낱말이 많은 쪽을 고른다
  const prose = info.filter((x) => x.rowItems >= 2).length <= 2;
  const isInstr = (x: PageInfo) => x.rowItems >= 2 || (prose && x.instr >= 12);
  const pick = new Set(
    info
      .filter((x) => isInstr(x) && x.ko >= 60 && (!size || x.sizes.size < 2 || x.sizes.has(size)) && !done.has(x.n))
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
/**
 * 코 번호 축: 차트 아래(또는 위)의 숫자 줄("38 34 … 5 1") → 가장 왼쪽·오른쪽 숫자의 가운데 x(pt)와 가장 큰 번호(= 콧수)
 */
export function stitchAxis(items: TItem[], c: Chart): { x0: number; x1: number; max: number; a: number; b: number } | null {
  const h = rowH(c);
  const yBot = rowY(c, c.nMin) + h / 2, yTopC = rowY(c, c.nMax) - h / 2;
  const nearAxis = (x: number) => c.axes.some((a) => Math.abs(a - x) < h * 1.5);
  const pick = (lo: number, hi: number) => items.filter((i) => /^\s*\d{1,3}\s*$/.test(i.str) && i.y > lo && i.y < hi && i.x >= c.x0 - 2 && i.x + i.w <= c.x1 + 2 && !nearAxis(i.x + i.w / 2));
  for (const nums of [pick(yBot, yBot + h * 3.5), pick(yTopC - h * 3, yTopC)]) {
    if (nums.length < 3) continue;
    const pts = nums.map((i) => ({ x: i.x + i.w / 2, v: +i.str.trim() })).sort((a, b) => a.x - b.x);
    // 숫자가 한 방향으로만 늘거나 줄어야 코 번호 축
    const up = pts.every((q, j) => j === 0 || q.v > pts[j - 1].v), down = pts.every((q, j) => j === 0 || q.v < pts[j - 1].v);
    if (!up && !down) continue;
    // 코 번호라면 번호 1 차이 = 칸 하나: x가 번호에 정비례하고(어긋남 < 칸 0.4개), 칸 너비가 단 높이와 비슷해야 한다
    const n = pts.length, mv = pts.reduce((a, q) => a + q.v, 0) / n, mx = pts.reduce((a, q) => a + q.x, 0) / n;
    const b = pts.reduce((a, q) => a + (q.v - mv) * (q.x - mx), 0) / Math.max(1e-9, pts.reduce((a, q) => a + (q.v - mv) ** 2, 0));
    const cell = Math.abs(b);
    if (cell < h * 0.4 || cell > h * 2.5) continue;
    if (pts.some((q) => Math.abs(mx + b * (q.v - mv) - q.x) > cell * 0.4)) continue;
    return { x0: pts[0].x, x1: pts[pts.length - 1].x, max: Math.max(...pts.map((q) => q.v)), a: mx - b * mv, b }; // x = a + b × 코 번호
  }
  return null;
}

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
  // 제목 아래 줄들: 같은 높이끼리 한 줄로 묶고, 줄 간격이 갑자기 벌어지거나 다른 제목(대문자 머리말)이 나오면 거기서 끝
  const below = items.filter((i) => i.y > title.y + 1 && i.str.trim()).sort((p, q) => p.y - q.y);
  const lines: { y: number; h: number; its: TItem[] }[] = [];
  for (const i of below) {
    const l = lines[lines.length - 1];
    if (l && Math.abs(i.y - l.y) < Math.max(2, Math.min(l.h, i.h) * 0.5)) l.its.push(i);
    else lines.push({ y: i.y, h: i.h, its: [i] });
  }
  const take: TItem[] = [];
  let lastY = title.y;
  const gaps: number[] = [];
  const HEAD = /^[A-Z][A-Z0-9 &'’()-]{3,}:?$/;
  for (const l of lines) {
    const gap = l.y - lastY;
    const med = gaps.length >= 3 ? [...gaps].sort((x, y) => x - y)[gaps.length >> 1] : 0;
    if (gap > 60 || (med && gap > Math.max(med * 2.2, l.h * 2.4))) break;
    if (take.length && l.its.length <= 2 && l.its.every((i) => HEAD.test(i.str.trim())) && !LEGEND_RE.test(l.its[0].str)) break; // 다음 머리말
    take.push(...l.its);
    if (take.length > l.its.length) gaps.push(gap);
    lastY = l.y;
  }
  if (!take.length) return null;
  const x0 = Math.min(title.x, ...take.map((i) => i.x)) - 40;
  const x1 = Math.max(title.x + title.w, ...take.map((i) => i.x + i.w)) + 8;
  return { x0: Math.max(0, x0), y0: title.y - title.h - 4, x1, y1: lastY + 8 };
}

/* ---------------- 텍스트 항목 → 줄 (내장 읽기) ---------------- */

/**
 * 같은 높이(기준선 차이 < 글자 높이 0.5)의 항목을 왼→오로 이어 한 줄로. 숫자만 있는 차트 축은 뺀다.
 * 두 단 편집(왼쪽 단·오른쪽 단)이면 큰 간격에서 끊어 왼쪽 단을 다 읽은 뒤 오른쪽 단을 읽는다.
 */
export function toLines(items: TItem[], pageW = 0): string[] {
  const its = items.filter((i) => i.str.trim() && !/^\s*\d{1,3}\s*$/.test(i.str)).sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: TItem[][] = [];
  for (const it of its) {
    const r = rows[rows.length - 1];
    if (r && Math.abs(r[0].y - it.y) < Math.max(2, Math.min(r[0].h, it.h) * 0.5)) r.push(it);
    else rows.push([it]);
  }
  type Seg = { x: number; y: number; t: string; row: number };
  const segs: Seg[] = [];
  const W = pageW || Math.max(...its.map((i) => i.x + i.w), 1);
  rows.forEach((r, ri) => {
    r.sort((a, b) => a.x - b.x);
    let cur: Seg | null = null;
    let end = -Infinity;
    for (const it of r) {
      const gap = it.x - end;
      if (cur && gap > Math.max(24, W * 0.04) && it.x > W * 0.38) {
        segs.push(cur);
        cur = null;
      }
      if (!cur) cur = { x: it.x, y: it.y, t: it.str, row: ri };
      else {
        // 자간 때문에 숫자가 쪼개진 경우("2" "7단")는 붙인다
        const glued = /\d$/.test(cur.t) && /^\d/.test(it.str) && gap < Math.max(1.5, it.h * 0.45);
        cur.t += (gap > 1 && !glued ? " " : "") + it.str;
      }
      end = it.x + it.w;
    }
    if (cur) segs.push(cur);
  });
  // 오른쪽 단 시작이 여러 줄에서 반복되면 두 단 편집으로 본다
  const rightStarts = segs.filter((s) => s.x > W * 0.38).length;
  const twoCol = rightStarts >= 4 && segs.filter((s) => s.x < W * 0.38).length >= 4;
  const clean = (s: Seg) => s.t.replace(/\s+/g, " ").trim();
  if (!twoCol) {
    // 한 단: 같은 줄 조각을 다시 잇는다
    const out: string[] = [];
    let last = -1;
    for (const s of segs) {
      if (s.row === last) out[out.length - 1] += " " + clean(s);
      else out.push(clean(s));
      last = s.row;
    }
    return out;
  }
  const left = segs.filter((s) => s.x <= W * 0.38), right = segs.filter((s) => s.x > W * 0.38);
  return [...left, ...right].map(clean);
}

/**
 * 원본 쪽에서 이 단 서술이 있는 자리 (내 사이즈 구역 안에서). 한 쪽에 여러 사이즈가 섞여 있어도 내 사이즈 줄을 찾는다.
 * 반환: 강조할 세로 범위 (pt, 위에서부터)
 */
export function findRowSpot(items: TItem[], n: number, span: [number, number] | null, size: string): { y0: number; y1: number } | null {
  const SZ = /^\s*(\d?XL|XXXL|XXL|XS|S|M|L)\s*사이즈/i;
  const norm = (x: string) => x.toUpperCase().replace(/^XXL$/, "2XL").replace(/^XXXL$/, "3XL");
  const heads = items.filter((i) => SZ.test(i.str)).map((i) => ({ sz: norm(i.str.match(SZ)![1]), y: i.y })).sort((a, b) => a.y - b.y);
  let lo = -Infinity, hi = Infinity;
  if (size && heads.length) {
    const mine = heads.find((x) => x.sz === norm(size));
    if (mine) { lo = mine.y - 1; hi = heads.find((x) => x.y > mine.y + 1)?.y ?? Infinity; }
    else hi = heads[0].y; // 내 사이즈 제목이 없으면 앞쪽에서 이어지는 부분만 (첫 사이즈 제목 전까지)
  }
  const ROW = /^\s*\(?\s*(\d{1,3})\s*단?\s*(?:[~\-–]\s*(\d{1,3})\s*)?단/;
  const labels = items.filter((i) => i.y > lo && i.y < hi && ROW.test(i.str)).sort((a, b) => a.y - b.y);
  const want = span ? span[0] : n;
  const hit = labels.find((i) => { const m = i.str.match(ROW)!; const a = +m[1], b = m[2] ? +m[2] : a; return (want >= a && want <= b) || (n >= a && n <= b); });
  if (!hit) return null;
  const next = labels.find((i) => i.y > hit.y + hit.h * 0.8);
  const y1 = Math.min(next ? next.y - next.h : hit.y + hit.h * 3, hi === Infinity ? Infinity : hi - hit.h);
  return { y0: hit.y - hit.h - 2, y1: Math.max(hit.y + 3, y1) };
}

/**
 * 사이즈별 시작·끝 선: 차트 아래(또는 위)의 사이즈 이름("XL", "2/3XL", "4/5XL", "S/M")과 그 x 위치.
 * 이름 하나가 여러 사이즈를 묶기도 한다 ("2/3XL" = 2XL, 3XL).
 */
export function sizeMarks(items: TItem[], c: Chart): { sizes: string[]; x: number }[] {
  const h = rowH(c);
  const yBot = rowY(c, c.nMin) + h / 2, yTopC = rowY(c, c.nMax) - h / 2;
  const LBL = /^\s*(?:(\d)\s*\/\s*(\d)\s*(XL)|(\d?)\s*(XS|XL|S|M|L|X)(?:\s*\/\s*(\d?)\s*(XS|XL|S|M|L))?)\s*$/i;
  const norm = (n: string, t: string) => { t = t.toUpperCase(); if (t === "X") t = "XL"; return (n && n !== "1" ? n : "") + t; };
  const out: { sizes: string[]; x: number }[] = [];
  for (const i of items) {
    const inBand = (i.y > yBot && i.y < yBot + h * 5) || (i.y < yTopC && i.y > yTopC - h * 4);
    if (!inBand || i.x < c.x0 - h * 2 || i.x > c.x1 + h * 2) continue;
    const m = i.str.match(LBL);
    if (!m) continue;
    const sizes = m[3] ? [norm(m[1], "XL"), norm(m[2], "XL")] : [norm(m[4], m[5]), ...(m[7] ? [norm(m[6] || "", m[7])] : [])];
    out.push({ sizes, x: i.x + i.w / 2 });
  }
  return out;
}

/** 내 사이즈의 차트 범위 [왼쪽 x, 오른쪽 x] (pt). 양쪽에 표시가 있으면 그 사이, 한쪽만 있으면 그 선부터 차트 반대쪽 끝까지 */
export function sizeRange(items: TItem[], c: Chart, size: string): [number, number] | null {
  if (!size) return null;
  const want = size.toUpperCase().replace(/^XXXL$/, "3XL").replace(/^XXL$/, "2XL").replace(/^1XL$/, "XL");
  const marks = sizeMarks(items, c);
  if (marks.length < 2) return null; // 사이즈 표시가 하나뿐이면 사이즈별 선이 아님
  const mine = marks.filter((m) => m.sizes.includes(want)).map((m) => m.x).sort((a, b) => a - b);
  if (!mine.length) return null;
  if (mine.length >= 2) return [mine[0], mine[mine.length - 1]];
  const mid = (c.x0 + c.x1) / 2;
  // 축 숫자 칸을 뺀 격자 끝
  const left = c.axes.filter((a) => a < mid);
  const right = c.axes.filter((a) => a >= mid);
  const gl = left.length ? Math.max(...left) + rowH(c) * 0.8 : c.x0;
  const gr = right.length ? Math.min(...right) - rowH(c) * 0.8 : c.x1;
  return mine[0] > mid ? [gl, mine[0]] : [mine[0], gr];
}

/** 사이즈 이름 목록 풀기: "XL/2/3XL/4/5XL" → XL, 2XL, 3XL, 4XL, 5XL · "XS/S/M/L" → XS, S, M, L */
export function sizeList(text: string): string[] {
  const toks = text.toUpperCase().replace(/\s+/g, "").split("/").filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (/^\d$/.test(t) && /^\d?X+L$/.test(toks[i + 1] || "")) out.push(t + "XL");
    else if (/^(?:\d?XL|XXXL|XXL|XS|S|M|L)$/.test(t)) out.push(t.replace(/^XXXL$/, "3XL").replace(/^XXL$/, "2XL"));
  }
  return out;
}

/** 차트 제목("CHART II BACK - XL/2/3XL/4/5XL")에 적힌 사이즈: 차트 위쪽, 가로로 겹치는 글자에서 */
export function chartSizes(items: TItem[], c: Chart): string[] {
  const top = rowY(c, c.nMax) - rowH(c) / 2;
  const near = items.filter((i) => i.y < top + 2 && i.y > top - 140 && i.x + i.w > c.x0 - 40 && i.x < c.x1);
  const best = near.filter((i) => /(?:^|[\s/])(?:\d?XL|XS|S|M|L)(?:$|[\s/])/i.test(i.str) && /\//.test(i.str)).sort((a, b) => b.y - a.y)[0];
  return best ? sizeList(best.str.replace(/^.*?([\dA-Z/]*\/[\dA-Z/]*).*$/i, "$1")) : [];
}

/** 한 쪽에 사이즈별 차트가 여럿이면 내 사이즈 차트만 (제목에 사이즈가 없는 차트는 그대로) */
export function chartsForSize(items: TItem[], charts: Chart[], size: string): Chart[] {
  if (!size || charts.length < 2) return charts;
  const want = sizeList(size)[0] || size.toUpperCase();
  const tagged = charts.map((c) => ({ c, s: chartSizes(items, c) }));
  if (!tagged.some((t) => t.s.includes(want))) return charts;
  return tagged.filter((t) => !t.s.length || t.s.includes(want)).map((t) => t.c);
}
