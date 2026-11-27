/**
 * 서술로 차트 그리기: 단 서술("겉11, 안2, 2/1 RPC, (겉1, 안1) 3번 반복, k2tog …")을 칸으로 풀어 차트처럼 그린다.
 * 서술을 바꿔서(다이아 한 번 더, 줄임 위치 바꾸기 등) PDF 차트와 달라진 단을 보여 주는 용도.
 * 도안 기호표처럼: 겉뜨기 |, 안뜨기 빈칸, 줄임·늘림은 색 상자에 이름, 교차뜨기는 앞 줄은 이어서·뒤 줄은 끊어서(안뜨기 교차는 짧은 밑줄).
 * 원본 PDF 차트와 헷갈리지 않게 보라색으로 그린다.
 */
import { splitNarrative } from "./chunks";

export type Cell = {
  k: "K" | "P" | "X" | "S" | "CO";
  name: string; // 서술의 그 묶음 이름 (누르면 보여 줌): "겉뜨기", "k2tog", "2/1 LPC" …
  label?: string; // 칸 안 글자 (S)
  fill?: string; // 칸 바탕색 (줄임·늘림 상자)
  span?: number; first?: boolean; lc?: boolean; a?: number; b?: number; purl?: boolean; // 교차뜨기
};
export type NRow = { label: string; cells: Cell[] | null; ws: boolean; done: boolean; cur: boolean; note?: string; extra?: boolean };

/** 그린 차트 색: PDF 원본(검정)과 헷갈리지 않게 보라 계열 */
const INK = "#5B3FA0", GRID = "#DCD2F0";

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

/** 줄임·늘림 기호 (도안 기호표 색) */
const SYM: [RegExp, string, string, string][] = [
  // [서술, 칸 글자, 바탕색, 이름]
  [/^k2tog\s*tbl$/i, "K2tb", "#F2C2D8", "2코 한 번에 뒤쪽 실에 찔러 겉뜨기 (K2tog tbl)"],
  [/^k2tog$/i, "K2tog", "#F2C2D8", "왼코 2코 모아 겉뜨기 (K2tog)"],
  [/^ssk$/i, "SSK", "#A9C9EC", "오른코 2코 모아 겉뜨기 (SSK)"],
  [/^p2tog$/i, "P2tog", "#F8DF8E", "왼코 2코 모아 안뜨기 (P2tog)"],
  [/^ssp$/i, "SSP", "#AED79F", "오른코 2코 모아 안뜨기 (SSP)"],
  [/^(?:sk2p|s2kp|cdd)$/i, "CDD", "#D9C9F2", "중심 3코 모아 겉뜨기"],
  [/^k3tog$/i, "K3tog", "#F2C2D8", "왼코 3코 모아 겉뜨기 (K3tog)"],
  [/^p3tog$/i, "P3tog", "#F8DF8E", "3코 모아 안뜨기 (P3tog)"],
  [/^(?:ktbl|k1?\s*tbl|겉1?\s*tbl)$/i, "Ktbl", "", "뒤쪽 실에 겉뜨기 (꼬아뜨기, K tbl)"],
  [/^(?:ptbl|p1?\s*tbl)$/i, "Ptbl", "", "뒤쪽 실에 안뜨기 (P tbl)"],
  [/^M1Rp$/i, "Rp", "#C9C4F0", "오른코 안뜨기 늘림 (M1Rp)"],
  [/^M1Lp$/i, "Lp", "#E7B3CF", "왼코 안뜨기 늘림 (M1Lp)"],
  [/^M1R$/i, "R", "#F7C3EE", "오른코 늘림 (M1R)"],
  [/^M1L$/i, "L", "#C9EFB1", "왼코 늘림 (M1L)"],
  [/^M1P$/i, "M1P", "#E7B3CF", "안뜨기 늘림 (M1P)"],
  [/^M1$/i, "M1", "#F7C3EE", "코 늘림 (M1)"],
  [/^(?:yo|바늘\s*비우기)$/i, "O", "", "바늘 비우기 (YO)"],
  [/^kfb$/i, "Kfb", "#F7C3EE", "겉뜨기 코늘리기 (Kfb)"],
  [/^(?:sl1?|걸러\s*뜨기)(?:\s*wyif)?$/i, "V", "", "걸러뜨기 (sl1)"],
  [/^(?:KDS|PDS|DS)$/i, "DS", "#F3B58E", "더블 스티치 (독일식 경사뜨기)"],
];

