/**
 * §3-5 서술 묶음 나누기 · 묶음별 왼바늘 소모 코 수 추정
 * 괄호 깊이 0의 `,` `，` 줄바꿈 ` / `로 나눈다. `(겉1, 안1) 4번 반복`은 한 묶음.
 */
const OPEN = "([（【";
const CLOSE = ")]）】";

/** 끝에 붙는 콧수 표시 "(206코)" "[총 48코]" — 묶음으로 치지 않는다 */
const ST_MARK = /^[\(\[（【]\s*(?:총\s*)?\d{1,4}\s*코\s*(?:가\s*됨|남음)?\s*[\)\]）】]$/;

export function splitTop(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  const push = () => {
    const t = cur.trim();
    if (t) out.push(t);
    cur = "";
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (OPEN.includes(c)) depth++;
    else if (CLOSE.includes(c)) depth = Math.max(0, depth - 1);
    if (depth === 0 && (c === "," || c === "，" || c === "\n" || c === "、")) {
      push();
      continue;
    }
    if (depth === 0 && c === "/" && text[i - 1] === " " && text[i + 1] === " ") {
      push();
      continue;
    }
    cur += c;
  }
  push();
  return out;
}

export function chunksOf(text: string): string[] {
  const parts = splitTop(text || "");
  // 맨 끝 "(206코)"는 앞 묶음에 붙여 보여준다
  const out: string[] = [];
  for (const p of parts) {
    if (ST_MARK.test(p) && out.length) out[out.length - 1] += " " + p;
    else out.push(p);
  }
  return out;
}

type Tok = { re: RegExp; n: (m: RegExpMatchArray) => number };
const TOKENS: Tok[] = [
  { re: /^(\d+)\s*\/\s*(\d+)\s*(?:LPC|RPC|LC|RC)/i, n: (m) => +m[1] + +m[2] },
  { re: /^(?:k2tog\s*tbl|k2tog|p2tog|ssk|ssp|2코\s*모아\s*(?:겉|안)?\s*뜨기|왼코\s*겹치기|오른코\s*겹치기)/i, n: () => 2 },
  { re: /^(?:sk2p|s2kp|k3tog|p3tog|중심\s*3코\s*모아\s*뜨기|3코\s*모아\s*(?:겉|안)?\s*뜨기)/i, n: () => 3 },
  { re: /^(?:KDS|PDS|DS)(?![a-z])/i, n: () => 1 },
  { re: /^(?:M1Rp|M1Lp|M1R|M1L|M1|YO|바늘\s*비우기|감아\s*코)(?![a-z])/i, n: () => 0 },
  { re: /^(?:턴|T)(?![a-z가-힣])/i, n: () => 0 },
  { re: /^(?:sl|slip|걸러\s*뜨기|걸러)\s*(\d*)(?![a-z])/i, n: (m) => (m[1] ? +m[1] : 1) },
  { re: /^(?:겉|안)\s*(?:뜨기)?\s*(\d*)/, n: (m) => (m[1] ? +m[1] : 1) },
  { re: /^[kp](\d*)(?![a-z])/i, n: (m) => (m[1] ? +m[1] : 1) },
  { re: /^(\d+)\s*코/, n: (m) => +m[1] }, // 배색 "A 3코"
];
/** 배색 색 기호 접두 ("A ", "MC색 ", "C1 ") — 콧수에는 영향 없음 */
const COLOR_PREFIX = /^(?:MC|CC\d?|C\d{1,2}|[A-F])(?:색|실)?(?=\s|$)/;
const SKIP = /^(?:마커\s*(?:옮기기|걸기|빼기)?|pm|sm|rm)(?![a-z])/i;

/** 묶음 하나가 왼바늘에서 쓰는 코 수. 모르는 말이 있으면 null */
export function countChunk(chunk: string): number | null {
  let s = chunk.trim().replace(/[\(\[（【]\s*(?:총\s*)?\d{1,4}\s*코[^\)\]）】]*[\)\]）】]\s*$/, "").trim();
  // (…) N번 반복 / […] 총 N번 반복
  const rep = s.match(/^[\(\[（【](.*)[\)\]）】]\s*(?:을|를)?\s*(?:총\s*)?(\d+)\s*(?:번|회|x|times)\s*(?:반복)?$/i) ||
    s.match(/^[\(\[（【](.*)[\)\]）】]\s*[x×]\s*(\d+)$/i);
  if (rep) {
    const inner = splitTop(rep[1]).map(countChunk);
    if (inner.some((v) => v == null)) return null;
    return (inner as number[]).reduce((a, b) => a + b, 0) * +rep[2];
  }
  if (/^[\(\[（【].*[\)\]）】]$/.test(s)) {
    const inner = splitTop(s.slice(1, -1)).map(countChunk);
    if (inner.some((v) => v == null)) return null;
    return (inner as number[]).reduce((a, b) => a + b, 0);
  }
  let total = 0;
  let any = false;
  while (s.length) {
    s = s.replace(/^[\s·.:;]+/, "");
    if (!s) break;
    let hit = false;
    for (const t of TOKENS) {
      const m = s.match(t.re);
      if (m && m[0].length) {
        total += t.n(m);
        s = s.slice(m[0].length);
        hit = any = true;
        break;
      }
    }
    if (hit) continue;
    const cp = s.match(COLOR_PREFIX);
    if (cp) {
      s = s.slice(cp[0].length);
      continue;
    }
    const sk = s.match(SKIP);
    if (sk && sk[0].length) {
      s = s.slice(sk[0].length);
      continue;
    }
    return null;
  }
  return any ? total : null;
}

/** 묶음 i까지(포함) 뜬 코 수. 중간에 모르는 묶음이 있으면 null */
export function stitchesThrough(chunks: string[], i: number): number | null {
  let sum = 0;
  for (let k = 0; k <= i && k < chunks.length; k++) {
    const c = countChunk(chunks[k]);
    if (c == null) return null;
    sum += c;
  }
  return sum;
}
