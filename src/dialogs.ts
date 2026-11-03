/** 설정 · 복사/붙여넣기 모드 · 원본 보기 */
import { AiError, providerLabel } from "./ai";
import type { CallReq } from "./anthropicCall";
import { getFile } from "./db";
import { openPdf, renderWidth } from "./pdf";
import { saveAi, state } from "./store";
import { dialog, download, h, toast } from "./ui";
import type { Pattern } from "./types";

export function openSettings(onSaved: () => void) {
  const key = h("input", { type: "password", autocomplete: "off", placeholder: "sk-ant-api…", value: state.ai.claudeKey || "", "aria-label": "Claude API 키" });
  const useKey = h("input", { type: "radio", name: "prov", value: "claude", checked: state.ai.provider === "claude" });
  const noKey = h("input", { type: "radio", name: "prov", value: "manual", checked: state.ai.provider !== "claude" });
  const keyBox = h("label", { class: "field" }, "Claude API 키", key,
    h("small", {}, "console.anthropic.com → API Keys에서 만들어요. 이 기기 안에만 저장되고 Anthropic으로만 보내요. 쓴 만큼 요금이 나가요. ",
      "Claude 구독(Pro/Max) 로그인 토큰은 다른 앱에서 쓸 수 없어서, API 키가 필요해요."));
  const sync = () => (keyBox.hidden = !useKey.checked);
  useKey.onchange = noKey.onchange = sync;
  sync();
  const dl = dialog("Claude 연결", [
    h("p", { class: "hint", text: "단 세기·차트 표시·기호표·서술 묶음·배색 그리기·게이지, 그리고 글자가 있는 PDF와 텍스트 도안 읽기는 이 기기에서 해요. Claude는 기기에서 못 끝내는 도안(사진·스캔 PDF·'1단과 동일' 같은 지시)과 '차트를 글로 풀기'에만 써요." }),
    h("div", { class: "radio", role: "radiogroup" },
      h("label", {}, useKey, h("span", {}, providerLabel("claude"), h("small", { text: "버튼 한 번에 바로 읽어요." }))),
      h("label", {}, noKey, h("span", {}, providerLabel("manual"), h("small", { text: "키 없이 claude.ai 채팅을 써요. 앱이 만든 프롬프트와 파일을 넣고 답을 붙여넣어요." })))),
    keyBox,
    h("div", { class: "actions" },
      h("button", { class: "btn primary", type: "button", text: "저장", on: { click: async () => {
        const k = key.value.trim();
        if (useKey.checked && !k) return toast("API 키를 넣어 주세요.");
        if (useKey.checked && /^sk-ant-oat/.test(k)) return toast("구독 로그인 토큰은 쓸 수 없어요. console.anthropic.com의 API 키를 넣어 주세요.", 4200);
        await saveAi({ provider: useKey.checked ? "claude" : "manual", claudeKey: k });
        dl.close();
        toast("설정을 저장했어요.");
        onSaved();
      } } }),
      h("button", { class: "btn ghost", type: "button", text: "취소", on: { click: () => dl.close() } }),
    ),
  ]);
}

