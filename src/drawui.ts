/** 배색 격자 편집기 */
import { drawGrid, hitCell, pixelCanvas, yarnHex, chartBitmap, type GridGeom } from "./chart";
import {
  colorCounts, copyRect, deleteCol, deleteRow, describeRow, fillRow, floodFill, gridFromPixels, insertCol, insertRow, longestFloat, mirrorRect, newDrawing, normRect,
  paste, resize, setCell, tileRepeat, type Clip, type Rect,
} from "./drawing";
import { primaryGauge } from "./gauge";
import { openImageImport } from "./imageimport";
import { applyDrawing, partRows, sideOf } from "./model";
import { chartFor, rowY } from "./pdfgeom";
import { canvasBlob } from "./pdf";
import { commit, pdfOf } from "./store";
import { ask, dialog, download, h, toast } from "./ui";
import type { Drawing, DrawOpt, Pattern, Yarn } from "./types";

type Tool = "select" | "pen" | "fill" | "erase" | "paste";
const CODES = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const IDX = "0123456789abcdefghijklmnopqrstuvwxyz";

export type DrawSize = { w: number; h: number; start: number; why: string };
export function openEditor(p: Pattern, part: string, o: { onSave: () => void; startImage?: File; size?: DrawSize | null }) {
  const rowsOf = partRows(p, part);
  // 새로 그릴 때는 도안의 콧수·단수 그대로 (모르면 24코)
  const fresh = !p.draw[part];
  let d: Drawing = p.draw[part] ? structuredClone(p.draw[part]) : newDrawing(o.size?.w || 24, o.size?.h || Math.max(10, rowsOf.length || 20), o.size?.start || rowsOf[0]?.n || 1);
  if (!d.opt) d.opt = {};
  if (d.opt.gauge === undefined) d.opt.gauge = primaryGauge(p.gauges);
  let colors: Yarn[] = p.colors.length ? p.colors.map((y) => ({ ...y })) : [{ code: "A", name: "바탕색", hex: "#EFE8D8" }, { code: "B", name: "배색", hex: "#2F5D8A" }];
  let cur = Math.min(1, colors.length - 1);
  let tool: Tool = "pen";
  let cell = 20;
  let sel: Rect | null = null;
  let clip: Clip | null = null;
  let focusRow = d.start;
  let focus: { c: number; r: number } | null = null;
  const undo: Drawing[] = [], redo: Drawing[] = [];
  let geom: GridGeom;
  // 사진 밑그림: 격자 위에 반투명하게 겹쳐 보며 칠한다 (이 편집 동안만)
  let under: { img: CanvasImageSource; alpha: number; on: boolean } | null = null;
  let dirty = false;

  const canvas = h("canvas", { "aria-label": "배색 격자. 칸을 눌러 칠해요." });
  const legend = h("div", { class: "yarns", style: "justify-content:center;margin-top:8px" });
  const body = h("div", { class: "ed-body" }, canvas, legend);
  const pal = h("div", { class: "pal", role: "radiogroup", "aria-label": "색" });
  const desc = h("div", { class: "ed-desc", "aria-live": "polite" });
  const zoomSel = h("select", { "aria-label": "확대" }, ...[["fit", "맞춤"], ["8", "40%"], ["12", "60%"], ["16", "80%"], ["20", "100%"], ["28", "140%"], ["36", "180%"], ["44", "220%"]].map(([v, t]) => new Option(t, v, false, v === "20")));
  zoomSel.onchange = () => { cell = zoomSel.value === "fit" ? fitCell() : +zoomSel.value; draw(); };
  const toolBtns: Record<Exclude<Tool, "paste">, HTMLButtonElement> = {
    select: h("button", { class: "btn", type: "button", text: "▭ 선택" }),
    pen: h("button", { class: "btn", type: "button", text: "🎨 색칠" }),
    fill: h("button", { class: "btn", type: "button", text: "▦ 채우기" }),
    erase: h("button", { class: "btn", type: "button", text: "⌫ 지우개" }),
  };
  (Object.keys(toolBtns) as (keyof typeof toolBtns)[]).forEach((t) => (toolBtns[t].onclick = () => setTool(t)));
  const alphaIn = h("input", { type: "range", min: 0, max: 90, step: 5, value: "45", "aria-label": "사진 진하기", style: "width:140px" });
  alphaIn.oninput = () => { if (under) { under.alpha = +alphaIn.value / 100; draw(); } };
  const underToggle = h("button", { class: "btn", type: "button", text: "사진 숨기기" });
  underToggle.onclick = () => { if (!under) return; under.on = !under.on; underToggle.textContent = under.on ? "사진 숨기기" : "사진 보이기"; draw(); };
  const underBar = h("div", { class: "ed-bar", hidden: true },
    h("span", { class: "gen", text: "사진 밑그림" }), h("span", { class: "gen", text: "흐리게" }), alphaIn, h("span", { class: "gen", text: "진하게" }), underToggle,
    h("button", { class: "btn ghost", type: "button", text: "밑그림 빼기", on: { click: () => { under = null; draw(); } } }));
  const selBar = h("div", { class: "ed-bar", hidden: true },
    h("span", { class: "gen", text: "선택 영역:" }),
    btn("복사", () => { if (sel) { clip = copyRect(d, sel); setTool("paste"); toast("붙일 자리(왼쪽 위 칸)를 누르세요."); } }),
    btn("좌우 반전", () => sel && edit(mirrorRect(d, sel, "h"))),
    btn("상하 반전", () => sel && edit(mirrorRect(d, sel, "v"))),
    btn("가로로 반복", () => sel && edit(tileRepeat(d, sel, "x"))),
    btn("세로로 반복", () => sel && edit(tileRepeat(d, sel, "y"))),
    btn("반복 단위로 표시", () => { if (sel) edit({ ...d, opt: { ...d.opt, rep: normRect(sel) } }); }),
    btn("선택 칠하기", () => { if (!sel) return; const q = normRect(sel); let nd = d; for (let r = q.r0; r <= q.r1; r++) for (let c = q.c0; c <= q.c1; c++) nd = setCell(nd, c, r, cur); edit(nd); }),
    btn("선택 해제", () => { sel = null; draw(); }),
  );

  const ed = h("div", { class: "editor", role: "dialog", "aria-modal": "true", "aria-label": `${part} 배색 그리기` },
    h("div", { class: "ed-bar" },
      h("strong", { text: "✏ " + part }), h("span", { class: "sep" }),
      btn("−", () => zoomStep(-4), "축소"), btn("+", () => zoomStep(4), "확대"), zoomSel,
      h("span", { class: "sep" }),
      btn("↶", () => { if (undo.length) { redo.push(d); d = undo.pop()!; dirty = true; draw(); } }, "되돌리기"),
      btn("↷", () => { if (redo.length) { undo.push(d); d = redo.pop()!; dirty = true; draw(); } }, "다시"),
      h("span", { class: "sep" }),
      btn("🖼 사진 불러오기", () => importImage(), "사진·이미지로 격자 채우기"),
      p.src === "pdf" ? btn("📄 PDF 차트에서", () => importFromPdf(), "PDF 차트 색으로 격자 채우기") : null,
      h("span", { style: "flex:1" }),
      btn("⚙ 설정", openSettings),
      h("button", { class: "btn primary", type: "button", text: "💾 저장", on: { click: save } }),
      btn("닫기", closeAsk),
    ),
    selBar,
    underBar,
    sizeBar(),
    body,
    h("div", { class: "ed-foot", style: "flex-direction:column;align-items:stretch" },
      desc,
      h("div", { class: "actions", style: "align-items:center" }, pal, btn("+", addColor, "색 추가")),
      h("div", { class: "actions ed-tools" }, toolBtns.select, toolBtns.pen, toolBtns.fill, toolBtns.erase),
    ),
  );
  document.body.append(ed);
  document.body.style.overflow = "hidden";
  setTool("pen");
  if (o.startImage) importImage(o.startImage);

  /** 도안 크기 안내: 새로 만들면 어디서 가져왔는지, 기존 격자가 도안과 다르면 맞추기 버튼 */
  function sizeBar() {
    const z = o.size;
    if (!z) return fresh ? h("div", { class: "ed-bar" }, h("span", { class: "gen", text: "도안에서 콧수를 찾지 못해 24코로 시작했어요. ⚙ 설정에서 바꿀 수 있어요." })) : null;
    if (fresh) return h("div", { class: "ed-bar" }, h("span", { class: "gen", text: `도안대로 ${z.w}코 × ${z.h}단(${z.start}단부터)으로 시작했어요 · ${z.why}` }));
    if (d.w === z.w && d.h === z.h && d.start === z.start) return null;
    const bar = h("div", { class: "ed-bar" },
      h("span", { class: "gen", text: `지금 격자 ${d.w}코 × ${d.h}단 · 도안은 ${z.w}코 × ${z.h}단 (${z.why})` }),
      btn("도안 크기로 맞추기", () => { edit({ ...resize(d, z.w, z.h), start: z.start, opt: d.opt }); bar.remove(); toast(`${z.w}코 × ${z.h}단으로 맞췄어요. 넘친 칸은 잘렸어요.`); }));
    return bar;
  }
  function btn(text: string, fn: () => void, label?: string) {
    return h("button", { class: "btn", type: "button", text, "aria-label": label || null, on: { click: fn } });
  }
  function zoomStep(dx: number) {
    cell = Math.max(6, Math.min(48, cell + dx));
    zoomSel.value = [...zoomSel.options].some((op) => op.value === String(cell)) ? String(cell) : zoomSel.value;
    draw();
  }
  const fitCell = () => Math.max(4, Math.floor((body.clientWidth - 80) / d.w));
  function setTool(t: Tool) {
    tool = t;
    (Object.keys(toolBtns) as (keyof typeof toolBtns)[]).forEach((k) => toolBtns[k].setAttribute("aria-pressed", String(k === t || (t === "paste" && k === "select"))));
    draw();
  }
  function edit(nd: Drawing) {
    if (nd === d) return;
    undo.push(d);
    if (undo.length > 200) undo.shift();
    redo.length = 0;
    d = nd;
    dirty = true;
    draw();
  }
  function drawPalette() {
    pal.innerHTML = "";
    colors.forEach((y, i) => {
      const on = cur === i && tool !== "erase";
      const b = h("button", { type: "button", role: "radio", "aria-checked": String(on), "aria-pressed": String(on), title: (y.name || y.code) + " · 다시 누르면 편집", style: { background: yarnHex(y, i) }, text: y.code });
      b.onclick = () => {
        if (cur === i && tool !== "erase" && tool !== "select") return editColor();
        cur = i;
        if (tool === "erase" || tool === "select" || tool === "paste") setTool("pen");
        else drawPalette();
      };
      pal.append(b);
    });
  }
  function draw() {
    drawPalette();
    selBar.hidden = !(tool === "select" || tool === "paste") || !sel;
    geom = drawGrid(canvas, d, colors, cell, { sel, n: focusRow, side: sideFor(focusRow), round: !!p.secs[part]?.round });
    if (under?.on) {
      const ctx = canvas.getContext("2d")!;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = under.alpha;
      ctx.drawImage(under.img, geom.ox, geom.oy, d.w * geom.cell, (geom.rows[1] - geom.rows[0] + 1) * geom.ch);
      ctx.restore();
    }
    underBar.hidden = !under;
    const s = sideFor(focusRow);
    const line = describeRow(d, focusRow, s, colors);
    const fl = longestFloat(d, focusRow);
    desc.textContent = `${focusRow}단 (${p.secs[part]?.round ? "원통" : s}) · ` + (line || "빈 단") + (fl && fl.len >= 6 ? ` · ⚠ 긴 플로트 ${fl.len}코` : "") + (tool === "paste" ? " · 붙일 자리를 누르세요" : "");
    legend.innerHTML = "";
    if (d.opt?.legend) {
      const cnt = colorCounts(d);
      colors.forEach((y, i) => legend.append(h("span", { class: "yarn" }, h("i", { style: { background: yarnHex(y, i) } }), `${y.code}${y.name ? " " + y.name : ""} · ${cnt[i] || 0}코`)));
    }
  }
  function sideFor(n: number) {
    const r = partRows(p, part).find((x) => x.n === n) || { s: part, n, t: "", st: null, side: null, pg: null, ch: null, span: null };
    return sideOf(p, r);
  }

  /* ----- 포인터 ----- */
  let down = false, anchor: { c: number; r: number } | null = null;
  const pos = (e: PointerEvent) => {
    const b = canvas.getBoundingClientRect();
    return hitCell(geom, e.clientX - b.left, e.clientY - b.top);
  };
  const paintColor = () => (tool === "erase" ? -1 : cur);
  canvas.addEventListener("pointerdown", (e) => {
    const hc = pos(e);
    if (!hc) return;
    canvas.setPointerCapture(e.pointerId);
    down = true;
    focus = hc;
    focusRow = hc.r + d.start;
    if (tool === "pen" || tool === "erase") edit(setCell(d, hc.c, hc.r, paintColor()));
    else if (tool === "fill") edit(floodFill(d, hc.c, hc.r, cur));
    else if (tool === "select") { anchor = hc; sel = { c0: hc.c, r0: hc.r, c1: hc.c, r1: hc.r }; }
    else if (tool === "paste" && clip) { edit(paste(d, clip, hc.c, hc.r - clip.h + 1)); }
    draw();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!down) return;
    const hc = pos(e);
    if (!hc) return;
    if (tool === "pen" || tool === "erase") {
      const nd = setCell(d, hc.c, hc.r, paintColor());
      if (nd !== d) { d = nd; dirty = true; draw(); } // 드래그 한 번 = 되돌리기 한 번
    } else if (tool === "select" && anchor) { sel = { c0: anchor.c, r0: anchor.r, c1: hc.c, r1: hc.r }; draw(); }
  });
  const up = () => { down = false; anchor = null; };
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);

  /* ----- 색 ----- */
  function addColor() {
    const code = CODES[colors.length] || "C" + (colors.length + 1);
    colors.push({ code, name: null, hex: ["#B23A48", "#E0A526", "#3E7C59", "#6B4E9B", "#222222", "#FFFFFF"][colors.length % 6] });
    cur = colors.length - 1;
    dirty = true;
    setTool("pen");
    editColor();
  }
  function editColor() {
    const y = colors[cur];
    const code = h("input", { type: "text", value: y.code, maxLength: 6 });
    const name = h("input", { type: "text", value: y.name || "", placeholder: "예: 아이보리 #101" });
    const hex = h("input", { type: "color", value: yarnHex(y, cur) });
    const dl = dialog("색 편집", [
      h("div", { class: "grid2" }, h("label", { class: "field" }, "색 기호 (서술에 쓰여요)", code), h("label", { class: "field" }, "실 이름", name)),
      h("label", { class: "field" }, "색", hex),
      h("div", { class: "actions" },
        h("button", { class: "btn primary", type: "button", text: "확인", on: { click: () => {
          const c = code.value.trim() || y.code;
          if (colors.some((x, i) => i !== cur && x.code === c)) return toast("이미 있는 기호예요.");
          colors[cur] = { code: c, name: name.value.trim() || null, hex: hex.value };
          dirty = true; dl.close(); draw();
        } } }),
        colors.length > 1 ? h("button", { class: "btn ghost", type: "button", text: "이 색 빼기", on: { click: () => {
          const nd = { ...d, cells: d.cells.split("").map((ch) => { if (ch === ".") return ch; const v = IDX.indexOf(ch); return v === cur ? "." : v > cur ? IDX[v - 1] : ch; }).join("") };
          colors.splice(cur, 1); cur = Math.max(0, cur - 1); edit(nd); dl.close();
        } } }) : null,
        h("button", { class: "btn ghost", type: "button", text: "취소", on: { click: () => dl.close() } })),
    ]);
  }

  /* ----- 설정 ----- */
  function openSettings() {
    const opt: DrawOpt = { ...d.opt };
    const sections: Record<string, () => HTMLElement> = {
      게이지: () => {
        const st = h("input", { type: "number", min: 1, step: "0.5", value: opt.gauge ? String(opt.gauge.st) : "" });
        const rows = h("input", { type: "number", min: 1, step: "0.5", value: opt.gauge ? String(opt.gauge.rows) : "" });
        const upd = () => { const a = +st.value, b = +rows.value; opt.gauge = a > 0 && b > 0 ? { st: a, rows: b } : null; };
        st.oninput = upd; rows.oninput = upd;
        const pg = primaryGauge(p.gauges);
        return h("div", { class: "set-sec" },
          h("p", { class: "hint", text: "10cm 안 콧수·단수. 칸을 실제 뜨개처럼 납작하게 그려서 완성 모양을 미리 볼 수 있어요. 비우면 정사각형." }),
          h("div", { class: "actions", style: "align-items:center" }, st, "코", rows, "단"),
          pg ? h("button", { class: "btn ghost", type: "button", text: `도안 게이지 쓰기 (${pg.st}코 ${pg.rows}단)`, on: { click: () => { st.value = String(pg.st); rows.value = String(pg.rows); upd(); } } }) : h("p", { class: "gen", text: "진행 화면의 '게이지'에 적으면 여기서 가져올 수 있어요." }));
      },
      크기: () => {
        const w = h("input", { type: "number", min: 1, max: 400, value: String(d.w) });
        const hh = h("input", { type: "number", min: 1, max: 400, value: String(d.h) });
        const s = h("input", { type: "number", min: 1, max: 999, value: String(d.start) });
        return h("div", { class: "set-sec" },
          h("div", { class: "actions", style: "align-items:center" }, h("label", {}, "콧수 ", w), h("label", {}, "단수 ", hh), h("label", {}, "시작 단 ", s)),
          h("p", { class: "gen", text: "왼쪽 아래 기준으로 늘리고 줄여요." }),
          h("button", { class: "btn", type: "button", text: "크기 적용", on: { click: () => { const nd = resize(d, +w.value, +hh.value); nd.start = Math.max(1, +s.value || 1); nd.opt = d.opt; edit(nd); toast("크기를 바꿨어요."); } } }),
          h("p", { class: "gen", text: focus ? `마지막으로 누른 칸: ${focus.r + d.start}단 · ${d.w - focus.c}번째 코` : "칸을 하나 누른 뒤 아래로 그 자리에 단·코를 넣거나 뺄 수 있어요." }),
          h("div", { class: "actions" },
            btn("그 단 위에 단 추가", () => edit(insertRow(d, focus ? focus.r + 1 : d.h))),
            btn("그 단 삭제", () => focus && edit(deleteRow(d, focus.r))),
            btn("그 코 옆에 코 추가", () => edit(insertCol(d, focus ? focus.c + 1 : d.w))),
            btn("그 코 삭제", () => focus && edit(deleteCol(d, focus.c))),
            btn("그 단 한 줄 칠하기", () => focus && edit(fillRow(d, focus.r, cur)))));
      },
      반복: () => h("div", { class: "set-sec" },
        h("p", { class: "hint", text: "아래 '선택'으로 반복 단위를 고른 뒤 선택 막대의 '반복 단위로 표시'를 누르면 빨간 상자로 보여요. '가로로/세로로 반복'은 그 단위를 끝까지 이어 그려요." }),
        opt.rep ? h("p", { text: `지금 반복 단위: ${Math.abs(opt.rep.c1 - opt.rep.c0) + 1}코 × ${Math.abs(opt.rep.r1 - opt.rep.r0) + 1}단` }) : h("p", { class: "gen", text: "표시된 반복 단위가 없어요." }),
        opt.rep ? h("button", { class: "btn ghost", type: "button", text: "반복 표시 지우기", on: { click: () => { opt.rep = null; } } }) : null),
      테두리: () => toggle("색 경계선 굵게", "색이 바뀌는 곳에 굵은 선을 그려 모양이 잘 보여요.", !!opt.outline, (v) => (opt.outline = v)),
      보기: () => {
        const v = h("div", { class: "tabs", role: "radiogroup" },
          ...(["grid", "stitch"] as const).map((k) => h("button", { type: "button", role: "radio", "aria-selected": String((opt.view || "grid") === k), text: k === "grid" ? "□ 격자" : "♡ 코 모양", on: { click: (e: Event) => { opt.view = k; (e.target as HTMLElement).parentElement!.querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", String(b === e.target))); } } })));
        return h("div", { class: "set-sec" },
          toggle("범례 보이기", "색마다 이름과 코 수를 격자 아래에 보여줘요.", !!opt.legend, (x) => (opt.legend = x)),
          h("div", { class: "field" }, "칸 그리기", v, h("small", { text: "코 모양은 뜬 편물처럼 보여 주고, 격자는 편집할 때 보기 쉬워요." })),
          h("button", { class: "btn", type: "button", text: "픽셀 보기 받기 (1코 = 1픽셀 PNG)", on: { click: async () => download(`colorwork-pixel.png`, await canvasBlob(pixelCanvas(d, colors, 1), "image/png")) } }),
          h("button", { class: "btn ghost", type: "button", text: "크게 받기 (1코 = 10픽셀)", on: { click: async () => download(`colorwork-grid.png`, await canvasBlob(pixelCanvas(d, colors, 10), "image/png")) } }));
      },
      서식: () => {
        const b = h("select", {}, ...[5, 10].map((k) => new Option(`${k}칸마다`, String(k), false, (opt.bold || 10) === k)));
        b.onchange = () => (opt.bold = +b.value);
        return h("div", { class: "set-sec" }, h("label", { class: "field" }, "굵은 격자선", b));
      },
      번호: () => {
        const dir = h("select", {}, new Option("오른쪽부터 (뜨개 차트 기본)", "r", false, !opt.colsFromLeft), new Option("왼쪽부터", "l", false, !!opt.colsFromLeft));
        dir.onchange = () => (opt.colsFromLeft = dir.value === "l");
        const ev = h("select", {}, new Option("칸 크기에 맞춰", "0", false, !opt.numEvery), ...[1, 2, 5, 10].map((k) => new Option(`${k}마다`, String(k), false, opt.numEvery === k)));
        ev.onchange = () => (opt.numEvery = +ev.value || undefined);
        return h("div", { class: "set-sec" }, h("label", { class: "field" }, "코 번호", dir), h("label", { class: "field" }, "번호 간격", ev));
      },
      불러오기: () => h("div", { class: "set-sec" },
        h("p", { class: "hint", text: "지금 격자를 바꿔요 (되돌리기 가능)." }),
        btn("이미지에서 불러오기", () => { dl.close(); importImage(); }),
        btn("PDF 차트에서 불러오기", () => { dl.close(); importFromPdf(); })),
    };
    const pane = h("div", { class: "set-pane" });
    const nav = h("div", { class: "set-nav", role: "tablist" });
    const show = (k: string) => {
      pane.innerHTML = "";
      pane.append(sections[k]());
      nav.querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", String(b.textContent === k)));
    };
    for (const k of Object.keys(sections)) nav.append(h("button", { type: "button", role: "tab", text: k, on: { click: () => show(k) } }));
    const dl = dialog("격자 설정", [
      h("div", { class: "set-wrap" }, nav, pane),
      h("div", { class: "actions" },
        h("button", { class: "btn primary", type: "button", text: "적용", on: { click: () => { edit({ ...d, opt }); dl.close(); } } }),
        h("button", { class: "btn ghost", type: "button", text: "취소", on: { click: () => dl.close() } })),
    ]);
    show("게이지");
  }
  function toggle(label: string, help: string, on: boolean, set: (v: boolean) => void) {
    const cb = h("input", { type: "checkbox", checked: on, on: { change: (e: Event) => set((e.target as HTMLInputElement).checked) } });
    return h("label", { class: "field", style: "flex-direction:row;gap:8px;align-items:flex-start" }, cb, h("span", {}, label, h("small", { style: "display:block", text: help })));
  }

  /* ----- 불러오기 ----- */
  async function importImage(file?: File) {
    const res = await openImageImport({ w: d.w, h: d.h, start: d.start, gauge: d.opt?.gauge, colors, file });
    if (!res) return;
    colors = res.colors;
    cur = Math.min(cur, colors.length - 1);
    if (res.photo) { under = { img: res.photo, alpha: +alphaIn.value / 100, on: true }; underToggle.textContent = "사진 숨기기"; }
    edit({ ...res.drawing, opt: d.opt });
    toast(`이미지를 ${d.w}×${d.h}칸으로 바꿨어요. 사진을 반투명하게 겹쳐 뒀으니 보면서 틀린 칸을 고쳐 주세요.`, 4200);
  }

  async function importFromPdf() {
    const page = partRows(p, part).find((r) => r.ch)?.ch || p.secs[part]?.ch;
    const pdf = await pdfOf(p);
    if (!pdf || !page) return toast("이 파트에 연결된 PDF 차트 쪽이 없어요. 진행 화면의 '차트 쪽 바꾸기'로 먼저 골라주세요.", 4200);
    const bmp = await chartBitmap(pdf, p.id, page);
    const c0 = chartFor(bmp.charts, d.start);
    if (!c0) return toast(`p${page}에서 단 번호 축을 찾지 못했어요. '이미지에서 불러오기'로 차트 부분을 잘라 올려주세요.`, 4200);
    const ctx = bmp.canvas.getContext("2d", { willReadFrequently: true })!;
    const px = (x: number, y: number): [number, number, number] => { const v = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data; return [v[0], v[1], v[2]]; };
    const S = bmp.scale;
    const yMid = rowY(c0, Math.round((c0.nMin + c0.nMax) / 2)) * S;
    const dark = (x: number) => { const [r, g, b] = px(x, yMid); return r + g + b < 300; };
    let gx0 = (c0.axes.length > 1 ? c0.axes[0] + 6 : c0.x0) * S, gx1 = (c0.axes.length > 1 ? c0.axes[c0.axes.length - 1] - 6 : c0.x1) * S;
    for (let x = gx0; x < gx1; x++) if (dark(x)) { gx0 = x; break; }
    for (let x = gx1; x > gx0; x--) if (dark(x)) { gx1 = x; break; }
    const wIn2 = h("input", { type: "number", min: 1, max: 400, value: String(d.w) });
    const go = await new Promise<boolean>((res) => {
      let ok = false;
      const dl = dialog("PDF 차트에서 불러오기", [
        h("p", { class: "hint", text: `p${page}의 ${c0.nMin}~${c0.nMax}단에서 칸 색을 읽어요. 차트 가로 콧수를 정확히 넣어 주세요.` }),
        h("label", { class: "field" }, "차트 가로 콧수", wIn2),
        h("div", { class: "actions" }, h("button", { class: "btn primary", type: "button", text: "불러오기", on: { click: () => { ok = true; dl.close(); } } }), h("button", { class: "btn ghost", type: "button", text: "취소", on: { click: () => dl.close() } })),
      ], { onClose: () => res(ok) });
    });
    if (!go) return;
    const w = Math.max(1, Math.min(400, +wIn2.value || d.w));
    const start = c0.nMin === 2 ? 1 : c0.nMin;
    const hgt = c0.nMax - start + 1;
    const cw = (gx1 - gx0) / w;
    const get = (c: number, r: number): [number, number, number] => {
      const n = r + start;
      const ch = chartFor(bmp.charts, n) || c0;
      const x = gx0 + (c + 0.5) * cw, y = rowY(ch, n) * S;
      const q = [px(x, y), px(x - cw * 0.2, y), px(x + cw * 0.2, y)];
      return [0, 1, 2].map((k) => (q[0][k] + q[1][k] + q[2][k]) / 3) as [number, number, number];
    };
    if (!colors.some((y) => y.hex)) {
      const samples: [number, number, number][] = [];
      for (let r = 0; r < hgt; r += Math.max(1, Math.floor(hgt / 40))) for (let c = 0; c < w; c += Math.max(1, Math.floor(w / 40))) samples.push(get(c, r));
      const { quantize } = await import("./drawing");
      colors = quantize(samples, 4).map((hex, i) => ({ code: CODES[i], name: null, hex }));
    }
    edit({ ...gridFromPixels(get, w, hgt, colors.map((y) => y.hex), start), opt: d.opt });
    toast("PDF 차트 색으로 칸을 채웠어요. 틀린 칸은 직접 고쳐 주세요.", 3600);
  }

  /* ----- 저장 ----- */
  function save() {
    p.draw[part] = d;
    p.colors = colors;
    p.secs[part] = p.secs[part] || { odd: "RS" };
    applyDrawing(p, part);
    p.rev++;
    commit(p);
    dirty = false;
    toast("배색을 저장했어요. 단마다 색 서술이 만들어졌어요.");
    close();
  }
  function closeAsk(): void {
    if (!dirty) return close();
    ask("저장하지 않았어요", "고친 내용을 저장하지 않고 닫을까요?", "닫기", "계속 편집").then((ok) => ok && close());
  }
  function close() {
    ed.remove();
    document.body.style.overflow = "";
    o.onSave();
  }
}
