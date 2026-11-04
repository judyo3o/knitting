import "./style.css";
import { chunksOf, splitNarrative, stitchesThrough } from "./chunks";
import { MAX_TOKENS } from "./config";
import { callAi, canCallDirect, errCopy } from "./ai";
import { inArtifact } from "./artifact";
import { cellKeyColor, chartBitmap, chartKey, clearBitmaps, splitChartByGap, labelColor, sharpRows, sizeLabelColors, sizeLineRange, drawGrid, drawPdfFull, drawPdfRows, explainStrip, hitCell, legendCanvas, sampleRowColors, yarnHex } from "./chart";
import { getFile, putFile } from "./db";
import { getCell, longestFloat, rowColors } from "./drawing";
import {
  applyDrawing, colorsInText, currentRow, currentTab, directionText, jumpTo, key, lastWorked, partNames, partProgress, partRows, partStitches, spanParts, finishText, etaText, continuousKnitMs, castLabel, flexibleRow, addRowAfter, removeRow, workIn, workStart, workStop, sideOf, stepNext, stepPrev,
} from "./model";
import { blobB64, canvasBlob, renderRegion, textItems } from "./pdf";
import type { Guide } from "./symbolid";
import { chartFor, chartsForSize, chartTitle, chartTitleCount, findCharts, findLegend, LEGEND_RE, partTitleScore, rowH, rowY, sizeRange, stitchAxis, type Chart } from "./pdfgeom";
import { explainCheck, explainDraft, explainHead } from "./prompts";
import { active, commit, exportJson, importJson, load, pdfOf, removePattern, saveNow, setActive, startAutosave, state, syncRemote } from "./store";
import { openSettings, manualHandler, openViewer } from "./dialogs";
import { openUpload } from "./upload";
import { openEditor, type DrawSize } from "./drawui";
import { gaugeSummary, openGauge } from "./gaugeui";
import { $, ask, dialog, download, fmtDay, fmtFull, fmtShort, fmtSmart, fmtTime, h, toast } from "./ui";
import type { Pattern, Row } from "./types";
import { rowText, stitchEdgeX, type RowStitch } from "./symbols";

const app = $("#app");
const view = {
  rowPx: 22,
  full: false,
  legendOpen: true,
  useDrawing: {} as Record<string, boolean>, // 파트별: 그린 배색 보기 (기본: 그린 게 있으면 그것)
  editing: false,
  home: false, // 도안 목록 화면
  sub: null as null | "rows" | "log", // 진행 화면에서 연 단 목록 · 진행 기록 화면
  peek: null as null | { id: string; s: string; n: number }, // 도안만 보기: 진행은 그대로 두고 보는 단
};
try {
  Object.assign(view, JSON.parse(localStorage.getItem("view") || "{}"));
} catch {}
const saveView = () => {
  try {
    localStorage.setItem("view", JSON.stringify({ rowPx: view.rowPx, legendOpen: view.legendOpen, useDrawing: view.useDrawing }));
  } catch {}
};

/* ---------------- 골격 ---------------- */
app.append(
  h("div", { class: "wrap" },
    h("header", { class: "top" },
      h("button", { id: "homeBtn", class: "round-btn", type: "button", "aria-label": "도안 목록", text: "‹" }),
      h("h1", { text: "도안 단수 카운터" }),
      h("div", { class: "top-actions" },
        h("label", { for: "patSel", class: "sr", text: "도안 선택" }),
        h("select", { id: "patSel" }),
        h("button", { id: "addBtn", class: "btn primary", type: "button", text: "+ 도안 올리기" }),
        h("button", { id: "setBtn", class: "btn ghost", type: "button", "aria-label": "AI 연결 설정", text: "⚙ 설정" }),
      ),
    ),
    h("div", { id: "meta", class: "meta" }),
    h("main", { id: "trackView", style: "display:flex;flex-direction:column;gap:14px" }),
  ),
  h("nav", { class: "thumb", id: "thumb", "aria-label": "단 이동" },
    h("div", { class: "thumb-in" },
      h("button", { id: "prevBtn", class: "btn", type: "button", text: "← 이전 단" }),
      h("button", { id: "nextBtn", class: "btn primary", type: "button", text: "다음 단 →" }),
    ),
  ),
);

