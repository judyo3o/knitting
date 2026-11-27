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
    // "1,1,1,2"처럼 숫자 사이 쉼표(띄어쓰기 없음)는 나누지 않는다
    const numList = c === "," && /\d/.test(text[i - 1] || "") && /\d/.test(text[i + 1] || "");
    if (depth === 0 && !numList && (c === "," || c === "，" || c === "\n" || c === "、")) {
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

/** 반복 회차 표시 묶음 ("▸ 2/4회") — 코를 쓰지 않는다 */
export const REP_MARK = /^▸\s*\d+\/\d+회$/;
/** 표시용 묶음 (반복 회차 "▸ 2/4회", 조각 이름 "▸ 뒤판 110코") — 코를 쓰지 않는다 */
export const SHOW_MARK = /^▸/;

/**
 * 차트에서 읽은 연결 단("왼쪽 앞판 …, 감아코 10코 만들기, 뒤판 …, 감아코 10코 만들기, 오른쪽 앞판 …"):
 * 감아코 칸("+ ×10")은 "감아코 10코"로, 조각마다 앞에 "▸ 왼쪽 앞판 54코" 같은 이름 묶음을 넣는다.
 */
export function labelParts(chunks: string[], t: string): string[] {
  const co = /^\+\s*(?:[×x]\s*(\d+))?$/;
  const out = chunks.map((c) => { const m = c.trim().match(co); return m ? `감아코 ${m[1] || 1}코` : c; });
  if (!/감아\s*코/.test(t || "")) return out;
  const names = (t.split("\n")[0] || "").split(/,?\s*감아\s*코\s*\d+\s*코\s*(?:만들기|잡기)?\s*,?/).map((x) => x.match(/(?:(왼쪽|오른쪽)\s*)?(앞판|뒤판|뒷판|몸판|소매)/)?.[0] || null);
  const isCo = (c: string) => /^감아코 \d+코$/.test(c);
  const groups: string[][] = [[]];
  for (const c of out) { if (isCo(c)) groups.push([c], []); else groups[groups.length - 1].push(c); }
  const parts = groups.filter((g) => !(g.length === 1 && isCo(g[0])));
  if (parts.length !== names.length || names.some((n) => !n)) return out;
  const res: string[] = [];
  let k = 0;
  for (const g of groups) {
    if (g.length === 1 && isCo(g[0])) { res.push(g[0]); continue; }
    const n = g.reduce<number | null>((a, c) => { const v = countChunk(c); return a == null || v == null ? null : a + v; }, 0);
    res.push(`▸ ${names[k++]}${n ? ` ${n}코` : ""}`, ...g);
  }
  return res;
}
const REP_RE = /^[\(\[（【](.*)[\)\]）】]\s*(?:을|를)?\s*(?:총\s*)?(\d+)\s*(?:번|회|x|times)\s*(?:반복)?$/i;

/** "[겉6, 안2, 겉2, 안2]를 (단) 끝까지 반복" — 몇 번인지는 그 단 콧수로 */
const REP_END = /^[\(\[（【](.*)[\)\]）】]\s*(?:을|를)?\s*(?:단\s*)?(?:끝까지|마지막까지)\s*반복(?:\s*\([^)]*\))?$|^[\(\[（【](.*)[\)\]）】]\s*(?:rep(?:eat)?\s*)?(?:to|until)\s*end(?:\s+of\s+(?:row|rnd|round))?\.?$/i;
/** 끝까지 반복형 반복 단위가 쓰는 코 수 */
export function repEndUnit(p: string): number | null {
  const m = p.trim().match(REP_END);
  if (!m) return null;
  const inner = splitTop(m[1] ?? m[2]).map(countChunk);
  return inner.some((v) => v == null) ? null : (inner as number[]).reduce((a, b) => a + b, 0);
}

export function chunksOf(text: string, total: number | null = null): string[] {
  const parts = splitTop(text || "");
  // 맨 끝 "(206코)"는 앞 묶음에 붙여 보여준다
  const out: string[] = [];
  for (const p of parts) {
    if (ST_MARK.test(p) && out.length) out[out.length - 1] += " " + p;
    else out.push(...expandRepeat(p, total));
  }
  return out;
}

/** "[안2, ktbl, …] 4번 반복"을 풀어 쓴다 (묶음마다 눌러 진행을 저장할 수 있게). 묶음이 4개 이상이면 회차 표시를 넣는다 */
function expandRepeat(p0: string, total: number | null = null): string[] {
  // 끝의 "(88코)"는 떼었다가 마지막 묶음에 다시 붙인다
  const stm = p0.match(/\s*([\(\[（【]\s*(?:총\s*)?\d{1,4}\s*코[^\)\]）】]*[\)\]）】])\s*$/);
  const p = stm ? p0.slice(0, p0.length - stm[0].length) : p0;
  let m = p.match(REP_RE) as RegExpMatchArray | null;
  // "…를 단 끝까지 반복": 그 단 콧수 ÷ 반복 단위 콧수가 딱 나누어떨어지면 횟수로 풀어 쓴다
  if (!m && total) {
    const e = p.trim().match(REP_END), unit = repEndUnit(p);
    if (e && unit && total % unit === 0) m = ["", e[1] ?? e[2], String(total / unit)] as unknown as RegExpMatchArray;
  }
  if (!m) return [p0];
  const n = +m[2];
  const inner = chunksOf(m[1]);
  if (n < 2 || n > 40 || inner.length < 3 || inner.length * n > 400) return [p0]; // (겉1, 안1) 같은 짧은 반복은 한 묶음 그대로
  const mark = inner.length >= 4;
  const out: string[] = [];
  for (let i = 1; i <= n; i++) {
    if (mark) out.push(`▸ ${i}/${n}회`);
    out.push(...inner);
  }
  if (stm) out[out.length - 1] += " " + stm[1];
  return out;
}