/** 묶음 하나 → 칸들 (뜨고 난 코 기준: k2tog는 1칸, 2/1 LC는 3칸) */
function cellsOfChunk(t0: string): Cell[] | null {
  const t = t0.trim().replace(/\s+—.*$/, "").replace(/\s*\([^()]*\d+\s*코[^()]*\)\s*$/, "");
  if (!t || SKIP.test(t)) return [];
  let m = t.match(/^[\(\[（【](.*)[\)\]）】]\s*(?:을|를)?\s*(\d+)\s*(?:번|회)\s*(?:반복)?$/);
  if (m) { const inner = cellsOf(m[1]); return inner ? Array.from({ length: +m[2] }, () => inner.map((c) => ({ ...c }))).flat() : null; }
  m = t.match(/^(.+?)\s+(\d+)\s*번$/);
  if (m && !/^[겉안]/.test(m[1])) { const one = cellsOfChunk(m[1]); return one ? Array.from({ length: +m[2] }, () => one.map((c) => ({ ...c }))).flat() : null; }
  m = t.match(/^(?:겉|k)\s*(?:뜨기)?\s*(\d*)$/i);
  if (m) return Array.from({ length: m[1] ? +m[1] : 1 }, () => ({ k: "K" as const, name: "겉뜨기" }));
  m = t.match(/^(?:안|p)\s*(?:뜨기)?\s*(\d*)$/i);
  if (m) return Array.from({ length: m[1] ? +m[1] : 1 }, () => ({ k: "P" as const, name: "안뜨기" }));
  m = t.match(/^감아\s*코\s*(\d+)\s*코?$/);
  if (m) return Array.from({ length: +m[1] }, () => ({ k: "CO" as const, name: "감아코", label: "+", fill: "#F6D776" }));
  // 교차뜨기: a/b LC·RC·LPC·RPC (앞으로 가는 코 a개), Ca/bL·R
  m = t.match(/^(\d)\s*\/\s*(\d)\s*(L|R)(P)?C$/i) || t.match(/^C(\d)\s*\/\s*(\d)\s*(L|R)(P)?$/i);
  if (m) {
    const a = +m[1], b = +m[2], n = a + b, lc = /l/i.test(m[3]), purl = !!m[4];
    const name = `${a}/${b} ${lc ? "L" : "R"}${purl ? "P" : ""}C — ${lc ? "오른코" : "왼코"} 위 ${a === b ? a + "코" : `${a}코와 ${b}코(${purl ? "안뜨기" : "겉뜨기"})`} 교차뜨기`;
    return Array.from({ length: n }, (_, i) => ({ k: "X" as const, name, span: n, first: i === 0, lc, a, b, purl }));
  }
  // 모으며 교차(2/2 kRCtog: 4코 → 2코), C4B dec
  m = t.match(/^(\d)\s*\/\s*(\d)\s*k(R|L)Ctog$/i);
  if (m) { const n = (+m[1] + +m[2]) / 2, lc = /l/i.test(m[3]); return Array.from({ length: n }, (_, i) => ({ k: "X" as const, name: `${t} — 교차하며 모아뜨기 (${n * 2}코 → ${n}코)`, span: n, first: i === 0, lc, a: n / 2 || 1, b: n / 2 || 1 })); }
  m = t.match(/^C(\d)(B|F)(\s*dec)?$/i);
  if (m) { const n = m[3] ? +m[1] / 2 : +m[1], lc = /f/i.test(m[2]); return Array.from({ length: n }, (_, i) => ({ k: "X" as const, name: t + (m![3] ? ` — 교차하며 모아뜨기 (${+m![1]}코 → ${n}코)` : " 교차뜨기"), span: n, first: i === 0, lc, a: Math.ceil(n / 2), b: Math.floor(n / 2) })); }
  if (/^k2togk$/i.test(t)) return [0, 1].map(() => ({ k: "S" as const, name: "k2togk — 2코 모아 뜨고 빼지 않은 채 첫 코를 다시 겉뜨기 (2코 → 2코)", label: "∧", fill: "" }));
  for (const [re, label, fill, name] of SYM) if (re.test(t)) return [{ k: "S", name, label, fill }];
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

export type NarrHit = { row: number; idx: number; cell: Cell; fromStart: number; x: number; y: number; w: number; h: number } | null;

/**
 * 단들을 차트처럼 그린다 (겉면에서 본 모양, 아래가 먼저 뜬 단).
 * 겉면 단·원통은 오른쪽부터, 안면 단은 왼쪽부터 놓고 겉/안을 바꿔 그린다. 단마다 가운데 맞춤(양쪽 줄임이면 차트 모양 그대로).
 * 돌려주는 hit(x, y)로 누른 칸이 어떤 코인지 찾는다.
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
  const yOf = (ri: number) => hCss - 2 - (ri + 1) * cell; // 아래가 첫 단
  const place = (r: NRow) => { const n = r.cells?.length || 0, off = Math.floor((W - n) / 2); return (i: number) => (r.ws ? off + i : off + n - 1 - i) * cell; };
  const fitText = (s: string, w: number, max: number) => { let fs = max; g.font = `600 ${fs}px system-ui, sans-serif`; while (fs > 6 && g.measureText(s).width > w - 2) { fs -= 0.5; g.font = `600 ${fs}px system-ui, sans-serif`; } };
  rows.forEach((r, ri) => {
    const y = yOf(ri);
    if (r.extra) { g.fillStyle = "rgba(155,134,201,0.13)"; g.fillRect(0, y, W * cell, cell); } // 한 번 더 뜨는 단
    if (r.cur) { g.fillStyle = "rgba(222,141,159,0.25)"; g.fillRect(0, y, W * cell, cell); }
    else if (r.done) { g.fillStyle = "rgba(120,160,200,0.13)"; g.fillRect(0, y, W * cell, cell); }
    g.fillStyle = r.cur ? "#B0475E" : r.extra ? INK : "#7a6a5e";
    g.font = `${Math.max(9, cell * 0.55)}px system-ui, sans-serif`;
    g.textBaseline = "middle"; g.textAlign = "left";
    g.fillText(r.label, W * cell + 6, y + cell / 2);
    const cells = r.cells;
    if (!cells) {
      g.fillStyle = "#9a8b80"; g.textAlign = "center";
      g.fillText(r.note || "서술에 코 지시가 없어요", (W * cell) / 2, y + cell / 2);
      return;
    }
    const xOf = place(r);
    for (let i = 0; i < cells.length; i++) {
      const x = xOf(i), cl = cells[i];
      g.strokeStyle = GRID; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, cell, cell);
      let k = cl.k;
      if (r.ws && (k === "K" || k === "P")) k = k === "K" ? "P" : "K"; // 안면에서 뜬 겉뜨기 = 겉면에서 안뜨기
      g.strokeStyle = INK; g.fillStyle = INK; g.textAlign = "center";
      if (k === "K") { g.lineWidth = Math.max(1, cell / 14); g.beginPath(); g.moveTo(x + cell / 2, y + cell * 0.25); g.lineTo(x + cell / 2, y + cell * 0.75); g.stroke(); }
      else if (k === "S" || k === "CO") {
        if (cl.fill) { g.fillStyle = cl.fill; g.fillRect(x + 1, y + 1, cell - 1, cell - 1); }
        g.fillStyle = INK; fitText(cl.label || "?", cell, cell * 0.5); g.fillText(cl.label || "?", x + cell / 2, y + cell / 2 + 0.5);
      } else if (k === "X" && cl.first) {
        // 교차: 한 상자에 앞으로 가는 코 a줄은 이어서, 뒤로 가는 코 b줄은 가운데를 끊어서 (도안 기호표 모양)
        const span = cl.span || 2, a = cl.a || Math.ceil(span / 2), b = cl.b || span - a;
        const xa = r.ws ? x : x - (span - 1) * cell;
        g.fillStyle = "#fff"; g.fillRect(xa + 1, y + 1, span * cell - 1, cell - 1);
        g.strokeStyle = GRID; g.strokeRect(xa + 0.5, y + 0.5, span * cell, cell);
        const yb = y + cell * 0.8, yt = y + cell * 0.2, sx = (j: number) => xa + (j + 0.5) * cell;
        // LC(앞 코가 왼쪽으로): 아래 오른쪽 → 위 왼쪽 = "\" 모양. RC는 반대
        const front = Array.from({ length: a }, (_, i) => (cl.lc ? [sx(b + i), sx(i)] : [sx(i), sx(b + i)]));
        const back = Array.from({ length: b }, (_, j) => (cl.lc ? [sx(j), sx(a + j)] : [sx(a + j), sx(j)]));
        g.strokeStyle = INK; g.lineCap = "round";
        g.lineWidth = Math.max(1, cell / 13);
        for (const [x0, x1] of back) {
          // 뒤 줄: 가운데(앞 줄과 겹치는 곳)를 비우고 두 토막
          for (const [t0, t1] of [[0, 0.36], [0.64, 1]]) { g.beginPath(); g.moveTo(x0 + (x1 - x0) * t0, yb + (yt - yb) * t0); g.lineTo(x0 + (x1 - x0) * t1, yb + (yt - yb) * t1); g.stroke(); }
          if (cl.purl) { const px = x0 + (x1 - x0) * 0.2; g.beginPath(); g.moveTo(px - cell * 0.18, yb + cell * 0.08); g.lineTo(px + cell * 0.18, yb + cell * 0.08); g.stroke(); } // 안뜨기 교차: 짧은 밑줄
        }
        g.lineWidth = Math.max(1.2, cell / 11);
        for (const [x0, x1] of front) { g.beginPath(); g.moveTo(x0, yb); g.lineTo(x1, yt); g.stroke(); }
        g.lineCap = "butt";
      }
    }
  });
  const hit = (px: number, py: number): NarrHit => {
    const ri = Math.floor((hCss - 2 - py) / cell);
    const r = rows[ri];
    if (!r?.cells) return null;
    const xOf = place(r);
    for (let i = 0; i < r.cells.length; i++) {
      const x = xOf(i);
      if (px >= x && px < x + cell) {
        // 교차는 상자 전체로
        let j = i; while (j > 0 && r.cells[j].k === "X" && !r.cells[j].first && r.cells[j - 1].k === "X") j--;
        const cl = r.cells[j], span = cl.k === "X" ? cl.span || 1 : 1;
        const xs = [j, j + span - 1].map(xOf);
        return { row: ri, idx: j, cell: cl, fromStart: j + 1, x: Math.min(...xs), y: yOf(ri), w: span * cell, h: cell };
      }
    }
    return null;
  };
  return { W, cell, lab, hit };
}
