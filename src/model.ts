import { MAX_LOG, SESSION_GAP_MS } from "./config";
import type { AiSection, Pattern, Row, SecInfo, Side } from "./types";

export const int = (v: unknown): number => {
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : 0;
};
export const str = (v: unknown): string => (v == null ? "" : String(v).trim());
export const flip = (s: Side): Side => (s === "RS" ? "WS" : "RS");
const normSide = (v: unknown): Side | null => {
  const s = str(v).toUpperCase();
  return s === "RS" || s === "WS" ? s : null;
};
export const key = (s: string, n: number) => `${s}#${n}`;
const isSwatch = (name: string) => /스와치|swatch|게이지/i.test(name);

/** 같은 이름의 파트는 하나로 합친다 (배치 사이에 파트가 이어질 때). 스와치는 맨 앞. */
export function mergeSections(base: AiSection[], add: AiSection[] | undefined): AiSection[] {
  const res = base.map((s) => ({ ...s, rows: [...s.rows] }));
  for (const s of add || []) {
    if (!s || !Array.isArray(s.rows)) continue;
    const name = str(s.name) || "도안";
    const hit = res.find((x) => str(x.name) === name);
    if (hit) {
      hit.rows.push(...s.rows);
      if (hit.chart == null && s.chart != null) hit.chart = s.chart;
      if (s.round) hit.round = true;
    } else res.push({ name, chart: s.chart ?? null, round: !!s.round, rows: [...s.rows] });
  }
  const sw = res.filter((s) => isSwatch(s.name));
  return [...sw, ...res.filter((s) => !isSwatch(s.name))];
}

/** Claude 결과 → 단마다 펼친 Row[] + 파트 정보 (§2) */
export function expand(sections: AiSection[]): { rows: Row[]; secs: Record<string, SecInfo> } {
  const rows: Row[] = [];
  const secs: Record<string, SecInfo> = {};
  for (const sec of sections || []) {
    const name = str(sec?.name) || "도안";
    const secCh = int(sec.chart) || null;
    const byN = new Map<number, Row>();
    for (const r of sec.rows || []) {
      const a = int(r.from);
      let b = int(r.to) || a;
      if (a < 1) continue;
      if (b < a) b = a;
      if (b - a > 400) b = a + 400;
      const text = str(r.text);
      for (let n = a; n <= b; n++) {
        const row: Row = {
          s: name,
          n,
          t: text,
          st: n === b ? str(r.stitches) || null : null,
          side: a === b ? normSide(r.side) : null,
          pg: int(r.page) || null,
          ch: int(r.chart) || secCh,
          span: a !== b ? [a, b] : null,
          ...(Array.isArray(r.colors) && r.colors.length ? { co: r.colors.map(str).filter(Boolean) } : {}),
        };
        const prev = byN.get(n);
        if (prev) {
          prev.t = prev.t && text && prev.t !== text ? prev.t + "\n" + text : prev.t || text;
          prev.st = prev.st || row.st;
          prev.ch = prev.ch || row.ch;
          prev.side = prev.side || row.side;
          prev.pg = prev.pg || row.pg;
          if (row.co) prev.co = [...new Set([...(prev.co || []), ...row.co])];
        } else byN.set(n, row);
      }
    }
    const list = [...byN.values()].sort((x, y) => x.n - y.n);
    const info: SecInfo = secs[name] || {};
    info.ch = info.ch ?? secCh;
    info.round = info.round || !!sec.round;
    secs[name] = info;
    // 같은 이름 파트가 두 번 나오면(드묾) 기존 rows에 섞는다
    const existing = rows.filter((x) => x.s === name);
    if (existing.length) {
      const have = new Set(existing.map((x) => x.n));
      rows.push(...list.filter((x) => !have.has(x.n)));
    } else rows.push(...list);
  }
  // 파트별로 모아 정렬 (도안 순서 유지)
  const order = [...new Set(rows.map((r) => r.s))];
  const sorted = order.flatMap((s) => rows.filter((r) => r.s === s).sort((a, b) => a.n - b.n));
  for (const s of order) {
    const list = sorted.filter((r) => r.s === s);
    markStart(list);
    secs[s].odd = inferOdd(list);
  }
  return { rows: sorted, secs };
}

