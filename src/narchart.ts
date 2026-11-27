/**
 * 서술로 차트 그리기: 단 서술("겉11, 안2, 2/1 RPC, (겉1, 안1) 3번 반복, k2tog …")을 칸으로 풀어 차트처럼 그린다.
 * 서술을 바꿔서(다이아 한 번 더, 줄임 위치 바꾸기 등) PDF 차트와 달라진 단을 보여 주는 용도.
 * 도안 기호표처럼 겉뜨기 = |, 안뜨기 = 빈칸, 교차뜨기 = 사선, 줄임·늘림 = 글자.
 */
import { splitNarrative } from "./chunks";

export type Cell = { k: "K" | "P" | "X" | "S" | "CO"; label?: string; span?: number; first?: boolean; lc?: boolean; purl?: number };
export type NRow = { label: string; cells: Cell[] | null; ws: boolean; done: boolean; cur: boolean; note?: string; extra?: boolean };

/** 그린 차트 색: PDF 원본(검정)과 헷갈리지 않게 보라 계열 */
const INK = "#5B3FA0", INK2 = "#9B86C9", GRID = "#DCD2F0";

const SKIP = /^(?:마커(?:\s*(?:옮기기|걸기|빼기))?|pm|sm|rm|턴|turn|▸.*)$/i;

