import "./style.css";
import { chunksOf, stitchesThrough } from "./chunks";
import { MAX_TOKENS } from "./config";
import { callAi, errCopy, hasKey } from "./ai";
import { chartBitmap, drawGrid, drawPdfFull, drawPdfRows, explainStrip, legendCanvas, sampleRowColors, yarnHex } from "./chart";
import { getFile, putFile } from "./db";
import { longestFloat, rowColors } from "./drawing";
import {
  applyDrawing, colorsInText, currentRow, currentTab, directionText, jumpTo, key, lastWorked, partNames, partProgress, partRows, sideOf, stepNext, stepPrev,
} from "./model";
import { blobB64, canvasBlob } from "./pdf";
import { findLegend, LEGEND_RE } from "./pdfgeom";
import { explainCheck, explainDraft, explainHead } from "./prompts";
import { active, commit, exportJson, importJson, load, pdfOf, removePattern, saveNow, setActive, startAutosave, state } from "./store";
import { openSettings, manualHandler, openViewer } from "./dialogs";
import { openUpload } from "./upload";
import { openEditor } from "./drawui";
import { gaugeSummary, openGauge } from "./gaugeui";
import { $, dialog, download, fmtFull, fmtShort, fmtSmart, fmtTime, h, toast } from "./ui";
import type { Pattern, Row } from "./types";

const app = $("#app");
const view = {
  rowPx: 22,
  full: false,
  legendOpen: true,
  useDrawing: {} as Record<string, boolean>, // 파트별: 그린 배색 보기 (기본: 그린 게 있으면 그것)
  editing: false,
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

/* ---------------- 렌더 ---------------- */
let renderSeq = 0;

export function render() {
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
  const r = currentRow(p, s)!;
  root.append(tabs(p, s), nowCard(p, r), tools(p, s), rowList(p, s), history(p), dangerZone(p));
  const prog = partProgress(p, s);
  const list = partRows(p, s);
  const isLast = list[list.length - 1] === r;
  $<HTMLButtonElement>("#prevBtn").disabled = list[0] === r && !prog.finished;
  $("#nextBtn").textContent = prog.finished ? "다음 파트로 →" : isLast ? "이 파트 완료 ✓" : "다음 단 →";
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

function tabs(p: Pattern, s: string) {
  const box = h("div", { class: "ptabs", role: "tablist", "aria-label": "파트" });
  for (const name of partNames(p)) {
    const pr = partProgress(p, name);
    const b = h("button", { class: "ptab" + (pr.finished ? " fin" : ""), role: "tab", type: "button", "aria-selected": String(name === s) },
      (pr.finished ? "✓ " : "") + name, h("small", { text: `${pr.done}/${pr.total}` }));
    b.onclick = () => { p.tab = name; commit(p, false); render(); };
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
        h("span", { class: "chip side", text: round ? "원통 RS" : side === "RS" ? "겉면 RS" : "안면 WS" }),
        h("span", { class: "chip dir", text: directionText(p, r) }),
        fin && h("span", { class: "chip fin", text: "이 파트 완료 ✓" }),
      ),
      h("span", { class: "prog", text: `파트 ${k + 1}/${list.length}` }),
    ),
    h("div", { class: "rowno" }, h("b", { text: String(r.n) }), h("span", { class: "unit", text: "단" }), h("span", { class: "st", text: r.st || "" })),
  );
  const gs = gaugeSummary(p);
  if (gs) card.append(h("button", { class: "link gauge-line", type: "button", text: gs, on: { click: () => openGauge(p, render) } }));
  const yarnBox = h("div", { class: "yarns" });
  card.append(yarnBox);
  fillYarns(p, r, yarnBox);
  card.append(chartArea(p, r, side, round, yarnBox));
  card.append(narrative(p, r));
  if (r.span) card.append(h("p", { class: "span-note", text: `${r.span[0]}~${r.span[1]}단 공통 지시예요.` }));
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
  const wrap = h("div", { style: "display:flex;flex-direction:column;gap:6px" });
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
    h("button", { class: "btn ghost", type: "button", text: d ? "배색 고치기" : "배색 그리기", on: { click: () => openEditor(p, r.s, { onSave: () => render() }) } }),
  );
  wrap.append(box, t);

  if (useDraw && d) {
    const c = h("canvas", { "aria-label": `${r.s} 배색 격자, ${r.n}단 표시` });
    cv.append(c);
    const idx = r.n - d.start;
    const rows: [number, number] = view.full ? [0, d.h - 1] : [Math.max(0, idx - 3), Math.min(d.h - 1, idx + 6)];
    drawGrid(c, d, p.colors, Math.max(10, view.rowPx), { n: r.n, side, round, rows });
    scrollStart(cv, side === "RS" || round);
    return wrap;
  }
  if (!page) {
    cv.append(h("p", { class: "empty", text: p.src === "pdf" ? "이 파트에 지정된 차트 쪽이 없어요. '차트 쪽 바꾸기'로 고르거나, 배색이면 '배색 그리기'로 직접 그릴 수 있어요." : "차트가 없는 파트예요. 배색 도안이면 '배색 그리기'로 직접 그려서 단마다 표시할 수 있어요." }));
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
    const bmp = await chartBitmap(pdf, p.id, page);
    if (seq !== renderSeq) return;
    cv.innerHTML = "";
    const c = h("canvas", { "aria-label": `차트 p${page}, ${r.n}단 표시` });
    if (view.full) {
      drawPdfFull(c, bmp, { n: r.n, side, round, rowPx: view.rowPx }, Math.max(cv.clientWidth, 320) * (view.rowPx / 22));
      cv.append(c);
    } else {
      const res = drawPdfRows(c, bmp, { n: r.n, side, round, rowPx: view.rowPx });
      if (!res.chart) {
        cv.append(h("p", { class: "empty", text: `p${page}에서 단 번호 축을 찾지 못했어요. '차트 전체'로 보거나 '차트 쪽 바꾸기'로 다른 쪽을 골라주세요.` }));
        return;
      }
      cv.append(c);
      scrollStart(cv, res.startX === "right");
    }
    // 배색 차트면 띠에서 실제 색을 뽑아 보여준다
    // 회색·검정(격자선·기호)은 빼고 채도 있는 색만 → 흑백 차트에선 안 보인다
    const cols = sampleRowColors(bmp, r.n).filter((c2) => c2.share > 0.04 && chroma(c2.hex) > 40);
    if (cols.length) {
      for (const c2 of cols.slice(0, 5)) yarnBox.append(h("span", { class: "yarn sample", title: "차트에서 뽑은 색" }, h("i", { style: { background: c2.hex } }), Math.round(c2.share * 100) + "%"));
      if (!yarnBox.querySelector(".gen")) yarnBox.prepend(h("span", { class: "gen", text: "차트 색" }));
    }
  })().catch(() => {
    cv.innerHTML = "";
    cv.append(h("p", { class: "empty", text: "차트를 그리지 못했어요." }));
  });
  return wrap;
}