/**
 * 단 서술 → 안내 문장 + 뜨는 묶음. 서술이 여러 줄이면 코 지시 줄(겉2, 안3, 2/1 LC…)만 묶음으로 나누고,
 * 나머지 문장("…마커를 걸어줍니다", "차트를 따라 진행")은 안내로 따로 보여 준다.
 * 코 지시 사이의 " / "는 마커 자리라 "마커" 묶음으로 남긴다.
 */
export function splitNarrative(text: string, total: number | null = null): { notes: string[]; chunks: string[] } {
  const known = (x: string) => countChunk(x) != null || ST_MARK.test(x) || repEndUnit(x) != null;
  const isStitchLine = (l: string) => {
    const parts = splitTop(l.replace(/\s\/\s/g, ", "));
    const ok = parts.filter(known).length;
    return parts.length >= 2 ? ok / parts.length >= 0.6 : parts.length === 1 && /[\[(（【]/.test(parts[0]) && known(parts[0]); // "[…] 4번 반복" 한 덩어리 줄도
  };
  // 한 줄 안에 안내 문장과 코 지시가 붙어 있으면 ("…걸어줍니다. (… 됩니다) 안4, 겉2, …") 문장 끝에서 나눈다
  const lines = (text || "").split(/\n+/).map((l) => l.trim()).filter(Boolean).flatMap((l) => {
    const first = splitTop(l)[0] || "";
    if (isStitchLine(l) && (known(first) || !/[가-힣]{4}/.test(first))) return [l];
    const re = /[.!?。)）]\s+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(l))) {
      const head = l.slice(0, m.index + 1).trim(), rest = l.slice(m.index + m[0].length).trim();
      if (/[가-힣]{2}/.test(head) && countChunk(splitTop(head).pop() || "") == null && isStitchLine(rest) && known(splitTop(rest)[0] || "")) return [head, rest];
    }
    return [l];
  });
  const stitch = lines.filter(isStitchLine);
  if (!stitch.length) return { notes: [], chunks: chunksOf(text, total) };
  return {
    notes: lines.filter((l) => !stitch.includes(l)),
    chunks: chunksOf(stitch.map((l) => l.replace(/\s\/\s/g, ", 마커, ")).join(", "), total),
  };
}

type Tok = { re: RegExp; n: (m: RegExpMatchArray) => number };
const TOKENS: Tok[] = [
  { re: /^(\d+)\s*\/\s*(\d+)\s*(?:LPC|RPC|LC|RC)/i, n: (m) => +m[1] + +m[2] },
  { re: /^(?:k2togk|k2tog\s*k)(?![a-z])/i, n: () => 2 }, // 2코 모아 뜨고 빼지 않은 채 첫 코를 다시 겉뜨기 (2코 → 2코)
  { re: /^(?:k1?\s*tbl|p1?\s*tbl|(?:겉|안)1?\s*tbl|꼬아\s*(?:겉|안)\s*뜨기)(?![a-z])/i, n: () => 1 },
  { re: /^(\d+)\s*\/\s*(\d+)\s*k(?:RC|LC|CR|CL)tog(?![a-z])/i, n: (m) => +m[1] + +m[2] },
  { re: /^C(\d+)\s*\/\s*(\d+)\s*(?:L|R|LP|RP)(?:C)?(?![a-z])/i, n: (m) => +m[1] + +m[2] }, // C2/2L · C2/2R 표기 // 교차하며 2코씩 모으기 (4코 → 2코)
  { re: /^C(\d+)(?:B|F)\s*dec(?![a-z])/i, n: (m) => +m[1] }, // C4B dec: 교차하며 모으기 (4코 → 2코)
  { re: /^C(\d+)(?:B|F)(?![a-z])/i, n: (m) => +m[1] }, // C6B · C4F
  { re: /^(?:k2tog\s*tbl|k2tog|p2tog|ssk|ssp|2코\s*모아\s*(?:겉|안)?\s*뜨기|왼코\s*겹치기|오른코\s*겹치기)/i, n: () => 2 },
  { re: /^(?:sk2p|s2kp|k3tog|p3tog|중심\s*3코\s*모아\s*뜨기|3코\s*모아\s*(?:겉|안)?\s*뜨기)/i, n: () => 3 },
  { re: /^(?:KDS|PDS|DS)(?![a-z])/i, n: () => 1 },
  { re: /^(?:M1Rp|M1Lp|M1RP|M1LP|M1P|M1R|M1L|M1|YO|바늘\s*비우기|감아\s*코)(?![a-z])/i, n: () => 0 },
  { re: /^(?:턴|T)(?![a-z가-힣])/i, n: () => 0 },
  { re: /^(?:Rp|Lp|R|L)$/, n: () => 1 }, // 차트 늘림 칸(M1R·M1L 표기) — 차트 칸 하나
  { re: /^\+\s*(?:[×x]\s*(\d+))?$/, n: (m) => (m[1] ? +m[1] : 1) }, // 차트 감아코 칸 "+ ×9"
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
  // "k2togk 2번" 같은 한 기법 N번
  const times = s.match(/^([^\[\(（【]+?)\s*(\d+)\s*번$/);
  if (times && !/반복$/.test(s)) {
    const one = countChunk(times[1]);
    return one == null ? null : one * +times[2];
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
    if (c == null) {
      // "마커" "PM" 같은 코를 쓰지 않는 묶음은 0코
      if (/^(?:마커\s*(?:옮기기|걸기|빼기)?|pm|sm|rm)$/i.test(chunks[k].trim()) || SHOW_MARK.test(chunks[k].trim())) continue;
      return null;
    }
    sum += c;
  }
  return sum;
}