function splitTop(s: string): string[] {
  const out: string[] = [];
  let d = 0, cur = "";
  for (const ch of s) {
    if ("[(（【".includes(ch)) d++;
    if ("])）】".includes(ch)) d--;
    if (ch === "," && d === 0) { if (cur.trim()) out.push(cur.trim()); cur = ""; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** 묶음 하나 → 칸들 (뜨고 난 코 기준: k2tog는 1칸, 2/1 LC는 3칸) */
function cellsOfChunk(t0: string): Cell[] | null {
  const t = t0.trim().replace(/\s+—.*$/, "").replace(/\s*\([^()]*\d+\s*코[^()]*\)\s*$/, "");
  if (!t || SKIP.test(t)) return [];
  let m = t.match(/^[\(\[（【](.*)[\)\]）】]\s*(?:을|를)?\s*(\d+)\s*(?:번|회)\s*(?:반복)?$/);
  if (m) { const inner = cellsOf(m[1]); return inner ? Array.from({ length: +m[2] }, () => inner.map((c) => ({ ...c }))).flat() : null; }
  m = t.match(/^(.+?)\s+(\d+)\s*번$/);
  if (m && !/^[겉안]/.test(m[1])) { const one = cellsOfChunk(m[1]); return one ? Array.from({ length: +m[2] }, () => one.map((c) => ({ ...c }))).flat() : null; }
  m = t.match(/^(?:겉|k)\s*(?:뜨기)?\s*(\d*)$/i);
  if (m) return Array.from({ length: m[1] ? +m[1] : 1 }, () => ({ k: "K" as const }));
  m = t.match(/^(?:안|p)\s*(?:뜨기)?\s*(\d*)$/i);
  if (m) return Array.from({ length: m[1] ? +m[1] : 1 }, () => ({ k: "P" as const }));
  m = t.match(/^감아\s*코\s*(\d+)\s*코?$/);
  if (m) return Array.from({ length: +m[1] }, () => ({ k: "CO" as const, label: "+" }));
  // 교차뜨기: a/b LC·RC·LPC·RPC, Ca/bL, a/b kRCtog(모으며 교차 → 칸 수 절반)
  m = t.match(/^(\d)\s*\/\s*(\d)\s*(L|R)(P)?C$/i) || t.match(/^C(\d)\s*\/\s*(\d)\s*(L|R)(P)?$/i);
  if (m) {
    const n = +m[1] + +m[2];
    return Array.from({ length: n }, (_, i) => ({ k: "X" as const, span: n, first: i === 0, lc: /l/i.test(m![3]), purl: m![4] ? +m![2] : 0 }));
  }
  m = t.match(/^(\d)\s*\/\s*(\d)\s*k(R|L)Ctog$/i);
  if (m) { const n = (+m[1] + +m[2]) / 2; return Array.from({ length: n }, (_, i) => ({ k: "X" as const, span: n, first: i === 0, lc: /l/i.test(m![3]) })); }
  m = t.match(/^C(\d)(B|F)(\s*dec)?$/i);
  if (m) { const n = m[3] ? +m[1] / 2 : +m[1]; return Array.from({ length: n }, (_, i) => ({ k: "X" as const, span: n, first: i === 0, lc: /f/i.test(m![2]) })); }
  const sym: [RegExp, string][] = [
    [/^k2tog\s*tbl$/i, "/"], [/^k2togk$/i, "∧∧"], [/^k2tog$/i, "/"], [/^ssk$/i, "\\"], [/^p2tog$/i, "/•"], [/^ssp$/i, "\\•"],
    [/^(?:sk2p|s2kp|cdd)$/i, "Λ"], [/^k3tog$/i, "//"], [/^p3tog$/i, "//•"], [/^(?:ktbl|k1?\s*tbl|겉1?\s*tbl)$/i, "Q"], [/^(?:ptbl|p1?\s*tbl)$/i, "Q•"],
    [/^M1Rp$/i, "Rp"], [/^M1Lp$/i, "Lp"], [/^M1R$/i, "R"], [/^M1L$/i, "L"], [/^M1P$/i, "Mp"], [/^M1$/i, "M"], [/^(?:yo|바늘\s*비우기)$/i, "O"], [/^kfb$/i, "V"],
    [/^(?:sl1?|걸러\s*뜨기)(?:\s*wyif)?$/i, "V"], [/^(?:KDS|PDS|DS)$/i, "DS"],
  ];
  for (const [re, label] of sym) if (re.test(t)) return label === "∧∧" ? [{ k: "S", label: "∧" }, { k: "S", label: "∧" }] : [{ k: "S", label }];
  return null;
}

/** 서술 한 단 → 칸 (뜨는 순서대로). 모르는 묶음이 있으면 null */
export function cellsOf(text0: string, total: number | null = null): Cell[] | null {
  const text = (text0 || "").split("\n").map((l) => l.replace(/\s+—.*$/, "")).join("\n"); // "k2tog 8번 (8코) — 설명" 같은 꼬리 설명은 빼고
  const chunks = /\n/.test(text) || /[가-힣]{4}/.test(text) ? splitNarrative(text, total).chunks : splitTop(text);
  if (!chunks.length) return null;
  const out: Cell[] = [];
  for (const c of chunks) { const v = cellsOfChunk(c); if (!v) return null; out.push(...v); }
  return out.length ? out : null;
}

/**
 * 단들을 차트처럼 그린다 (겉면에서 본 모양, 아래가 먼저 뜬 단).
 * 겉면 단·원통은 오른쪽부터, 안면 단은 왼쪽부터 놓고 겉/안을 바꿔 그린다. 단마다 가운데 맞춤(양쪽 줄임이면 차트 모양 그대로).
 */
export function drawNarrChart(c: HTMLCanvasElement, rows: NRow[], cell: number, dpr = Math.min(2, window.devicePixelRatio || 1)) {
  const W = Math.max(1, ...rows.map((r) => r.cells?.length || 0));
  const lab = 44;
  const wCss = W * cell + lab + 8, hCss = rows.length * cell + 4;
  c.width = Math.round(wCss * dpr); c.height = Math.round(hCss * dpr);
  c.style.width = wCss + "px"; c.style.height = hCss + "px";
  const g = c.getContext("2d")!;
  g.scale(dpr, dpr);
  g.fillStyle = "#fff"; g.fillRect(0, 0, wCss, hCss);
  rows.forEach((r, ri) => {
    const y = hCss - 2 - (ri + 1) * cell; // 아래가 첫 단
    if (r.extra) { g.fillStyle = "rgba(155,134,201,0.13)"; g.fillRect(0, y, W * cell, cell); } // 한 번 더 뜨는 단
    if (r.cur) { g.fillStyle = "rgba(222,141,159,0.25)"; g.fillRect(0, y, W * cell, cell); }
    else if (r.done) { g.fillStyle = "rgba(120,160,200,0.13)"; g.fillRect(0, y, W * cell, cell); }
    const cells = r.cells;
    g.fillStyle = r.cur ? "#B0475E" : r.extra ? INK : "#7a6a5e";
    g.font = `${Math.max(9, cell * 0.55)}px system-ui, sans-serif`;
    g.textBaseline = "middle"; g.textAlign = "left";
    g.fillText(r.label, W * cell + 6, y + cell / 2);
    if (!cells) {
      g.fillStyle = "#9a8b80"; g.textAlign = "center";
      g.fillText(r.note || "서술에 코 지시가 없어요", (W * cell) / 2, y + cell / 2);
      return;
    }
    const n = cells.length, off = Math.floor((W - n) / 2);
    // 칸 자리: 겉면(원통)은 첫 코가 오른쪽 끝
    const xOf = (i: number) => (r.ws ? off + i : off + n - 1 - i) * cell;
    for (let i = 0; i < n; i++) {
      const x = xOf(i), cl = cells[i];
      g.strokeStyle = GRID; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, cell, cell);
      let k = cl.k;
      if (r.ws && (k === "K" || k === "P")) k = k === "K" ? "P" : "K"; // 안면에서 뜬 겉뜨기 = 겉면에서 안뜨기
      g.strokeStyle = INK; g.fillStyle = INK;
      if (k === "K") { g.lineWidth = Math.max(1, cell / 14); g.beginPath(); g.moveTo(x + cell / 2, y + cell * 0.25); g.lineTo(x + cell / 2, y + cell * 0.75); g.stroke(); }
      else if (k === "CO") { g.fillStyle = "#F6D776"; g.fillRect(x + 1, y + 1, cell - 1, cell - 1); g.fillStyle = INK; g.textAlign = "center"; g.fillText("+", x + cell / 2, y + cell / 2); }
      else if (k === "S") { g.textAlign = "center"; g.font = `${Math.max(8, cell * (String(cl.label).length > 1 ? 0.42 : 0.6))}px system-ui, sans-serif`; g.fillText(cl.label || "?", x + cell / 2, y + cell / 2); }
      else if (k === "X" && cl.first) {
        // 교차: 칸 묶음 전체에 사선 두 줄 (앞으로 가는 코를 굵게). 겉면 단에서 첫 코가 오른쪽
        const span = cl.span || 2;
        const xa = r.ws ? x : x - (span - 1) * cell, xb = xa + span * cell;
        g.fillStyle = "#fff"; g.fillRect(xa + 1, y + 1, span * cell - 1, cell - 1);
        g.strokeStyle = GRID; g.strokeRect(xa + 0.5, y + 0.5, span * cell, cell);
        const back = () => { g.lineWidth = Math.max(1, cell / 16); g.strokeStyle = INK2; g.beginPath(); if (cl.lc) { g.moveTo(xa + 3, y + 3); g.lineTo(xb - 3, y + cell - 3); } else { g.moveTo(xa + 3, y + cell - 3); g.lineTo(xb - 3, y + 3); } g.stroke(); };
        const front = () => { g.lineWidth = Math.max(1.5, cell / 9); g.strokeStyle = INK; g.beginPath(); if (cl.lc) { g.moveTo(xa + 3, y + cell - 3); g.lineTo(xb - 3, y + 3); } else { g.moveTo(xa + 3, y + 3); g.lineTo(xb - 3, y + cell - 3); } g.stroke(); };
        back(); front();
        if (cl.purl) { g.lineWidth = 1; g.strokeStyle = INK; const px = cl.lc ? xb - cell * 0.75 : xa + cell * 0.25; g.beginPath(); g.moveTo(px - cell * 0.15, y + cell * 0.72); g.lineTo(px + cell * 0.15, y + cell * 0.72); g.stroke(); }
      }
    }
  });
  return { W, cell, lab };
}
