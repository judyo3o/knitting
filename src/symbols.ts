/**
 * 차트 기호 → 기법 이름
 *  1) 글자 기호(｜, SSK, k2tog, 감아코…)는 PDF 글자 레이어에서 찾아 기호표 항목과 맞춘다
 *  2) 그림 기호(교차뜨기 선, 빈칸…)는 격자선으로 칸을 찾고 기호표의 기호 그림과 비교 (추정)
 */
import { LEGEND_RE, type TItem } from "./pdfgeom";

export type Box = { x0: number; y0: number; x1: number; y1: number };
export type LegendEntry = { sym: string; name: string; cy: number; area: Box };

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "").replace(/[‐-―−]/g, "-");

/** 기호표 영역의 글자로 [기호 글자, 이름] 목록을 만든다 (기호가 그림이면 sym = "") */
export function legendEntries(items: TItem[], lg: Box): LegendEntry[] {
  const its = items
    .filter((i) => i.str.trim() && i.x >= lg.x0 - 2 && i.x <= lg.x1 && i.y >= lg.y0 && i.y <= lg.y1 + 2 && !LEGEND_RE.test(i.str))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  type Line = { y: number; h: number; items: TItem[] };
  const lines: Line[] = [];
  for (const it of its) {
    const l = lines[lines.length - 1];
    if (l && Math.abs(l.y - it.y) < Math.max(2, Math.min(l.h, it.h) * 0.5)) l.items.push(it);
    else lines.push({ y: it.y, h: it.h, items: [it] });
  }
  // 이름 열의 x: 줄마다 가장 큰 간격 뒤 (또는 줄 시작이 오른쪽이면 그 자리)의 최빈값
  const w = lg.x1 - lg.x0;
  const votes = new Map<number, number>();
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x);
    let best = -1, gap = 0;
    for (let k = 1; k < l.items.length; k++) {
      const g = l.items[k].x - (l.items[k - 1].x + l.items[k - 1].w);
      if (g > gap) { gap = g; best = k; }
    }
    const x = gap >= 10 ? l.items[best].x : l.items[0].x - lg.x0 > w * 0.2 ? l.items[0].x : null;
    if (x == null) continue;
    const b = Math.round(x / 4) * 4;
    votes.set(b, (votes.get(b) || 0) + 1);
  }
  const nameX = [...votes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? lg.x0 + w * 0.4;
  const out: LegendEntry[] = [];
  let prev: (LegendEntry & { y: number; h: number }) | null = null;
  for (const l of lines) {
    const sym = l.items.filter((i) => i.x + i.w <= nameX - 2).map((i) => i.str).join(" ").trim();
    const name = l.items.filter((i) => i.x + i.w > nameX - 2).map((i) => i.str).join(" ").replace(/\s+/g, " ").trim();
    if (!name && !sym) continue;
    if (!sym && /^\d{1,3}$/.test(name)) continue; // 쪽 번호
    // 이름이 두 줄로 넘어간 경우
    if (!sym && prev && l.y - prev.y < l.h * 1.9) {
      prev.name += " " + name;
      prev.y = l.y;
      continue;
    }
    const e = { sym, name: name || sym, cy: l.y - l.h * 0.35, area: { x0: lg.x0, x1: nameX - 3, y0: 0, y1: 0 }, y: l.y, h: l.h };
    out.push(e);
    prev = e;
  }
  // 세로 범위: 이웃 항목과의 중간까지
  out.forEach((e, i) => {
    const up = i > 0 ? (out[i - 1].cy + e.cy) / 2 : e.cy - 12;
    const dn = i < out.length - 1 ? (out[i + 1].cy + e.cy) / 2 : e.cy + 12;
    e.area.y0 = Math.max(up, e.cy - 16);
    e.area.y1 = Math.min(dn, e.cy + 16);
  });
  return out.map(({ sym, name, cy, area }) => ({ sym, name, cy, area }));
}

/** 차트 칸의 글자 → 기호표 항목 (기호 글자 일치 > 기호 낱말 일치 > 이름에 포함) */
export function matchToken(token: string, entries: LegendEntry[]): LegendEntry | null {
  const t = norm(token);
  if (!t) return null;
  return (
    entries.find((e) => e.sym && norm(e.sym) === t) ||
    entries.find((e) => e.sym && norm(e.sym).split(/[\/,]/).includes(t)) ||
    entries.find((e) => e.name && new RegExp(`\\(${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)|(^|[\\s-])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[\\s)])`, "i").test(e.name.toLowerCase())) ||
    entries.find((e) => norm(e.name).includes(t) && t.length >= 2) ||
    null
  );
}

