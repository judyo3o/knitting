/**
 * 기장 조절: 파트의 무늬 단위(몇 단마다 되풀이되나)를 찾고, "몇 cm 줄이기/늘리기"에 맞는 추천 옵션을 만든다.
 *  - 차트: 단마다 읽은 칸을 열(코 자리)별로 모아 열마다 되풀이 주기를 구한다 → 무늬별 단위 (하트 12단, 꽈배기 8단 …)
 *  - 서술: 같은 서술이 몇 단마다 돌아오나
 *  - 무늬 없음(메리야스 등): 평면은 2단(겉·안면 맞춤), 원통은 1단 단위
 */
import type { GaugeSet, PartShape, Pattern, Rep, Row } from "./types";
import type { RowStitch } from "./symbols";

export type Unit = { P: number; cols: number }; // P단마다 되풀이, cols = 그 주기를 가진 열(코) 수
export type { PartShape };

/** 줄임·늘림 기호/서술 */
export const SHAPING_RE = /\b(?:k2tog|k3tog|ssk|sssk|p2tog|ssp|sk2p|s2kp|cdd|M1[LRP]?|kfb|pfb|yo)\b|줄임|줄음|늘림|늘음|코\s*줄|코\s*늘|모아뜨기|감아코/i;

/** 차트에서 읽은 단들 → 열별 주기로 무늬 단위 찾기 (순수 함수) */
export function gridUnits(rows: { n: number; st: RowStitch[] | null }[]): { units: Unit[]; shaping: number[] } {
  const data = rows.filter((r) => r.st && r.st.length && r.st.every((s) => s.x0 != null && s.x1 != null));
  const shaping = rows.filter((r) => r.st?.some((s) => SHAPING_RE.test(s.name) || SHAPING_RE.test(s.sym || ""))).map((r) => r.n);
  if (data.length < 6) return { units: [], shaping };
  const ws = data.flatMap((r) => r.st!.map((s) => Math.abs(s.x1! - s.x0!) / Math.max(1, s.cells))).sort((a, b) => a - b);
  const cw = ws[ws.length >> 1];
  if (!(cw > 0)) return { units: [], shaping };
  const xMin = Math.min(...data.flatMap((r) => r.st!.map((s) => Math.min(s.x0!, s.x1!))));
  const grid = new Map<number, Map<number, string>>();
  const shapeCols = new Set<number>(); // 줄임·늘림이 지나가는 열(가장자리)은 무늬가 아니다
  for (const r of data) {
    const row = new Map<number, string>();
    for (const s of r.st!) {
      const k = Math.round((Math.min(s.x0!, s.x1!) - xMin) / cw);
      const plain = /^(겉뜨기|안뜨기)$/.test(s.name) || s.yarn;
      const sh = SHAPING_RE.test(s.name) || SHAPING_RE.test(s.sym || "");
      for (let i = 0; i < s.cells; i++) { row.set(k + i, plain ? s.name : `${s.name}#${i}`); if (sh) shapeCols.add(k + i); }
    }
    grid.set(r.n, row);
  }
  const ns = [...grid.keys()];
  const cols = [...new Set(ns.flatMap((n) => [...grid.get(n)!.keys()]))].filter((c) => !shapeCols.has(c));
  const count = new Map<number, number>();
  for (const c of cols) {
    for (let P = 2; P <= Math.floor(ns.length / 2); P++) {
      let m = 0, t = 0;
      for (const n of ns) {
        const a = grid.get(n)!.get(c), b = grid.get(n + P)?.get(c);
        if (a == null || b == null) continue;
        t++;
        if (a === b) m++;
      }
      if (t >= P && m / t >= 0.9) { count.set(P, (count.get(P) || 0) + 1); break; }
    }
  }
  return { units: unitsFrom(count, cols.length), shaping };
}

