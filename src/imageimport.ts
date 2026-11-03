/** 이미지로 시작: 자르기 상자 · 콧수/단수 · 보기(원본/원본+격자/격자) · 팔레트 → 배색 격자 */
import { detectGrid, gridFromImage, quantize, quantizeAuto, rowsForWidth, getCell } from "./drawing";
import { yarnHex } from "./chart";
import { h, toast } from "./ui";
import type { Drawing, Yarn } from "./types";

type Result = { drawing: Drawing; colors: Yarn[] };
type View = "image" | "overlay" | "grid";
const CODES = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function openImageImport(o: { w?: number; h?: number; start?: number; gauge?: { st: number; rows: number } | null; colors?: Yarn[]; file?: File }): Promise<Result | null> {
  return new Promise((resolve) => {
    let img: HTMLCanvasElement | null = null;
    let data: Uint8ClampedArray | null = null;
    let crop = { x: 0, y: 0, w: 1, h: 1 };
    let W = o.w || 40, H = o.h || 40;
    let view: View = "overlay";
    let zoom = 1; // 화면 맞춤 대비 배율
    let keepRatio = true;
    let colors: Yarn[] = (o.colors || []).map((y) => ({ ...y }));
    let preview: Drawing | null = null;

    const cv = h("canvas", { "aria-label": "이미지와 자르기 상자" });
    const body = h("div", { class: "ed-body" }, cv);
    const wIn = h("input", { type: "number", min: 1, max: 400, value: String(W), "aria-label": "가로 콧수" });
    const hIn = h("input", { type: "number", min: 1, max: 400, value: String(H), "aria-label": "세로 단수" });
    const ratio = h("input", { type: "checkbox", checked: keepRatio, "aria-label": "비율 유지" });
    const kSel = h("select", { "aria-label": "색 수" }, new Option("색 수 자동", "auto", false, true), ...[2, 3, 4, 5, 6, 8].map((k) => new Option(`${k}색`, String(k))));
    const zoomSel = h("select", { "aria-label": "확대" }, ...[["0.5", "50%"], ["0.75", "75%"], ["1", "맞춤"], ["1.5", "150%"], ["2", "200%"], ["3", "300%"]].map(([v, t]) => new Option(t, v, false, v === "1")));
    const pal = h("div", { class: "pal" });
    const viewBtns: Record<View, HTMLButtonElement> = {
      image: h("button", { class: "btn", type: "button", text: "🖼 원본", title: "원본만" }),
      overlay: h("button", { class: "btn", type: "button", text: "▦ 원본+격자", title: "원본 위에 격자" }),
      grid: h("button", { class: "btn", type: "button", text: "▩ 격자", title: "만들어질 격자" }),
    };
    (Object.keys(viewBtns) as View[]).forEach((v) => (viewBtns[v].onclick = () => { view = v; draw(); }));
    const fileIn = h("input", { type: "file", accept: "image/*", class: "sr" });

    const ed = h("div", { class: "editor", role: "dialog", "aria-modal": "true", "aria-label": "이미지로 시작" },
      h("div", { class: "ed-bar" },
        h("button", { class: "btn", type: "button", text: "🖼 이미지 바꾸기", on: { click: () => fileIn.click() } }), fileIn,
        h("span", { class: "sep" }),
        h("label", {}, "↔ 가로 ", wIn, "코"), h("label", {}, "↕ 세로 ", hIn, "단"),
        h("label", { title: "게이지(없으면 정사각형)를 지켜 세로 단수를 맞춰요" }, ratio, "비율 유지"),
        h("span", { class: "sep" }),
        h("button", { class: "btn", type: "button", text: "▦ 격자 자동 찾기", on: { click: () => findGrid() } }),
        h("span", { class: "sep" }),
        viewBtns.image, viewBtns.overlay, viewBtns.grid,
        h("span", { class: "sep" }),
        h("label", {}, "확대 ", zoomSel),
      ),
      body,
      h("div", { class: "ed-foot" },
        h("span", { class: "actions", style: "align-items:center" }, h("span", { class: "gen", text: "색" }), pal,
          h("button", { class: "btn", type: "button", text: "+", "aria-label": "색 추가", on: { click: addColor } })),
        h("span", { class: "actions", style: "align-items:center" }, kSel,
          h("button", { class: "btn", type: "button", text: "이미지에서 색 뽑기", on: { click: autoPalette } }),
          o.colors && o.colors.some((y) => y.hex) ? h("button", { class: "btn ghost", type: "button", text: "지금 도안 색에 맞추기", on: { click: () => { colors = o.colors!.map((y) => ({ ...y })); update(); } } }) : null),
        h("span", { class: "actions" },
          h("button", { class: "btn primary", type: "button", text: "💾 저장", on: { click: save } }),
          h("button", { class: "btn ghost", type: "button", text: "취소", on: { click: () => close(null) } })),
      ),
    );
    document.body.append(ed);
    document.body.style.overflow = "hidden";

    fileIn.onchange = () => fileIn.files?.[0] && load(fileIn.files[0]);
    wIn.onchange = () => { W = clamp(+wIn.value); if (keepRatio && img) { H = rowsForWidth(W, crop.w, crop.h, o.gauge); hIn.value = String(H); } update(); };
    hIn.onchange = () => { H = clamp(+hIn.value); update(); };
    ratio.onchange = () => { keepRatio = ratio.checked; wIn.onchange!(new Event("change")); };
    zoomSel.onchange = () => { zoom = +zoomSel.value; draw(); };
    kSel.onchange = autoPalette;
    if (o.file) load(o.file);
    else fileIn.click();

    async function load(f: File) {
      try {
        const bmp = await createImageBitmap(f);
        const s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
        img = document.createElement("canvas");
        img.width = Math.round(bmp.width * s);
        img.height = Math.round(bmp.height * s);
        const ctx = img.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(bmp, 0, 0, img.width, img.height);
        data = ctx.getImageData(0, 0, img.width, img.height).data;
        crop = { x: 0, y: 0, w: img.width, h: img.height };
        if (keepRatio) { H = rowsForWidth(W, crop.w, crop.h, o.gauge); hIn.value = String(H); }
        // 차트 사진이면 격자를 찾아 콧수·단수·범위를 자동으로
        if (!findGrid(true)) autoPalette();
      } catch {
        toast("이미지를 열지 못했어요.");
      }
    }
    const px = (x: number, y: number): [number, number, number] => {
      if (!img || !data) return [255, 255, 255];
      const xi = Math.max(0, Math.min(img.width - 1, Math.floor(x))), yi = Math.max(0, Math.min(img.height - 1, Math.floor(y)));
      const i = (yi * img.width + xi) * 4;
      return [data[i], data[i + 1], data[i + 2]];
    };
    /** 사진 속 차트 격자 찾기 → 자르기 상자·가로 콧수·세로 단수 */
    function findGrid(quiet = false): boolean {
      if (!img || !data) return false;
      const lumAt = (x: number, y: number) => {
        const [r, g, b] = px(x, y);
        return 0.3 * r + 0.59 * g + 0.11 * b;
      };
      // 지금 자르기 상자 안에서 찾는다 (처음엔 사진 전체)
      const g = detectGrid((x, y) => lumAt(crop.x + x, crop.y + y), Math.round(crop.w), Math.round(crop.h));
      if (!g || g.cols > 400 || g.rows > 400) {
        if (!quiet) toast("격자를 찾지 못했어요. 차트 부분만 자르기 상자로 감싼 뒤 다시 눌러 보거나 콧수·단수를 직접 넣어 주세요.", 4200);
        return false;
      }
      crop = { x: crop.x + g.x, y: crop.y + g.y, w: g.w, h: g.h };
      W = g.cols; H = g.rows;
      wIn.value = String(W); hIn.value = String(H);
      keepRatio = false; ratio.checked = false;
      view = "overlay";
      autoPalette();
      toast(`격자를 찾았어요: 가로 ${W}코 × 세로 ${H}단. 칸이 어긋나면 자르기 상자를 맞추세요.`, 3800);
      return true;
    }

    function autoPalette() {
      if (!img) return;
      const samples: [number, number, number][] = [];
      const step = Math.max(1, Math.floor(Math.sqrt((crop.w * crop.h) / 6000)));
      for (let y = crop.y; y < crop.y + crop.h; y += step) for (let x = crop.x; x < crop.x + crop.w; x += step) samples.push(px(x, y));
      const pal = kSel.value === "auto" ? quantizeAuto(samples) : quantize(samples, +kSel.value);
      colors = pal.map((hex, i) => ({ code: CODES[i], name: null, hex }));
      update();
    }
    function addColor() {
      colors.push({ code: CODES[colors.length] || "C" + (colors.length + 1), name: null, hex: "#888888" });
      update();
    }
    function drawPalette() {
      pal.innerHTML = "";
      colors.forEach((y, i) => {
        const inp = h("input", { type: "color", value: yarnHex(y, i), "aria-label": `${y.code} 색`, title: `${y.code} — 눌러서 바꾸기, 길게 눌러 빼기` });
        inp.style.cssText = "width:34px;height:34px;padding:0;border:1px solid var(--rule);border-radius:8px";
        inp.oninput = () => { colors[i] = { ...y, hex: inp.value }; update(); };
        inp.oncontextmenu = (e) => { e.preventDefault(); if (colors.length > 1) { colors.splice(i, 1); update(); } };
        pal.append(h("span", { style: "display:inline-flex;flex-direction:column;align-items:center;font-size:.7rem" }, inp, y.code));
      });
    }
    function update() {
      drawPalette();
      preview = img && colors.length ? gridFromImage(px, crop, W, H, colors.map((y) => y.hex), o.start || 1) : null;
      draw();
    }
    const clamp = (v: number) => Math.max(1, Math.min(400, Math.round(v) || 1));

    /* ----- 그리기 ----- */
    let fit = 1; // 원본 px → 화면 px
    function draw() {
      (Object.keys(viewBtns) as View[]).forEach((v) => viewBtns[v].setAttribute("aria-pressed", String(v === view)));
      if (!img) return;
      const avail = Math.max(200, body.clientWidth - 32), availH = Math.max(200, window.innerHeight - 200);
      fit = Math.min(avail / img.width, availH / img.height) * zoom;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const Wc = img.width * fit, Hc = img.height * fit;
      cv.width = Math.round(Wc * dpr); cv.height = Math.round(Hc * dpr);
      cv.style.width = Wc + "px"; cv.style.height = Hc + "px";
      const ctx = cv.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, Wc, Hc);
      const cx = crop.x * fit, cy = crop.y * fit, cw = crop.w * fit, chh = crop.h * fit;
      if (view !== "grid") ctx.drawImage(img, 0, 0, Wc, Hc);
      else ctx.globalAlpha = 1;
      if (view === "grid" && preview) {
        const sx = cw / W, sy = chh / H;
        for (let r = 0; r < H; r++)
          for (let c = 0; c < W; c++) {
            const v = getCell(preview, c, r);
            ctx.fillStyle = v < 0 ? "#fff" : yarnHex(colors[v], v);
            ctx.fillRect(cx + c * sx, cy + (H - 1 - r) * sy, Math.ceil(sx), Math.ceil(sy));
          }
      }
      if (view !== "image") {
        const sx = cw / W, sy = chh / H;
        ctx.strokeStyle = view === "grid" ? "rgba(0,0,0,.25)" : "rgba(0,0,0,.45)";
        ctx.lineWidth = sx < 4 ? 0.3 : 0.7;
        ctx.beginPath();
        for (let c = 0; c <= W; c++) { ctx.moveTo(cx + c * sx, cy); ctx.lineTo(cx + c * sx, cy + chh); }
        for (let r = 0; r <= H; r++) { ctx.moveTo(cx, cy + r * sy); ctx.lineTo(cx + cw, cy + r * sy); }
        ctx.stroke();
      }
      // 자르기 상자 바깥 흐리게 + 핸들
      ctx.fillStyle = "rgba(255,255,255,.6)";
      ctx.fillRect(0, 0, Wc, cy); ctx.fillRect(0, cy + chh, Wc, Hc - cy - chh); ctx.fillRect(0, cy, cx, chh); ctx.fillRect(cx + cw, cy, Wc - cx - cw, chh);
      ctx.strokeStyle = "#1D9BF0"; ctx.lineWidth = 1.5;
      ctx.strokeRect(cx, cy, cw, chh);
      for (const [hx, hy] of handles()) { ctx.fillStyle = "#fff"; ctx.fillRect(hx - 6, hy - 6, 12, 12); ctx.strokeRect(hx - 6, hy - 6, 12, 12); }
    }
    const handles = () => {
      const x0 = crop.x * fit, y0 = crop.y * fit, x1 = (crop.x + crop.w) * fit, y1 = (crop.y + crop.h) * fit, xm = (x0 + x1) / 2, ym = (y0 + y1) / 2;
      return [[x0, y0], [xm, y0], [x1, y0], [x1, ym], [x1, y1], [xm, y1], [x0, y1], [x0, ym]];
    };

    /* ----- 자르기 상자 끌기 ----- */
    let drag: { kind: number; sx: number; sy: number; start: typeof crop } | null = null; // kind: 0~7 핸들, 8 이동
    cv.addEventListener("pointerdown", (e) => {
      if (!img) return;
      const b = cv.getBoundingClientRect();
      const x = e.clientX - b.left, y = e.clientY - b.top;
      const hs = handles();
      let kind = hs.findIndex(([hx, hy]) => Math.abs(hx - x) < 14 && Math.abs(hy - y) < 14);
      if (kind < 0 && x > crop.x * fit && x < (crop.x + crop.w) * fit && y > crop.y * fit && y < (crop.y + crop.h) * fit) kind = 8;
      if (kind < 0) return;
      cv.setPointerCapture(e.pointerId);
      drag = { kind, sx: x, sy: y, start: { ...crop } };
    });
    cv.addEventListener("pointermove", (e) => {
      if (!drag || !img) return;
      const b = cv.getBoundingClientRect();
      const dx = (e.clientX - b.left - drag.sx) / fit, dy = (e.clientY - b.top - drag.sy) / fit;
      const s = drag.start;
      let x0 = s.x, y0 = s.y, x1 = s.x + s.w, y1 = s.y + s.h;
      if (drag.kind === 8) { x0 += dx; x1 += dx; y0 += dy; y1 += dy; }
      else {
        if ([0, 6, 7].includes(drag.kind)) x0 += dx;
        if ([2, 3, 4].includes(drag.kind)) x1 += dx;
        if ([0, 1, 2].includes(drag.kind)) y0 += dy;
        if ([4, 5, 6].includes(drag.kind)) y1 += dy;
      }
      const iw = img.width, ih = img.height;
      if (drag.kind === 8) { const ox = Math.min(0, iw - x1) + Math.max(0, -x0), oy = Math.min(0, ih - y1) + Math.max(0, -y0); x0 += ox; x1 += ox; y0 += oy; y1 += oy; }
      x0 = Math.max(0, Math.min(x0, x1 - 8)); y0 = Math.max(0, Math.min(y0, y1 - 8));
      x1 = Math.min(iw, Math.max(x1, x0 + 8)); y1 = Math.min(ih, Math.max(y1, y0 + 8));
      crop = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      draw();
    });
    const end = () => {
      if (!drag) return;
      drag = null;
      if (keepRatio) { H = rowsForWidth(W, crop.w, crop.h, o.gauge); hIn.value = String(H); }
      update();
    };
    cv.addEventListener("pointerup", end);
    cv.addEventListener("pointercancel", end);
    window.addEventListener("resize", draw);

    function save() {
      if (!img || !preview) return toast("이미지를 먼저 골라주세요.");
      close({ drawing: preview, colors });
    }
    function close(r: Result | null) {
      window.removeEventListener("resize", draw);
      ed.remove();
      document.body.style.overflow = "";
      resolve(r);
    }
  });
}
