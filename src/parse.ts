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
