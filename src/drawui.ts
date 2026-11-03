/** 배색 격자 편집기 */
import { drawGrid, hitCell, yarnHex, chartBitmap, type GridGeom } from "./chart";
import {
  copyRect, deleteCol, deleteRow, describeRow, fillRow, floodFill, gridFromPixels, insertCol, insertRow, longestFloat, mirrorRect, newDrawing, normRect, paste,
  resize, rgbToHex, setCell, tileRepeat, type Clip, type Rect,
} from "./drawing";
import { applyDrawing, partRows, sideOf } from "./model";
import { chartFor, rowY } from "./pdfgeom";
import { commit, pdfOf } from "./store";
import { dialog, h, toast } from "./ui";
import type { Drawing, Pattern, Yarn } from "./types";

type Tool = "pen" | "fill" | "select" | "paste";
const CODES = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function openEditor(p: Pattern, part: string, o: { onSave: () => void }) {
  let d: Drawing = p.draw[part] ? { ...p.draw[part] } : newDrawing(24, Math.max(10, partRows(p, part).length || 20), partRows(p, part)[0]?.n || 1);
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
  let dirty = false;

  const canvas = h("canvas", { "aria-label": "배색 격자. 칸을 눌러 칠해요." });
  const body = h("div", { class: "ed-body" }, canvas);
  const pal = h("div", { class: "pal", role: "radiogroup", "aria-label": "색" });
  const desc = h("div", { class: "ed-desc", "aria-live": "polite" });
  const wIn = h("input", { type: "number", min: 1, max: 400, value: String(d.w), "aria-label": "콧수" });
  const hIn = h("input", { type: "number", min: 1, max: 400, value: String(d.h), "aria-label": "단수" });
  const sIn = h("input", { type: "number", min: 1, max: 999, value: String(d.start), "aria-label": "시작 단" });
  const toolBtns: Record<Tool, HTMLButtonElement> = {
    pen: h("button", { class: "btn", type: "button", text: "✏ 칠하기" }),
    fill: h("button", { class: "btn", type: "button", text: "▦ 채우기" }),
    select: h("button", { class: "btn", type: "button", text: "▭ 선택" }),
    paste: h("button", { class: "btn", type: "button", text: "📋 붙이기", disabled: true }),
  };
  (Object.keys(toolBtns) as Tool[]).forEach((t) => (toolBtns[t].onclick = () => setTool(t)));
  const selBtns = h("span", { class: "actions", style: "display:inline-flex;gap:6px" },
    btn("복사", () => { if (sel) { clip = copyRect(d, sel); toolBtns.paste.disabled = false; toast("복사했어요. '붙이기'로 놓을 칸을 누르세요."); } }),
    btn("좌우 반전", () => sel && edit(mirrorRect(d, sel, "h"))),
    btn("상하 반전", () => sel && edit(mirrorRect(d, sel, "v"))),
    btn("가로 반복", () => sel && edit(tileRepeat(d, sel, "x"))),
    btn("세로 반복", () => sel && edit(tileRepeat(d, sel, "y"))),
    btn("선택 칠하기", () => { if (!sel) return; const q = normRect(sel); let nd = d; for (let r = q.r0; r <= q.r1; r++) for (let c = q.c0; c <= q.c1; c++) nd = setCell(nd, c, r, cur); edit(nd); }),
  );

  const ed = h("div", { class: "editor", role: "dialog", "aria-modal": "true", "aria-label": `${part} 배색 그리기` },
    h("div", { class: "ed-bar" },
      h("strong", { text: part }), h("span", { class: "sep" }),
      pal, btn("+ 색", addColor), btn("색 편집", editColor), h("span", { class: "sep" }),
      toolBtns.pen, toolBtns.fill, toolBtns.select, toolBtns.paste,
    ),
    h("div", { class: "ed-bar" }, selBtns),
    h("div", { class: "ed-bar" },
      btn("↶ 되돌리기", () => { if (undo.length) { redo.push(d); d = undo.pop()!; dirty = true; draw(); } }),
      btn("↷ 다시", () => { if (redo.length) { undo.push(d); d = redo.pop()!; dirty = true; draw(); } }),
      h("span", { class: "sep" }),
      btn("단 한 줄 칠하기", () => focus && edit(fillRow(d, focus.r, cur))),
      btn("단 추가", () => edit(insertRow(d, focus ? focus.r + 1 : d.h))),
      btn("단 삭제", () => focus && edit(deleteRow(d, focus.r))),
      btn("코 추가", () => edit(insertCol(d, focus ? focus.c + 1 : d.w))),
      btn("코 삭제", () => focus && edit(deleteCol(d, focus.c))),
      h("span", { class: "sep" }),
      h("label", {}, "콧수 ", wIn), h("label", {}, "단수 ", hIn), h("label", {}, "시작 단 ", sIn),
      btn("크기 적용", () => { const nd = resize(d, +wIn.value, +hIn.value); nd.start = Math.max(1, +sIn.value || 1); edit(nd); }),
      h("span", { class: "sep" }),
      btn("−", () => { cell = Math.max(8, cell - 4); draw(); }), btn("+", () => { cell = Math.min(44, cell + 4); draw(); }),
      h("span", { class: "sep" }),
      btn("PDF 차트에서 불러오기", importFromPdf), btn("사진에서 불러오기", importFromPhoto),
    ),
    body,
    h("div", { class: "ed-foot" }, desc,
      h("span", { class: "actions" },
        h("button", { class: "btn primary", type: "button", text: "저장", on: { click: save } }),
        h("button", { class: "btn ghost", type: "button", text: "닫기", on: { click: closeAsk } }))),
  );
  document.body.append(ed);
  document.body.style.overflow = "hidden";
  setTool("pen");

  function btn(text: string, fn: () => void) {
    return h("button", { class: "btn", type: "button", text, on: { click: fn } });
  }
  function setTool(t: Tool) {
    tool = t;
    (Object.keys(toolBtns) as Tool[]).forEach((k) => toolBtns[k].setAttribute("aria-pressed", String(k === t)));
    selBtns.querySelectorAll("button").forEach((b) => ((b as HTMLButtonElement).disabled = !sel));
    draw();
  }
  function edit(nd: Drawing) {
    if (nd === d) return;
    undo.push(d);
    if (undo.length > 200) undo.shift();
    redo.length = 0;
    d = nd;
    dirty = true;
    wIn.value = String(d.w); hIn.value = String(d.h); sIn.value = String(d.start);
    draw();
  }
  function drawPalette() {
    pal.innerHTML = "";
    colors.forEach((y, i) => {
      const b = h("button", { type: "button", role: "radio", "aria-checked": String(cur === i), "aria-pressed": String(cur === i), title: y.name || y.code, style: { background: yarnHex(y, i) }, text: y.code });
      b.onclick = () => { cur = i; if (tool === "select" || tool === "paste") setTool("pen"); drawPalette(); };
      pal.append(b);
    });
    const er = h("button", { type: "button", class: "erase", role: "radio", "aria-checked": String(cur === -1), "aria-pressed": String(cur === -1), title: "지우개", "aria-label": "지우개" });
    er.onclick = () => { cur = -1; drawPalette(); };
    pal.append(er);
  }
  function draw() {
    drawPalette();
    geom = drawGrid(canvas, d, colors, cell, { sel, n: focusRow, side: sideFor(focusRow), round: !!p.secs[part]?.round });
    const s = sideFor(focusRow);
    const line = describeRow(d, focusRow, s, colors);
    const fl = longestFloat(d, focusRow);
    desc.textContent = `${focusRow}단 (${p.secs[part]?.round ? "원통" : s}) · ` + (line || "빈 단") + (fl && fl.len >= 6 ? ` · ⚠ 긴 플로트 ${fl.len}코` : "");
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
  canvas.addEventListener("pointerdown", (e) => {
    const hc = pos(e);
    if (!hc) return;
    canvas.setPointerCapture(e.pointerId);
    down = true;
    focus = hc;
    focusRow = hc.r + d.start;
    if (tool === "pen") edit(setCell(d, hc.c, hc.r, cur));
    else if (tool === "fill") edit(floodFill(d, hc.c, hc.r, cur));
    else if (tool === "select") { anchor = hc; sel = { c0: hc.c, r0: hc.r, c1: hc.c, r1: hc.r }; setTool("select"); }
    else if (tool === "paste" && clip) edit(paste(d, clip, hc.c, hc.r - clip.h + 1));
    draw();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!down) return;
    const hc = pos(e);
    if (!hc) return;
    if (tool === "pen") {
      const nd = setCell(d, hc.c, hc.r, cur);
      if (nd !== d) { d = nd; dirty = true; draw(); } // 드래그 한 번 = 되돌리기 한 번
    } else if (tool === "select" && anchor) { sel = { c0: anchor.c, r0: anchor.r, c1: hc.c, r1: hc.r }; draw(); }
  });
  const up = () => { down = false; anchor = null; selBtns.querySelectorAll("button").forEach((b) => ((b as HTMLButtonElement).disabled = !sel)); };
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);

  /* ----- 색 ----- */
  function addColor() {
    const code = CODES[colors.length] || "C" + (colors.length + 1);
    colors.push({ code, name: null, hex: ["#B23A48", "#E0A526", "#3E7C59", "#6B4E9B", "#222222", "#FFFFFF"][colors.length % 6] });
    cur = colors.length - 1;
    dirty = true;
    editColor();
  }
  function editColor() {
    if (cur < 0) return toast("지우개 말고 색을 먼저 골라주세요.");
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
          // 이 색 칸은 빈칸으로, 뒤 색 인덱스는 하나씩 당긴다
          const IDX = "0123456789abcdefghijklmnopqrstuvwxyz";
          const nd = { ...d, cells: d.cells.split("").map((ch) => { if (ch === ".") return ch; const v = IDX.indexOf(ch); return v === cur ? "." : v > cur ? IDX[v - 1] : ch; }).join("") };
          colors.splice(cur, 1); cur = Math.max(0, cur - 1); edit(nd); dl.close();
        } } }) : null,
        h("button", { class: "btn ghost", type: "button", text: "취소", on: { click: () => dl.close() } })),
    ]);
  }

  /* ----- 불러오기 ----- */
  function paletteFrom(samples: [number, number, number][]): Yarn[] {
    const bins = new Map<string, { r: number; g: number; b: number; n: number }>();
    for (const [r, g, b] of samples) {
      const k = `${r >> 5},${g >> 5},${b >> 5}`;
      const x = bins.get(k) || { r: 0, g: 0, b: 0, n: 0 };
      x.r += r; x.g += g; x.b += b; x.n++;
      bins.set(k, x);
    }
    const top = [...bins.values()].sort((a, b) => b.n - a.n).filter((x) => x.n / samples.length > 0.02).slice(0, 8);
    return top.map((x, i) => ({ code: CODES[i], name: null, hex: rgbToHex(x.r / x.n, x.g / x.n, x.b / x.n) }));
  }
  let replace = false;
  async function choosePalette(samples: [number, number, number][]) {
    return new Promise<void>((res) => {
      const dl = dialog("색 정하기", [
        h("p", { class: "hint", text: "칸 색을 어떤 팔레트에 맞출까요?" }),
        h("div", { class: "actions" },
          h("button", { class: "btn primary", type: "button", text: "지금 팔레트에 맞추기", on: { click: () => { replace = false; dl.close(); } } }),
          h("button", { class: "btn", type: "button", text: "이미지 색으로 새 팔레트", on: { click: () => { replace = true; dl.close(); } } })),
      ], { onClose: () => { if (replace) colors = paletteFrom(samples); res(); } });
    });
  }

  async function importFromPdf() {
    const page = partRows(p, part).find((r) => r.ch)?.ch || p.secs[part]?.ch;
    const pdf = await pdfOf(p);
    if (!pdf || !page) return toast("이 파트에 연결된 PDF 차트 쪽이 없어요. 진행 화면의 '차트 쪽 바꾸기'로 먼저 골라주세요.", 4200);
    const bmp = await chartBitmap(pdf, p.id, page);
    const c0 = chartFor(bmp.charts, d.start);
    if (!c0) return toast(`p${page}에서 단 번호 축을 찾지 못했어요. '사진에서 불러오기'로 차트 부분을 잘라 올려주세요.`, 4200);
    const ctx = bmp.canvas.getContext("2d", { willReadFrequently: true })!;
    const px = (x: number, y: number): [number, number, number] => { const v = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data; return [v[0], v[1], v[2]]; };
    const S = bmp.scale;
    // 격자 가로 범위: 가운데 단에서 축 안쪽으로 첫 진한 선을 찾는다
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
    const samples: [number, number, number][] = [];
    for (let r = 0; r < hgt; r += Math.max(1, Math.floor(hgt / 40))) for (let c = 0; c < w; c += Math.max(1, Math.floor(w / 40))) samples.push(get(c, r));
    await choosePalette(samples);
    edit(gridFromPixels(get, w, hgt, colors.map((y) => y.hex), start));
    toast("PDF 차트 색으로 칸을 채웠어요. 틀린 칸은 직접 고쳐 주세요.", 3600);
  }

  function importFromPhoto() {
    const inp = h("input", { type: "file", accept: "image/*" });
    inp.onchange = async () => {
      const f = inp.files?.[0];
      if (!f) return;
      const bmp = await createImageBitmap(f);
      const c = document.createElement("canvas");
      c.width = bmp.width; c.height = bmp.height;
      const ctx = c.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(bmp, 0, 0);
      const cw = c.width / d.w, ch = c.height / d.h;
      const get = (x: number, r: number): [number, number, number] => {
        const v = ctx.getImageData(Math.floor((x + 0.5) * cw), Math.floor((d.h - 1 - r + 0.5) * ch), 1, 1).data;
        return [v[0], v[1], v[2]];
      };
      const samples: [number, number, number][] = [];
      for (let r = 0; r < d.h; r++) for (let x = 0; x < d.w; x++) samples.push(get(x, r));
      await choosePalette(samples);
      edit(gridFromPixels(get, d.w, d.h, colors.map((y) => y.hex), d.start));
      toast(`사진을 ${d.w}×${d.h}칸으로 나눠 색을 읽었어요. 사진은 차트 부분만 잘라 올리면 정확해요.`, 4200);
    };
    inp.click();
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
  function closeAsk() {
    if (dirty && !confirm("저장하지 않은 변경이 있어요. 닫을까요?")) return;
    close();
  }
  function close() {
    ed.remove();
    document.body.style.overflow = "";
    o.onSave();
  }
}
