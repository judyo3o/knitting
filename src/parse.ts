import { int } from "./model";
import type { AiRow, AiSection } from "./types";

/** §3-4 로컬 텍스트 파서 (prototype-v2 그대로 옮김) */
const reA = /^\s*[\[(]?\s*(\d{1,3})\s*(?:단|R)?\s*(?:[~\-–]\s*(\d{1,3}))?\s*(?:단|R)\s*(?:\(\s*(RS|WS)\s*\))?\s*[\])]?\s*[:：.)\-–]?\s*(.*)$/i;
const reB = /^\s*(?:rounds?|rnds?|rows?|r)\s*(\d{1,3})\s*(?:(?:[~\-–]|to)\s*(\d{1,3}))?\s*(?:\(\s*(RS|WS)\s*\))?\s*[:：.)\-–]?\s*(.*)$/i;
/** 코바늘 영어: "1st round:", "3rd-5th rounds:" */
const reC = /^\s*(\d{1,3})(?:st|nd|rd|th)\s*(?:(?:[~\-–]|to)\s*(\d{1,3})(?:st|nd|rd|th))?\s*(?:rounds?|rows?|rnds?)\s*(?:\(\s*(RS|WS)\s*\))?\s*[:：.]?\s*(.*)$/i;
/** 단 끝 콧수: "(48코)", "[총 48코]", "(12개)", "(12 sts)", "… 9dc." */
const stRe = /(?:[\(\[（]\s*(?:총\s*)?(\d{1,4})\s*(?:코|개|sts?|stitches)\s*[\)\]）]|…\s*(\d{1,4})\s*(?:dc|sc|tr|hdc|sts?)\.?)\s*$/i;
const stOf = (m: RegExpMatchArray) => (m[1] || m[2]) + "코";

/** 한 줄이 단 표시로 시작하면 [시작, 끝, 면, 나머지] */
function rowStart(l: string): [number, number, string | undefined, string] | null {
  let m = l.match(reA);
  if (m && /단|R/i.test(l.slice(0, m[0].length - (m[4] || "").length))) return [int(m[1]), int(m[2]) || int(m[1]), m[3], m[4]];
  if ((m = l.match(reC))) return [int(m[1]), int(m[2]) || int(m[1]), m[3], m[4]];
  if ((m = l.match(reB))) return [int(m[1]), int(m[2]) || int(m[1]), m[3], m[4]];
  return null;
}

