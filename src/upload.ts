/** §1-1 도안 올리기 · §1-2 Claude로 구조화 (배치·병합·캐시) */
import { AiError, callAi, errCopy, parseJson } from "./ai";
import type { Part } from "./anthropicCall";
import { MAX_BODY_BYTES, MAX_TOKENS, PAGES_PER_BATCH, PROMPT_VERSION } from "./config";
import { cacheGet, cacheSet, putFile } from "./db";
import { manualHandler } from "./dialogs";
import { openEditor } from "./drawui";
import { newDrawing } from "./drawing";
import { applyDrawing, colorsInText, expand, mergeSections, mergeYarns, newPattern, str, toSections } from "./model";
import { localParse, needsClaude, parseRange, toRanges } from "./parse";
import { b64, blobB64, canvasBlob, extractPages, openPdf, renderWidth, sha256, textItems, type Pdf } from "./pdf";
import { autoPick, normSize, pageInfo, type PageInfo } from "./pdfgeom";
import { STRUCTURE_SCHEMA, structurePrompt } from "./prompts";
import { commit, forgetPdf, setActive, state } from "./store";
import { $, h, toast } from "./ui";
import type { AiResult, AiSection, Pattern, Yarn } from "./types";
import { clearBitmaps } from "./chart";

type Opts = { appendTo?: string; relink?: boolean; onDone: () => void };