function chroma(hex: string) {
  const v = parseInt(hex.slice(1), 16);
  const r = v >> 16, g = (v >> 8) & 255, b = v & 255;
  return Math.max(r, g, b) - Math.min(r, g, b);
}

function scrollStart(cv: HTMLElement, right: boolean) {
  requestAnimationFrame(() => {
    cv.scrollLeft = right ? cv.scrollWidth : 0;
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
  pane.append(h("div", { class: "lg-head" }, view.legendOpen ? h("span", { text: "기호표" }) : null, toggle), body);
  if (!view.legendOpen) return pane;
  (async () => {
    const pdf = await pdfOf(p);
    if (!pdf) return;
    if (!p.legend) await detectLegend(p);
    if (!p.legend || "none" in p.legend) {
      pane.remove();
      return;
    }
    const c = await legendCanvas(pdf, p.legend, 2);
    c.setAttribute("aria-label", "기호표");
    body.append(c);
  })().catch(() => {});
  return pane;
}

async function detectLegend(p: Pattern) {
  const pdf = await pdfOf(p);
  if (!pdf) return;
  const { textItems } = await import("./pdf");
  for (let n = 1; n <= Math.min(14, pdf.numPages); n++) {
    const t = await textItems(pdf, n);
    if (!t.items.some((i) => LEGEND_RE.test(i.str))) continue;
    const lg = findLegend(t.items);
    if (lg) {
      p.legend = { page: n, ...lg, auto: true };
      commit(p, false);
      return;
    }
  }
  p.legend = { none: true };
  commit(p, false);
}

function chartPicker(p: Pattern, r: Row) {
  const chIn = h("input", { type: "number", min: 1, inputmode: "numeric", value: String(chartPage(p, r) || "") });
  const lgIn = h("input", { type: "number", min: 1, inputmode: "numeric", value: p.legend && "page" in p.legend ? String(p.legend.page) : "" });
  const dl = dialog(`${r.s} 차트 쪽`, [
    h("label", { class: "field" }, "이 파트 차트 PDF 쪽", chIn, h("small", { text: "비우면 차트 없이 서술만 보여요." })),
    h("label", { class: "field" }, "기호표 PDF 쪽", lgIn, h("small", { text: "그 쪽 전체를 기호표로 써요. 비우면 기호표를 숨겨요." })),
    h("div", { class: "actions" },
      h("button", { class: "btn primary", type: "button", text: "저장", on: { click: async () => {
        const ch = parseInt(chIn.value, 10) || null;
        p.secs[r.s] = { ...p.secs[r.s], ch };
        for (const x of partRows(p, r.s)) x.ch = ch;
        const lp = parseInt(lgIn.value, 10);
        if (lp) {
          const pdf = await pdfOf(p);
          const { pageSize } = await import("./pdf");
          const sz = pdf ? await pageSize(pdf, lp) : { w: 595, h: 842 };
          p.legend = { page: lp, x0: 0, y0: 0, x1: sz.w, y1: sz.h };
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
  const chunks = chunksOf(r.t || "");
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
  if (!chunks.length) {
    wrap.append(h("p", { class: "instr", text: "(서술 없음)" }));
    return wrap;
  }
  const prog = p.part[k];
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

function rowActions(p: Pattern, r: Row, side: "RS" | "WS", round: boolean) {
  const page = chartPage(p, r);
  const box = h("div", { class: "row-actions" });
  if (page && p.src === "pdf" && !(p.draw[r.s] && (view.useDrawing[r.s] ?? true))) {
    const b = h("button", { class: "btn", type: "button", text: "이 단 차트를 글로 풀기" });
    b.onclick = () => explainRow(p, r, side, round, b);
    box.append(b);
  }
  if (r.pg && p.src && p.src !== "text") box.append(h("button", { class: "btn ghost", type: "button", text: p.src === "pdf" ? `원본 p${r.pg} 보기` : `원본 사진 ${r.pg} 보기`, on: { click: () => openViewer(p, r.pg!) } }));
  if (page && p.src === "pdf") box.append(h("button", { class: "btn ghost", type: "button", text: `차트 p${page} 원본`, on: { click: () => openViewer(p, page) } }));
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
    if (!p.legend) await detectLegend(p);
    const hasLegend = !!(p.legend && "page" in p.legend);
    if (hasLegend) parts.push({ kind: "image", media: "image/jpeg", b64: await blobB64(await canvasBlob(await legendCanvas(pdf, p.legend as any, 2), "image/jpeg", 0.9)) });
    const head = explainHead(r.n, side, round, hasLegend, p.colors);
    const draftQ = explainDraft(p.colors.length > 0);
    let out: string;
    if (!hasKey(state.ai)) {
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
    const n = parseInt(num.value, 10);
    if (!jumpTo(p, sel.value, n)) return toast(`${sel.value}에 ${n}단이 없어요.`);
    commit(p, false);
    render();
  };
  const gauge = h("button", { class: "btn ghost", type: "button", text: "게이지", on: { click: () => openGauge(p, render) } });
  const wake = h("button", { class: "btn ghost", type: "button", "aria-pressed": String(wantWake), text: wantWake ? "화면 켜두는 중" : "화면 켜두기", on: { click: () => setWake(!wantWake) } });
  return h("div", { class: "tools" }, form, p.example ? null : gauge, wake);
}

function rowList(p: Pattern, s: string) {
  const cur = currentRow(p, s);
  const ol = h("ol", { class: "rows2" });
  for (const x of partRows(p, s)) {
    const t = p.done[key(s, x.n)];
    const b = h("button", { type: "button", class: (x === cur ? "on" : "") + (t ? " done" : "") },
      h("span", { class: "n", text: x.n + "단" + (x.side ? " " + x.side : "") }),
      h("span", { class: "t", text: (x.t || "") + (x.st ? `  (${x.st})` : "") }),
      h("span", { class: "when", text: t ? fmtShort(t) : "" }));
    b.onclick = () => { jumpTo(p, s, x.n); commit(p, false); render(); window.scrollTo({ top: 0, behavior: "smooth" }); };
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
  const ul = h("ul", { class: "hist" });
  const recent = [...p.log].reverse().slice(0, 40);
  for (const l of recent) {
    const d = l.to - l.from;
    ul.append(h("li", {}, h("span", { text: `${l.s} ${l.from}→${l.to}단` }), h("span", { class: "d", text: `${fmtShort(l.a)}–${fmtTime(l.b)} · ${d >= 0 ? "+" : ""}${d}단` })));
  }
  if (!recent.length) ul.append(h("li", { class: "d", text: "아직 기록이 없어요. '다음 단'을 누르면 시각이 남아요." }));
  return h("details", { class: "sheet" }, h("summary", { text: "진행 기록" }), ul);
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
    h("button", { class: "link", type: "button", text: "진행 내보내기", on: { click: () => download(`뜨개진행-${new Date().toISOString().slice(0, 10)}.json`, exportJson()) } }), sep(),
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
function next() {
  const p = active();
  const before = currentTab(p);
  const res = stepNext(p);
  if (res === "all-done") toast("모든 파트를 다 떴어요! 🎉");
  if (res === "finished") toast(`${before} 완료 ✓ ${fmtTime(Date.now())}`);
  view.editing = false;
  commit(p);
  render();
}
function prev() {
  const p = active();
  stepPrev(p);
  view.editing = false;
  commit(p);
  render();
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
  startAutosave(() => renderMeta(active()));
  // 저장 공간을 브라우저가 함부로 비우지 않게
  (navigator.storage as any)?.persist?.().catch(() => {});
})();

// 테스트·점검 스크립트에서 쓰려고 노출
(window as any).__app = { state, render, active, putFile, getFile, rowColors };
