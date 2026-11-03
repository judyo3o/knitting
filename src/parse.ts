import { int } from "./model";
import type { AiRow, AiSection } from "./types";

/** §3-4 로컬 텍스트 파서 (prototype-v2 그대로 옮김) */
const reA = /^\s*[\[(]?\s*(\d{1,3})\s*(?:단|R)?\s*(?:[~\-–]\s*(\d{1,3}))?\s*(?:단|R)\s*(?:\(\s*(RS|WS)\s*\))?\s*[\])]?\s*[:：.)\-–]?\s*(.*)$/i;
const reB = /^\s*(?:round|rnd|row|r)\s*(\d{1,3})\s*(?:[~\-–]\s*(\d{1,3}))?\s*(?:\(\s*(RS|WS)\s*\))?\s*[:：.)\-–]?\s*(.*)$/i;
const stRe = /[\(\[（]\s*(?:총\s*)?(\d{1,4})\s*코\s*[\)\]）]\s*$/;

const isHeader = (l: string) =>
  l.length <= 24 &&
  !/[.。]$/.test(l) &&
  (/^[\[【<〈#*].*[\]】>〉]?$/.test(l) ||
    /:$/.test(l) ||
    /^\d+\.\s*\S/.test(l) ||
    /(판|소매|카라|고무단|몸통|요크|버튼|밴드|마무리|스와치|front|back|sleeve|body|collar|swatch)/i.test(l));

export function localParse(text: string): AiSection[] {
  const lines = text.split(/\r?\n/);
  const secs: AiSection[] = [];
  let cur: AiSection | null = null;
  let lastRow: AiRow | null = null;
  let pendingName: string | null = null;
  let lastN = 0;
  let autoK = 1;
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) continue;
    let m = l.match(reA);
    let a = 0, b = 0, side: string | undefined, rest = "";
    if (m && /단|R/i.test(l.slice(0, m[0].length - (m[4] || "").length))) {
      a = int(m[1]); b = int(m[2]) || a; side = m[3]; rest = m[4];
    } else if ((m = l.match(reB))) {
      a = int(m[1]); b = int(m[2]) || a; side = m[3]; rest = m[4];
    } else m = null;
    if (m) {
      if (!cur || pendingName || (a <= lastN && a === 1)) {
        cur = { name: pendingName || (secs.length ? "파트 " + ++autoK : "도안"), rows: [] };
        secs.push(cur);
        pendingName = null;
      }
      let st: string | null = null;
      const sm = rest.match(stRe);
      if (sm) st = sm[1] + "코";
      lastRow = { from: a, to: Math.max(a, b), side: side ? (side.toUpperCase() as "RS" | "WS") : null, text: rest, stitches: st };
      cur.rows.push(lastRow);
      lastN = Math.max(a, b);
    } else if (isHeader(l)) {
      pendingName = l.replace(/^[\[【<〈#*\s]+|[\]】>〉:*\s]+$/g, "").replace(/^\d+\.\s*/, "") || l;
      lastRow = null;
    } else if (lastRow) {
      lastRow.text = (lastRow.text ? lastRow.text + " " : "") + l;
      const sm = l.match(stRe);
      if (sm) lastRow.stitches = sm[1] + "코";
    }
  }
  return secs.filter((s) => s.rows.length);
}

/** 로컬 파서로 충분한가, Claude가 정리해야 하나 (§1-1) */
export function needsClaude(text: string, secs: AiSection[]): boolean {
  const n = secs.reduce((a, s) => a + s.rows.length, 0);
  return n < 2 || /반복|동일|게이지|repeat|same as/i.test(text);
}

/** "2, 5, 7-12" → Set */
export function parseRange(s: string, max: number): Set<number> {
  const set = new Set<number>();
  for (const part of s.split(/[,\s]+/)) {
    const m = part.match(/^(\d+)(?:\s*[-~]\s*(\d+))?$/);
    if (!m) continue;
    let a = int(m[1]), b = int(m[2]) || a;
    if (b < a) [a, b] = [b, a];
    for (let n = a; n <= Math.min(b, max); n++) if (n >= 1) set.add(n);
  }
  return set;
}

export function toRanges(a: number[]): string {
  const s = [...a].sort((x, y) => x - y);
  const out: string[] = [];
  for (let i = 0; i < s.length; ) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    out.push(i === j ? "" + s[i] : s[i] + "-" + s[j]);
    i = j + 1;
  }
  return out.join(", ");
}

/* ---------- 내장 읽기: 사이즈 숫자 고르기 · 차트 쪽 · 다른 단 참조 ---------- */

const SIZE_TOKEN = /^(\d?XL|XXXL|XXL|XS|S|M|L)$/i;
export const DEFAULT_SIZES = ["S", "M", "L", "XL", "2XL", "3XL"];
const normS = (s: string) => ({ XXL: "2XL", XXXL: "3XL" } as Record<string, string>)[s.toUpperCase()] || s.toUpperCase();

/** "S (M) L (XL) 2XL (3XL)" 같은 사이즈 순서를 찾는다 (가장 긴 것) */
export function sizeOrder(text: string): string[] {
  let best: string[] = [];
  for (const m of text.matchAll(/(?:\b(?:\d?XL|XXXL|XXL|XS|S|M|L)\b[\s()/,·]*){3,}/gi)) {
    const list = m[0].split(/[\s()/,·]+/).filter((x) => SIZE_TOKEN.test(x)).map(normS);
    if (list.length > best.length && new Set(list).size === list.length) best = list;
  }
  return best.length >= 2 ? best : DEFAULT_SIZES;
}

/** "100 (104) 110 (114) 124 (134)" → 내 사이즈 숫자 하나. 개수가 사이즈 수와 같을 때만 */
export function resolveSizes(text: string, size: string, order: string[]): string {
  const i = order.indexOf(normS(size));
  if (i < 0) return text;
  const NUM = String.raw`(?:\d+(?:[.,]\d+)?|-)`;
  const re = new RegExp(String.raw`${NUM}(?:\s*\(\s*${NUM}\s*\)|\s+${NUM}(?=\s*\())+(?:\s*\(\s*${NUM}\s*\))?`, "g");
  return text.replace(re, (m) => {
    const nums = m.match(/\d+(?:[.,]\d+)?|-/g) || [];
    return nums.length === order.length ? nums[i] : m;
  });
}

/** "[차트 S:p13 / M:p18 / L:p23]" → 내 사이즈 쪽. 사이즈 구분 없는 "p23"도 */
export function chartRef(line: string, size: string): number | null {
  if (!/차트|chart/i.test(line)) return null;
  const pairs = [...line.matchAll(/(\d?XL|XXXL|XXL|XS|S|M|L)\s*[:：]\s*p\.?\s*(\d{1,3})/gi)];
  if (pairs.length) {
    const hit = pairs.find((m) => normS(m[1]) === normS(size || ""));
    return hit ? +hit[2] : null;
  }
  const one = line.match(/p\.?\s*(\d{1,3})\b/i);
  return one ? +one[1] : null;
}

/** 다른 단을 가리키는 지시 (내장 파서로는 못 풂 → Claude 필요) */
export const REFERS_OTHER_ROWS = /\d+\s*단\s*(?:과|와|이랑)\s*(?:동일|같|똑같)|\[\s*\d+\s*단\s*,\s*\d+\s*단\s*\]\s*(?:을|를)?\s*반복|\d+\s*[~\-–]\s*\d+\s*단\s*(?:을|를)?\s*(?:\d+\s*번\s*)?반복|same as row|rep(?:eat)? rows?/i;

export type Line = { t: string; pg: number | null };

/** 줄 목록(쪽 번호 포함) → 파트·단. 앞 쪽의 마지막 파트가 이어지면 그 이름을 쓴다 */
export function localParseLines(lines: Line[], size = ""): AiSection[] {
  const secs: AiSection[] = [];
  let cur: AiSection | null = null;
  let lastRow: AiRow | null = null;
  let pendingName: string | null = null;
  let pendingChart: number | null = null;
  let lastN = 0;
  let autoK = 1;
  for (const { t: raw, pg } of lines) {
    const l = raw.trim();
    if (!l) continue;
    const ch = chartRef(l, size);
    let m = l.match(reA);
    let a = 0, b = 0, side: string | undefined, rest = "";
    if (m && /단|R/i.test(l.slice(0, m[0].length - (m[4] || "").length))) {
      a = int(m[1]); b = int(m[2]) || a; side = m[3]; rest = m[4];
    } else if ((m = l.match(reB))) {
      a = int(m[1]); b = int(m[2]) || a; side = m[3]; rest = m[4];
    } else m = null;
    if (m) {
      if (!cur || pendingName || (a <= lastN && a === 1)) {
        cur = { name: pendingName || (secs.length ? "파트 " + ++autoK : "도안"), chart: null, round: false, rows: [] };
        const same = secs.find((s) => s.name === cur!.name);
        if (same) cur = same;
        else secs.push(cur);
        pendingName = null;
      }
      if (pendingChart && !cur.chart) cur.chart = pendingChart;
      pendingChart = null;
      let st: string | null = null;
      const sm = rest.match(stRe) || rest.match(/(\d{1,4})\s*코(?:가)?\s*(?:있습니다|됩니다|남습니다|가 됨)/);
      if (sm) st = sm[1] + "코";
      lastRow = { from: a, to: Math.max(a, b), side: side ? (side.toUpperCase() as "RS" | "WS") : null, text: rest, stitches: st, page: pg, chart: ch && cur.chart && ch !== cur.chart ? ch : null };
      if (ch && !cur.chart) cur.chart = ch;
      if (/원통|링으로|in the round/i.test(rest)) cur.round = true;
      cur.rows.push(lastRow);
      lastN = Math.max(a, b);
    } else if (isHeader(l)) {
      pendingName = l.replace(/^[\[【<〈#*\s]+|[\]】>〉:*\s]+$/g, "").replace(/^\d+\.\s*/, "").replace(/\s*[—-]\s*.*사이즈.*$/, "").trim() || l;
      lastRow = null;
      if (ch) pendingChart = ch;
    } else {
      if (ch) { if (cur && !pendingName) cur.chart = cur.chart || ch; else pendingChart = ch; }
      if (/원통|링으로 연결/.test(l) && cur && !pendingName) cur.round = true;
      if (lastRow && l.length < 200) {
        lastRow.text = (lastRow.text ? lastRow.text + " " : "") + l;
        const sm = l.match(stRe);
        if (sm) lastRow.stitches = sm[1] + "코";
      }
    }
  }
  return secs.filter((s) => s.rows.length);
}

/** 내장 결과로 충분한가: 단이 충분하고 다른 단 참조가 없을 때 */
export function localGoodEnough(secs: AiSection[], text: string): { ok: boolean; why: string } {
  const n = secs.reduce((s, x) => s + x.rows.length, 0);
  if (n < 3) return { ok: false, why: "단 표시를 거의 찾지 못했어요" };
  if (REFERS_OTHER_ROWS.test(text)) return { ok: false, why: "다른 단을 가리키는 지시(예: '1단과 동일')가 있어요" };
  return { ok: true, why: "" };
}