/* ---------------- 도안 목록 (첫 화면) ---------------- */
const KNIT_V = (c: string, a: number) => `url('data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="12" height="14"><path d="M2.5 2 L6 12 M9.5 2 L6 12" stroke="${c}" stroke-opacity="${a}" stroke-width="3.4" stroke-linecap="round"/></svg>`)}')`;
function swatch(p: Pattern, size: number) {
  const hex = p.colors[0]?.hex || (p.done && Object.keys(p.done).length ? "#F7CDD5" : "#C9D9EC");
  const dark = (() => { const m = hex.match(/^#(..)(..)(..)$/); if (!m) return false; return parseInt(m[1], 16) * 0.3 + parseInt(m[2], 16) * 0.59 + parseInt(m[3], 16) * 0.11 < 120; })();
  return h("div", { class: "swatch", style: { width: size + "px", height: size + "px", backgroundColor: hex, backgroundImage: KNIT_V(dark ? "#FFFFFF" : "#3A2A1E", dark ? 0.18 : 0.3), backgroundSize: `${size / 8}px ${size / 7}px` } });
}
function yarnBar(frac: number, done = false) {
  return h("div", { class: "yarnbar" + (done ? " done" : "") }, h("i", { style: { width: Math.max(4, Math.min(100, frac * 100)) + "%" } }));
}
function patStats(p: Pattern) {
  const names = partNames(p);
  const fin = names.filter((n) => p.fin[n]).length;
  const total = p.rows.length, done = p.rows.filter((r) => p.done[key(r.s, r.n)]).length;
  return { names, fin, total, done, all: names.length > 0 && fin === names.length };
}
function showHome() {
  closePop();
  view.home = true;
  $("#meta").hidden = true;
  $("#thumb").hidden = true;
  document.querySelector(".top")?.setAttribute("hidden", "");
  const root = $("#trackView");
  root.innerHTML = "";
  const list = Object.values(state.patterns).sort((a, b) => (lastWorked(b) || b.updatedAt || 0) - (lastWorked(a) || a.updatedAt || 0));
  const pats = list.length ? list : [active()];
  const cont = pats.find((x) => !x.example && !patStats(x).all) || pats[0];
  const open = (id: string) => { setActive(id); view.home = false; view.full = false; render(); window.scrollTo({ top: 0 }); };
  const head = h("header", { class: "home-head" },
    h("div", { class: "home-title" }, h("h1", { text: "도안 단수 카운터" }), h("div", { class: "dots" }, h("i", { style: { background: "var(--pink)" } }), h("i", { style: { background: "var(--sky)" } }), h("i", { style: { background: "var(--lav-2)" } }))),
    h("button", { class: "round-btn", type: "button", "aria-label": "설정", text: "⚙", on: { click: () => openSettings(() => showHome()) } }));
  root.append(head);
  if (cont) {
    const st = patStats(cont);
    const s = currentTab(cont);
    const r = currentRow(cont, s);
    const pr = partProgress(cont, s);
    root.append(h("section", { class: "home-cont" },
      h("div", { class: "eyebrow", text: "이어서 뜨기" }),
      h("div", { class: "hc-top" }, swatch(cont, 64), h("div", { class: "hc-name" }, h("b", { text: cont.name }), h("span", { text: `${cont.size ? cont.size + " 사이즈 · " : ""}${st.names.length}개 파트 중 ${st.fin}개 완료` }))),
      r ? h("div", { class: "hc-row" }, h("span", { class: "hc-part", text: s }), h("b", { text: `${r.n}단` }), h("span", { class: "hc-frac", text: `${pr.done}/${pr.total}` })) : null,
      yarnBar(pr.total ? pr.done / pr.total : 0),
      h("button", { class: "btn primary big", type: "button", text: "이어서 뜨기 →", on: { click: () => open(cont.id) } }),
      lastWorked(cont) ? h("span", { class: "hc-when", text: "마지막 작업 " + fmtFull(lastWorked(cont)) }) : null));
  }
  const others = pats.filter((x) => x !== cont);
  if (others.length) {
    root.append(h("div", { class: "home-sec", text: "내 도안" }));
    for (const x of others) {
      const st = patStats(x);
      root.append(h("button", { class: "home-item", type: "button", on: { click: () => open(x.id) } },
        swatch(x, 46),
        h("div", { class: "hi-body" },
          h("div", { class: "hi-top" }, h("b", { text: x.name }), st.all ? h("span", { class: "badge fin", text: "완료 ✓" }) : x.example ? h("span", { class: "badge ex", text: "예시" }) : null),
          yarnBar(st.total ? st.done / st.total : 0, st.all),
          h("span", { class: "hi-sub", text: `${st.fin}/${st.names.length} 파트` + (lastWorked(x) ? ` · ${fmtShort(lastWorked(x))}` : "") }))));
    }
  }
  root.append(h("p", { class: "home-foot", text: "진행은 이 기기에만 저장돼요 · 10분마다 백업" }),
    h("div", { class: "home-add" }, h("button", { class: "btn add", type: "button", text: "+ 도안 올리기", on: { click: () => { view.home = false; openUpload({ onDone: render }); } } })));
}

/* ---------------- 렌더 ---------------- */
let renderSeq = 0;

export function render() {
  closePop();
  if (view.home) return showHome();
  $("#meta").hidden = false;
  $("#thumb").hidden = false;
  document.querySelector(".top")?.removeAttribute("hidden");
  const p = active();
  renderSelect(p);
  renderMeta(p);
  const root = $("#trackView");
  root.innerHTML = "";
  if (p.example)
    root.append(h("div", { class: "banner" }, "지금 보이는 건 예시 도안이에요. 위의 ", h("b", { text: "+ 도안 올리기" }), "로 내 도안(사진·PDF·텍스트)을 올리거나 배색 차트를 직접 그려 보세요."));
  if (!p.rows.length) {
    root.append(h("p", { class: "banner", text: "단 정보를 찾지 못했어요. 아래 '페이지 더 읽어서 붙이기'로 다시 읽어보세요." }), dangerZone(p));
    return;
  }
  const s = currentTab(p);
  if (p.tab !== s) p.tab = s;
  const cur = currentRow(p, s)!;
  // 도안만 보기 중이면 그 단을 보여 준다 (진행 위치는 그대로)
  const pk = view.peek && view.peek.id === p.id && view.peek.s === s ? partRows(p, s).find((x) => x.n === view.peek!.n) : null;
  if (!pk || pk === cur) view.peek = null;
  const r = view.peek && pk ? pk : cur;
  if (view.sub) return renderSub(p, s, cur);
  // 진행 화면: 지금 단 카드 + 단 목록 · 진행 기록 화면으로 가는 버튼
  const links = h("div", { class: "sub-links" },
    h("button", { class: "sub-link", type: "button", on: { click: () => { view.sub = "rows"; render(); window.scrollTo({ top: 0 }); } } }, "단 목록", h("span", { text: "›" })),
    h("button", { class: "sub-link", type: "button", on: { click: () => { view.sub = "log"; render(); window.scrollTo({ top: 0 }); } } }, "진행 기록", h("span", { text: "›" })));
  root.append(tabs(p, s), ...(view.peek ? [peekBanner(p, r, cur)] : []), nowCard(p, r), links, tools(p, s));
  const prog = partProgress(p, s);
  const list = partRows(p, s);
  const isLast = list[list.length - 1] === r;
  const pb = $<HTMLButtonElement>("#prevBtn");
  pb.disabled = list[0] === r && (!prog.finished || !!view.peek);
  pb.textContent = view.peek ? "← 이전 단 보기" : "← 이전 단";
  document.body.classList.toggle("peeking", !!view.peek);
  if (view.peek) {
    // 도안만 보기: 앞뒤로 넘겨 보기만 (진행은 바뀌지 않음)
    const nb = $("#nextBtn");
    nb.innerHTML = "";
    const nxv = list[list.indexOf(r) + 1];
    nb.append(h("span", { text: nxv === cur ? `지금 단(${cur.n}단)으로 →` : nxv ? "다음 단 보기 →" : "지금 단으로 돌아가기" }), h("small", { text: `진행은 ${cur.n}단 그대로` }));
    return;
  }
  // 다음 단 버튼 아래에 다음 단 미리보기 (예: "5단 · A 2코, B 3코…")
  const nb = $("#nextBtn");
  nb.innerHTML = "";
  const nx = list[list.indexOf(r) + 1];
  const pv = nx && !prog.finished ? `${nx.n}단 · ${(splitNarrative(nx.t || "").chunks.slice(0, 3).join(", ") || spanParts(nx.t, nx.span).each).slice(0, 28)}…` : "";
  nb.append(h("span", { text: prog.finished ? "다음 파트로 →" : isLast ? "이 파트 완료 ✓" : "다음 단 →" }), pv ? h("small", { text: pv }) : "");
}

function renderSelect(p: Pattern) {
  const sel = $<HTMLSelectElement>("#patSel");
  sel.innerHTML = "";
  const ids = Object.keys(state.patterns).sort((a, b) => (state.patterns[b].updatedAt || 0) - (state.patterns[a].updatedAt || 0));
  if (!ids.length) sel.append(new Option("예시 · 넥워머", "example"));
  for (const id of ids) sel.append(new Option(state.patterns[id].name || "이름 없는 도안", id));
  sel.value = p.id;
}

function renderMeta(p: Pattern) {
  const m = $("#meta");
  m.innerHTML = "";
  const lw = lastWorked(p);
  if (lw) m.append(h("span", { text: "마지막 작업 " + fmtFull(lw) }));
  if (!p.example)
    m.append(
      h("span", { text: state.lastSaved ? `마지막 저장 ${fmtSmart(state.lastSaved)} · 10분마다 자동` : "기기에 바로 저장돼요 · 10분마다 백업" }),
      h("button", { class: "btn ghost", type: "button", text: "지금 저장", on: { click: async () => { await saveNow(); renderMeta(p); toast("저장했어요."); } } }),
    );
}

const refreshWork = (p: Pattern) => document.querySelector(".work")?.replaceWith(workButtons(p));

/** 뜨개 시작·중지: 켜 둔 동안만 뜬 시간으로 센다 (페이스·스트레칭 알림) */
let workTick: number | undefined;
function workButtons(p: Pattern) {
  const on = !!p.work?.on;
  const clock = h("span", { class: "work-clock" });
  const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return workIn(p, d.getTime(), Date.now()); };
  const hms = (ms: number) => { const t = Math.floor(ms / 1000); return `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; };
  // 뜬 시간 아래: 지금 페이스로 이 파트·도안 전체가 언제 끝나는지
  const eta = h("span", { class: "work-eta" });
  let etaAt = 0;
  const tick = () => {
    clock.textContent = on ? `뜨는 중 ${hms(Date.now() - p.work!.on!)} · 오늘 ${hms(today())}` : today() > 0 ? `오늘 뜬 시간 ${hms(today())}` : "";
    if (Date.now() - etaAt > 15000) { etaAt = Date.now(); eta.textContent = etaText(p, currentTab(p)) || ""; }
  };
  clearInterval(workTick);
  tick();
  if (on) workTick = window.setInterval(() => { if (!clock.isConnected) return clearInterval(workTick); tick(); if (Date.now() % 30000 < 1000) stretchReminder(p); }, 1000);
  const b = h("button", { class: "btn " + (on ? "work-on" : "primary"), type: "button", text: on ? "⏸ 중지" : "▶ 시작", "aria-pressed": String(on), on: { click: () => {
    if (on) { workStop(p); toast("중지했어요. 쉰 시간은 페이스에서 빠져요."); }
    else { workStart(p); toast("시작! 켜 둔 동안만 뜬 시간으로 셀게요."); }
    commit(p);
    refreshWork(p);
  } } });
  return h("span", { class: "work" }, b, h("span", { class: "work-txt" }, clock, eta));
}

function tabs(p: Pattern, s: string) {
  const box = h("div", { class: "ptabs", role: "tablist", "aria-label": "파트" });
  for (const name of partNames(p)) {
    const pr = partProgress(p, name);
    const b = h("button", { class: "ptab" + (pr.finished ? " fin" : ""), role: "tab", type: "button", "aria-selected": String(name === s) },
      (pr.finished ? "✓ " : "") + name, h("small", { text: `${pr.done}/${pr.total}` }));
    b.onclick = () => { p.tab = name; view.peek = null; commit(p, false); render(); };
    box.append(b);
  }
  requestAnimationFrame(() => box.querySelector<HTMLElement>("[aria-selected=true]")?.scrollIntoView({ block: "nearest", inline: "center" }));
  return box;
}

function nowCard(p: Pattern, r: Row) {
  const s = r.s;
  const list = partRows(p, s);
  const k = list.indexOf(r);
  const side = sideOf(p, r);
  const round = !!p.secs[s]?.round;
  const fin = !!p.fin[s];
  const card = h("section", { class: "now", "aria-live": "polite" });
  card.append(
    h("div", { class: "now-head" },
      h("div", { class: "chips" },
        h("span", { class: "chip", text: s }),
        r.castOn ? h("span", { class: "chip side", text: `${castLabel(r)} 단` }) : h("span", { class: "chip side", text: round ? "원통 RS" : side === "RS" ? "겉면 RS" : "안면 WS" }),
        r.castOn ? null : h("span", { class: "chip dir", text: directionText(p, r) }),
        fin && h("span", { class: "chip fin", text: "이 파트 완료 ✓" }),
      ),
      h("div", { class: "prog-col" }, h("span", { class: "prog", text: `파트 ${k + 1}/${list.length}` }), p.example ? null : workButtons(p)),
    ),
    h("div", { class: "rowno" }, h("b", { text: String(r.n) }), h("span", { class: "unit", text: "단" }), h("span", { class: "st", text: r.st || "" })),
  );
  // 게이지는 스와치 탭에서만
  const gs = /스와치|swatch|게이지|gauge/i.test(s) ? gaugeSummary(p) : null;
  if (gs) card.append(h("button", { class: "link gauge-line", type: "button", text: gs, on: { click: () => openGauge(p, render, (sz) => openUpload({ appendTo: p.id, resize: sz, onDone: render })) } }));
  const yarnBox = h("div", { class: "yarns" });
  card.append(yarnBox);
  fillYarns(p, r, yarnBox);
  card.append(chartArea(p, r, side, round, yarnBox));
  card.append(narrative(p, r));
  if (r.castOn) {
    const nx = list[k + 1];
    const cl = castLabel(r);
    card.append(h("p", { class: "span-note", text: `${cl} 자체가 1단이에요. ${cl === "코줍기" ? "코를 다 주웠으면" : "코를 잡았으면"} '다음 단'을 누르고 ${nx ? `${nx.n}단(${sideOf(p, nx) === "WS" ? "안면" : "겉면"})` : "다음 단"}부터 떠요.` }));
  }
  if (fin) { const ft = finishText(p, s); if (ft) card.append(h("p", { class: "span-note fin-note", text: `✓ 완성 · ${ft}` })); }
  // 파트 첫 단 바로 앞 단이 다른 파트에 있으면 (예: 몸통 74단 ← '앞, 뒤판 연결' 73단)
  if (k === 0 && r.n > 1) {
    const prevRow = p.rows.find((x) => x.s !== s && x.n === r.n - 1 && (x.ch || p.secs[x.s]?.ch) === chartPage(p, r));
    if (prevRow) card.append(h("p", { class: "span-note" }, `${prevRow.n}단은 '${prevRow.s}' 탭에서 떠요` + (p.done[key(prevRow.s, prevRow.n)] ? " (떴어요 ✓)" : " — 아직 안 떴어요. 먼저 뜨고 오세요."),
      p.done[key(prevRow.s, prevRow.n)] ? null : h("button", { class: "link", type: "button", text: " 그 탭으로", on: { click: () => { p.tab = prevRow.s; commit(p, false); render(); } } })));
  }
  if (r.ln) card.append(h("p", { class: "span-note", text: r.ln }));
  // 원하는 만큼 뜨는 단: 게이지로 정한 단 수는 추정이라 직접 늘리고 줄인다
  if (flexibleRow(r)) card.append(h("div", { class: "actions flex-rows" },
    h("span", { class: "gen", text: "원하는 길이만큼 뜨는 단이에요." }),
    h("button", { class: "btn", type: "button", text: "＋ 한 단 더", on: { click: () => { addRowAfter(p, s, r.n); p.rev++; commit(p); render(); toast(`${r.n + 1}단을 더했어요. 뒤 단 번호도 하나씩 밀렸어요.`); } } }),
    partRows(p, s).length > 1 ? h("button", { class: "btn ghost", type: "button", text: "− 이 단 빼기", on: { click: async () => {
      if (!(await ask("이 단 빼기", `${r.n}단을 빼고 뒤 단 번호를 하나씩 당겨요.`, "빼기"))) return;
      removeRow(p, s, r.n); p.rev++; commit(p); render(); toast(`${r.n}단을 뺐어요.`);
    } } }) : null));
  if (r.span) {
    const sp = spanParts(r.t, r.span);
    const last = r.n === r.span[1];
    card.append(h("p", { class: "span-note", text: `${r.span[0]}~${r.span[1]}단 공통: ${sp.each}` + (sp.end ? (last ? ` · 이 단을 다 뜨면 → ${sp.end}` : ` · (${r.span[1]}단까지 다 뜬 뒤에 → ${sp.end})`) : "") }));
  }
  if (r.x) card.append(h("div", { class: "explain" }, h("small", { text: "차트를 읽어 풀어쓴 내용 · 차트와 꼭 대조해 보세요" }), r.x));
  card.append(rowActions(p, r, side, round));
  const pr = partProgress(p, s);
  card.append(h("div", { class: "bar", "aria-hidden": "true" }, h("i", { style: { width: ((pr.done / Math.max(1, pr.total)) * 100).toFixed(1) + "%" } })));
  return card;
}

/** 배색: 이 단에 쓰는 색 칩 (도안 표기 → 그린 격자 → 차트 띠에서 뽑은 색) */
function fillYarns(p: Pattern, r: Row, box: HTMLElement) {
  box.innerHTML = "";
  const codes = r.co && r.co.length ? r.co : colorsInText(r.t, p.colors);
  for (const code of codes) {
    const i = p.colors.findIndex((y) => y.code === code);
    const y = p.colors[i];
    box.append(h("span", { class: "yarn", title: y?.name || code }, h("i", { style: { background: yarnHex(y, Math.max(0, i)) } }), code + (y?.name ? " " + y.name : "")));
  }
  const d = p.draw[r.s];
  if (d) {
    const f = longestFloat(d, r.n);
    if (f && f.len >= 6) box.append(h("span", { class: "float-warn", text: `긴 플로트 ${f.len}코 (${p.colors[f.color]?.code || "색"}) — 중간에 실 걸기` }));
  }
  if (codes.length) box.prepend(h("span", { class: "gen", text: "이 단 색" }));
}

/* ---------------- 차트 영역 ---------------- */
function chartPage(p: Pattern, r: Row) {
  return r.ch || p.secs[r.s]?.ch || null;
}

function chartArea(p: Pattern, r: Row, side: "RS" | "WS", round: boolean, yarnBox: HTMLElement) {
  const wrap = h("div", { class: "chart-col", style: "display:flex;flex-direction:column;gap:6px" });
  const d = p.draw[r.s];
  const page = chartPage(p, r);
  const useDraw = !!d && (view.useDrawing[r.s] ?? true);
  const seq = ++renderSeq;
  const cv = h("div", { class: "chartview" });
  const box = h("div", { class: "chartbox" });
  const lg = legendPane(p);
  if (lg && !useDraw) box.append(lg);
  box.append(cv);
  const t = h("div", { class: "charttools" },
    h("button", { class: "btn", type: "button", "aria-label": "축소", text: "−", on: { click: () => zoom(-4) } }),
    h("button", { class: "btn", type: "button", "aria-label": "확대", text: "+", on: { click: () => zoom(4) } }),
    h("button", { class: "btn", type: "button", "aria-pressed": String(view.full), text: view.full ? "주변만" : "차트 전체", on: { click: () => { view.full = !view.full; render(); } } }),
    !p.example && h("button", { class: "btn ghost", type: "button", text: "차트 쪽 바꾸기", on: { click: () => chartPicker(p, r) } }),
    h("label", {}, h("input", { type: "checkbox", checked: round, on: { change: (e: Event) => { p.secs[r.s] = { ...p.secs[r.s], round: (e.target as HTMLInputElement).checked }; if (p.draw[r.s]) applyDrawing(p, r.s); commit(p); render(); } } }), "원통뜨기"),
    !!(d && page) && h("button", { class: "btn ghost", type: "button", text: useDraw ? "PDF 차트 보기" : "그린 배색 보기", on: { click: () => { view.useDrawing[r.s] = !useDraw; saveView(); render(); } } }),
    h("button", { class: "btn ghost", type: "button", text: d ? "배색 고치기" : "배색 그리기", on: { click: async () => openEditor(p, r.s, { onSave: () => render(), size: await drawSize(p, r.s).catch(() => null) }) } }),
  );
  wrap.append(box, t);

  if (useDraw && d) {
    const c = h("canvas", { "aria-label": `${r.s} 배색 격자, ${r.n}단 표시` });
    cv.append(c);
    const idx = r.n - d.start;
    const rows: [number, number] = view.full ? [0, d.h - 1] : [Math.max(0, idx - 3), Math.min(d.h - 1, idx + 6)];
    const geom = drawGrid(c, d, p.colors, Math.max(10, view.rowPx), { n: r.n, side, round, rows });
    scrollStart(cv, side === "RS" || round);
    // 칸을 누르면 색 이름 (다시 누르면 닫힘)
    c.addEventListener("click", (e) => {
      const b = c.getBoundingClientRect();
      const hc = hitCell(geom, e.clientX - b.left, e.clientY - b.top);
      if (!hc) return closePop(cv);
      const v = getCell(d, hc.c, hc.r);
      const y = p.colors[v];
      const label = v < 0 ? "빈칸" : `${y?.code || "색" + (v + 1)}${y?.name ? " · " + y.name : ""}`;
      const nTap = hc.r + d.start;
      const rowObj = partRows(p, r.s).find((x) => x.n === nTap) || { ...r, n: nTap, side: null };
      const fromLeft = sideOf(p, rowObj) === "WS" && !round;
      const st = fromLeft ? hc.c + 1 : d.w - hc.c;
      showPop(cv, e.clientX, e.clientY, label, `${nTap}단 · ${fromLeft ? "왼쪽" : "오른쪽"}부터 ${st}번째 코`,
        { x: c.offsetLeft + geom.ox + hc.c * geom.cell, y: c.offsetTop + geom.oy + (geom.rows[1] - hc.r) * geom.ch, w: geom.cell, h: geom.ch }, v >= 0 ? yarnHex(y, v) : null);
    });
    return wrap;
  }
  const noChart = (why: string) => {
    box.remove();
    t.prepend(h("span", { class: "gen", text: why }));
    for (const b of [...t.querySelectorAll("button")].filter((b) => /^[−+]$|차트 전체/.test(b.textContent || ""))) b.remove();
  };
  // 고무단처럼 '차트 상단 가이드 라인을 참고'하는 파트: 차트 위 가이드 줄만 크게
  const showGuide = async (why: string) => {
    const gd = await guideOf(p, r).catch(() => null);
    if (seq !== renderSeq) return;
    if (!gd) return noChart(why);
    const gc = await guideCanvas(p, gd.page, gd.g, Math.max(22, view.rowPx * 1.4));
    if (seq !== renderSeq) return;
    if (!gc) return noChart(why);
    lg?.remove();
    cv.innerHTML = "";
    cv.append(gc);
    box.after(h("span", { class: "gen", text: `차트 p${gd.page} 위 고무단 가이드 라인${p.size ? ` · ${p.size} 사이즈` : ""} · ${gd.g.st.length}코 (옆으로 밀어 보기)` }));
    for (const b of [...t.querySelectorAll("button")].filter((b) => /차트 전체/.test(b.textContent || ""))) b.remove();
    scrollStart(cv, side === "RS" || round);
  };
  if (!page && guidePage(p, r)) {
    cv.append(h("p", { class: "empty", text: "고무단 가이드 라인을 찾는 중…" }));
    showGuide("차트 없음 ·");
    return wrap;
  }
  if (!page) {
    // 차트 없는 파트(코바늘·서술형): 큰 상자 대신 한 줄
    box.remove();
    t.prepend(h("span", { class: "gen", text: "차트 없음 ·" }));
    for (const b of [...t.querySelectorAll("button")].filter((b) => /^[−+]$|차트 전체/.test(b.textContent || ""))) b.remove();
    return wrap;
  }
  cv.append(h("p", { class: "empty", text: "차트를 그리는 중…" }));
  (async () => {
    const pdf = await pdfOf(p);
    if (seq !== renderSeq) return;
    if (!pdf) {
      cv.innerHTML = "";
      cv.append(h("p", { class: "empty", text: "이 기기에 원본 PDF가 없어요. 아래 '이 기기에 PDF 다시 연결'로 골라주세요." }));
      return;
    }
    const bmp = await bmpForSize(p, pdf, page, await chartBitmap(pdf, p.id, page), r.s);
    if (seq !== renderSeq) return;
    // 이 단이 차트에 없으면(고무단처럼 차트 없이 서술로만 뜨는 파트) 그냥 '차트 없음'
    // 가이드 라인 파트(고무단)는 차트 단이 아니라 가이드 줄을 보여 준다 (단 번호가 차트와 겹쳐도 — 소매 고무단 1단 ≠ 소매 차트 1단)
    if (guidePage(p, r)) return showGuide(`차트 없음 (p${page} 차트에 ${r.n}단이 없어요) ·`);
    if (!chartFor(bmp.charts, r.n)) {
      const why = `차트 없음 (p${page} 차트에 ${r.n}단이 없어요) ·`;
      return noChart(why);
    }
    const range = await sizeRangeOf(p, pdf, page, bmp, r.n);
    if (seq !== renderSeq) return;
    cv.innerHTML = "";
    const c = h("canvas", { "aria-label": `차트 p${page}, ${r.n}단 표시` });
    if (view.full) {
      const width = Math.max(cv.clientWidth, 320) * (view.rowPx / 22);
      drawPdfFull(c, bmp, { n: r.n, side, round, rowPx: view.rowPx, range, done: doneOnPage(p, page) }, width);
      cv.append(c);
      symbolTap(p, pdf, page, bmp, cv, c, { x0: 0, yTop: 0, k: width / bmp.w }, range);
    } else {
      const vo = { n: r.n, side, round, rowPx: view.rowPx, range, done: doneOnPage(p, page) };
      const res = drawPdfRows(c, bmp, vo);
      // 먼저 빠르게 그리고, 보이는 단들만 선명하게 다시
      sharpRows(pdf, page, bmp, vo).then((hi) => { if (hi && seq === renderSeq && c.isConnected) drawPdfRows(c, bmp, vo, hi); }).catch(() => {});
      if (!res.chart) {
        cv.append(h("p", { class: "empty", text: `p${page}에서 단 번호 축을 찾지 못했어요. '차트 전체'로 보거나 '차트 쪽 바꾸기'로 다른 쪽을 골라주세요.` }));
        return;
      }
      cv.append(c);
      scrollStart(cv, res.startX === "right", range && res.chart ? ((res.startX === "right" ? range[1] : range[0]) - res.x0) * res.k : null);
      scrollToProgress(p, r, cv, c, res).catch(() => {});
      symbolTap(p, pdf, page, bmp, cv, c, res, range);
      if (range) cv.append(h("div", { class: "size-note", text: `${p.size} 사이즈 범위만 표시 (점선 사이)` }));
    }
    // 배색 차트면 띠에서 실제 색을 뽑아 보여준다
    // 회색·검정(격자선·기호)은 빼고 채도 있는 색만 → 흑백 차트에선 안 보인다
    // 기호표 색칸(SSK 등)을 실 색으로 오해하지 않게: 배색 도안이거나, 두 색 이상이 넉넉히 칠해진 단만
    const cols = sampleRowColors(bmp, r.n).filter((c2) => c2.share > 0.04 && chroma(c2.hex) > 40);
    const colorwork = p.colors.length > 0 || cols.filter((c2) => c2.share > 0.15).length >= 2;
    if (cols.length && colorwork) {
      for (const c2 of cols.slice(0, 5)) yarnBox.append(h("span", { class: "yarn sample", title: "차트에서 뽑은 색" }, h("i", { style: { background: c2.hex } }), Math.round(c2.share * 100) + "%"));
      if (!yarnBox.querySelector(".gen")) yarnBox.prepend(h("span", { class: "gen", text: "차트 색" }));
    }
  })().catch((err) => {
    console.warn("차트 그리기 실패", err);
    cv.innerHTML = "";
    const why = String((err as any)?.message || err || "").slice(0, 120);
    cv.append(h("div", { class: "empty" },
      h("p", { text: "차트를 그리지 못했어요." + (why ? ` (이유: ${why})` : "") }),
      h("button", { class: "btn", type: "button", text: "다시 그리기", on: { click: () => { clearBitmaps(); render(); } } })));
  });
  return wrap;
}

function chroma(hex: string) {
  const v = parseInt(hex.slice(1), 16);
  const r = v >> 16, g = (v >> 8) & 255, b = v & 255;
  return Math.max(r, g, b) - Math.min(r, g, b);
}

/* ---------- 기호를 누르면 기법 이름 ---------- */
type View = { x0: number; yTop: number; k: number };
function symbolTap(p: Pattern, pdf: any, page: number, bmp: any, cv: HTMLElement, c: HTMLCanvasElement, v: View, range: [number, number] | null = null) {
  c.title = "기호를 누르면 기법 이름이 보여요";
  c.addEventListener("click", async (e) => {
    const b = c.getBoundingClientRect();
    const cx = e.clientX - b.left, cy = e.clientY - b.top;
    const open = document.querySelector<HTMLElement>(".sympop");
    if (open && Math.hypot(+open.dataset.x! - cx, +open.dataset.y! - cy) < 10) return closePop(cv); // 같은 자리 다시 누르면 닫기
    const x = v.x0 + cx / v.k, y = v.yTop + cy / v.k;
    const { identify } = await import("./symbolid");
    if (!p.legend || staleLegend(p)) await detectLegend(p);
    const hit = await identify(p, pdf, page, bmp, x, y, range).catch((err) => { console.warn("기호 찾기 실패", err); return null; });
    if (!hit) return closePop(cv);
    // 그 단을 뜨기 시작하는 쪽에서 센다: 겉면(RS)·원통은 오른쪽부터, 안면(WS)은 왼쪽부터
    const rowObj = partRows(p, p.tab).find((x) => x.n === hit.n) || { s: p.tab, n: hit.n, t: "", st: null, side: null, pg: null, ch: null, span: null };
    const fromLeft = sideOf(p, rowObj) === "WS" && !p.secs[p.tab]?.round;
    const cnt = fromLeft ? hit.fromLeft : hit.fromRight;
    const where = `${hit.n}단` + (cnt ? ` · ${fromLeft ? "왼쪽" : "오른쪽"}부터 ${cnt}번째 코` : "");
    const box = hit.rect ? { x: c.offsetLeft + (hit.rect.x0 - v.x0) * v.k, y: c.offsetTop + (hit.rect.y0 - v.yTop) * v.k, w: (hit.rect.x1 - hit.rect.x0) * v.k, h: (hit.rect.y1 - hit.rect.y0) * v.k } : null;
    // 기법 이름을 글자로. 약어(SSK 등)가 이름에 없으면 괄호로 덧붙임
    const abbr = hit.sym && hit.sym.length <= 12 && !hit.name.toLowerCase().includes(hit.sym.toLowerCase()) && !/^[|ㅣ]$/.test(hit.sym) ? ` (${hit.sym})` : "";
    let title = hit.name ? hit.name + abbr : hit.sym || (hit.img ? "" : "기호표에서 찾지 못했어요");
    let where2 = where;
    // 안면 단: 차트는 겉면 그림이라 겉뜨기 기호는 안뜨기로, 안뜨기 기호는 겉뜨기로 뜬다
    if (fromLeft && /^(겉뜨기|안뜨기)$/.test(hit.name.trim())) {
      const real = hit.name.trim() === "겉뜨기" ? "안뜨기" : "겉뜨기";
      where2 = `${where} · 차트 기호는 ${hit.name.trim()}(안면이라 반대로)`;
      title = real;
    }
    // 배색 도안: 칸 색으로 어느 실인지 (그림 기호 추정은 빼고, 글자 기호가 확실하면 같이)
    if (p.colors.length >= 2 && hit.rect) {
      // 차트에 색 KEY가 있으면 그 실제 색으로, 없으면 실 목록의 색으로
      const key = chartKey(bmp, (await textItems(pdf, page)).items);
      const kc = key.length ? cellKeyColor(bmp, hit.rect, key) : null;
      const cy = kc ? { yarn: p.colors.find((x) => x.code === kc) || { code: kc, name: null, hex: null }, white: false } : cellYarn(bmp, hit.rect, p.colors);
      // 그림 기호표가 있는 흑백 차트의 흰 칸은 기호로 (배색 칸은 색이 칠해져 있다)
      const y = cy && (kc || !hit.entry || hit.entry.abbr || !cy.white) ? cy.yarn : null;
      if (y) {
        const sym = !hit.guess && hit.name && !hit.entry?.abbr ? hit.name + abbr : !hit.guess && hit.entry?.abbr ? `${hit.entry.sym} (${hit.entry.name})` : "";
        title = `${y.code}${y.name ? " · " + y.name : ""}`;
        where2 = where + (sym ? ` · 기호: ${sym}` : "");
      }
    }
    // 코잡기 단(예: "코잡기가 1단")의 칸은 기호가 아니라 코잡기
    if (rowObj.castOn) { const cl = castLabel(rowObj as Row); title = cl; where2 = `${hit.n}단 · ${cl === "코줍기" ? "코를 줍는" : "코를 잡는"} 것 자체가 이 단이에요`; }
    showPop(cv, e.clientX, e.clientY, title, where2, box, null, { x: cx, y: cy }, hit.name ? null : hit.img);
    highlightLegend(hit.entry);
  });
}

function closePop(cv?: HTMLElement) {
  document.querySelectorAll(".sympop").forEach((el) => el.remove());
  (cv || document).querySelectorAll(".symbox").forEach((el) => el.remove());
  highlightLegend(null);
}
/** 말풍선은 화면 위에 띄운다 (차트 스크롤 상자에 잘리지 않게), 화면 안으로 맞춤 */
function showPop(cv: HTMLElement, clientX: number, clientY: number, title: string, sub: string, box: { x: number; y: number; w: number; h: number } | null, swatch: string | null, at = { x: clientX, y: clientY }, img: HTMLCanvasElement | null = null) {
  closePop(cv);
  if (box) cv.append(h("div", { class: "symbox", style: { left: box.x + "px", top: box.y + "px", width: box.w + "px", height: box.h + "px" } }));
  const pop = h("div", { class: "sympop", role: "status", "data-x": String(at.x), "data-y": String(at.y) },
    img ? h("img", { class: "symimg", src: img.toDataURL("image/png"), alt: title || "기호표의 이 기호" }) : null,
    title ? h("b", {}, swatch ? h("i", { class: "sw", style: { background: swatch } }) : null, title) : null, h("small", { text: sub }));
  pop.onclick = () => closePop(cv);
  document.body.append(pop);
  const w = pop.offsetWidth, hgt = pop.offsetHeight, vw = window.innerWidth;
  const left = Math.max(8, Math.min(vw - w - 8, clientX - w / 2));
  const below = clientY - hgt - 16 < 8;
  pop.style.left = left + "px";
  pop.style.top = (below ? clientY + 16 : clientY - hgt - 16) + "px";
  pop.classList.toggle("below", below);
  pop.style.setProperty("--tip", Math.max(12, Math.min(w - 12, clientX - left)) + "px");
}
window.addEventListener("scroll", () => document.querySelectorAll(".sympop").length && closePop(), { passive: true });

/** 기호표 그림에서 그 항목을 표시 */
let legendView: { canvas: HTMLCanvasElement; base: ImageData; lg: { x0: number; y0: number; x1: number }; scale: number } | null = null;
function highlightLegend(entry: { area: { x0: number; y0: number; x1: number; y1: number } } | null) {
  const lv = legendView;
  if (!lv || !lv.canvas.isConnected) return;
  const ctx = lv.canvas.getContext("2d")!;
  ctx.putImageData(lv.base, 0, 0);
  if (!entry) return;
  const y0 = (entry.area.y0 - lv.lg.y0) * lv.scale, y1 = (entry.area.y1 - lv.lg.y0) * lv.scale;
  ctx.fillStyle = "rgba(232, 62, 140, 0.18)";
  ctx.fillRect(0, y0, lv.canvas.width, y1 - y0);
  ctx.strokeStyle = "#E83E8C";
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, y0, lv.canvas.width - 3, y1 - y0);
  const pane = lv.canvas.closest(".legend");
  if (pane) {
    const r = lv.canvas.getBoundingClientRect(), pr = pane.getBoundingClientRect();
    const k = r.height / lv.canvas.height;
    pane.scrollTop += r.top - pr.top + y0 * k - pane.clientHeight / 3;
  }
}

/** 차트 칸의 색 → 가장 가까운 실 (칸 안쪽 가운데만 평균, 격자선 빼고) */
function cellYarn(bmp: any, r: { x0: number; x1: number; y0: number; y1: number }, colors: Pattern["colors"]) {
  const S = bmp.scale, w = r.x1 - r.x0, hh = r.y1 - r.y0;
  const x = Math.round((r.x0 + w * 0.3) * S), y = Math.round((r.y0 + hh * 0.3) * S);
  const W = Math.max(1, Math.round(w * 0.4 * S)), H = Math.max(1, Math.round(hh * 0.4 * S));
  const d = bmp.canvas.getContext("2d", { willReadFrequently: true }).getImageData(x, y, W, H).data;
  let R = 0, G = 0, B = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) { R += d[i]; G += d[i + 1]; B += d[i + 2]; n++; }
  if (!n) return null;
  R /= n; G /= n; B /= n;
  const white = R > 238 && G > 238 && B > 238;
  let best: Pattern["colors"][number] | null = null, bd = Infinity;
  colors.forEach((c, i) => {
    const hx = yarnHex(c, i).replace("#", "");
    const cr = parseInt(hx.slice(0, 2), 16), cg = parseInt(hx.slice(2, 4), 16), cb = parseInt(hx.slice(4, 6), 16);
    const dd = (R - cr) ** 2 * 0.3 + (G - cg) ** 2 * 0.59 + (B - cb) ** 2 * 0.11;
    if (dd < bd) { bd = dd; best = c; }
  });
  return best ? { yarn: best as Pattern["colors"][number], white } : null;
}

/** 내 사이즈 차트 범위: 단마다 내 사이즈 색 선을 찾고, 없으면 차트 아래 사이즈 표시 사이 */
async function sizeRangeOf(p: Pattern, pdf: any, page: number, bmp: any, n: number): Promise<[number, number] | null> {
  if (!p.size) return null;
  const c = chartFor(bmp.charts, n);
  if (!c) return null;
  const items = (await textItems(pdf, page)).items;
  const col = labelColor(bmp, items, c, p.size);
  const want = p.size.toUpperCase();
  const others = sizeLabelColors(bmp, items, c).filter((x) => !x.sizes.includes(want) && !x.sizes.includes(want.replace(/^XXL$/, "2XL"))).map((x) => x.rgb);
  const row = col ? sizeLineRange(bmp, c, n, col, others) : null;
  const fixed = sizeRange(items, c, p.size);
  // 사이즈 선은 차트 아래 표시에서 안쪽으로만 들어온다 (모양 내기). 더 넓게 잡혔으면 잘못 찾은 것
  // 사이즈 이름 글자는 선 바로 위가 아니라 조금 비켜 있어서 한 칸까지는 봐준다
  const tol = rowH(c) * 1.1;
  let rr = row;
  // 한쪽에만 선이 있으면(앞판처럼 다른 쪽은 차트 끝) 그 선 하나 + 표시 범위의 반대쪽 끝
  if (rr && rr[1] - rr[0] < rowH(c) * 2) {
    if (!fixed) return null;
    const x = (rr[0] + rr[1]) / 2;
    rr = Math.abs(x - fixed[1]) < Math.abs(x - fixed[0]) ? [fixed[0], x] : [x, fixed[1]];
  }
  if (rr && fixed && (rr[0] < fixed[0] - tol || rr[1] > fixed[1] + tol)) return fixed;
  return rr || fixed;
}

/** 이 차트 쪽을 쓰는 모든 파트에서 실제로 뜬 단 번호 */
function doneOnPage(p: Pattern, page: number): Set<number> {
  const out = new Set<number>();
  for (const r of p.rows) if ((r.ch || p.secs[r.s]?.ch) === page && p.done[key(r.s, r.n)]) out.add(r.n);
  return out;
}

/** 이 파트에 맞는 차트만 남긴 그림 정보: 붙어 있는 두 차트는 나누고, 사이즈·파트 이름이 맞는 차트로 */
async function bmpForSize(p: Pattern, pdf: any, page: number, bmp: any, part = "") {
  const items = (await textItems(pdf, page)).items;
  let charts: Chart[] = [];
  for (const c of bmp.charts) charts.push(...(chartTitleCount(items, c) >= 2 ? splitChartByGap(bmp, c) : [c]));
  if (p.size && charts.length > 1) charts = chartsForSize(items, charts, p.size);
  if (part && charts.length > 1) {
    const sc = charts.map((c) => partTitleScore(part, chartTitle(items, c)));
    const best = Math.max(...sc);
    if (best > 0 && sc.filter((v) => v === best).length < charts.length) charts = charts.filter((_, i) => sc[i] === best);
  }
  return charts.length === bmp.charts.length && charts.every((c, i) => c === bmp.charts[i]) ? bmp : { ...bmp, charts };
}

function scrollStart(cv: HTMLElement, right: boolean, startPx: number | null = null) {
  requestAnimationFrame(() => {
    cv.scrollLeft = startPx != null ? (right ? startPx - cv.clientWidth + 40 : startPx - 40) : right ? cv.scrollWidth : 0;
    const band = cv.scrollHeight;
    if (view.full) cv.scrollTop = band / 2 - cv.clientHeight / 2;
  });
}
function zoom(dx: number) {
  view.rowPx = Math.max(10, Math.min(44, view.rowPx + dx));
  saveView();
  render();
}

function legendPane(p: Pattern) {
  if (p.src !== "pdf") return null;
  if (p.legend && "none" in p.legend) return null;
  const pane = h("div", { class: "legend" + (view.legendOpen ? "" : " closed") });
  const toggle = h("button", { class: "link", type: "button", text: view.legendOpen ? "접기" : "기호표", on: { click: () => { view.legendOpen = !view.legendOpen; saveView(); render(); } } });
  const body = h("div", { class: "lg-body" });
  const big = view.legendOpen ? h("button", { class: "link", type: "button", text: "크게 보기", on: { click: () => openLegendBig(p) } }) : null;
  pane.append(h("div", { class: "lg-head" }, view.legendOpen ? h("span", { text: "기호표" }) : null, h("span", { style: "display:flex;gap:10px" }, big, toggle)), body);
  if (!view.legendOpen) return pane;
  (async () => {
    const pdf = await pdfOf(p);
    if (!pdf) return;
    if (!p.legend || staleLegend(p)) await detectLegend(p);
    if (!p.legend || "none" in p.legend) {
      pane.remove();
      return;
    }
    const c = await legendCanvas(pdf, p.legend, 2);
    c.setAttribute("aria-label", "기호표 (누르면 크게 보기)");
    c.style.cursor = "zoom-in";
    c.addEventListener("click", () => openLegendBig(p));
    body.append(c);
    legendView = { canvas: c, base: c.getContext("2d")!.getImageData(0, 0, c.width, c.height), lg: p.legend, scale: 2 };
  })().catch(() => {});
  return pane;
}

/** 기호표 크게 보기: 화면 가득, 맞추기 ↔ 확대 */
async function openLegendBig(p: Pattern) {
  const pdf = await pdfOf(p);
  if (!pdf || !p.legend || "none" in p.legend) return;
  const lg = p.legend;
  const body = h("div", { class: "viewer-body" }, h("p", { class: "gen", text: "기호표를 크게 그리는 중…" }));
  let zoom = false;
  const zoomB = h("button", { class: "btn", type: "button", text: "확대", "aria-pressed": "false" });
  const closeB = h("button", { class: "btn primary", type: "button", text: "닫기" });
  const v = h("div", { class: "viewer", role: "dialog", "aria-modal": "true", "aria-label": "기호표 크게 보기" },
    h("div", { class: "viewer-bar" }, h("b", { text: "기호표", style: "align-self:center" }), h("div", { class: "actions" }, zoomB, closeB)), body);
  const close = () => { v.remove(); document.body.style.overflow = ""; document.removeEventListener("keydown", onKey); };
  const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
  closeB.onclick = close;
  zoomB.onclick = () => { zoom = !zoom; body.classList.toggle("zoom", zoom); zoomB.textContent = zoom ? "맞추기" : "확대"; zoomB.setAttribute("aria-pressed", String(zoom)); };
  document.addEventListener("keydown", onKey);
  document.body.append(v);
  document.body.style.overflow = "hidden";
  closeB.focus();
  // 화면 폭의 두 배 해상도로 (확대해도 선명하게), 휴대폰 그림 크기 제한은 legendCanvas가 지킨다
  const scale = Math.max(3, Math.min(8, (Math.max(window.innerWidth, 600) * 2) / Math.max(40, lg.x1 - lg.x0)));
  const c = await legendCanvas(pdf, lg, scale).catch(() => null);
  body.innerHTML = "";
  if (!c) return void body.append(h("p", { class: "empty", text: "기호표를 그리지 못했어요." }));
  c.setAttribute("aria-label", "기호표");
  body.append(c);
}

/** 기호표 자동 찾기 규칙 버전: 올리면 예전에 자동으로 찾은 범위를 다시 찾는다 */
const LEGEND_V = 2;
const staleLegend = (p: Pattern) => !!p.legend && "page" in p.legend && p.legend.auto && (p.legend.v || 1) < LEGEND_V;

async function detectLegend(p: Pattern) {
  const pdf = await pdfOf(p);
  if (!pdf) return;
  const { textItems } = await import("./pdf");
  for (let n = 1; n <= Math.min(14, pdf.numPages); n++) {
    const t = await textItems(pdf, n);
    if (!t.items.some((i) => LEGEND_RE.test(i.str))) continue;
    const lg = findLegend(t.items);
    if (lg) {
      p.legend = { page: n, ...lg, auto: true, v: LEGEND_V };
      commit(p, false);
      return;
    }
  }
  p.legend = { none: true };
  commit(p, false);
}

function chartPicker(p: Pattern, r: Row) {
  const chIn = h("input", { type: "number", min: 1, inputmode: "numeric", value: String(chartPage(p, r) || "") });
  const lgInit = p.legend && "page" in p.legend ? String(p.legend.page) : "";
  const lgIn = h("input", { type: "number", min: 1, inputmode: "numeric", value: lgInit });
  const dl = dialog(`${r.s} 차트 쪽`, [
    h("label", { class: "field" }, "이 파트 차트 PDF 쪽", chIn, h("small", { text: "비우면 차트 없이 서술만 보여요." })),
    h("label", { class: "field" }, "기호표 PDF 쪽", lgIn, h("small", { text: "그 쪽 전체를 기호표로 써요. 비우면 기호표를 숨겨요." })),
    h("div", { class: "actions" },
      h("button", { class: "btn primary", type: "button", text: "저장", on: { click: async () => {
        const ch = parseInt(chIn.value, 10) || null;
        p.secs[r.s] = { ...p.secs[r.s], ch };
        for (const x of partRows(p, r.s)) x.ch = ch;
        const lp = parseInt(lgIn.value, 10);
        const curLg = p.legend && "page" in p.legend ? p.legend.page : null;
        if (lgIn.value === lgInit || lp === curLg) {
          // 기호표 쪽을 안 바꿨으면 자동으로 찾은 영역 그대로
        } else if (lp) {
          const pdf = await pdfOf(p);
          const { pageSize } = await import("./pdf");
          const sz = pdf ? await pageSize(pdf, lp) : { w: 595, h: 842 };
          // 그 쪽에서 기호표 제목을 찾으면 그 영역, 없으면 쪽 전체
          const t = pdf ? await (await import("./pdf")).textItems(pdf, lp) : null;
          const box = t ? findLegend(t.items) : null;
          p.legend = box ? { page: lp, ...box, auto: true } : { page: lp, x0: 0, y0: 0, x1: sz.w, y1: sz.h };
        } else p.legend = { none: true };
        commit(p); dl.close(); render();
      } } }),
      h("button", { class: "btn ghost", type: "button", text: "기호표 자동 찾기", on: { click: async () => { p.legend = undefined; await detectLegend(p); dl.close(); render(); } } }),
      h("button", { class: "btn ghost", type: "button", text: "취소", on: { click: () => dl.close() } }),
    ),
  ]);
}

/* ---------------- 서술 (묶음 단위 진행) ---------------- */
function narrative(p: Pattern, r: Row) {
  const k = key(r.s, r.n);
  const chunks = splitNarrative(r.t || "").chunks;
  const wrap = h("div", { style: "display:flex;flex-direction:column;gap:6px" });
  if (r.auto) wrap.append(h("span", { class: "gen", text: "그린 배색에서 만든 서술 · " + (sideOf(p, r) === "RS" || p.secs[r.s]?.round ? "오른쪽부터 읽음" : "왼쪽부터 읽음") }));
  if (view.editing) {
    const ta = h("textarea", { rows: 4, "aria-label": "이 단 서술 수정", value: r.t || "" });
    wrap.append(ta, h("div", { class: "actions" },
      h("button", { class: "btn primary", type: "button", text: "저장", on: { click: () => {
        r.t = ta.value.trim(); r.span = null; r.auto = false; delete p.part[k];
        p.rev++; commit(p); view.editing = false; render(); toast("이 단 서술을 고쳤어요.");
      } } }),
      h("button", { class: "btn", type: "button", text: "취소", on: { click: () => { view.editing = false; render(); } } })));
    setTimeout(() => ta.focus());
    return wrap;
  }
  // 고무단 가이드 라인을 참고하라는 단: 차트 위 가이드 줄을 기기에서 읽어 내 사이즈 콧수까지
  if (guidePage(p, r)) {
    const nar = splitNarrative(r.t || "");
    const body = h("div", { style: "display:flex;flex-direction:column;gap:6px" });
    const plain = () => {
      body.innerHTML = "";
      for (const n of nar.notes) body.append(h("p", { class: "instr note", text: n }));
      if (nar.chunks.length) body.append(chunkBox(p, r, nar.chunks));
      else if (!nar.notes.length) body.append(h("p", { class: "instr", text: "(서술 없음)" }));
    };
    body.append(h("div", { class: "gen", text: "차트 위 고무단 가이드 라인을 읽는 중…" }));
    wrap.append(body);
    guideOf(p, r).then((gd) => {
      if (!body.isConnected) return;
      if (!gd) return plain();
      const ws = sideOf(p, r) === "WS" && !p.secs[r.s]?.round;
      body.innerHTML = "";
      for (const n of nar.notes) body.append(h("p", { class: "instr note", text: n }));
      if (nar.chunks.length) body.append(h("p", { class: "gen", text: "도안 원문: " + nar.chunks.join(", ").slice(0, 90) }));
      body.append(
        chunkBox(p, r, chunksOf(rowText(gd.g.st, ws))),
        h("span", { class: "gen", text: `차트 p${gd.page} 위 가이드 라인에서 ${p.size ? p.size + " 사이즈 " : ""}${gd.g.st.length}코를 읽었어요${ws ? " (안면이라 겉·안을 바꿔 적음)" : ""}.` }),
      );
    }).catch(() => body.isConnected && plain());
    return wrap;
  }
  // 서술 없이 '차트를 따라 진행'뿐인 단: 기기에서 차트를 읽어 그 단의 서술을 만들어 보여 준다
  if (wantsChartText(p, r)) {
    if (r.t) wrap.append(h("p", { class: "gen", text: "도안 원문: " + (r.span ? spanParts(r.t, r.span).each : r.t.split("\n")[0]).slice(0, 80) }));
    const slot = h("div", { class: "gen", text: "차트에서 이 단을 읽는 중…" });
    wrap.append(slot);
    chartRowText(p, r).then((txt) => {
      if (!slot.isConnected) return;
      if (!txt) { slot.textContent = "차트에서 이 단을 읽지 못했어요. '이 단 차트를 글로 풀기'를 써 보세요."; if (chunks.length) slot.after(chunkBox(p, r, chunks)); return; }
      slot.replaceWith(
        chunkBox(p, r, chunksOf(txt)),
        h("span", { class: "gen", text: "기기가 차트 그림을 읽은 거라 교차뜨기 방향(LC/RC)은 차트와 한 번 대조해 주세요." }),
        h("div", { class: "actions" }, h("button", { class: "btn ghost", type: "button", text: "이 서술을 이 단에 저장", on: { click: () => {
          r.t = withEnd(r, txt); r.span = null; p.rev++; commit(p); render(); toast("이 단 서술로 저장했어요.");
        } } }), saveAllBtn(p, r.s)),
      );
    }).catch(() => { slot.textContent = "차트에서 이 단을 읽지 못했어요."; });
    return wrap;
  }
  // 안내 문장은 위에 따로, 코 지시만 묶음으로
  const nar = splitNarrative(r.t || "");
  for (const n of nar.notes) wrap.append(h("p", { class: "instr note", text: n }));
  if (!nar.chunks.length) {
    if (!nar.notes.length) wrap.append(h("p", { class: "instr", text: "(서술 없음)" }));
    return wrap;
  }
  wrap.append(chunkBox(p, r, nar.chunks));
  cableCheck(p, r, wrap);
  return wrap;
}

/** 서술의 교차뜨기 순서 ("2/1 LPC" …) */
const cablesIn = (t: string) => (t.match(/\b\d\s*\/\s*\d\s*[A-Z]{2,4}\b/g) || []).map((x) => x.replace(/\s+/g, "").replace(/(\d\/\d)/, "$1 "));
/**
 * 저장된 서술의 교차뜨기가 지금 차트에서 읽은 것과 다르면 알려 주고 바꿀 수 있게
 * (예전 버전이 RPC를 RC로 잘못 읽어 저장한 단 등)
 */
function cableCheck(p: Pattern, r: Row, wrap: HTMLElement) {
  if (!chartPage(p, r) || p.src !== "pdf" || r.castOn || r.auto || (p.draw[r.s] && (view.useDrawing[r.s] ?? true))) return;
  const mine = cablesIn(r.t || "");
  if (!mine.length) return;
  chartRowText(p, r).then((txt) => {
    if (!txt || !wrap.isConnected) return;
    const read = cablesIn(txt);
    if (!read.length || read.join("|") === mine.join("|")) return;
    const diff = mine.length === read.length ? mine.map((m, i) => (m !== read[i] ? `${m} → ${read[i]}` : "")).filter(Boolean).join(", ") : `${mine.join(", ")} → ${read.join(", ")}`;
    wrap.append(h("div", { class: "cable-diff" },
      h("span", { class: "gen", text: `차트를 다시 읽어 보니 교차뜨기가 달라요: ${diff}` }),
      h("div", { class: "actions" }, h("button", { class: "btn ghost", type: "button", text: "차트대로 바꾸기", on: { click: () => {
        r.t = withEnd(r, txt); r.span = null; p.rev++; commit(p); render(); toast("차트에서 다시 읽은 서술로 바꿨어요.");
      } } }))));
  }).catch(() => {});
}

/** 배색 격자 크기를 도안에서: 콧수는 차트 코 번호 축 > 기초코·단 끝 콧수, 단수는 파트의 단 범위(차트 단 번호까지) */
async function drawSize(p: Pattern, s: string): Promise<DrawSize | null> {
  const rows = partRows(p, s);
  if (!rows.length) return null;
  const n0 = rows[0].n;
  let n1 = rows[rows.length - 1].n;
  let w: number | null = null, why = "";
  const page = p.secs[s]?.ch || rows.find((x) => x.ch)?.ch || null;
  if (page && p.src === "pdf") {
    const pdf = await pdfOf(p);
    if (pdf) {
      const t = await textItems(pdf, page);
      const charts = findCharts(t.items, t.w);
      const c = chartFor(charts, n1) || charts[0];
      const ax = c ? stitchAxis(t.items, c) : null;
      if (ax) { w = ax.max; why = `차트 p${page}의 코 번호`; }
      if (c && c.nMax > n1 && c.nMin <= n0 + 1) n1 = c.nMax;
    }
  }
  if (!w) { w = partStitches(rows); if (w) why = "도안 서술의 콧수"; }
  if (!w || w > 400) return null;
  return { w, h: Math.min(400, n1 - n0 + 1), start: n0, why };
}

/** 서술 묶음 버튼 (누른 묶음까지 뜬 것으로 저장) + 진행 정보 */
function chunkBox(p: Pattern, r: Row, chunks: string[]) {
  const k = key(r.s, r.n);
  const wrap = h("div", { style: "display:flex;flex-direction:column;gap:6px" });
  const prog = p.part[k] && p.part[k].i < chunks.length ? p.part[k] : undefined;
  const at = prog ? prog.i : -1;
  const box = h("div", { class: "chunks", role: "list" });
  chunks.forEach((c, i) => {
    const codes = colorsInText(c, p.colors);
    const dot = codes.length ? h("span", { class: "dot", style: { background: yarnHex(p.colors.find((y) => y.code === codes[0]), p.colors.findIndex((y) => y.code === codes[0])) } }) : null;
    const b = h("button", { class: "chunk" + (i <= at ? " done" : "") + (i === at ? " last" : ""), type: "button", role: "listitem", "aria-pressed": String(i <= at) }, dot, c);
    b.onclick = () => {
      if (p.part[k] && p.part[k].i === i) {
        if (i === 0) delete p.part[k];
        else p.part[k] = { i: i - 1, t: Date.now() };
      } else p.part[k] = { i, t: Date.now() };
      commit(p);
      render();
    };
    box.append(b);
  });
  wrap.append(box);
  if (prog) {
    const st = stitchesThrough(chunks, prog.i);
    wrap.append(h("span", { class: "chunk-meta", text: `${prog.i + 1}/${chunks.length} 묶음` + (st != null ? ` · 왼바늘에서 약 ${st}코 뜸` : "") + ` · ${fmtTime(prog.t)}` }));
  } else if (chunks.length > 1) wrap.append(h("span", { class: "gen", text: "뜬 묶음을 누르면 그 자리까지 저장돼요." }));
  return wrap;
}

/** 차트로 읽은 서술로 바꿀 때, 공통 지시의 마지막 단이면 '다 뜬 뒤 할 일'은 남긴다 */
function withEnd(r: Row, txt: string) {
  if (!r.span || r.n !== r.span[1]) return txt;
  const end = spanParts(r.t, r.span).end;
  return end ? `${txt}\n${end}` : txt;
}

/** 이 파트에서 서술 없이 차트만 따르는 단을 모두 차트로 읽어 서술로 저장 */
function saveAllBtn(p: Pattern, s: string) {
  const todo = () => partRows(p, s).filter((x) => wantsChartText(p, x));
  const n = todo().length;
  if (n < 2) return null;
  const b = h("button", { class: "btn ghost", type: "button", text: `서술 없는 단 모두 저장 (${n}단)` });
  b.onclick = async () => {
    if (!(await ask("서술 없는 단 모두 저장", `${s}에서 서술 없이 차트만 따르는 ${n}단을 기기에서 차트로 읽어 그 단 서술로 저장해요. 교차 방향은 나중에 차트와 대조해 주세요.`, "저장"))) return;
    b.disabled = true;
    const list = todo();
    let ok = 0;
    for (let i = 0; i < list.length; i++) {
      b.textContent = `읽는 중… ${i + 1}/${list.length}`;
      const txt = await chartRowText(p, list[i]).catch(() => null);
      if (txt) { list[i].t = withEnd(list[i], txt); list[i].span = null; ok++; }
    }
    p.rev++;
    commit(p);
    render();
    toast(`${ok}단을 저장했어요${ok < list.length ? ` (${list.length - ok}단은 읽지 못해 그대로)` : ""}.`, 4000);
  };
  return b;
}

/** 단 서술에 코 지시(겉2, 안3, LC…)가 없고 차트만 가리키나 */
const STITCH_INSTR = /(?:겉|안)\s*\d|겉뜨기\s*\d|안뜨기\s*\d|\b[kp]\d|\b(?:LC|RC|LPC|RPC|k2tog|ssk|p2tog|DS|KDS|PDS|M1[LR]?)\b/i;
function wantsChartText(p: Pattern, r: Row) {
  const page = chartPage(p, r);
  return !!page && p.src === "pdf" && !r.castOn && !r.auto && !(p.draw[r.s] && (view.useDrawing[r.s] ?? true)) && !STITCH_INSTR.test(r.t || "");
}
const chartTextCache = new Map<string, Promise<string | null>>();
/** 이 단 차트를 기기에서 읽은 칸들 (위치 포함, 같은 단은 다시 읽지 않음) */
const rowStitchCache = new Map<string, Promise<RowStitch[] | null>>();
function chartRowStitches(p: Pattern, r: Row): Promise<RowStitch[] | null> {
  const page = chartPage(p, r)!;
  const ws = sideOf(p, r) === "WS" && !p.secs[r.s]?.round;
  const lg = p.legend && "page" in p.legend ? [p.legend.page, p.legend.x0, p.legend.y0].join(",") : "";
  const ck = [p.id, page, r.n, ws, lg, p.size].join(":");
  let c = rowStitchCache.get(ck);
  if (!c) {
    if (rowStitchCache.size > 40) rowStitchCache.clear();
    c = (async () => {
      const pdf = await pdfOf(p);
      if (!pdf) return null;
      if (!p.legend || staleLegend(p)) await detectLegend(p);
      const bmp = await bmpForSize(p, pdf, page, await chartBitmap(pdf, p.id, page), r.s);
      const { readRow } = await import("./symbolid");
      const key = p.colors.length >= 2 ? chartKey(bmp, (await textItems(pdf, page)).items) : [];
      return readRow(p, pdf, page, bmp, r.n, ws, await sizeRangeOf(p, pdf, page, bmp, r.n), key);
    })();
    rowStitchCache.set(ck, c);
    c.catch(() => rowStitchCache.delete(ck));
  }
  return c;
}
async function chartRowText(p: Pattern, r: Row): Promise<string | null> {
  const st = await chartRowStitches(p, r);
  const ws = sideOf(p, r) === "WS" && !p.secs[r.s]?.round;
  return st && st.length ? rowText(st, ws) : null;
}

/* ---------------- 고무단 가이드 라인 (차트 위 따로 그린 한 줄) ---------------- */
const GUIDE_RE = /가이드\s*라인|가이드\s*선|guide\s*line/i;
/** 이 파트가 '차트 상단 고무단 가이드 라인을 참고'하라는 파트면, 가이드가 있는 차트 쪽 */
function guidePage(p: Pattern, r: Row): number | null {
  if (p.src !== "pdf" || r.castOn) return null;
  if (!GUIDE_RE.test(r.t || "") && !partRows(p, r.s).some((x) => GUIDE_RE.test(x.t || ""))) return null;
  const own = chartPage(p, r);
  if (own) return own;
  // 쪽이 없으면 같은 이름(고무단 앞)의 파트 차트 → 바로 앞 파트 차트
  const names = Object.keys(p.secs);
  const base = r.s.replace(/고무단|ribbing|rib|밴드|\s+/gi, "");
  const same = names.find((n) => n !== r.s && base && n.replace(/\s+/g, "").includes(base) && p.secs[n]?.ch);
  if (same) return p.secs[same].ch!;
  const order = [...new Set(p.rows.map((x) => x.s))];
  for (let i = order.indexOf(r.s) - 1; i >= 0; i--) {
    const ch = p.secs[order[i]]?.ch || p.rows.find((x) => x.s === order[i] && x.ch)?.ch;
    if (ch) return ch;
  }
  return null;
}
const guideCache = new Map<string, Promise<{ page: number; g: Guide } | null>>();
function guideOf(p: Pattern, r: Row): Promise<{ page: number; g: Guide } | null> {
  const page = guidePage(p, r);
  if (!page) return Promise.resolve(null);
  const ws = sideOf(p, r) === "WS" && !p.secs[r.s]?.round;
  const ck = [p.id, page, r.s, ws, p.size].join(":");
  let c = guideCache.get(ck);
  if (!c) {
    c = (async () => {
      const pdf = await pdfOf(p);
      if (!pdf) return null;
      const bmp = await bmpForSize(p, pdf, page, await chartBitmap(pdf, p.id, page), r.s);
      if (!bmp.charts.length) return null;
      const topC = [...bmp.charts].sort((a: Chart, b: Chart) => rowY(a, a.nMax) - rowY(b, b.nMax))[0];
      const range = await sizeRangeOf(p, pdf, page, bmp, topC.nMax);
      const { readGuide } = await import("./symbolid");
      const g = await readGuide(pdf, page, bmp, range, ws);
      return g ? { page, g } : null;
    })();
    guideCache.set(ck, c);
    c.catch(() => guideCache.delete(ck));
  }
  return c;
}
/** 가이드 라인 띠 그림 (내 사이즈 부분만, 위아래 조금 여유) */
async function guideCanvas(p: Pattern, page: number, g: Guide, rowPx: number): Promise<HTMLCanvasElement | null> {
  const pdf = await pdfOf(p);
  if (!pdf) return null;
  const hh = g.y1 - g.y0, pad = hh * 0.6;
  const sc = Math.max(2, (rowPx / hh) * (window.devicePixelRatio || 1));
  const src = await renderRegion(pdf, page, sc, g.y0 - pad, g.y1 + pad);
  const k = src.height / (hh + 2 * pad);
  const x0 = Math.max(0, (g.x0 - pad) * k), x1 = Math.min(src.width, (g.x1 + pad) * k);
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(x1 - x0));
  out.height = src.height;
  out.getContext("2d")!.drawImage(src, x0, 0, out.width, out.height, 0, 0, out.width, out.height);
  const css = (rowPx * (hh + 2 * pad)) / hh;
  out.style.height = css + "px";
  out.style.width = (out.width / out.height) * css + "px";
  out.style.maxWidth = "none";
  return out;
}

/** 묶음 진행을 저장했으면 차트를 그 코 자리로 스크롤하고 세로 표시 */
async function scrollToProgress(p: Pattern, r: Row, cv: HTMLElement, c: HTMLCanvasElement, res: { chart: any; x0: number; yTop: number; k: number }) {
  const prog = p.part[key(r.s, r.n)];
  if (!prog || !res.chart) return;
  const chunks = wantsChartText(p, r) ? chunksOf((await chartRowText(p, r)) || "") : splitNarrative(r.t || "").chunks;
  const count = stitchesThrough(chunks, prog.i);
  if (!count) return;
  const st = await chartRowStitches(p, r);
  if (!st || !c.isConnected) return;
  const ws = sideOf(p, r) === "WS" && !p.secs[r.s]?.round;
  const x = stitchEdgeX(st, count, ws);
  if (x == null) return;
  const hh = rowH(res.chart);
  const xPx = (x - res.x0) * res.k, top = (rowY(res.chart, r.n) - hh / 2 - res.yTop) * res.k;
  cv.querySelector(".prog-mark")?.remove();
  cv.append(h("div", { class: "prog-mark", title: `${count}코 뜸`, style: { left: c.offsetLeft + xPx - 1.5 + "px", top: c.offsetTop + top - 4 + "px", height: hh * res.k + 8 + "px" } }, h("span", { text: `${count}코` })));
  requestAnimationFrame(() => cv.scrollTo({ left: c.offsetLeft + xPx - cv.clientWidth / 2, behavior: "smooth" }));
}

function rowActions(p: Pattern, r: Row, side: "RS" | "WS", round: boolean) {
  const page = chartPage(p, r);
  const box = h("div", { class: "row-actions" });
  if (page && p.src === "pdf" && !(p.draw[r.s] && (view.useDrawing[r.s] ?? true))) {
    const b = h("button", { class: "btn", type: "button", text: "이 단 차트를 글로 풀기" });
    b.onclick = () => explainRow(p, r, side, round, b);
    box.append(b);
  }
  if (r.pg && p.src && p.src !== "text") box.append(h("button", { class: "btn ghost", type: "button", text: p.src === "pdf" ? `원본 p${r.pg} 보기` : `원본 사진 ${r.pg} 보기`, on: { click: () => openViewer(p, r.pg!, { n: r.n, span: r.span }) } }));
  if (page && p.src === "pdf") box.append(h("button", { class: "btn ghost", type: "button", text: `차트 p${page} 원본`, on: { click: () => openViewer(p, page) } }));
  if (inArtifact && state.ai.provider === "artifact") box.append(h("button", { class: "btn", type: "button", text: "이 단 물어보기", on: { click: async () => (await import("./chat")).openChat(p, r) } }));
  box.append(h("button", { class: "btn ghost", type: "button", text: "이 단 서술 수정", on: { click: () => { view.editing = true; render(); } } }));
  return box;
}

async function explainRow(p: Pattern, r: Row, side: "RS" | "WS", round: boolean, btn: HTMLButtonElement) {
  const page = chartPage(p, r)!;
  btn.disabled = true;
  btn.textContent = "차트 읽는 중…";
  try {
    const pdf = await pdfOf(p);
    if (!pdf) throw Object.assign(new Error(), { code: "nopdf" });
    const strip = await explainStrip(pdf, page, r.n);
    if (!strip) {
      toast("이 쪽에서 단 위치를 찾지 못했어요.");
      return;
    }
    const parts: any[] = [{ kind: "image", media: "image/jpeg", b64: await blobB64(await canvasBlob(strip, "image/jpeg", 0.92)) }];
    if (!p.legend || staleLegend(p)) await detectLegend(p);
    const hasLegend = !!(p.legend && "page" in p.legend);
    if (hasLegend) parts.push({ kind: "image", media: "image/jpeg", b64: await blobB64(await canvasBlob(await legendCanvas(pdf, p.legend as any, 2), "image/jpeg", 0.9)) });
    const head = explainHead(r.n, side, round, hasLegend, p.colors);
    const draftQ = explainDraft(p.colors.length > 0);
    let out: string;
    if (!canCallDirect(state.ai)) {
      out = await callAi(state.ai, { parts: [...parts, { kind: "text", text: head + "\n" + draftQ + "\n그다음 " + explainCheck("(방금 쓴 초안)") }], maxTokens: MAX_TOKENS.explain },
        { manual: manualHandler, label: `${r.s} ${r.n}단 차트 풀기` });
    } else {
      const draft = await callAi(state.ai, { parts: [...parts, { kind: "text", text: head + "\n" + draftQ }], maxTokens: MAX_TOKENS.explain }, { manual: manualHandler, label: "차트 풀기" });
      out = await callAi(state.ai, { parts: [...parts, { kind: "text", text: head + "\n" + draftQ }], maxTokens: MAX_TOKENS.explain, followUp: { assistant: draft, user: explainCheck(draft.trim()) } }, { manual: manualHandler, label: "차트 점검" });
    }
    r.x = out.trim();
    commit(p);
    render();
  } catch (e: any) {
    if (e?.code === "nopdf") toast("이 기기에 원본 PDF가 없어요. 'PDF 다시 연결'로 골라주세요.", 4000);
    else if (e?.code !== "cancelled") toast(errCopy(e), 4000);
  } finally {
    btn.disabled = false;
    btn.textContent = "이 단 차트를 글로 풀기";
  }
}

/* ---------------- 도구 · 목록 · 기록 ---------------- */
function tools(p: Pattern, s: string) {
  const sel = h("select", { "aria-label": "파트" }, ...partNames(p).map((n) => new Option(n, n, false, n === s)));
  const num = h("input", { type: "number", min: 1, inputmode: "numeric", placeholder: "단", "aria-label": "단 번호" });
  const form = h("form", {}, sel, num, h("button", { class: "btn", type: "submit", text: "이동" }));
  form.onsubmit = (e) => {
    e.preventDefault();
    // 단을 안 적고 누르면 그 파트의 첫 단으로
    const n = num.value.trim() ? parseInt(num.value, 10) : partRows(p, sel.value)[0]?.n;
    view.peek = null;
    if (n == null || !jumpTo(p, sel.value, n)) return toast(num.value.trim() ? `${sel.value}에 ${num.value}단이 없어요.` : `${sel.value}에 단이 없어요.`);
    commit(p, false);
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (!num.value.trim()) toast(`${sel.value} ${n}단(첫 단)으로 이동했어요.`);
  };
  const gauge = h("button", { class: "btn ghost", type: "button", text: "게이지", on: { click: () => openGauge(p, render, (sz) => openUpload({ appendTo: p.id, resize: sz, onDone: render })) } });
  const wake = h("button", { class: "btn ghost", type: "button", "aria-pressed": String(wantWake), text: wantWake ? "화면 켜두는 중" : "화면 켜두기", on: { click: () => setWake(!wantWake) } });
  return h("div", { class: "tools" }, form, p.example ? null : gauge, wake);
}

/** 도안 정보 (사이즈별 치수·실·바늘·게이지…) — 단 목록과 따로, 직접 고칠 수 있게 */
function infoCard(p: Pattern) {
  const lines = (p.info || "").split("\n").filter((l) => l.trim());
  const edit = () => {
    const ta = h("textarea", { rows: 10, value: p.info || "", placeholder: "예) L 사이즈: 가슴둘레 110cm\n실: 메리노 DK 6볼\n바늘: 4mm, 3.5mm", "aria-label": "도안 정보" });
    const dl = dialog("도안 정보", [
      h("p", { class: "hint", text: "사이즈별 치수·여유분, 실·바늘, 게이지, 주의 사항처럼 단이 아닌 정보를 적어 두는 곳이에요." }),
      ta,
      h("div", { class: "actions" },
        h("button", { class: "btn primary", type: "button", text: "저장", on: { click: () => { p.info = ta.value.trim(); commit(p); dl.close(); render(); toast("도안 정보를 저장했어요."); } } }),
        h("button", { class: "btn ghost", type: "button", text: "취소", on: { click: () => dl.close() } })),
    ]);
  };
  const first = lines[0] ? " · " + (lines[0].length > 18 ? lines[0].slice(0, 18) + "…" : lines[0]) : "";
  return h("details", { class: "sheet info" },
    h("summary", { text: `도안 정보${first || " (없음)"}` }),
    lines.length ? h("ul", { class: "info-list" }, ...lines.map((l) => h("li", { text: l }))) : h("p", { class: "notes", style: "padding:0 16px 8px", text: "사이즈 치수·실·바늘 같은 정보가 아직 없어요." }),
    h("div", { class: "actions", style: "padding:0 16px 8px" }, h("button", { class: "btn ghost", type: "button", text: lines.length ? "정보 수정" : "정보 적기", on: { click: edit } })));
}

/** 단 목록 한 줄: 여러 단 공통 지시는 매 단 할 일만, 다 뜬 뒤 할 일은 마지막 단에만 */
function rowText1(x: Row) {
  if (!x.span) return x.t || "";
  const sp = spanParts(x.t, x.span);
  return x.n === x.span[1] && sp.end ? `${sp.each} → 다 뜨면: ${sp.end}` : sp.each;
}

/** 단 목록 · 진행 기록 화면 (진행 화면에서 '›'로 연다) */
function renderSub(p: Pattern, s: string, r: Row) {
  const root = $("#trackView");
  $("#thumb").hidden = true;
  $("#meta").hidden = true;
  document.querySelector(".top")?.setAttribute("hidden", "");
  const back = () => { view.sub = null; render(); window.scrollTo({ top: 0 }); };
  const pr = partProgress(p, s);
  const head = (title: string, sub: string) => h("header", { class: "sub-head" },
    h("button", { class: "round-btn", type: "button", "aria-label": "진행 화면", text: "‹", on: { click: back } }),
    h("div", { class: "sub-title" }, h("b", { text: title }), h("span", { text: sub })));
  if (view.sub === "rows") {
    const num = h("input", { type: "number", min: 1, inputmode: "numeric", placeholder: "단 번호로 이동", "aria-label": "단 번호" });
    const form = h("form", { class: "jump" }, num, h("button", { class: "btn lav", type: "submit", text: "이동" }));
    form.onsubmit = (e) => {
      e.preventDefault();
      const n = num.value.trim() ? parseInt(num.value, 10) : partRows(p, s)[0]?.n;
      view.peek = null;
      if (n == null || !jumpTo(p, s, n)) return toast(`${s}에 ${num.value}단이 없어요.`);
      commit(p, false); back();
    };
    root.append(head("단 목록", `${p.name} · ${s} ${r.n}/${pr.total}단`), tabs(p, s), form, infoCard(p), rowList(p, s));
  } else {
    root.append(head("진행 기록", `${p.name} · 10분 안에 이어 뜬 단은 한 번으로`), history(p), backupCard(p));
  }
}

/** 저장 · 백업 카드 + 이 도안 삭제 */
function backupCard(p: Pattern) {
  if (p.example) return h("div", { class: "danger" }, h("button", { class: "link", type: "button", text: "진행 가져오기 (JSON)", on: { click: importFile } }));
  const confirm = h("span", { hidden: true }, "정말 지울까요? 진행 기록도 함께 지워져요. ",
    h("button", { class: "btn", type: "button", text: "삭제", on: { click: async () => { await removePattern(p.id); view.sub = null; render(); toast("도안을 지웠어요."); } } }), " ",
    h("button", { class: "btn ghost", type: "button", text: "취소", on: { click: () => (confirm.hidden = true) } }));
  return h("div", { class: "backup-wrap" },
    h("div", { class: "home-sec", text: "저장 · 백업" }),
    h("section", { class: "backup" },
      h("div", { class: "bk-top" },
        h("div", { class: "bk-txt" }, h("b", { text: state.lastSaved ? `마지막 저장 ${fmtSmart(state.lastSaved)}` : "이 기기에 바로 저장돼요" }), h("span", { text: "이 기기에 바로 저장 · 10분마다 백업" })),
        h("button", { class: "btn lav", type: "button", text: "지금 저장", on: { click: async () => { await saveNow(); render(); toast("저장했어요."); } } })),
      h("div", { class: "bk-grid" },
        h("button", { class: "btn ghost", type: "button", text: "진행 내보내기", on: { click: () => download(`knitting-progress-${new Date().toISOString().slice(0, 10)}.json`, exportJson()) } }),
        h("button", { class: "btn ghost", type: "button", text: "가져오기", on: { click: importFile } }),
        h("button", { class: "btn ghost", type: "button", text: "백업에서 복원", on: { click: restoreDialog } }))),
    h("div", { class: "danger" },
      h("button", { class: "link", type: "button", text: "페이지 더 읽어서 붙이기", on: { click: () => openUpload({ appendTo: p.id, onDone: render }) } }),
      p.src === "pdf" ? h("button", { class: "link", type: "button", text: "이 기기에 PDF 다시 연결", on: { click: () => openUpload({ appendTo: p.id, relink: true, onDone: render }) } }) : null,
      h("button", { class: "link warn", type: "button", text: "이 도안 삭제", on: { click: () => (confirm.hidden = false) } }), confirm));
}

function rowList(p: Pattern, s: string) {
  const cur = currentRow(p, s);
  const ol = h("ol", { class: "rows2" });
  for (const x of partRows(p, s)) {
    const t = p.done[key(s, x.n)];
    const b = h("button", { type: "button", class: (x === cur ? "on" : "") + (t ? " done" : "") },
      h("span", { class: "n", text: x.n + "단" + (x.side ? " " + x.side : "") }),
      h("span", { class: "t", text: rowText1(x) + (x.st ? `  (${x.st})` : "") }),
      h("span", { class: "when", text: t ? fmtShort(t) : "" }));
    b.onclick = () => { jumpTo(p, s, x.n); view.peek = null; commit(p, false); view.sub = null; render(); window.scrollTo({ top: 0, behavior: "smooth" }); };
    ol.append(h("li", {}, b));
  }
  requestAnimationFrame(() => {
    const on = ol.querySelector<HTMLElement>("button.on");
    if (on) ol.scrollTop = on.offsetTop - ol.clientHeight / 2;
  });
  const fin = p.fin[s];
  return h("details", { class: "sheet", open: true },
    h("summary", { text: `${s} 단 목록` + (fin ? ` · 완료 ${fmtShort(fin)}` : "") }),
    p.notes ? h("p", { class: "notes", style: "padding:0 16px 8px", text: p.notes }) : null,
    ol);
}

function history(p: Pattern) {
  const wrap = h("div", { class: "hist-wrap" });
  const recent = [...p.log].reverse().slice(0, 60);
  if (!recent.length) wrap.append(h("p", { class: "gen", text: "아직 기록이 없어요. '다음 단'을 누르면 시각이 남아요." }));
  // 날짜별로 묶어 카드 하나에
  const days = new Map<string, typeof recent>();
  for (const l of recent) { const d = fmtDay(l.a); days.set(d, [...(days.get(d) || []), l]); }
  for (const [day, ls] of days) {
    const card = h("div", { class: "hist-card" });
    for (const l of ls) {
      const d = l.to - l.from, total = partRows(p, l.s).length || 1;
      const fin = p.fin[l.s] && p.fin[l.s] >= l.a - 60000 && p.fin[l.s] <= l.b + 60000;
      card.append(h("div", { class: "hist-row" },
        h("div", { class: "hr-top" }, h("b", {}, `${l.s} ${l.from} → ${l.to}단`, fin ? h("span", { class: "badge fin", text: "완료 ✓" }) : null), h("span", { class: "hr-d", text: `${d >= 0 ? "+" : ""}${d}단` })),
        h("div", { class: "hr-bar" }, yarnBar(Math.abs(d) / total, !!fin), h("span", { text: `${fmtTime(l.a)} – ${fmtTime(l.b)}` }))));
    }
    wrap.append(h("div", { class: "home-sec", text: day }), card);
  }
  if (p.log.length) wrap.append(h("div", { class: "actions" }, h("button", { class: "btn ghost", type: "button", text: "진행 기록 지우기", on: { click: async () => {
    if (!(await ask("진행 기록 지우기", `진행 기록 ${p.log.length}개를 지워요. 지금 단 위치와 뜬 단 표시는 그대로예요.`, "지우기"))) return;
    p.log = []; commit(p); render(); toast("진행 기록을 지웠어요.");
  } } })));
  return wrap;
}

function dangerZone(p: Pattern) {
  const box = h("div", { class: "danger" });
  if (p.example) {
    box.append(h("button", { class: "link", type: "button", text: "진행 가져오기 (JSON)", on: { click: importFile } }));
    return box;
  }
  const sep = () => h("span", { "aria-hidden": "true", text: "·" });
  box.append(...([
    h("button", { class: "link", type: "button", text: "이 도안에 페이지 더 읽어서 붙이기", on: { click: () => openUpload({ appendTo: p.id, onDone: render }) } }), sep(),
    p.src === "pdf" ? h("button", { class: "link", type: "button", text: "이 기기에 PDF 다시 연결", on: { click: () => openUpload({ appendTo: p.id, relink: true, onDone: render }) } }) : null, p.src === "pdf" ? sep() : null,
    h("button", { class: "link", type: "button", text: "진행 내보내기", on: { click: () => download(`knitting-progress-${new Date().toISOString().slice(0, 10)}.json`, exportJson()) } }), sep(),
    h("button", { class: "link", type: "button", text: "가져오기", on: { click: importFile } }), sep(),
    h("button", { class: "link", type: "button", text: "백업에서 복원", on: { click: restoreDialog } }), sep(),
  ].filter(Boolean) as Node[]));
  const confirm = h("span", { hidden: true }, "정말 지울까요? 진행 기록도 함께 지워져요. ",
    h("button", { class: "btn", type: "button", text: "삭제", on: { click: async () => { await removePattern(p.id); render(); toast("도안을 지웠어요."); } } }), " ",
    h("button", { class: "btn ghost", type: "button", text: "취소", on: { click: () => (confirm.hidden = true) } }));
  box.append(h("button", { class: "link", type: "button", text: "이 도안 삭제", on: { click: () => (confirm.hidden = false) } }), confirm);
  return box;
  return box;
}

async function restoreDialog() {
  const { listSnapshots } = await import("./db");
  const snaps = await listSnapshots().catch(() => []);
  const dl = dialog("백업에서 복원", [
    h("p", { class: "hint", text: "10분마다(바뀐 게 있을 때) 이 기기에 백업해요. 최근 20개까지 남아요. 복원하면 그 시점의 모든 도안 진행으로 돌아가요." }),
    snaps.length
      ? h("ul", { class: "hist" }, ...snaps.map((sn) => h("li", {},
          h("span", { text: `${fmtFull(sn.t)} · 도안 ${sn.data.length}개` }),
          h("button", { class: "btn", type: "button", text: "복원", on: { click: async () => {
            for (const id of Object.keys(state.patterns)) if (!sn.data.some((x) => x.id === id)) await removePattern(id);
            for (const x of sn.data) commit(x, false);
            dl.close(); render(); toast(`${fmtTime(sn.t)} 백업으로 돌아갔어요.`);
          } } }))))
      : h("p", { class: "hint", text: "아직 백업이 없어요." }),
    h("div", { class: "actions" }, h("button", { class: "btn ghost", type: "button", text: "닫기", on: { click: () => dl.close() } })),
  ]);
}

function importFile() {
  const inp = h("input", { type: "file", accept: "application/json,.json" });
  inp.onchange = async () => {
    const f = inp.files?.[0];
    if (!f) return;
    try {
      const n = await importJson(await f.text());
      toast(n ? `${n}개 도안 진행을 가져왔어요.` : "가져올 새 기록이 없어요.");
      render();
    } catch {
      toast("이 파일은 읽지 못했어요.");
    }
  };
  inp.click();
}

/* ---------------- 이동 · 키보드 · 화면 켜두기 ---------------- */
/** 30분 넘게 쉬지 않고 뜨면 스트레칭 알림 (쉬지 않은 시간 30분마다 한 번) */
let stretchShown = 0;
function stretchReminder(p: Pattern) {
  const ms = continuousKnitMs(p);
  const step = Math.floor(ms / (30 * 60000));
  if (step < 1) { stretchShown = 0; return; }
  if (step <= stretchShown) return;
  stretchShown = step;
  const min = Math.round(ms / 60000);
  const long = ms >= 2 * 3600000; // 2시간 넘으면 스트레칭이 아니라 쉬기
  // 알림이 뜨면 타이머는 멈춘다 (쉬는 시간은 뜬 시간에서 빠지게)
  const wasOn = !!p.work?.on;
  if (wasOn) { workStop(p); commit(p); refreshWork(p); }
  const resume = () => { box.remove(); if (wasOn && !p.work?.on) { workStart(p); commit(p); refreshWork(p); toast("다시 시작했어요."); } };
  const box = h("div", { class: "stretch" + (long ? " rest" : ""), role: "status" },
    h("b", { text: long ? `${Math.floor(min / 60)}시간 ${min % 60}분째 뜨고 있어요. 이제 쉬다 오세요` : `${min}분째 뜨고 있어요` }),
    h("span", { text: long
      ? "손과 눈이 많이 지쳤을 거예요. 일어나서 물 한 잔 마시고 15분쯤 쉬었다 와요. 지금 단은 그대로 저장돼 있어요 ☕"
      : "손목을 돌리고 손가락을 쫙 펴고, 어깨·목을 천천히 늘려 주세요. 눈도 잠깐 먼 곳을 봐요 🙆" }),
    wasOn ? h("span", { class: "gen", text: long ? "타이머를 멈췄어요. 돌아와서 ▶ 시작을 눌러 주세요." : "타이머를 잠깐 멈췄어요." }) : null,
    h("div", { class: "actions", style: "justify-content:flex-end" },
      long
        ? h("button", { class: "btn", type: "button", text: "쉬고 올게요", on: { click: () => box.remove() } })
        : h("button", { class: "btn", type: "button", text: wasOn ? "스트레칭했어요 · 다시 시작" : "스트레칭했어요", on: { click: resume } })));
  document.querySelector(".stretch")?.remove();
  document.body.append(box);
  if (!wasOn) setTimeout(() => box.remove(), 60000); // 타이머를 멈췄으면 누를 때까지 둔다
}

function next() {
  const p = active();
  if (view.peek) return peekStep(p, 1);
  const before = currentTab(p);
  const res = stepNext(p);
  if (res === "all-done") toast("모든 파트를 다 떴어요! 🎉");
  if (res === "finished") { const ft = finishText(p, before); toast(`${before} 완료 ✓ ${fmtTime(Date.now())}` + (ft ? ` · ${ft}` : ""), 6000); }
  else if (res === "moved") stretchReminder(p);
  view.editing = false;
  commit(p);
  render();
}
function prev() {
  const p = active();
  if (document.querySelector(".dlg")) return;
  if (view.peek) return peekStep(p, -1);
  const s = currentTab(p);
  const list = partRows(p, s);
  const cur = currentRow(p, s);
  if (!cur) return;
  const fin = !!p.fin[s];
  const pv = fin ? cur : list[list.indexOf(cur) - 1];
  if (!pv) return;
  // 이미 뜬 단으로 갈 때: 보기만 할지, 진행을 되돌릴지
  const dl = dialog(`${pv.n}단으로 갈까요?`, [
    h("div", { class: "back-choice" },
      h("button", { class: "btn primary", type: "button", on: { click: () => { dl.close(); view.peek = { id: p.id, s, n: pv.n }; view.editing = false; render(); window.scrollTo({ top: 0, behavior: "smooth" }); } } },
        h("b", { text: "도안만 보기" }), h("small", { text: `진행은 ${fin ? "완료 상태" : cur.n + "단"} 그대로 두고 앞 단을 살펴봐요` })),
      h("button", { class: "btn", type: "button", on: { click: () => { dl.close(); stepPrev(p); view.editing = false; commit(p); render(); toast(fin ? `${s} 완료를 취소했어요.` : `${pv.n}단으로 되돌렸어요.`); } } },
        h("b", { text: fin ? "완료 취소하기" : "한 단 되돌리기" }), h("small", { text: fin ? `${pv.n}단을 다시 떠요 (파트 완료 표시가 지워져요)` : `${pv.n}단부터 다시 떠요 (${pv.n}단 완료 표시가 지워져요)` }))),
    h("div", { class: "actions", style: "justify-content:flex-end" }, h("button", { class: "btn ghost", type: "button", text: "취소", on: { click: () => dl.close() } })),
  ]);
}

/** 도안만 보기 중 앞뒤로 넘기기: 지금 단에 닿으면 보기를 끝낸다 */
function peekStep(p: Pattern, d: 1 | -1) {
  const s = currentTab(p);
  const list = partRows(p, s);
  const cur = currentRow(p, s)!;
  const at = list.findIndex((x) => x.n === view.peek?.n);
  const nx = list[at + d];
  if (!nx || nx === cur) view.peek = null;
  else view.peek = { id: p.id, s, n: nx.n };
  render();
}

function peekBanner(p: Pattern, r: Row, cur: Row) {
  return h("div", { class: "peek-banner", role: "status" },
    h("span", {}, h("b", { text: `${r.n}단 보는 중` }), ` · 지금 뜨는 곳은 ${p.fin[r.s] ? "완료" : cur.n + "단"} (진행은 그대로예요)`),
    h("button", { class: "btn", type: "button", text: "지금 단으로", on: { click: () => { view.peek = null; render(); } } }));
}
$("#nextBtn").onclick = next;
$("#prevBtn").onclick = prev;
document.addEventListener("keydown", (e) => {
  if (document.querySelector(".dlg, .viewer:not([hidden]), .editor, #uploadView")) return;
  if (/INPUT|TEXTAREA|SELECT/.test((document.activeElement as HTMLElement)?.tagName || "")) return;
  if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); next(); }
  if (e.key === "ArrowLeft") { e.preventDefault(); prev(); }
});
$("#patSel").onchange = (e) => { setActive((e.target as HTMLSelectElement).value); view.full = false; render(); };
$("#homeBtn").onclick = () => showHome();
$("#addBtn").onclick = () => openUpload({ onDone: render });
$("#setBtn").onclick = () => openSettings(render);

let wake: any = null, wantWake = false;
async function setWake(on: boolean) {
  wantWake = on;
  try {
    if (on) wake = await (navigator as any).wakeLock.request("screen");
    else { await wake?.release(); wake = null; }
  } catch {
    wantWake = false;
    toast("이 화면에서는 켜두기를 쓸 수 없어요.");
  }
  render();
}
document.addEventListener("visibilitychange", () => { if (wantWake && document.visibilityState === "visible") setWake(true); });

/* ---------------- 시작 ---------------- */
(async () => {
  await load();
  render();
  // 아티팩트: 다른 기기에서 뜬 기록까지 불러온다
  syncRemote().then((changed) => changed && render());
  startAutosave(() => renderMeta(active()));
  // 화면 폭이 바뀌면(가로·세로 돌리기, 창 크기) 차트·내용을 새 폭에 맞춰 다시 그린다. 높이만 바뀌는 건(키보드·주소창) 무시
  let lastW = window.innerWidth, rT: number | undefined;
  window.addEventListener("resize", () => {
    if (Math.abs(window.innerWidth - lastW) < 24) return;
    clearTimeout(rT);
    rT = window.setTimeout(() => {
      lastW = window.innerWidth;
      const typing = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      if (!typing && !view.editing && !document.querySelector(".editor")) render();
    }, 250);
  });
  // 저장 공간을 브라우저가 함부로 비우지 않게
  (navigator.storage as any)?.persist?.().catch(() => {});
})();

// 테스트·점검 스크립트에서 쓰려고 노출
(window as any).__app = { state, render, active, putFile, getFile, rowColors };