/** 누른 점(pt)에 있는 글자 항목 (축 숫자 제외) */
export function textAt(items: TItem[], x: number, y: number, pad = 1.5): TItem | null {
  const hits = items.filter((i) => i.str.trim() && !/^\s*\d{1,3}\s*$/.test(i.str) && x >= i.x - pad && x <= i.x + i.w + pad && y >= i.y - i.h - pad && y <= i.y + pad);
  if (!hits.length) return null;
  return hits.sort((a, b) => Math.abs(a.x + a.w / 2 - x) - Math.abs(b.x + b.w / 2 - x))[0];
}

/**
 * 격자선 찾기: 여러 단에 걸쳐 거의 끊기지 않는 세로 진한 열 → 칸 너비(최빈 간격)와 위치(최빈 나머지).
 * 겉뜨기 '|'처럼 칸 가운데의 세로 획은 위치가 반 칸 어긋나 소수라 걸러진다.
 */
export function gridLattice(dark: (x: number, y: number) => boolean, xA: number, xB: number, yA: number, yB: number): { w: number; off: number; xs: number[] } | null {
  const cols: number[] = [];
  const H = Math.max(1, yB - yA);
  for (let x = Math.floor(xA); x <= xB; x++) {
    let n = 0;
    for (let y = Math.floor(yA); y < yB; y++) if (dark(x, y)) n++;
    if (n / H >= 0.6) cols.push(x);
  }
  const xs: number[] = [];
  for (const x of cols) {
    if (xs.length && x - xs[xs.length - 1] <= 1.5) xs[xs.length - 1] = (xs[xs.length - 1] + x) / 2;
    else xs.push(x);
  }
  if (xs.length < 3) return null;
  const diffs = xs.slice(1).map((x, i) => x - xs[i]).filter((d) => d > 3);
  const bucket = new Map<number, number[]>();
  for (const d of diffs) {
    const k = Math.round(d);
    let hit = [...bucket.keys()].find((b) => Math.abs(b - k) <= 1);
    if (hit == null) bucket.set((hit = k), []);
    bucket.get(hit)!.push(d);
  }
  const top = [...bucket.values()].sort((a, b) => b.length - a.length)[0];
  if (!top || top.length < 2) return null;
  const w = top.reduce((s, d) => s + d, 0) / top.length;
  const offs = xs.map((x) => ((x % w) + w) % w);
  let bestOff = offs[0], bestN = 0;
  for (const o of offs) {
    const n = offs.filter((v) => Math.min(Math.abs(v - o), w - Math.abs(v - o)) < Math.max(1, w * 0.12)).length;
    if (n > bestN) { bestN = n; bestOff = o; }
  }
  return { w, off: bestOff, xs: xs.filter((x) => { const v = ((x % w) + w) % w; return Math.min(Math.abs(v - bestOff), w - Math.abs(v - bestOff)) < Math.max(1, w * 0.12); }) };
}

/**
 * 모양 비교 0~1: 획(잉크) 칸마다 상대 그림의 ±tol 안에 획이 있는지 → 짝 없는 획 수 / 전체 획 수.
 * 획 굵기·위치가 조금 달라도 같은 모양이면 0에 가깝고, 빈칸과 획 칸은 1. 색은 따로 평균 차이.
 */
export function symbolScore(a: Uint8ClampedArray, b: Uint8ClampedArray, W: number, H: number, tol = 1): number {
  const ink = (m: Uint8ClampedArray, x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && m[(y * W + x) * 4] > 0;
  const near = (m: Uint8ClampedArray, x: number, y: number) => {
    for (let dy = -tol; dy <= tol; dy++) for (let dx = -tol - 1; dx <= tol + 1; dx++) if (ink(m, x + dx, y + dy)) return true;
    return false;
  };
  let inkA = 0, inkB = 0, un = 0, col = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (a[i]) { inkA++; if (!near(b, x, y)) un++; }
      if (b[i]) { inkB++; if (!near(a, x, y)) un++; }
      col += (Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) + Math.abs(a[i + 3] - b[i + 3])) / (3 * 255);
    }
  const shape = un / (inkA + inkB + 1);
  return shape * 0.75 + (col / (W * H)) * 1.5;
}

