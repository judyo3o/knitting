/** 게이지: 도안 · 세탁 전 · 세탁 후 비교와 콧수/단수 환산 (10cm 기준) */
import type { Gauge, GaugeSet, Swatch } from "./types";

const ok = (g: Gauge | null | undefined): g is Gauge => !!g && g.st > 0 && g.rows > 0;
const pct = (a: number, b: number) => ((a - b) / b) * 100;
const r1 = (v: number) => Math.round(v * 10) / 10;

/** 지금 쓸 내 게이지: 세탁 후 > 세탁 전 */
export const myGauge = (s: GaugeSet): Gauge | null => (ok(s.after) ? s.after : ok(s.before) ? s.before : null);

export type GaugeCheck = {
  stPct: number; // 내 콧수가 도안보다 몇 % 많은가 (+면 촘촘)
  rowPct: number;
  stOk: boolean;
  rowOk: boolean;
  advice: string;
  widthPct: number; // 같은 콧수로 떴을 때 너비 변화 % (+면 넓어짐)
  lengthPct: number;
};

/** 도안 대비 내 게이지 (±2.5% 안이면 맞음) */
export function compare(pattern: Gauge, mine: Gauge, tol = 2.5): GaugeCheck {
  const stPct = pct(mine.st, pattern.st), rowPct = pct(mine.rows, pattern.rows);
  const stOk = Math.abs(stPct) <= tol, rowOk = Math.abs(rowPct) <= tol;
  let advice: string;
  if (stOk && rowOk) advice = "게이지가 맞아요.";
  else if (!stOk && stPct > 0) advice = "코가 도안보다 촘촘해요 → 바늘을 반 호수(0.5mm) 굵게 해보세요.";
  else if (!stOk) advice = "코가 도안보다 느슨해요 → 바늘을 반 호수(0.5mm) 가늘게 해보세요.";
  else advice = "콧수는 맞고 단수만 달라요 → 길이는 cm 기준 지시를 따르고, 단수 지시는 아래 환산을 참고하세요.";
  return { stPct: r1(stPct), rowPct: r1(rowPct), stOk, rowOk, advice, widthPct: r1((pattern.st / mine.st - 1) * 100), lengthPct: r1((pattern.rows / mine.rows - 1) * 100) };
}

/** 세탁으로 변한 정도: 같은 10cm 안 콧수가 늘면 줄어든 것 */
export function washChange(before: Gauge, after: Gauge) {
  return { widthPct: r1((before.st / after.st - 1) * 100), lengthPct: r1((before.rows / after.rows - 1) * 100) };
}

/** 도안 콧수·단수 → 내 게이지로 같은 치수가 나오는 콧수·단수 */
export const convertSt = (n: number, pattern: Gauge, mine: Gauge) => Math.round((n * mine.st) / pattern.st);
export const convertRows = (n: number, pattern: Gauge, mine: Gauge) => Math.round((n * mine.rows) / pattern.rows);
/** 콧수·단수 → cm */
export const stToCm = (n: number, g: Gauge) => r1((n / g.st) * 10);
export const rowsToCm = (n: number, g: Gauge) => r1((n / g.rows) * 10);
export const cmToSt = (cm: number, g: Gauge) => Math.round((cm * g.st) / 10);
export const cmToRows = (cm: number, g: Gauge) => Math.round((cm * g.rows) / 10);

/**
 * 도안 텍스트에서 게이지 찾기. "20코 26단 (5.5mm 바늘, 10 x 10cm 메리야스뜨기)",
 * "42코 30단 (5.5mm, 19 x 13cm 무늬게이지)", "22 sts and 30 rows = 10 cm" 등.
 * 잰 크기가 10cm가 아니면 10cm 기준으로 바꾼다.
 */