/** "코잡기가 1단", "cast-on counts as row 1" */
export const CAST_ON_ROW1 = /코\s*잡기(?:가|는)?\s*1\s*단|기초코(?:가|는)?\s*1\s*단|cast[- ]?on\s+(?:counts?\s+as|is)\s+(?:row|rnd|round)\s*1/i;
/** "2단 안면부터", "2단(WS)부터", "row 2 (WS)" → 그 단의 면 */
const START_SIDE = /(\d{1,3})\s*단\s*(?:은|는|이|가)?\s*\(?\s*(안면|겉면|WS|RS)\s*\)?\s*(?:부터|에서|으로)?|(?:row|rnd)\s*(\d{1,3})\s*\(?\s*(WS|RS)\b/i;

/** 파트 서술에서 코잡기 단·시작 면을 읽어 표시한다 (차트의 ← → 방향과 같게) */
export function markStart(list: Row[]) {
  const first = list[0];
  if (!first) return;
  const text = list.slice(0, 3).map((r) => r.t).join(" ");
  if (first.n === 1 && CAST_ON_ROW1.test(text)) first.castOn = true;
  // 코줍기로 시작하는 파트: 1단 서술이 코줍기뿐(코 지시 없음)이면 코줍기 자체가 1단 (차트 1단도 코줍기 표시)
  if (first.n === 1 && /코를?\s*줍|코\s*줍기|주워|감아\s*코|pick\s*up|cast\s*on/i.test(first.t) && !/(?:겉|안)\s*\d|\b[kp]\d|겉뜨기\s*\d|안뜨기\s*\d/i.test(first.t)) first.castOn = true;
  const m = text.match(START_SIDE);
  if (m) {
    const n = +(m[1] || m[3]);
    const side = /안면|WS/i.test(m[2] || m[4]) ? "WS" : "RS";
    const r = list.find((x) => x.n === n);
    if (r && !r.side) r.side = side;
  }
}

/** 파트 안에서 side가 적힌 첫 단으로 "홀수단 = RS/WS"를 정한다. 없으면 RS. */
export function inferOdd(partRows: Row[]): Side {
  const r = partRows.find((x) => x.side);
  if (!r || !r.side) return "RS";
  return r.n % 2 === 1 ? r.side : flip(r.side);
}

/** rows → sections (페이지를 더 읽어 붙일 때 다시 병합하려고) */
export function toSections(rows: Row[], secs: Record<string, SecInfo>): AiSection[] {
  const out: AiSection[] = [];
  for (const r of rows) {
    let s = out.find((x) => x.name === r.s);
    if (!s) {
      s = { name: r.s, chart: secs[r.s]?.ch ?? null, round: !!secs[r.s]?.round, rows: [] };
      out.push(s);
    }
    s.rows.push({ from: r.n, to: r.n, text: r.t, stitches: r.st, side: r.side, page: r.pg, chart: r.ch, colors: r.co || null });
  }
  return out;
}

/* ---------- 파트 / 현재 단 ---------- */

export const partNames = (p: Pattern) => [...new Set(p.rows.map((r) => r.s))];
export const partRows = (p: Pattern, s: string) => p.rows.filter((r) => r.s === s);

export function currentTab(p: Pattern): string {
  const names = partNames(p);
  return names.includes(p.tab) ? p.tab : names[0] || "";
}

export function currentRow(p: Pattern, s = currentTab(p)): Row | null {
  const list = partRows(p, s);
  if (!list.length) return null;
  const n = p.pos[s];
  return list.find((r) => r.n === n) || list[0];
}

/** 지금 단의 면. 원통이면 항상 RS, side가 적혀 있으면 그것, 아니면 홀짝 + odd */
export function sideOf(p: Pattern, r: Row): Side {
  const info = p.secs[r.s] || {};
  if (info.round) return "RS";
  if (r.side) return r.side;
  const odd = info.odd || "RS";
  return r.n % 2 === 1 ? odd : flip(odd);
}

export function directionText(p: Pattern, r: Row): string {
  if (p.secs[r.s]?.round) return "← 원통: 오른쪽부터";
  return sideOf(p, r) === "RS" ? "← 오른쪽에서 왼쪽" : "→ 왼쪽에서 오른쪽 · 기호 반대로";
}

export function partProgress(p: Pattern, s: string) {
  const list = partRows(p, s);
  const done = list.filter((r) => p.done[key(s, r.n)]).length;
  return { done, total: list.length, finished: !!p.fin[s] };
}

/** 같은 파트에서 30분 안에 이어진 이동은 한 세션 (§1-5) */
export function logMove(p: Pattern, s: string, from: number, to: number, now: number) {
  const last = p.log[p.log.length - 1];
  if (last && last.s === s && now - last.b <= SESSION_GAP_MS) {
    last.b = now;
    last.to = to;
  } else p.log.push({ a: now, b: now, s, from, to });
  if (p.log.length > MAX_LOG) p.log.splice(0, p.log.length - MAX_LOG);
}

export type StepResult = "moved" | "finished" | "next-part" | "all-done" | "none";

/** "다음 단": 단 완료 기록 → 다음 단. 마지막 단이면 파트 완료, 완료 상태에서 또 누르면 다음 미완료 파트로. */
export function stepNext(p: Pattern, now = Date.now()): StepResult {
  const s = currentTab(p);
  const list = partRows(p, s);
  const cur = currentRow(p, s);
  if (!cur) return "none";
  const k = list.indexOf(cur);
  if (p.fin[s]) {
    const names = partNames(p);
    const i = names.indexOf(s);
    const nextPart = [...names.slice(i + 1), ...names.slice(0, i)].find((x) => !p.fin[x]);
    if (!nextPart) return "all-done";
    p.tab = nextPart;
    return "next-part";
  }
  p.done[key(s, cur.n)] = now;
  if (k < list.length - 1) {
    const nx = list[k + 1];
    p.pos[s] = nx.n;
    logMove(p, s, cur.n, nx.n, now);
    return "moved";
  }
  p.fin[s] = now;
  logMove(p, s, cur.n, cur.n + 1, now);
  return "finished";
}

/** "이전 단": 완료 취소 또는 한 단 뒤로 (돌아간 그 단의 완료 기록 삭제) */
export function stepPrev(p: Pattern, now = Date.now()): StepResult {
  const s = currentTab(p);
  const list = partRows(p, s);
  const cur = currentRow(p, s);
  if (!cur) return "none";
  if (p.fin[s]) {
    delete p.fin[s];
    delete p.done[key(s, cur.n)];
    return "moved";
  }
  const k = list.indexOf(cur);
  if (k <= 0) return "none";
  const pv = list[k - 1];
  p.pos[s] = pv.n;
  delete p.done[key(s, pv.n)];
  logMove(p, s, cur.n, pv.n, now);
  return "moved";
}

export function jumpTo(p: Pattern, s: string, n: number): boolean {
  if (!partRows(p, s).some((r) => r.n === n)) return false;
  p.tab = s;
  p.pos[s] = n;
  return true;
}

export function lastWorked(p: Pattern): number {
  const t = [...Object.values(p.done), ...Object.values(p.fin), ...p.log.map((l) => l.b), ...Object.values(p.part).map((x) => x.t)];
  return t.length ? Math.max(...t) : 0;
}

export function newPattern(init: Partial<Pattern> & { id: string; name: string }): Pattern {
  return {
    size: "",
    notes: "",
    info: "",
    rows: [],
    secs: {},
    tab: "",
    pos: {},
    done: {},
    fin: {},
    part: {},
    log: [],
    src: null,
    srcPages: null,
    readPages: [],
    colors: [],
    draw: {},
    gauges: [],
    rev: 1,
    updatedAt: Date.now(),
    ...init,
  };
}

/** 예전 버전 데이터나 가져오기 JSON을 현재 모델로 맞춘다 */
export function normalize(p: Partial<Pattern> & { id: string }): Pattern {
  const base = newPattern({ id: p.id, name: p.name || "도안" });
  const out = { ...base, ...p } as Pattern;
  for (const k of ["secs", "pos", "done", "fin", "part", "draw"] as const) if (!out[k] || typeof out[k] !== "object") (out as any)[k] = {};
  if (!Array.isArray(out.log)) out.log = [];
  if (!Array.isArray(out.rows)) out.rows = [];
  if (!Array.isArray(out.readPages)) out.readPages = [];
  if (!Array.isArray(out.colors)) out.colors = [];
  if (!Array.isArray(out.gauges)) out.gauges = [];
  if (typeof p.info !== "string") {
    // 옛 데이터: notes에 도안 정보와 앱 안내가 섞여 있었다 → 앱 안내만 notes에 남김
    const lines = String(out.notes || "").split("\n");
    const app = (l: string) => /^기기에서 읽었어요|^예시 도안이에요/.test(l);
    out.info = lines.filter((l) => l.trim() && !app(l)).join("\n");
    out.notes = lines.filter(app).join("\n");
  }
  expandLengthRepeats(out);
  for (const s of partNames(out)) {
    markStart(partRows(out, s));
    out.secs[s] = out.secs[s] || {};
    if (!out.secs[s].odd) out.secs[s].odd = inferOdd(partRows(out, s));
  }
  return out;
}

/** 색 목록 병합 (같은 기호는 하나로, 이름·hex는 먼저 알게 된 값 유지) */
export function mergeYarns(base: { code: string; name: string | null; hex: string | null }[], add: unknown): typeof base {
  const out = base.map((y) => ({ ...y }));
  if (!Array.isArray(add)) return out;
  for (const y of add as any[]) {
    const code = str(y?.code);
    if (!code) continue;
    const hex = /^#[0-9a-f]{6}$/i.test(str(y?.hex)) ? str(y.hex) : null;
    const hit = out.find((x) => x.code === code);
    if (hit) {
      hit.name = hit.name || str(y?.name) || null;
      hit.hex = hit.hex || hex;
    } else out.push({ code, name: str(y?.name) || null, hex });
  }
  return out;
}

/** 서술에서 색 기호를 찾는다 (Claude가 row.colors를 안 줬을 때 / 텍스트 파서용) */
export function colorsInText(text: string, yarns: { code: string }[]): string[] {
  const found = new Set<string>();
  for (const y of yarns) {
    const c = y.code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(^|[^A-Za-z0-9가-힣])${c}(색|실)?(?=$|[^A-Za-z0-9])`).test(text)) found.add(y.code);
  }
  for (const m of text.matchAll(/(?:^|[^A-Za-z])((?:MC|CC\d?|C\d{1,2}|[A-F]))\s*(?:색|실)/g)) found.add(m[1]);
  return [...found];
}

/* ---------- 직접 그린 배색 → 단 서술 ---------- */
import { describeRow, rowColors } from "./drawing";

/**
 * 파트의 그린 격자로 단 서술을 만든다. 서술이 비었거나 이전에 자동으로 만든 단만 바꾸고,
 * 격자에만 있는 단은 새로 만든다 (사용자가 고친 서술은 그대로 둔다).
 */
export function applyDrawing(p: Pattern, s: string): number {
  const d = p.draw[s];
  if (!d) return 0;
  p.secs[s] = p.secs[s] || { odd: "RS" };
  let changed = 0;
  const others = p.rows.filter((r) => r.s !== s);
  const mine = p.rows.filter((r) => r.s === s);
  for (let n = d.start; n < d.start + d.h; n++) {
    let r = mine.find((x) => x.n === n);
    if (!r) {
      r = { s, n, t: "", st: null, side: null, pg: null, ch: null, span: null, auto: true };
      mine.push(r);
    }
    const desc = describeRow(d, n, sideOf(p, r), p.colors);
    const codes = rowColors(d, n).map((i) => p.colors[i]?.code || `색${i + 1}`);
    if (!r.t || r.auto) {
      if (r.t !== (desc || "")) changed++;
      r.t = desc || "";
      r.auto = true;
      r.st = `${d.w}코`;
      r.span = null;
    }
    r.co = codes;
  }
  mine.sort((a, b) => a.n - b.n);
  // 파트 순서 유지: 원래 자리에 다시 끼운다
  const order = partNames(p);
  if (!order.includes(s)) order.push(s);
  p.rows = order.flatMap((name) => (name === s ? mine : others.filter((r) => r.s === name)));
  return changed;
}

/** 파트 콧수: 기초코 문장("110코를 만듭니다", "38코 기초코", "cast on 60 sts") > 단 끝 콧수 중 가장 많이 나온 값 */
export function partStitches(rows: Row[]): number | null {
  for (const r of rows.slice(0, 3)) {
    const m = (r.t || "").match(/(\d{1,4})\s*코\s*(?:를|을)?\s*(?:기초코|만듭|만들|잡|일반코|코잡기)|(?:기초코|코잡기|cast\s*on)\s*(\d{1,4})\s*(?:코|sts?|stitches)?/i);
    if (m) return +(m[1] || m[2]);
  }
  const cnt = new Map<number, number>();
  for (const r of rows) { const m = (r.st || "").match(/\d{1,4}/); if (m) cnt.set(+m[0], (cnt.get(+m[0]) || 0) + 1); }
  const best = [...cnt.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
  return best ? best[0] : null;
}

/**
 * 여러 단 공통 지시("16단~58단까지 차트를 따라 진행합니다. 이제 바늘에 96코예요. 실을 자르고 코를 쉼코로 둡니다.")를
 * 매 단 할 일(each)과 다 뜬 뒤에 할 일(end)로 나눈다. 다른 범위("16단~66단", 다른 사이즈)를 가리키는 줄은 뺀다.
 */
export function spanParts(t: string, span: [number, number] | null): { each: string; end: string } {
  const RANGE = /(\d{1,3})\s*단\s*[~\-–]\s*(\d{1,3})\s*단/;
  let lines = (t || "").split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (span) {
    const mine = lines.filter((l) => { const m = l.match(RANGE); return !m || (+m[1] === span[0] && +m[2] === span[1]); });
    if (mine.length) lines = mine;
  }
  const sents = lines.flatMap((l) => l.split(/(?<=[.。])\s+/)).map((x) => x.trim()).filter(Boolean);
  const END = /코가\s*(?:있|남|됩)|코\s*남|실을\s*끊|쉬어\s*둡|쉬어둡|홀더|코막음|코\s*막음|마무리/;
  // "차트를 따라 진행합니다."와 "차트를 따라 진행"은 같은 말로
  const uniq = (a: string[]) => { const seen = new Set<string>(); return a.filter((x) => { const k = x.replace(/\s+/g, "").replace(/(?:합니다|한다|해요|하기)?[.。]?$/, ""); if (seen.has(k)) return false; seen.add(k); return true; }); };
  const each = uniq(sents.filter((x) => !END.test(x)).map((x) => x.replace(RANGE, "").replace(/^\s*까지\s*/, "").trim()).filter(Boolean));
  const end = uniq(sents.filter((x) => END.test(x)));
  return { each: each.join(" ") || "차트대로 뜨기", end: end.join(" ") };
}

/**
 * 길이로 정한 반복("Rep last 2 rows ribbing for 2\" [5 cm], ending on a 2nd row", "5cm가 될 때까지 반복")을
 * 단 게이지로 단 수를 계산해 실제 단으로 푼다. 홀수·짝수 단 서술은 괄호 안 표기나 바로 앞 단들에서 가져온다.
 * 뒤에 오는 단 번호는 늘어난 만큼 민다. 한 번 푼 단(ln)은 다시 풀지 않는다.
 */
export function expandLengthRepeats(p: Pattern): void {
  const g = p.gauges.find((x) => x.after || x.before || x.pattern);
  const per10 = g ? (g.after || g.before || g.pattern)!.rows : 0;
  if (!per10) return;
  const LEN = /(?:for|until[^.]*?measures?)\s*(\d+(?:\.\d+)?)\s*(?:"|”|in(?:ches)?\b)\s*(?:\[\s*(\d+(?:\.\d+)?)\s*cm\s*\])?|(\d+(?:\.\d+)?)\s*cm\s*(?:가\s*될\s*때까지|까지|만큼)/i;
  const REP = /rep(?:eat)?\s+(?:the\s+)?last\s+(\d+)\s+rows|(\d+)\s*단\s*(?:을|를)?\s*(?:반복|되풀이)|반복/i;
  for (const s of partNames(p)) {
    const list = partRows(p, s);
    const r = list.find((x) => !x.ln && !x.span && REP.test(x.t) && LEN.test(x.t));
    if (!r) continue;
    const m = r.t.match(LEN)!;
    const cm = m[2] ? +m[2] : m[1] ? +m[1] * 2.54 : +m[3];
    const rm = r.t.match(REP)!;
    const k = Math.max(1, Math.min(4, +(rm[1] || rm[2] || 2)));
    let total = Math.round((cm * per10) / 10);
    // "ending on a 2nd row / WS row"면 짝수 단에서 끝나게, "1st row / RS row"면 홀수
    if (k === 2 && /ending (?:on|with) (?:a |the )?(?:2nd|second|wrong side|ws)\b|안면\s*단?에서\s*끝/i.test(r.t) && total % 2) total++;
    if (k === 2 && /ending (?:on|with) (?:a |the )?(?:1st|first|right side|rs)\b|겉면\s*단?에서\s*끝/i.test(r.t) && total % 2 === 0) total++;
    if (total <= r.n) continue;
    // 반복할 서술: "(홀수 단: … / 짝수 단: …)" > 바로 앞 k단
    const odd = r.t.match(/홀수\s*단\s*[:：]\s*([^/]+?)\s*\/\s*짝수\s*단\s*[:：]\s*([^)]+)\)/);
    const prev = list.filter((x) => x.n < r.n).slice(-k);
    const textFor = (n: number) => {
      if (odd) return (n % 2 ? odd[1] : odd[2]).trim();
      const src = prev.find((x) => (x.n - n) % k === 0);
      return src ? src.t.replace(/^.*?\d+(?:st|nd|rd|th)\s+row\s*:\s*(?:\((?:RS|WS)\)\.?\s*)?/i, "").trim() : r.t;
    };
    const add = total - r.n;
    // 뒤 단 번호 밀기 (진행 기록 키도 같이)
    shiftRows(p, s, r.n, add);
    const note = `${m[0].trim()} → 단 게이지 ${per10}단/10cm로 약 ${total}단까지 (실제 길이를 재서 맞춰요)`;
    const orig = r.t;
    const made: Row[] = [];
    for (let n = r.n; n <= total; n++) made.push({ ...r, n, t: n === total ? `${textFor(n)}\n${orig}` : textFor(n), side: null, st: n === total ? r.st : null, ln: note });
    const at = p.rows.indexOf(r);
    p.rows.splice(at, 1, ...made);
  }
}

/**
 * 파트를 뜨는 데 걸린 시간과 뜬 콧수 (완성 페이스).
 * 시간: 단 완료 시각 사이 간격의 합. 평소 한 단 시간보다 훨씬 긴 간격(4배 넘고 15분 넘음)은 쉰 것으로 보고
 * 평소 한 단 시간만 센다. 첫 단은 누르기 전에 뜬 시간을 모르니 평소 한 단 시간으로.
 * 콧수: 단 끝 콧수(st)가 있으면 그 값, 없으면 앞 단 콧수를 이어 쓰고, 처음엔 기초코 수.
 */
export function partStats(p: Pattern, s: string): { ms: number; rest: number; rows: number; stitches: number | null } {
  const list = partRows(p, s);
  const ts = list.map((r) => p.done[key(s, r.n)]).filter((t): t is number => !!t).sort((a, b) => a - b);
  const gaps = ts.slice(1).map((t, i) => t - ts[i]).filter((d) => d > 0);
  let ms = 0, rest = 0;
  if (workUsed(p) && ts.length) {
    // 시작·중지 버튼을 썼으면 켜 둔 시간만: 첫 단을 시작한 때(앞 파트 마지막 단 이후)부터 마지막 단까지
    const before = Object.values(p.done).filter((t) => t < ts[0]).sort((a, b) => b - a)[0] ?? 0;
    const from = Math.max(before, ts[0] - 6 * 3600000);
    const on = workIn(p, from, ts[ts.length - 1]);
    if (on > 0) return { ms: on, rest: Math.max(0, ts[ts.length - 1] - from - on), rows: countRows(), stitches: countSts() };
  }
  if (gaps.length) {
    const med = [...gaps].sort((a, b) => a - b)[gaps.length >> 1];
    const cap = Math.max(med * 4, 15 * 60000);
    for (const d of gaps) if (d > cap) { ms += med; rest += d - med; } else ms += d;
    ms += med; // 첫 단
  }
  return { ms, rest, rows: countRows(), stitches: countSts() };
  function countRows() { return list.filter((r) => p.done[key(s, r.n)] && !r.castOn).length; }
  function countSts(): number | null {
    let cur = partStitches(list);
    let total = 0, known = true;
    for (const r of list) {
      const m = (r.st || "").match(/\d{1,4}/);
      const st = m ? +m[0] : cur;
      if (m) cur = +m[0];
      if (!p.done[key(s, r.n)] || r.castOn) continue;
      if (st == null) known = false;
      else total += st;
    }
    return known && total ? total : null;
  }
}

/** "1시간 25분" */
export function fmtDur(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60000));
  const hh = Math.floor(m / 60), mm = m % 60;
  return hh ? `${hh}시간${mm ? ` ${mm}분` : ""}` : `${mm}분`;
}

/** 완성 문구: "실제 뜬 시간 1시간 25분 · 쉰 시간까지 3시간 · 시간당 약 620코 페이스 (총 880코 · 8단)" */
export function finishText(p: Pattern, s: string): string | null {
  const st = partStats(p, s);
  if (!st.ms || st.ms < 30000) return null;
  const pace = st.stitches ? Math.round(st.stitches / (st.ms / 3600000)) : null;
  return `실제 뜬 시간 ${fmtDur(st.ms)}` + (st.rest >= 60000 ? ` · 쉰 시간까지 ${fmtDur(st.ms + st.rest)}` : "") + (pace ? ` · 시간당 약 ${pace.toLocaleString()}코 페이스 (총 ${st.stitches!.toLocaleString()}코 · ${st.rows}단)` : ` · ${st.rows}단`);
}

/** 쉬지 않고 뜬 시간: 모든 파트의 단 완료 시각을 거꾸로 따라가며 10분 넘게 빈 곳에서 끊는다 */
export function continuousKnitMs(p: Pattern, now = Date.now(), gap = 10 * 60000): number {
  if (workUsed(p)) {
    // 타이머를 쓰면: 켜 둔 구간들을 거꾸로 이어 붙인다. 구간 사이가 gap(10분) 넘게 비면 쉰 것으로 보고 끊는다
    const spans = [...(p.work!.spans || []), ...(p.work!.on ? [[p.work!.on, now] as [number, number]] : [])].sort((a, b) => b[1] - a[1]);
    if (!spans.length || now - spans[0][1] > gap) return 0;
    let total = 0, start = spans[0][0];
    for (const [a, b] of spans) {
      if (start - b > gap) break;
      total += b - a;
      start = Math.min(start, a);
    }
    return total;
  }
  const ts = Object.values(p.done).filter((t) => t <= now).sort((a, b) => b - a);
  if (!ts.length || now - ts[0] > gap) return 0;
  let start = ts[0];
  for (let i = 1; i < ts.length && start - ts[i] <= gap; i++) start = ts[i];
  return now - start;
}

/* ---------- 뜨개 시작·중지 (켜 둔 시간만 뜬 시간) ---------- */
export function workStart(p: Pattern, now = Date.now()) {
  p.work = p.work || { on: null, spans: [] };
  if (!p.work.on) p.work.on = now;
}
export function workStop(p: Pattern, now = Date.now()) {
  if (!p.work?.on) return;
  if (now - p.work.on >= 5000) p.work.spans.push([p.work.on, now]);
  p.work.on = null;
  if (p.work.spans.length > 500) p.work.spans.splice(0, p.work.spans.length - 500);
}
/** [a, b] 동안 켜 둔 시간 (ms) */
export function workIn(p: Pattern, a: number, b: number, now = Date.now()): number {
  const spans = [...(p.work?.spans || []), ...(p.work?.on ? [[p.work.on, now] as [number, number]] : [])];
  let t = 0;
  for (const [x, y] of spans) t += Math.max(0, Math.min(b, y) - Math.max(a, x));
  return t;
}
export const workUsed = (p: Pattern) => !!(p.work && (p.work.on || p.work.spans.length));

/** 코잡기 단인지 코줍기 단인지 (이름만) */
export const castLabel = (r: Row) => (/줍|주워|pick\s*up/i.test(r.t) ? "코줍기" : "코잡기");

/** 파트 s에서 n보다 뒤 단 번호를 d만큼 민다 (단·완료·묶음 진행·현재 위치 키도 같이) */
export function shiftRows(p: Pattern, s: string, after: number, d: number) {
  for (const x of p.rows) if (x.s === s && x.n > after) x.n += d;
  const move = (o: Record<string, any>) => {
    const ks = Object.keys(o).filter((k) => k.startsWith(s + "#") && +k.split("#").pop()! > after);
    ks.sort((a, b) => (d > 0 ? -1 : 1) * (+a.split("#").pop()! - +b.split("#").pop()!));
    for (const k of ks) { const n = +k.split("#").pop()!; o[key(s, n + d)] = o[k]; delete o[k]; }
  };
  move(p.done); move(p.part);
  if ((p.pos[s] || 0) > after) p.pos[s] += d;
}

/** 원하는 만큼 뜨는 단인가 (길이로 푼 반복, "원하는 길이만큼", "until desired length") */
export const flexibleRow = (r: Row) => !!r.ln || /원하는\s*(?:길이|만큼)|원하는\s*만큼|desired\s+length|as\s+long\s+as\s+(?:you\s+)?(?:like|want)|until\s+(?:piece|work)\s+measures/i.test(r.t);

/** 이 단 뒤에 한 단 더: 두 단 반복이면 앞 단 서술을, 아니면 이 단 서술을 이어 쓴다 */
export function addRowAfter(p: Pattern, s: string, n: number) {
  const list = partRows(p, s);
  const r = list.find((x) => x.n === n);
  if (!r) return;
  const prev = list.find((x) => x.n === n - 1);
  const src = prev && prev.ln && r.ln && prev.t !== r.t.split("\n")[0] ? prev : r;
  shiftRows(p, s, n, 1);
  const nr: Row = { ...r, n: n + 1, t: src.t.split("\n")[0], st: null, side: null, castOn: false, ln: r.ln || "원하는 만큼 뜨는 단 (직접 더함)" };
  p.rows.splice(p.rows.indexOf(r) + 1, 0, nr);
}

/** 이 단 빼기 (뒤 단 번호를 당긴다) */
export function removeRow(p: Pattern, s: string, n: number) {
  const r = partRows(p, s).find((x) => x.n === n);
  if (!r) return;
  p.rows.splice(p.rows.indexOf(r), 1);
  delete p.done[key(s, n)]; delete p.part[key(s, n)];
  shiftRows(p, s, n, -1);
}