export function openUpload(o: Opts) {
  const target = o.appendTo ? state.patterns[o.appendTo] : null;
  const up = { mode: "file" as "file" | "text" | "draw", pdf: null as Pdf | null, pdfBlob: null as Blob | null, images: [] as File[], selected: new Set<number>(), info: [] as PageInfo[] };
  let ctl: AbortController | null = null;

  const nameIn = h("input", { type: "text", placeholder: "예: 하트 체인 가디건", value: target?.name || "", disabled: !!target });
  const sizeIn = h("input", { type: "text", placeholder: "예: L", value: target?.size || "" });
  const fileIn = h("input", { class: "sr", type: "file", multiple: true, accept: "application/pdf,image/*", id: "fileIn" });
  const drop = h("label", { class: "drop", for: "fileIn" }, h("strong", { text: o.relink ? "이 도안의 원본 PDF를 고르세요" : "도안 PDF나 사진을 고르세요" }), h("span", { text: "사진은 여러 장 한 번에 · 끌어다 놓아도 돼요" }));
  const fileList = h("ul", { class: "files" });
  const autoNote = h("span", { class: "hint" });
  const pgRange = h("input", { type: "text", placeholder: "예: 2, 5, 7-12", "aria-label": "페이지 범위" });
  const pgCount = h("span", { class: "prog" });
  const pages = h("div", { class: "pages" });
  const pdfPick = h("div", { hidden: true, style: "display:flex;flex-direction:column;gap:8px" },
    h("div", { class: "pg-tools" }, autoNote),
    h("div", { class: "pg-tools" }, pgRange,
      h("button", { class: "btn", type: "button", text: "범위 선택", on: { click: () => { if (up.pdf) { up.selected = parseRange(pgRange.value, up.pdf.numPages); syncThumbs(); } } } }),
      h("button", { class: "btn ghost", type: "button", text: "선택 해제", on: { click: () => { up.selected = new Set(); syncThumbs(); } } }),
      pgCount),
    pages);
  const textIn = h("textarea", { rows: 10, "aria-label": "도안 텍스트", placeholder: "1단(RS): 겉뜨기 끝까지\n2단(WS): 안뜨기 끝까지\n3~6단: 1~2단 반복 (48코)" });
  const dPart = h("input", { type: "text", value: "배색", "aria-label": "파트 이름" });
  const dW = h("input", { type: "number", min: 1, max: 400, value: "24", "aria-label": "콧수" });
  const dH = h("input", { type: "number", min: 1, max: 400, value: "20", "aria-label": "단수" });
  const progress = h("div", { class: "progress", hidden: true });
  const readBtn = h("button", { class: "btn primary", type: "button", text: o.relink ? "PDF 연결" : "도안 읽기" });
  const stopBtn = h("button", { class: "btn", type: "button", text: "중지", hidden: true, on: { click: () => ctl?.abort() } });
  const retryBtn = h("button", { class: "btn", type: "button", text: "다시 시도", hidden: true });
  const say = (t: string) => { progress.hidden = false; progress.textContent = t; };

  const tabBtn = (m: typeof up.mode, label: string) => h("button", { role: "tab", type: "button", "aria-selected": String(up.mode === m), text: label, on: { click: () => setTab(m) } });
  const tabs = h("div", { class: "tabs", role: "tablist" }, tabBtn("file", "사진 · PDF"), !target && tabBtn("text", "텍스트"), !target && tabBtn("draw", "배색 차트 그리기"));
  const tabFile = h("div", { style: "display:flex;flex-direction:column;gap:12px" }, drop, fileIn, fileList, pdfPick);
  const tabText = h("div", { hidden: true, style: "display:flex;flex-direction:column;gap:8px" }, textIn, h("p", { class: "hint", text: "'1단', '1~3단', 'Row 1', 'R1' 같은 표기를 단 단위로 나눠요. 반복 지시가 많으면 AI가 풀어서 정리해요." }));
  const tabDraw = h("div", { hidden: true, style: "display:flex;flex-direction:column;gap:8px" },
    h("p", { class: "hint", text: "AI 없이 배색 격자를 직접 칠해서 도안을 만들어요. 단마다 색 서술이 자동으로 생기고 차트에 현재 단이 표시돼요." }),
    h("div", { class: "grid2" }, h("label", { class: "field" }, "파트 이름", dPart), h("div", { class: "grid2" }, h("label", { class: "field" }, "콧수(가로)", dW), h("label", { class: "field" }, "단수(세로)", dH))));
  const setTab = (m: typeof up.mode) => {
    up.mode = m;
    tabFile.hidden = m !== "file"; tabText.hidden = m !== "text"; tabDraw.hidden = m !== "draw";
    tabs.querySelectorAll("button").forEach((b, i) => b.setAttribute("aria-selected", String(["file", "text", "draw"][i] === m)));
    readBtn.textContent = m === "draw" ? "그리기 시작" : o.relink ? "PDF 연결" : "도안 읽기";
  };
  const aiNote = h("p", { class: "hint" });
  aiNote.textContent = state.ai.provider === "manual"
    ? "AI 연결: 복사·붙여넣기 — 읽을 때마다 프롬프트와 파일을 내 Claude/ChatGPT 채팅에 넣어요. 키를 쓰려면 ⚙ 설정."
    : `AI 연결: ${state.ai.provider === "openai" ? "내 OpenAI 키" : state.ai.provider === "server" ? "서버 함수" : "내 Anthropic 키"}. 고른 페이지만 잘라 보내요. 같은 페이지를 다시 읽으면 저장된 결과를 써요.`;

  const panel = h("main", { id: "uploadView" },
    h("section", { class: "panel" },
      h("h2", { text: o.relink ? `'${target?.name}' PDF 다시 연결` : target ? `'${target.name}'에 페이지 더 붙이기` : "도안 올리기" }),
      h("div", { class: "grid2" },
        h("label", { class: "field" }, "도안 이름", nameIn),
        h("label", { class: "field" }, h("span", {}, "뜨는 사이즈 ", h("small", { text: "S (M) L…처럼 나뉜 도안이면 꼭 적어주세요" })), sizeIn)),
      o.relink ? null : tabs,
      tabFile, tabText, tabDraw,
      o.relink ? h("p", { class: "hint", text: "페이지를 고르지 않으면 PDF만 이 기기에 저장해요 (차트·원본 보기용)." }) : aiNote,
      h("div", { class: "actions" }, readBtn, stopBtn, retryBtn, h("button", { class: "btn ghost", type: "button", text: "돌아가기", on: { click: () => { ctl?.abort(); close(); } } })),
      progress));
  $("#trackView").hidden = true;
  $("#thumb").hidden = true;
  $("#meta").hidden = true;
  $("#trackView").after(panel);
  window.scrollTo(0, 0);
  const close = () => { panel.remove(); $("#trackView").hidden = false; $("#thumb").hidden = false; $("#meta").hidden = false; o.onDone(); };

  /* ----- 파일 ----- */
  fileIn.onchange = () => fileIn.files?.length && take(fileIn.files);
  ["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e: DragEvent) => e.dataTransfer?.files.length && take(e.dataTransfer.files));

  async function take(list: FileList) {
    const files = [...list];
    const pdf = files.find((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
    fileList.innerHTML = "";
    if (pdf) {
      up.pdfBlob = pdf; up.images = []; up.selected = new Set();
      const li = h("li", { text: "📄 " + pdf.name + " · 불러오는 중…" });
      fileList.append(li);
      if (!nameIn.value) nameIn.value = pdf.name.replace(/\.pdf$/i, "").replace(/_+/g, " ").trim();
      try {
        up.pdf = await openPdf(pdf);
        li.textContent = `📄 ${pdf.name} · ${up.pdf.numPages}쪽`;
        buildThumbs();
        if (!o.relink) await analyze();
        else autoNote.textContent = "더 읽을 페이지가 있으면 골라주세요. 고르지 않아도 돼요.";
      } catch {
        li.textContent = "PDF를 열지 못했어요. 페이지를 사진으로 찍어 올려주세요.";
        up.pdf = null;
      }
    } else {
      up.pdf = null; up.pdfBlob = null; pdfPick.hidden = true;
      up.images = files.filter((f) => f.type.startsWith("image/"));
      up.images.forEach((f, k) => fileList.append(h("li", { text: `🖼 ${k + 1}. ${f.name}` })));
      if (!up.images.length) fileList.append(h("li", { text: "사진(JPG·PNG)이나 PDF만 올릴 수 있어요." }));
    }
  }
  function buildThumbs() {
    pages.innerHTML = ""; pdfPick.hidden = false; syncThumbs();
    const btns: HTMLButtonElement[] = [];
    for (let n = 1; n <= up.pdf!.numPages; n++) {
      const b = h("button", { type: "button", class: "pg", "aria-pressed": "false", "aria-label": n + "쪽", "data-n": String(n) }, h("span", { class: "num", text: String(n) }));
      b.onclick = () => { up.selected.has(n) ? up.selected.delete(n) : up.selected.add(n); syncThumbs(); };
      pages.append(b); btns.push(b);
    }
    const io = new IntersectionObserver(async (entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        io.unobserve(en.target);
        try { en.target.prepend(await renderWidth(up.pdf!, +(en.target as HTMLElement).dataset.n!, 180)); } catch {}
      }
    }, { root: pages, rootMargin: "200px" });
    btns.forEach((b) => io.observe(b));
  }
  function syncThumbs() {
    pages.querySelectorAll<HTMLElement>(".pg").forEach((b) => b.setAttribute("aria-pressed", String(up.selected.has(+b.dataset.n!))));
    pgCount.textContent = up.selected.size ? `${up.selected.size}쪽 선택` : "선택한 쪽 없음";
  }
  async function analyze() {
    autoNote.textContent = "서술이 있는 페이지를 찾는 중…";
    up.info = [];
    for (let n = 1; n <= up.pdf!.numPages; n++) {
      let items: any[] = [];
      try { items = (await textItems(up.pdf!, n)).items; } catch {}
      up.info.push(pageInfo(n, items));
    }
    auto();
  }
  function auto() {
    if (!up.pdf || !up.info.length) return;
    const size = normSize(sizeIn.value);
    const { pages: pick, scanned } = autoPick(up.info, sizeIn.value, target?.readPages || []);
    up.selected = new Set(pick); syncThumbs();
    pgRange.value = toRanges(pick);
    if (scanned) autoNote.textContent = "글자를 인식할 수 없는 PDF라 모든 페이지를 골랐어요. 차트만 있는 페이지는 눌러서 빼면 더 빨리 읽어요.";
    else if (!pick.length) autoNote.textContent = target ? "새로 읽을 서술 페이지가 없어요. 필요한 페이지를 직접 눌러 골라주세요." : "서술 페이지를 찾지 못했어요. 읽을 페이지를 직접 눌러 골라주세요.";
    else autoNote.textContent = `${size ? size + " 사이즈 " : ""}서술이 있는 ${toRanges(pick)}쪽을 골랐어요.` + (size ? "" : " 사이즈를 적으면 다른 사이즈 전용 페이지는 빼고 골라요.") + " 차트 쪽은 읽지 않아도 진행 화면에서 표시돼요.";
  }
  let sizeT: number | undefined;
  sizeIn.addEventListener("input", () => { clearTimeout(sizeT); sizeT = window.setTimeout(auto, 400); });

  /* ----- 읽기 ----- */
  readBtn.onclick = run;
  retryBtn.onclick = run;
  async function run() {
    retryBtn.hidden = true;
    const size = str(sizeIn.value), name = str(nameIn.value);
    if (up.mode === "draw") return startDrawing(name);
    let sections: AiSection[] = [];
    let title: string | null = null;
    const notes: string[] = [];
    let colors: Yarn[] = [];
    let src: Pattern["src"] = target ? target.src : null;
    let srcPages = target ? target.srcPages : null;
    let readNow: number[] = [];
    let pdfHash: string | undefined;
    const take = (res: AiResult) => {
      sections = mergeSections(sections, res.sections);
      if (!title && res.title) title = res.title;
      if (res.notes && !notes.includes(res.notes)) notes.push(res.notes);
      colors = mergeYarns(colors, res.colors);
    };
    ctl = new AbortController();
    readBtn.disabled = true; stopBtn.hidden = false;
    try {
      if (up.mode === "text") {
        const text = textIn.value.trim();
        if (!text) return say("도안 텍스트를 붙여넣어 주세요.");
        const local = localParse(text);
        if (needsClaude(text, local)) {
          say("AI가 도안을 정리하는 중이에요… 보통 30초~1분 걸려요.");
          take(await structure([{ kind: "text", text: structurePrompt({ kind: "text", size, text: text.slice(0, 60000) }) }], "text:" + (await sha256(new Blob([text]))) + ":" + normSize(size), "텍스트 도안 정리"));
        } else sections = local;
        src = target ? target.src : "text";
      } else if (up.pdf && up.pdfBlob) {
        pdfHash = await sha256(up.pdfBlob);
        const pg = [...up.selected].sort((a, b) => a - b);
        if (!pg.length && !o.relink) return say("읽을 페이지를 골라주세요. 서술(단별 설명)이 있는 페이지만 고르면 돼요.");
        const batches: number[][] = [];
        for (let k = 0; k < pg.length; k += PAGES_PER_BATCH) batches.push(pg.slice(k, k + PAGES_PER_BATCH));
        for (let bi = 0; bi < batches.length; bi++) {
          for (const part of await sizedParts(up.pdfBlob, up.pdf, batches[bi])) {
            say(`AI가 ${part.pages.join(", ")}쪽을 읽는 중… (${bi + 1}/${batches.length}묶음)\n묶음마다 1~2분 걸릴 수 있어요. 같은 페이지는 다시 읽지 않아요.`);
            const known = [...new Set([...(target ? target.rows.map((r) => r.s) : []), ...sections.map((s) => s.name)])];
            const prompt = structurePrompt({ kind: "pdf", pages: part.pages, size, known });
            take(await structure([...part.parts, { kind: "text", text: prompt }], `pdf:${pdfHash}:${part.pages.join(",")}:${normSize(size)}`, `${part.pages.join(", ")}쪽 읽기`));
          }
        }
        src = "pdf"; srcPages = up.pdf.numPages; readNow = pg;
      } else if (up.images.length) {
        const all: Blob[] = [];
        for (const f of up.images) all.push(await shrinkImage(f));
        const per = 6;
        for (let k = 0; k < all.length; k += per) {
          const b = all.slice(k, k + per);
          say(`AI가 사진 ${k + 1}~${k + b.length}장을 읽는 중… 1~2분 걸릴 수 있어요.`);
          const parts: Part[] = [];
          for (const blob of b) parts.push({ kind: "image", media: "image/jpeg", b64: await blobB64(blob) });
          const hash = await sha256(new Blob(b));
          const known = sections.map((s) => s.name);
          take(await structure([...parts, { kind: "text", text: structurePrompt({ kind: "images", size, known, imageOffset: k }) }], `img:${hash}:${normSize(size)}`, `사진 ${k + 1}~${k + b.length}장 읽기`));
        }
        src = "images"; srcPages = all.length;
        (up as any).imgBlobs = all;
      } else return say("도안 파일을 골라주세요.");
    } catch (e) {
      say(errCopy(e));
      if ((e as any)?.code !== "cancelled") retryBtn.hidden = false;
      return;
    } finally {
      readBtn.disabled = false; stopBtn.hidden = true;
    }

    // PDF만 연결
    if (o.relink && target && up.pdfBlob && !sections.length) {
      await putFile(target.id, { type: "pdf", blob: up.pdfBlob });
      Object.assign(target, { src: "pdf", srcPages: up.pdf!.numPages, pdfHash });
      forgetPdf(target.id); clearBitmaps(); commit(target);
      toast("이 기기에 PDF를 연결했어요."); return close();
    }
    if (!sections.length) return say("단 정보를 찾지 못했어요. 서술이 있는 페이지를 골랐는지 확인해 주세요.");

    if (target) {
      const merged = mergeSections(toSections(target.rows, target.secs), sections);
      const { rows, secs } = expand(merged);
      for (const [k, v] of Object.entries(target.secs)) secs[k] = { ...secs[k], ...v, ch: v.ch ?? secs[k]?.ch };
      const old = new Map(target.rows.map((r) => [r.s + "#" + r.n, r]));
      for (const r of rows) { const o2 = old.get(r.s + "#" + r.n); if (o2?.x) r.x = o2.x; }
      Object.assign(target, { rows, secs, colors: mergeYarns(target.colors, colors), rev: target.rev + 1 });
      if (notes.length) target.notes = [...new Set([target.notes, ...notes])].filter(Boolean).join("\n").slice(0, 900);
      if (size) target.size = size;
      target.readPages = [...new Set([...target.readPages, ...readNow])].sort((a, b) => a - b);
      if (up.pdfBlob && target.src !== "images") { await putFile(target.id, { type: "pdf", blob: up.pdfBlob }); target.src = "pdf"; target.srcPages = srcPages; target.pdfHash = pdfHash; forgetPdf(target.id); }
      fillColors(target);
      for (const s of Object.keys(target.draw)) applyDrawing(target, s);
      commit(target);
      toast(`${sections.length}개 파트를 붙였어요.`);
      return close();
    }
    const id = "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const { rows, secs } = expand(sections);
    const p = newPattern({ id, name: name || str(title) || "새 도안", size, notes: notes.join("\n").slice(0, 900), rows, secs, colors, src, srcPages, readPages: readNow, pdfHash });
    if (!p.rows.length) return say("단 정보를 찾지 못했어요.");
    p.tab = p.rows[0].s;
    fillColors(p);
    if (src === "pdf" && up.pdfBlob) await putFile(id, { type: "pdf", blob: up.pdfBlob });
    else if (src === "images" && (up as any).imgBlobs) await putFile(id, { type: "images", blobs: (up as any).imgBlobs });
    commit(p);
    setActive(id);
    toast(`${p.rows.length}단, ${new Set(p.rows.map((r) => r.s)).size}개 파트로 정리했어요.`);
    close();
  }

  /** Claude 결과 캐시: (PDF 해시, 페이지 묶음, 사이즈, 프롬프트 버전) → JSON */
  async function structure(parts: Part[], cacheKey: string, label: string): Promise<AiResult> {
    const k = `v${PROMPT_VERSION}:${cacheKey}`;
    const hit = await cacheGet<AiResult>(k).catch(() => undefined);
    if (hit) return hit;
    const text = await callAi(state.ai, { parts, maxTokens: MAX_TOKENS.structure, effort: "high", schema: STRUCTURE_SCHEMA as any }, { signal: ctl!.signal, manual: manualHandler, label });
    const res = parseJson<AiResult>(text);
    if (!res || !Array.isArray(res.sections)) throw new AiError("invalid_json");
    await cacheSet(k, res).catch(() => {});
    return res;
  }

  function startDrawing(name: string) {
    const part = str(dPart.value) || "배색";
    const id = "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const p = newPattern({ id, name: name || "내 배색 차트", size: str(sizeIn.value) });
    p.colors = [{ code: "A", name: "바탕색", hex: "#EFE8D8" }, { code: "B", name: "배색", hex: "#2F5D8A" }];
    p.draw[part] = newDrawing(parseInt(dW.value, 10) || 24, parseInt(dH.value, 10) || 20);
    p.secs[part] = { odd: "RS", round: false };
    p.tab = part;
    applyDrawing(p, part);
    commit(p);
    setActive(id);
    close();
    openEditor(p, part, { onSave: o.onDone });
  }
}

/** 배치를 본문 한도 안으로: 너무 크면 쪽을 나누고, 한 쪽도 크면 그 쪽은 이미지로 */
async function sizedParts(blob: Blob, pdf: Pdf, pages: number[]): Promise<{ pages: number[]; parts: Part[] }[]> {
  const limit = state.ai.provider === "server" ? MAX_BODY_BYTES : 24_000_000;
  const data = b64(await extractPages(blob, pages));
  if (data.length <= limit) return [{ pages, parts: [{ kind: "pdf", b64: data }] }];
  if (pages.length > 1) {
    const mid = Math.ceil(pages.length / 2);
    return [...(await sizedParts(blob, pdf, pages.slice(0, mid))), ...(await sizedParts(blob, pdf, pages.slice(mid)))];
  }
  const c = await renderWidth(pdf, pages[0], 1600);
  return [{ pages, parts: [{ kind: "image", media: "image/jpeg", b64: await blobB64(await canvasBlob(c, "image/jpeg", 0.85)) }] }];
}

async function shrinkImage(f: File): Promise<Blob> {
  if (/image\/(jpeg|png|webp)/.test(f.type) && f.size < 3.5e6) return f;
  const bmp = await createImageBitmap(f);
  const s = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return canvasBlob(c, "image/jpeg", 0.88);
}

/** row.colors가 없으면 서술에서 색 기호를 찾아 채운다 */
function fillColors(p: Pattern) {
  if (!p.colors.length) return;
  for (const r of p.rows) if (!r.co || !r.co.length) { const c = colorsInText(r.t, p.colors); if (c.length) r.co = c; }
}