/** 복사·붙여넣기 모드: 요청을 보여 주고 사용자가 붙여넣은 답을 돌려준다 */
export function manualHandler(req: CallReq, label: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const files = req.parts.filter((p) => p.kind !== "text");
    let prompt = req.parts.filter((p) => p.kind === "text").map((p: any) => p.text).join("\n\n");
    if (req.followUp) prompt += "\n\n" + req.followUp.user;
    const ta = h("textarea", { rows: 8, readOnly: true, class: "mono", value: prompt });
    const ans = h("textarea", { rows: 6, placeholder: "Claude의 답을 여기에 붙여넣으세요" });
    const fileBtns = files.map((f: any, i) => {
      const isPdf = f.kind === "pdf";
      const name = isPdf ? `도안-${label.replace(/[^\w가-힣-]+/g, "_")}.pdf` : `이미지-${i + 1}.${f.media === "image/png" ? "png" : "jpg"}`;
      return h("button", { class: "btn", type: "button", text: `${i + 1}. ${isPdf ? "PDF" : "이미지"} 받기`, on: { click: () => download(name, b64Blob(f.b64, isPdf ? "application/pdf" : f.media)) } });
    });
    let done = false;
    const dl = dialog(label, [
      h("ol", { class: "steps" },
        files.length ? h("li", {}, "아래 파일을 받아요: ", h("span", { class: "actions", style: "display:inline-flex" }, fileBtns)) : null,
        h("li", {}, "claude.ai에서 ", h("b", { text: "새 채팅" }), "을 열고 ", files.length ? "받은 파일을 첨부한 뒤 " : "", "아래 프롬프트를 붙여넣어 보내요."),
        h("li", { text: req.schema ? "답(JSON)을 전부 복사해서 맨 아래 칸에 붙여넣어요." : "답을 복사해서 맨 아래 칸에 붙여넣어요." }),
      ),
      ta,
      h("div", { class: "actions" }, h("button", { class: "btn", type: "button", text: "프롬프트 복사", on: { click: async () => {
        try { await navigator.clipboard.writeText(prompt); toast("복사했어요."); } catch { ta.select(); toast("선택해 두었어요. 복사해 주세요."); }
      } } })),
      ans,
      h("div", { class: "actions" },
        h("button", { class: "btn primary", type: "button", text: "붙여넣은 답으로 계속", on: { click: () => {
          if (!ans.value.trim()) return toast("답을 붙여넣어 주세요.");
          done = true; dl.close(); resolve(ans.value);
        } } }),
        h("button", { class: "btn ghost", type: "button", text: "중지", on: { click: () => dl.close() } }),
      ),
    ], { onClose: () => { if (!done) reject(new AiError("cancelled")); } });
  });
}

function b64Blob(b64: string, type: string) {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Blob([u], { type });
}

/** 원본 보기 */
export async function openViewer(p: Pattern, page: number) {
  const rec = await getFile(p.id);
  if (!rec) return toast("원본은 도안을 올린 기기에만 저장돼요. 'PDF 다시 연결'로 골라주세요.", 4200);
  const pdf = rec.type === "pdf" ? await openPdf(rec.blob).catch(() => null) : null;
  const count = pdf ? pdf.numPages : rec.type === "images" ? rec.blobs.length : 1;
  let cur = Math.min(Math.max(1, page), count);
  let zoom = false;
  const body = h("div", { class: "viewer-body" });
  const label = h("span", { class: "prog", style: "align-self:center" });
  const prevB = h("button", { class: "btn", type: "button", text: "‹", "aria-label": "이전 쪽" });
  const nextB = h("button", { class: "btn", type: "button", text: "›", "aria-label": "다음 쪽" });
  const zoomB = h("button", { class: "btn", type: "button", text: "확대", "aria-pressed": "false" });
  const closeB = h("button", { class: "btn primary", type: "button", text: "닫기" });
  const v = h("div", { class: "viewer", role: "dialog", "aria-modal": "true", "aria-label": "원본 도안" },
    h("div", { class: "viewer-bar" }, h("div", { class: "actions" }, prevB, label, nextB), h("div", { class: "actions" }, zoomB, closeB)), body);
  const draw = async () => {
    label.textContent = `${cur} / ${count}`;
    prevB.disabled = cur <= 1;
    nextB.disabled = cur >= count;
    body.innerHTML = "";
    if (pdf) body.append(await renderWidth(pdf, cur, Math.min(2400, Math.max(1200, body.clientWidth * 2))));
    else if (rec.type === "images") {
      const img = h("img", { alt: `${cur}번째 도안 사진` });
      const url = URL.createObjectURL(rec.blobs[cur - 1]);
      img.onload = () => URL.revokeObjectURL(url);
      img.src = url;
      body.append(img);
    }
  };
  const close = () => { v.remove(); document.body.style.overflow = ""; document.removeEventListener("keydown", onKey); };
  const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
  prevB.onclick = () => { cur--; draw(); };
  nextB.onclick = () => { cur++; draw(); };
  closeB.onclick = close;
  zoomB.onclick = () => { zoom = !zoom; body.classList.toggle("zoom", zoom); zoomB.textContent = zoom ? "맞추기" : "확대"; zoomB.setAttribute("aria-pressed", String(zoom)); };
  document.addEventListener("keydown", onKey);
  document.body.append(v);
  document.body.style.overflow = "hidden";
  closeB.focus();
  draw();
}