/** 열 주기 개수 → 무늬 단위 (작은 주기의 배수만 있는 잡음은 빼고, 열이 적은 주기도 뺀다) */
function unitsFrom(count: Map<number, number>, nCols: number): Unit[] {
  const min = Math.max(3, Math.round(nCols * 0.03));
  return [...count].filter(([P, c]) => P >= 2 && c >= min).map(([P, cols]) => ({ P, cols })).sort((a, b) => b.cols - a.cols);
}

/** 서술만으로 무늬 단위 찾기 (차트만 가리키는 단은 비교하지 않음) */
export function textUnits(list: Row[]): Unit[] {
  const norm = (r: Row) => (r.span ? `\u0000${r.n}` : (r.t || "").split("\n")[0].replace(/\s*·\s*(양쪽|10단마다)[^·]*$/g, "").replace(/\(바늘에[^)]*\)|\(\d+코\)/g, "").replace(/\s+/g, " ").trim());
  const t = list.map(norm);
  if (t.length < 6) return [];
  for (let P = 2; P <= Math.min(48, Math.floor(t.length / 2)); P++) {
    let m = 0, c = 0;
    for (let i = 0; i + P < t.length; i++) { if (t[i].startsWith("\u0000")) continue; c++; if (t[i] === t[i + P]) m++; }
    if (c >= 2 * P && m / c >= 0.8) return [{ P, cols: 1 }];
  }
  return [];
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

export type LenOption = { rep: Rep; rows: number; cm: number; best?: boolean; note: string; title: string };

/**
 * deltaCm: +늘리기 / -줄이기. rowsPer10: 내 게이지(10cm 단수). list: 파트 단(코잡기 제외). curN: 지금 뜨는 단.
 * 무늬 단위의 배수로 목표에 가까운 옵션을 고르고, 다른 무늬가 어긋나는 정도·줄임 단 수를 함께 알려준다.
 */
export function lengthOptions(list: Row[], shape: PartShape | null, deltaCm: number, rowsPer10: number, round: boolean, curN: number | null): LenOption[] {
  const L = list.length;
  if (!deltaCm || !rowsPer10 || L < 2) return [];
  const target = (Math.abs(deltaCm) * rowsPer10) / 10;
  const motifs = (shape?.units || []).filter((u) => u.P >= 4);
  const base = round ? 1 : 2;
  const units = motifs.length ? [...new Set([...motifs.map((u) => u.P), ...motifs.length > 1 ? [motifs.map((u) => u.P).reduce((a, b) => (a * b) / gcd(a, b))] : []])] : [base];
  const cand = new Map<number, { R: number; U: number; off: Unit[]; score: number }>();
  const shrink = deltaCm < 0;
  const startIdx = curN == null ? 0 : Math.max(0, list.findIndex((r) => r.n > curN));
  const room = L - (startIdx < 0 ? L : startIdx);
  for (const U of units) {
    for (let k = 1; k * U <= Math.max(target * 1.7, U) && k <= 40; k++) {
      const R = k * U;
      if (shrink && R > room) break;
      const off = motifs.filter((m) => R % m.P !== 0);
      const offShare = off.length / motifs.length || 0; // 무늬마다 같은 무게 (하트처럼 열이 적어도 눈에 띄는 무늬)
      const score = Math.abs(R - target) / Math.max(target, base) + offShare * 0.6;
      if (!cand.has(R) || cand.get(R)!.score > score) cand.set(R, { R, U, off, score });
    }
  }
  const picked = [...cand.values()].sort((a, b) => a.score - b.score).slice(0, 3).sort((a, b) => a.R - b.R);
  const bestR = [...cand.values()].sort((a, b) => a.score - b.score)[0]?.R;
  const cm = (R: number) => Math.round(((R * 10) / rowsPer10) * 10) / 10;
  const out: LenOption[] = [];
  for (const c of picked) {
    // 구간 자리: 아직 안 뜬 곳의 가운데쯤, 무늬 단위에 맞춰
    const free = list.slice(Math.max(0, startIdx));
    if (!free.length) continue;
    const span = shrink ? c.R : c.R <= free.length ? c.R : c.U;
    if (span > free.length) continue;
    const times = shrink ? -1 : span === c.R ? 1 : c.R / span;
    let i0 = Math.max(0, Math.floor((free.length - span) / 2));
    i0 -= i0 % c.U;
    // 맨 앞(코 줍기 다음 첫 단들) 바로는 피한다
    const from = free[i0], to = free[i0 + span - 1];
    if (!from || !to) continue;
    const shaped = (shape?.shaping || []).filter((n) => n >= from.n && n <= to.n).length;
    const notes: string[] = [];
    const on = motifs.filter((m) => !c.off.includes(m));
    if (motifs.length && c.off.length) notes.push(`${on.length ? on.map((m) => m.P + "단").join("·") + " 무늬는 그대로 이어지고 " : ""}${c.off.map((m) => m.P + "단").join("·")} 무늬는 이음매가 조금 어긋나요`);
    else if (motifs.length) notes.push("모든 무늬가 자연스럽게 이어져요");
    if (shaped) notes.push(shrink ? `이 구간의 줄임·늘림 ${shaped}번도 같이 빠져요 — 남은 줄임 단에 나눠서 해 주세요` : `줄임·늘림 ${shaped}번도 ${times}번 더 해요 — 콧수가 달라지니 주의`);
    const unitTxt = `${c.R}단`;
    out.push({
      rows: c.R,
      cm: cm(c.R),
      best: c.R === bestR,
      title: `${shrink ? "−" : "+"}${cm(c.R)}cm · ${unitTxt}`,
      note: (shrink ? `${from.n}~${to.n}단 빼기` : times > 1 ? `${from.n}~${to.n}단을 ${times}번 더` : `${from.n}~${to.n}단을 한 번 더`) + (notes.length ? " · " + notes.join(" · ") : ""),
      rep: { from: from.n, to: to.n, times, pass: 0, label: `${shrink ? "−" : "+"}${cm(c.R)}cm` },
    });
  }
  return out;
}

