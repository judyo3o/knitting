/** 설정 · 복사/붙여넣기 모드 · 원본 보기 */
import { AiError, providerLabel, type AiSettings, type Provider } from "./ai";
import type { CallReq } from "./anthropicCall";
import { getFile } from "./db";
import { openPdf, renderWidth } from "./pdf";
import { saveAi, state } from "./store";
import { dialog, download, h, toast } from "./ui";
import type { Pattern } from "./types";

export function openSettings(onSaved: () => void) {
  const s: AiSettings = { ...state.ai };
  const radios = (["manual", "anthropic", "openai", "server"] as Provider[]).map((p) =>
    h("label", {},
      h("input", { type: "radio", name: "prov", value: p, checked: s.provider === p, on: { change: () => { s.provider = p; sync(); } } }),
      h("span", {}, providerLabel(p), h("small", { text: ({
        manual: "키 없이 써요. 앱이 만든 프롬프트와 파일을 내 Claude나 ChatGPT 채팅에 넣고, 답을 붙여넣어요. 내 구독 사용량만 써요.",
        anthropic: "console.anthropic.com에서 만든 API 키. 이 기기 안에만 저장되고 Anthropic으로만 보내요. 사용량만큼 요금이 나가요.",
        openai: "platform.openai.com에서 만든 API 키. 이 기기 안에만 저장돼요. 모델 이름은 직접 바꿀 수 있어요.",
        server: "직접 배포한 /api/claude 함수 (키는 서버 환경변수). 접근 비밀번호가 필요해요.",
      } as Record<Provider, string>)[p] })),
    ));
  const ak = h("input", { type: "password", autocomplete: "off", placeholder: "sk-ant-…", value: s.anthropicKey || "" });
  const ok = h("input", { type: "password", autocomplete: "off", placeholder: "sk-…", value: s.openaiKey || "" });
  const om = h("input", { type: "text", value: s.openaiModel || "gpt-5" });
  const su = h("input", { type: "text", value: s.serverUrl || "/api/claude" });
  const sp = h("input", { type: "password", autocomplete: "off", value: s.serverPassword || "" });
  const fa = h("label", { class: "field" }, "Anthropic API 키", ak);
  const fo = h("div", { style: "display:flex;flex-direction:column;gap:8px" }, h("label", { class: "field" }, "OpenAI API 키", ok), h("label", { class: "field" }, "OpenAI 모델", om, h("small", { text: "PDF·이미지를 읽을 수 있는 모델이어야 해요." })));
  const fs = h("div", { style: "display:flex;flex-direction:column;gap:8px" }, h("label", { class: "field" }, "서버 주소", su), h("label", { class: "field" }, "접근 비밀번호", sp));
  const sync = () => {
    fa.hidden = s.provider !== "anthropic";
    fo.hidden = s.provider !== "openai";
    fs.hidden = s.provider !== "server";
  };
  sync();
  const dl = dialog("AI 연결", [
    h("p", { class: "hint", text: "도안 읽기와 '차트를 글로 풀기'에만 AI를 써요. 단 세기·차트 표시·배색 그리기는 AI 없이 이 기기에서 돼요." }),
    h("div", { class: "radio", role: "radiogroup" }, radios),
    fa, fo, fs,
    h("div", { class: "actions" },
      h("button", { class: "btn primary", type: "button", text: "저장", on: { click: async () => {
        Object.assign(s, { anthropicKey: ak.value.trim(), openaiKey: ok.value.trim(), openaiModel: om.value.trim() || "gpt-5", serverUrl: su.value.trim() || "/api/claude", serverPassword: sp.value });
        await saveAi(s);
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
    const ans = h("textarea", { rows: 6, placeholder: "Claude/ChatGPT의 답을 여기에 붙여넣으세요" });
    const fileBtns = files.map((f: any, i) => {
      const isPdf = f.kind === "pdf";
      const name = isPdf ? `도안-${label.replace(/[^\w가-힣-]+/g, "_")}.pdf` : `이미지-${i + 1}.${f.media === "image/png" ? "png" : "jpg"}`;
      return h("button", { class: "btn", type: "button", text: `${i + 1}. ${isPdf ? "PDF" : "이미지"} 받기`, on: { click: () => download(name, b64Blob(f.b64, isPdf ? "application/pdf" : f.media)) } });
    });
    let done = false;
    const dl = dialog(label, [
      h("ol", { class: "steps" },
        files.length ? h("li", {}, "아래 파일을 받아요: ", h("span", { class: "actions", style: "display:inline-flex" }, fileBtns)) : null,
        h("li", {}, "Claude.ai나 ChatGPT에서 ", h("b", { text: "새 채팅" }), "을 열고 ", files.length ? "받은 파일을 첨부한 뒤 " : "", "아래 프롬프트를 붙여넣어 보내요."),
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
