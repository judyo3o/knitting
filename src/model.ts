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
  for (const s of order) secs[s].odd = inferOdd(sorted.filter((r) => r.s === s));
  return { rows: sorted, secs };
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
  for (const s of partNames(out)) {
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
