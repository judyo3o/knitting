/** 게이지: 도안 · 세탁 전 · 세탁 후 비교와 콧수/단수 환산 (10cm 기준) */
import type { Gauge, GaugeSet } from "./types";

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

/** 도안 텍스트에서 게이지 찾기: "18코 23단 메리야스", "무늬뜨기 38코 x 27단" */
export function findGauges(text: string): { label: string; st: number; rows: number }[] {
  const out: { label: string; st: number; rows: number }[] = [];
  const re = /(?:([가-힣A-Za-z]{2,10}(?:뜨기)?)\s*[:：]?\s*)?(\d{1,3})\s*코\s*[x×X*]?\s*(\d{1,3})\s*단(?:\s*\(?\s*([가-힣]{2,10}(?:뜨기)?)\s*\)?)?/g;
  for (const m of text.matchAll(re)) {
    const st = +m[2], rows = +m[3];
    if (st < 5 || rows < 5 || st > 80 || rows > 80) continue;
    let label = (m[4] || m[1] || "").replace(/^(게이지|gauge)$/i, "");
    if (/게이지|사이즈|기초코/.test(label)) label = "";
    if (out.some((g) => g.st === st && g.rows === rows)) continue;
    out.push({ label: label || (out.length ? `게이지 ${out.length + 1}` : "메리야스"), st, rows });
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