/** 지금 기장: 이 파트에서 뜬 단 · 남은 단 (cm), 단 번호가 앞 파트에서 이어지면 처음부터의 길이도 */
export function lengthNow(p: Pattern, s: string, list: Row[], doneRows: number, totalRows: number, rowsPer10: number | null) {
  const cm = (n: number) => (rowsPer10 ? Math.round(((n * 10) / rowsPer10) * 10) / 10 : null);
  const first = list.find((r) => !r.castOn)?.n ?? 1;
  const cont = first > 3 ? first - 1 : 0; // 앞 파트에서 이어진 단 수 (예: 몸통 74단부터)
  return { done: doneRows, total: totalRows, doneCm: cm(doneRows), totalCm: cm(totalRows), fromStartCm: cont ? cm(cont + doneRows) : null, fullCm: cont ? cm(cont + totalRows) : null };
}

/** 기장 계산에 쓸 10cm 단수: 무늬 파트면 무늬 게이지, 아니면 메리야스 게이지 (내 스와치 > 도안) */
export function rowGaugeFor(sets: GaugeSet[], motif: boolean): number | null {
  const g = (s: GaugeSet) => { const m = s.after?.rows ? s.after : s.before?.rows ? s.before : s.pattern; return m && m.rows > 0 ? m.rows : null; };
  const isPlain = (s: GaugeSet) => /메리야스|stockinette|st\s*st|plain/i.test(s.label);
  const ordered = [...sets].sort((a, b) => (motif ? Number(isPlain(a)) - Number(isPlain(b)) : Number(isPlain(b)) - Number(isPlain(a))));
  const mineFirst = [...ordered.filter((s) => s.after?.rows || s.before?.rows), ...ordered];
  for (const s of mineFirst) { const r = g(s); if (r) return r; }
  return null;
}
