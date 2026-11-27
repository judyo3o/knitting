/** 이 단 물어보기 — 아티팩트 안에서 보는 사람의 Claude와 채팅 (지금 단의 서술·차트를 함께 보냄) */
import { getSample } from "./artifact";
import { explainStrip } from "./chart";
import { gaugeSummary } from "./gaugeui";
import { directionText, partRows, sideOf } from "./model";
import { canvasBlob } from "./pdf";
import { pdfOf } from "./store";
import { dialog, h } from "./ui";
import type { Pattern, Row } from "./types";

type Turn = { role: "user" | "assistant"; content: string };

function context(p: Pattern, r: Row): string {
  const list = partRows(p, r.s);
  const k = list.indexOf(r);
  const near = (x: Row | undefined, label: string) => (x ? `${label} ${x.n}단: ${x.t || "(서술 없음)"}${x.st ? ` (${x.st})` : ""}` : "");
  const colors = p.colors.length ? "색: " + p.colors.map((y) => `${y.code}${y.name ? "=" + y.name : ""}`).join(", ") : "";
  return [
    `도안: ${p.name}${p.size ? ` (${p.size} 사이즈)` : ""}`,
    `파트: ${r.s}${p.secs[r.s]?.round ? " (원통뜨기)" : ""}`,
    `지금 단: ${r.n}단 · ${p.secs[r.s]?.round ? "원통" : sideOf(p, r) === "RS" ? "겉면(RS)" : "안면(WS)"} · ${directionText(p, r)}`,
    `지금 단 서술: ${r.t || "(서술 없음)"}${r.st ? ` (${r.st})` : ""}`,
    r.x ? `차트 풀이: ${r.x}` : "",
    near(list[k - 1], "앞"),
    near(list[k + 1], "다음"),
    gaugeSummary(p) || "",
    colors,
    p.info ? `도안 정보: ${p.info.slice(0, 800)}` : "",
  ].filter(Boolean).join("\n");
}

export async function openChat(p: Pattern, r: Row) {
  const sample = await getSample();
  if (!sample) return;
  const page = r.ch || p.secs[r.s]?.ch || null;
  let strip: Blob | null = null;
  const RULES = (img: boolean) =>
    `너는 뜨개질을 잘 아는 선생님이야. 아래 도안 정보로 뜨는 사람의 질문에 한국어로 짧고 정확하게 답해. 도안에 없는 걸 지어내지 말고, 모르면 모른다고 해. 콧수·방향(겉면/안면, 오른쪽부터/왼쪽부터)을 꼭 맞게 말해.${img ? " 첫 질문에 지금 단 주변 차트 이미지를 붙였어 (분홍 테두리가 지금 단)." : ""}\n\n${context(p, r)}`;
  const turns: Turn[] = [];
  const log = h("div", { class: "chatlog", "aria-live": "polite" });
  const box = h("textarea", { rows: 2, placeholder: "예: 이 단 2/1 LC는 어떻게 떠요?", "aria-label": "질문" });
  const send = h("button", { class: "btn primary", type: "button", text: "보내기" });
  const stop = h("button", { class: "btn ghost", type: "button", text: "중지", hidden: true });
  let ctl: AbortController | null = null;
  const bubble = (who: "me" | "ai", text: string) => {
    const b = h("div", { class: "bubble " + who, text });
    log.append(b);
    log.scrollTop = log.scrollHeight;
    return b;
  };
  bubble("ai", `${r.s} ${r.n}단에 대해 물어보세요. 지금 단 서술${page ? "과 차트" : ""}를 함께 보내요.`);
  const ask = async () => {
    const q = box.value.trim();
    if (!q || ctl) return;
    box.value = "";
    bubble("me", q);
    turns.push({ role: "user", content: q });
    const out = bubble("ai", "생각하는 중…");
    ctl = new AbortController();
    send.disabled = true;
    stop.hidden = false;
    try {
      const first = turns.length === 1;
      if (first && page && !strip) {
        const pdf = await pdfOf(p);
        const c = pdf ? await explainStrip(pdf, page, r.n).catch(() => null) : null;
        if (c) strip = await canvasBlob(c, "image/jpeg", 0.9);
      }
      const lim = await sample.limits().catch(() => null);
      const withImg = first && !!strip && !!lim?.images;
      const input = [{ role: "user", content: RULES(!!strip && !!lim?.images) }, ...turns.slice(-12)];
      const res = await sample(input, {
        signal: ctl.signal,
        cache: false,
        ...(withImg ? { images: [strip] } : {}),
        onText: ({ text }: { text: string }) => {
          out.textContent = text;
          log.scrollTop = log.scrollHeight;
        },
      });
      turns.push({ role: "assistant", content: res.text });
      if (res.truncated) bubble("ai", "(답이 길어서 잘렸어요. 더 짧게 물어봐 주세요.)");
    } catch (e: any) {
      if (e?.code === "cancelled") out.textContent = (e.text || "") + " (중지함)";
      else if (e?.code === "not_granted" || e?.code === "sampling_disabled") out.textContent = "Claude 사용을 허용하지 않아서 답할 수 없어요.";
      else if (e?.code === "rate_limited") out.textContent = "지금은 요청이 많아요. 잠시 뒤 다시 물어봐 주세요.";
      else out.textContent = (e?.text ? e.text + "\n" : "") + "답을 받지 못했어요. 다시 보내 주세요.";
      if (e?.text) turns.push({ role: "assistant", content: e.text });
    } finally {
      ctl = null;
      send.disabled = false;
      stop.hidden = true;
      box.focus();
    }
  };
  send.onclick = ask;
  stop.onclick = () => ctl?.abort();
  box.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      ask();
    }
  });
  dialog(`${r.s} ${r.n}단 물어보기`, [log, box, h("div", { class: "actions" }, send, stop)], { onClose: () => ctl?.abort() });
  box.focus();
}