/** 위치가 한 칸쯤 어긋나도 되게: 가로·세로 ±1 밀어 본 것 중 가장 작은 차이 */
export function shiftDiff(a: Uint8ClampedArray, b: Uint8ClampedArray, W: number, H: number): number {
  let best = Infinity;
  for (const dx of [-1, 0, 1])
    for (const dy of [-1, 0, 1]) {
      let s = 0, n = 0;
      for (let y = Math.max(0, dy); y < Math.min(H, H + dy); y++)
        for (let x = Math.max(0, dx); x < Math.min(W, W + dx); x++) {
          const i = (y * W + x) * 4, j = ((y - dy) * W + (x - dx)) * 4;
          s += 2 * Math.abs(a[i] - b[j]) + (Math.abs(a[i + 1] - b[j + 1]) + Math.abs(a[i + 2] - b[j + 2]) + Math.abs(a[i + 3] - b[j + 3])) / 3;
          n++;
        }
      const d = s / (n * 3 * 255) + (dx || dy ? 0.002 : 0);
      if (d < best) best = d;
    }
  return best;
}

/** 두 특징 배열의 차이 0~1 (작을수록 비슷). [진하기×2, 평균색] */
export function imageDiff(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let s = 0;
  for (let i = 0; i < a.length; i += 4) s += 2 * Math.abs(a[i] - b[i]) + (Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) + Math.abs(a[i + 3] - b[i + 3])) / 3;
  return s / ((a.length / 4) * 3 * 255);
}

/** 글자 레이어가 깨진 이름인가 (ToUnicode 없는 글꼴: 한글 음절·ASCII가 아닌 낯선 글자가 많음) */
export function unreadable(s: string): boolean {
  const chars = [...s.replace(/\s/g, "")];
  if (!chars.length) return false;
  const ok = chars.filter((c) => /[\u0020-\u007e\uac00-\ud7a3\u00b7·–—~×]/.test(c)).length;
  return ok / chars.length < 0.7;
}

/** 찾은 격자선(xs)으로 칸 경계 목록: 빠진 선은 칸 너비로 채운다 (계산값이 아니라 실제 선 위치를 쓰려고) */
export function boundaries(xs: number[], w: number): number[] {
  const s = [...xs].sort((a, b) => a - b);
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    if (i > 0) {
      const gap = s[i] - s[i - 1];
      const m = Math.round(gap / w);
      for (let k = 1; k < m; k++) out.push(s[i - 1] + (gap * k) / m);
    }
    out.push(s[i]);
  }
  return out;
}

export type RowStitch = { name: string; sym: string; cells: number };
/** 읽은 칸 → 서술 ("겉2, 안2, 2/2 LC, …"). 안면에서 뜨면 겉↔안을 바꾼다 */
export function rowText(st: RowStitch[], ws: boolean): string {
  const label = (x: RowStitch) => {
    const nm = x.name.replace(/\s+/g, " ").trim();
    if (/^겉뜨기$/.test(nm) || (!nm && /^[|ㅣ]$/.test(x.sym))) return ws ? "안" : "겉";
    if (/^안뜨기$/.test(nm) || /^(?:—|-|ㅡ)$/.test(x.sym)) return ws ? "겉" : "안";
    if (!nm) return x.sym || "?";
    // "오른코 위 2코 교차뜨기 - 2/2 LC" → "2/2 LC", "[K2tog] 왼코…" → 기호 약어
    const ab = nm.match(/[-–]\s*(\d\/\d\s*[A-Z]+)\s*$/) || nm.match(/\b(\d\/\d\s*[A-Z]{2,4})\b/);
    if (ab) return ab[1];
    if (x.sym && x.sym.length <= 12) return x.sym;
    return nm.length > 16 ? nm.slice(0, 16) + "…" : nm;
  };
  const parts: string[] = [];
  let prev = "", cnt = 0;
  const flush = () => {
    if (!cnt) return;
    parts.push(prev === "겉" || prev === "안" ? prev + cnt : cnt > 1 ? `${prev} ×${cnt}` : prev);
  };
  for (const x of st) {
    const l = label(x);
    if (l === prev) cnt++;
    else { flush(); prev = l; cnt = 1; }
  }
  flush();
  // 같은 두 묶음이 3번 넘게 되풀이되면 "(겉1, 안1) 5번 반복"처럼 (도안 표기와 같게)
  const out: string[] = [];
  for (let i = 0; i < parts.length; ) {
    let rep = 1;
    while (i + 2 * rep + 1 < parts.length && parts[i + 2 * rep] === parts[i] && parts[i + 2 * rep + 1] === parts[i + 1]) rep++;
    if (rep >= 3 && parts[i] !== parts[i + 1]) { out.push(`(${parts[i]}, ${parts[i + 1]}) ${rep}번 반복`); i += 2 * rep; }
    else out.push(parts[i++]);
  }
  return out.join(", ");
}