export function findGauges(text: string): { label: string; st: number; rows: number; needle?: string; swatch?: Swatch }[] {
  const out: { label: string; st: number; rows: number; needle?: string; swatch?: Swatch }[] = [];
  const t = text.replace(/\s+/g, " ");
  const re = /(\d(?: ?\d){0,2}(?:[.,]\d)?)\s*(?:코|sts?|stitches)\s*(?:[x×X*,/]|and)?\s*(\d(?: ?\d){0,2}(?:[.,]\d)?)\s*(?:단|rows?|rounds?|rnds?)/gi;
  for (const m of t.matchAll(re)) {
    m[1] = m[1].replace(/ /g, ""); m[2] = m[2].replace(/ /g, "");
    let st = parseFloat(m[1].replace(",", ".")), rows = parseFloat(m[2].replace(",", "."));
    const after = t.slice(m.index! + m[0].length, m.index! + m[0].length + 90);
    const before = t.slice(Math.max(0, m.index! - 30), m.index!);
    const ctx = (after.match(/^\s*[(\[]([^)\]]{0,80})[)\]]/) || [, after.slice(0, 90)])[1] as string;
    const size = ctx.match(/(\d+(?:[.,]\d+)?)\s*[x×X*]\s*(\d+(?:[.,]\d+)?)\s*cm/i) || (before + ctx).match(/=\s*(\d+(?:[.,]\d+)?)\s*(?:x\s*(\d+(?:[.,]\d+)?)\s*)?cm/i);
    if (size) {
      const w = parseFloat(size[1].replace(",", ".")), h = parseFloat((size[2] || size[1]).replace(",", "."));
      if (w > 0 && h > 0) { st = (st * 10) / w; rows = (rows * 10) / h; }
    } else if (/(\d+)\s*in(?:ch)?/i.test(ctx)) {
      const inch = parseFloat(ctx.match(/(\d+)\s*in/i)![1]);
      st = (st * 10) / (inch * 2.54); rows = (rows * 10) / (inch * 2.54);
    }
    st = Math.round(st * 10) / 10; rows = Math.round(rows * 10) / 10;
    if (st < 5 || rows < 5 || st > 60 || rows > 80) continue;
    if (out.some((g) => g.st === st && g.rows === rows)) continue;
    const needle = (ctx.match(/(\d(?:[.,]\d{1,2})?)\s*mm/i) || before.match(/(\d(?:[.,]\d{1,2})?)\s*mm/i) || [])[1];
    const word = (ctx + " " + before).match(/(메리야스|무늬|가터|고무|멍석|배색|stockinette|stocking|texture pattern|pattern|garter|ribbing|rib|colou?rwork|moss|seed)/i);
    let label = word ? word[1].replace(/stocking$/i, "stockinette") : out.length ? `게이지 ${out.length + 1}` : "메리야스";
    // 10cm가 아닌 크기(예: 42코 30단 → 19×13cm)는 '스와치를 떠서 전체 크기를 재는' 게이지
    const swatch: Swatch | undefined = size && !/^10\s*[x×]\s*10/.test(size[0].replace(/\s/g, ""))
      ? { st: parseFloat(m[1].replace(",", ".")), rows: parseFloat(m[2].replace(",", ".")), w: parseFloat(size[1].replace(",", ".")), h: parseFloat((size[2] || size[1]).replace(",", ".")) }
      : undefined;
    out.push({ label, st, rows, ...(needle ? { needle: needle.replace(",", ".") + "mm" } : {}), ...(swatch ? { swatch } : {}) });
  }
  return out;
}

/** 칸 비율·환산에 쓸 대표 게이지 (첫 묶음의 내 게이지 > 도안 게이지) */
export function primaryGauge(sets: GaugeSet[]): Gauge | null {
  for (const s of sets) {
    const g = myGauge(s) || (ok(s.pattern) ? s.pattern : null);
    if (g) return g;
  }
  return null;
}

/**
 * 스와치로 사이즈 다시 고르기: 내 게이지로 도안 콧수를 뜨면 치수가 (도안 콧수 ÷ 내 콧수) 배가 된다.
 * 지금 사이즈의 도안 치수(원하던 크기)에 가장 가까운 사이즈를 고른다.
 */
export function sizeAdvice(order: string[], values: number[], current: string, pattern: Gauge, mine: Gauge) {
  const f = pattern.st / mine.st;
  const list = order.map((sz, i) => ({ sz, pat: values[i], mine: Number.isFinite(values[i]) ? Math.round(values[i] * f * 10) / 10 : NaN }));
  const ci = order.findIndex((x) => x.toUpperCase() === (current || "").toUpperCase());
  const target = ci >= 0 ? values[ci] : NaN;
  let best: string | null = null;
  if (Number.isFinite(target)) {
    let d = Infinity;
    for (const x of list) if (Number.isFinite(x.mine) && Math.abs(x.mine - target) < d) { d = Math.abs(x.mine - target); best = x.sz; }
  }
  return { factor: f, list, target, best };
}

/** 스와치 크기(cm) ↔ 10cm 게이지 */
export const swatchToGauge = (sw: Swatch, w: number, h: number): Gauge => ({ st: Math.round(((sw.st * 10) / w) * 10) / 10, rows: Math.round(((sw.rows * 10) / h) * 10) / 10 });
export const gaugeToSwatch = (sw: Swatch, g: Gauge): { w: number; h: number } => ({ w: Math.round(((sw.st * 10) / g.st) * 10) / 10, h: Math.round(((sw.rows * 10) / g.rows) * 10) / 10 });

/** 옛 데이터: 이름에 "(원문 42코 30단 / 19×13cm)"로만 남아 있던 스와치 크기를 꺼낸다 */
export function swatchFromLabel(set: GaugeSet): GaugeSet {
  if (set.swatch) return set;
  const m = set.label.match(/\s*\(원문\s*([\d.]+)코\s*([\d.]+)단\s*\/\s*([\d.]+)\s*[×x]\s*([\d.]+)\s*cm\)/);
  if (!m) return set;
  return { ...set, label: set.label.replace(m[0], "").trim() || "무늬", swatch: { st: +m[1], rows: +m[2], w: +m[3], h: +m[4] } };
}