const isHeader = (l: string) =>
  (l.length <= 24 || (/^[A-Z][A-Z\s&,'’()0-9–-]{2,}(?:\(|$)/.test(l) && l.length <= 60)) &&
  !/[.。]$/.test(l) &&
  (/^[\[【<〈#*★☆◆◇◈■□●○▶►]/.test(l) ||
    /^[A-Z][A-Z\s&'’]{2,}(?:\s*\(|$)/.test(l) ||
    /:$/.test(l) ||
    /^\d+\.\s*\S/.test(l) ||
    /(판|소매|카라|고무단|몸통|요크|버튼|밴드|마무리|스와치|얼굴|몸|머리|귀|다리|팔|꼬리|front|back|sleeve|body|collar|swatch|head|ears?|arms?|legs?|tail|hood|yoke)/i.test(l));

export function localParse(text: string): AiSection[] {
  return localParseLines(text.split(/\r?\n/).map((t) => ({ t, pg: null })));
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
  for (const m of text.matchAll(/(?:(?<![\w’'])(?:\d?XL|XXXL|XXL|XS|S|M|L)\b[\s()/,·]*){3,}/g)) {
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
  const pick = (m: string) => {
    const nums = m.match(/\d+(?:\.\d+)?|(?<=[\s(])-(?=[\s)])/g) || [];
    return nums.length === order.length ? nums[i] : m;
  };
  return text
    .replace(new RegExp(String.raw`\d+(?:\.\d+)?\s*\(\s*\d+(?:\.\d+)?(?:\s*,\s*\d+(?:\.\d+)?)+\s*\)`, "g"), pick) // 46 (46, 48, 48)
    .replace(new RegExp(String.raw`\b\d+(?:-\d+){${order.length - 1}}\b`, "g"), pick) // 96-104-112-120
    .replace(re, pick);
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
export const REFERS_OTHER_ROWS = /rep(?:eat)?\s+(?:the\s+)?(?:\d+(?:st|nd|rd|th)\s+(?:round|row)|(?:rounds?|rows?|rnds?)\s*\d)|\d+\s*단\s*(?:과|와|이랑)\s*(?:동일|같|똑같)|\[\s*\d+\s*단\s*,\s*\d+\s*단\s*\]\s*(?:을|를)?\s*반복|\d+\s*[~\-–]\s*\d+\s*단\s*(?:을|를)?\s*(?:\d+\s*번\s*)?반복|same as row|rep(?:eat)? rows?/i;

export type Line = { t: string; pg: number | null };
const NON_PART = /^(?:special\s+)?(?:abbreviations?|materials?|yarns?(?:\s+required)?|tension|gauge|notes?|measurements?|sizes?|needles?|hooks?|crochet hook|notions|finished|약어|재료|준비물|게이지|사이즈|참고)\b/i;

/** 줄 목록(쪽 번호 포함) → 파트·단. 앞 쪽의 마지막 파트가 이어지면 그 이름을 쓴다 */
export function localParseLines(lines: Line[], size = ""): AiSection[] {
  const secs: AiSection[] = [];
  let cur: AiSection | null = null;
  let lastRow: AiRow | null = null;
  let pendingName: string | null = null;
  let pendingChart: number | null = null;
  let lastN = 0;
  let autoK = 1;
  let skipping = false;
  for (const { t: raw, pg } of lines) {
    const l = raw.trim();
    if (!l) continue;
    const ch = chartRef(l, size);
    const rs = rowStart(l);
    const [a, b, side, rest] = rs || [0, 0, undefined, ""];
    if (rs && skipping && !pendingName) continue;
    if (rs) {
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
      if (sm) st = stOf(sm);
      lastRow = { from: a, to: Math.max(a, b), side: side ? (side.toUpperCase() as "RS" | "WS") : null, text: rest, stitches: st, page: pg, chart: ch && cur.chart && ch !== cur.chart ? ch : null };
      if (ch && !cur.chart) cur.chart = ch;
      if (/원통|링으로|in the round/i.test(rest)) cur.round = true;
      cur.rows.push(lastRow);
      lastN = Math.max(a, b);
    } else if (NON_PART.test(l) && isHeader(l)) {
      // 약어·재료·게이지 같은 제목은 파트가 아니다 → 그 아래 단은 무시
      cur = null;
      lastRow = null;
      pendingName = null;
      skipping = true;
    } else if (isHeader(l)) {
      skipping = false;
      pendingName = l.replace(/^[\[【<〈#*★☆◆◇◈■□●○▶►\s]+|[\]】>〉:*\s]+$/g, "").replace(/^\d+\.\s*/, "").replace(/\s*[—-]\s*.*사이즈.*$/, "").replace(/\s*\(.*$/, "").trim() || l;
      if (/스와치|swatch|게이지\s*(?:샘플|편물)/i.test(pendingName)) pendingName = "스와치"; // 서술 스와치는 스와치 탭으로
      lastRow = null;
      if (ch) pendingChart = ch;
    } else {
      if (ch) { if (cur && !pendingName) cur.chart = cur.chart || ch; else pendingChart = ch; }
      if (/원통|링으로 연결/.test(l) && cur && !pendingName) cur.round = true;
      if (lastRow && l.length < 200) {
        lastRow.text = (lastRow.text ? lastRow.text + " " : "") + l;
        const sm = l.match(stRe);
        if (sm) lastRow.stitches = stOf(sm);
      }
    }
  }
  return secs.filter((s) => s.rows.length);
}

/**
 * 사이즈별 치수 표: "가슴둘레 : 96 (104) 110 (120) 126 (136) cm" 처럼 사이즈 수만큼 숫자가 있는 치수 줄.
 * 글자가 깨져 "(1 8)"처럼 갈라진 숫자는 NaN (모름)
 */
export type SizeRow = { label: string; values: number[]; unit: string };
export function sizeTable(text: string): { order: string[]; rows: SizeRow[] } | null {
  const order = sizeOrder(text);
  if (order === DEFAULT_SIZES) return null;
  const LABEL = /가슴|기장|품|어깨|소매|길이|둘레|너비|암홀|진동|chest|bust|length|width|sleeve|shoulder/i;
  const rows: SizeRow[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(/^\s*([^:：\d]{1,16}?)\s*[:：]\s*(.+)$/);
    if (!m || !LABEL.test(m[1])) continue;
    const um = m[2].match(/^([\d.\s()]+?)\s*(cm|mm|m|g|inch|in|")(?![a-z])/i);
    const body = um ? um[1] : m[2].match(/^[\d.\s()]+/)?.[0] || "";
    const toks = body.match(/\(\s*[\d.\s]+?\s*\)|\d+(?:\.\d+)?/g) || [];
    if (toks.length !== order.length) continue;
    const values = toks.map((t) => { const v = t.replace(/[()]/g, "").trim(); return /\s/.test(v) ? NaN : +v; });
    if (rows.some((r) => r.label === m[1].trim())) continue;
    rows.push({ label: m[1].trim(), values, unit: um ? um[2] : "" });
  }
  return rows.length ? { order, rows } : null;
}

/**
 * 사이즈별 가슴둘레 찾기 (여러 도안 형식). sizeTable(하트 체인 형식)로 못 찾으면:
 *  - "CHEST Approx. 34¾ (37¾, …) in / 88 (96, …) cm" — 인치·cm가 함께 (cm 쪽), 콜론 없어도
 *  - "Final bust measurements: (90, 100) 110, 120 (130, 140)\n{150, 160} cm" — 숫자 사이즈, 중괄호, 두 줄
 *  - "To fit bust … L 40-42" [101.5-106.5 cm]" — 몸 치수 범위 (body: true, 값은 범위 가운데)
 */
export function sizeChart(text: string): { order: string[]; rows: SizeRow[]; body?: boolean } | null {
  const t1 = sizeTable(text);
  if (t1) return t1;
  // 다음 줄이 '{'·'('로 시작하는 숫자 묶음이면 이어 붙인다
  const lines: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.replace(/\s+/g, " ").trim();
    const prev = lines[lines.length - 1] || "";
    if (lines.length && ((/^[{(]\s*\d/.test(l) && !/cm|"|″/.test(prev.split(/[:：]/).pop() || "")) || (/^\d/.test(l) && /[,\-–]$/.test(prev)))) lines[lines.length - 1] += " " + l;
    else lines.push(l);
  }
  const nums = (seg: string) => (seg.replace(/\(\s*(\d+)\s+(\d+)\s*\)/g, "(NaN)").match(/NaN|\d+(?:\.\d+)?/g) || []).map((x) => (x === "NaN" ? NaN : +x));
  const LABEL = /chest|bust|가슴|품\b|가슴둘레|circumference/i;
  const NOT = /\b(?:sleeves?|biceps?|upper arm|arms?|head|wrist|neck|hips?)\b|소매|팔|목/i; // 가슴 말고 다른 둘레 ("garment"의 arm은 아님)
  // 1) 몸 치수 범위 줄 ("To fit bust" 아래 "L 40-42" [101.5-106.5 cm]")
  const fit = [...text.matchAll(/(?:^|\n|\s{2,})((?:XS\/S|\d\/\dXL|\d?XL|XXXL|XXL|XS|S|M|L))\s+[\d.\-–]+["″]?\s*\[\s*([\d.]+)\s*[-–]\s*([\d.]+)\s*cm\]/g)];
  if (/to fit|fits? bust|몸 치수|실제 가슴/i.test(text) && fit.length >= 3) {
    const seen = new Set<string>();
    const order: string[] = [], values: number[] = [];
    for (const m of fit) { const sz = normS(m[1]); if (seen.has(sz)) continue; seen.add(sz); order.push(sz); values.push((+m[2] + +m[3]) / 2); }
    return { order, rows: [{ label: "몸 가슴둘레(맞는 범위 가운데)", values, unit: "cm" }], body: true };
  }
  // 2) 글자 사이즈 + 라벨 줄 (콜론 없어도, 인치·cm 함께여도 cm 쪽). 완성 치수(actual·finished)를 몸 치수(measurement)보다 먼저
  let order = sizeOrder(text);
  // "Size: A (B) C (D), E (F) …" 같은 글자 사이즈 (콧수가 맞는 쪽을 쓴다)
  const lm = text.match(/\b[Ss]izes?\s*[:：]\s*((?:[({]?\s*[A-Z](?![A-Za-z])\s*[)}]?\s*,?\s*){3,})/);
  const letters = lm ? lm[1].match(/[A-Z]/g) || [] : [];
  const orders = [order, ...(letters.length >= 3 && new Set(letters).size === letters.length ? [letters] : [])].filter((o) => o !== DEFAULT_SIZES);
  const cand = lines.filter((l) => LABEL.test(l) && !NOT.test(l.split(/[:：]/)[0]));
  cand.sort((a, b) => Number(/actual|finished|완성/i.test(b)) - Number(/actual|finished|완성/i.test(a)) || Number(/measurement|to fit/i.test(a)) - Number(/measurement|to fit/i.test(b)));
  for (const l of cand) {
    if (/\(\s*in(?:ches)?\s*\)/i.test(l)) continue; // 인치 줄은 건너뛴다
    let seg = l;
    const head = l.split(/[:：]/)[0];
    const cmPart = l.match(/(?:in(?:ches)?|["″])\s*\/\s*([^\n]*?)\s*cm/i);
    if (/\(\s*cm\s*\)/i.test(head)) seg = l.slice(head.length + 1); // "Actual circumference of garment (cm): 85 (90) …"
    else if (cmPart) seg = cmPart[1];
    else if (/cm/i.test(l)) seg = l.split(/cm/i)[0];
    if (/\d\s*[-–]\s*\d/.test(seg)) continue; // "75-80 (80-85)" 같은 범위(몸 치수)는 건너뛴다
    seg = seg.replace(/^[^\d({]*/, "");
    const v = nums(seg);
    const o = orders.find((x) => x.length === v.length);
    if (o) return { order: o, rows: [{ label: "가슴둘레", values: v, unit: "cm" }] };
    // 3) 숫자 사이즈 (사이즈 이름이 곧 가슴둘레: "Final bust measurements: (90, 100) 110 …")
    if (!orders.length && v.length >= 3 && v.every((x) => x >= 60 && x <= 200)) {
      order = v.map((x) => String(x));
      return { order, rows: [{ label: "가슴둘레", values: v, unit: "cm" }] };
    }
  }
  return null;
}

/** 도안 정보 줄 (사이즈별 치수·여유분, 실·바늘, 게이지, 재료) — 단 목록이 아니라 '도안 정보'로 따로 */
const INFO_RE = /사이즈|가슴\s*둘레|품|총\s*장|기장|어깨\s*(?:너비|폭)|소매\s*(?:길이|기장)|진동|암홀|완성\s*(?:치수|크기)|실제\s*치수|여유|권장|실\s*[:：]|사용\s*실|바늘|게이지|부자재|단추|\b(?:finished|measurements?|chest|bust|ease|yarns?|needles?|hooks?|gauge|tension|notions)\b/i;
export function extractInfo(text: string, size = "", max = 900): string {
  const out: string[] = [];
  let len = 0;
  const order = sizeOrder(text);
  const me = normS(size || "");
  for (const raw of text.split(/\r?\n/)) {
    let l = raw.replace(/\s+/g, " ").trim();
    if (l.length < 4 || l.length > 180 || rowStart(l) || !INFO_RE.test(l)) continue;
    if (/차트\s*[:：]?\s*p\.?\s*\d/i.test(l)) continue; // 차트 쪽 안내는 정보가 아님
    // 정보 낱말로 시작하지 않는데 뜨는 지시가 섞인 줄은 단 서술이다
    const lead = /^[\W\d]*(?:[A-C]\s+)?(?:사이즈|가슴|총\s*장|기장|어깨|소매|완성|실제|사용|실\s*[:：]|바늘|게이지|부자재|단추|finished|measurements?|sizes?|chest|bust|yarns?|needles?|hooks?|gauge|tension|notions)/i.test(l);
    if (/코가\s*(?:있|남|됩)|(?:둡니다|줍니다|합니다|떠요|뜹니다)\.?\s*$/.test(l)) continue; // 단 서술 문장
    if (!lead && !/\d\s*(?:cm|mm|코|단|g|m|볼|타래|ply|inch|in\b|")/i.test(l)) continue; // 머리말이 없으면 치수가 있는 줄만
    if (!lead && /\b(?:work|fasten|sew|rep(?:eat)?|join|knit|purl|\d*(?:dc|sc|tr|hdc|ch|sl st)\b)|뜹니다|뜨세요|떠\s*주세요/i.test(l)) continue;
    if (size && order.includes(me)) {
      // 다른 사이즈 하나만 가리키는 줄("S사이즈 …")은 빼고, 사이즈 나열은 내 사이즈로
      const one = l.match(/^(\d?XL|XXXL|XXL|XS|S|M|L)\s*사이즈/i);
      if (one && normS(one[1]) !== me) continue;
      l = l.replace(/(?<![\w’'])(?:(?:\d?XL|XXXL|XXL|XS|S|M|L)\b[\s()/,·]*){3,}/g, (m) => {
        const list = m.split(/[\s()/,·]+/).filter((x) => SIZE_TOKEN.test(x)).map(normS);
        return list.includes(me) ? me + (/\s$/.test(m) ? " " : "") : m;
      });
      // 글자가 깨져 "(1 8)"처럼 숫자가 갈라진 칸도 한 칸으로 세어 내 사이즈 숫자를 고른다
      l = resolveSizes(l.replace(/\(\s*(\d+)\s+(\d+)\s*\)/g, "($1$2)"), size, order);
    }
    if (!/\d|[:：]/.test(l)) continue; // 제목만 있는 줄("게이지")은 빼고 값이 있는 줄만
    if (out.includes(l)) continue;
    if (len + l.length > max) break;
    out.push(l);
    len += l.length + 1;
  }
  return out.join("\n");
}

/** 내장 결과로 충분한가: 단이 충분하고 다른 단 참조가 없을 때 */
export function localGoodEnough(secs: AiSection[], text: string): { ok: boolean; why: string } {
  const n = secs.reduce((s, x) => s + x.rows.length, 0);
  if (n < 3) return { ok: false, why: "단 표시를 거의 찾지 못했어요" };
  if (REFERS_OTHER_ROWS.test(text)) return { ok: false, why: "다른 단을 가리키는 지시(예: '1단과 동일')가 있어요" };
  return { ok: true, why: "" };
}
