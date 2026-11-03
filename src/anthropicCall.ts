/**
 * Anthropic Messages 호출 — 내 Claude API 키로 브라우저에서 직접.
 * 스트리밍 + finalMessage로 긴 응답의 타임아웃을 피하고, 사용 가능하면 structured outputs와
 * 서버측 거절 폴백(fallbacks: "default")을 켠다. 그 조합이 400이면 한 번만 기본 요청으로 다시 보낸다.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { MODEL } from "./config";

export type Part =
  | { kind: "pdf"; b64: string }
  | { kind: "image"; b64: string; media: "image/jpeg" | "image/png" | "image/webp" | "image/gif" }
  | { kind: "text"; text: string };

export type CallReq = {
  parts: Part[];
  maxTokens: number;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  schema?: Record<string, unknown>;
  /** 2단계 대화(차트 점검)용: 앞 턴의 assistant 답과 다음 user 지시 */
  followUp?: { assistant: string; user: string };
};

function content(parts: Part[]): Anthropic.ContentBlockParam[] {
  // 문서·이미지 블록을 텍스트보다 앞에
  const media = parts.filter((p) => p.kind !== "text");
  const texts = parts.filter((p) => p.kind === "text");
  return [...media, ...texts].map((p): Anthropic.ContentBlockParam => {
    if (p.kind === "pdf") return { type: "document", source: { type: "base64", media_type: "application/pdf", data: p.b64 } };
    if (p.kind === "image") return { type: "image", source: { type: "base64", media_type: p.media, data: p.b64 } };
    return { type: "text", text: p.text };
  });
}

export class RefusalError extends Error {
  code = "refused";
}
export class TruncatedError extends Error {
  code = "truncated";
}

export async function callAnthropic(client: Anthropic, req: CallReq, signal?: AbortSignal): Promise<string> {
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: content(req.parts) }];
  if (req.followUp) {
    messages.push({ role: "assistant", content: req.followUp.assistant });
    messages.push({ role: "user", content: req.followUp.user });
  }
  const base = {
    model: MODEL,
    max_tokens: req.maxTokens,
    thinking: { type: "adaptive" as const },
    messages,
  };
  const effort = req.effort || "high";
  let msg: any;
  try {
    msg = await client.beta.messages
      .stream(
        {
          ...base,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          output_config: { effort, ...(req.schema ? { format: { type: "json_schema", schema: req.schema } } : {}) },
        } as any,
        { signal },
      )
      .finalMessage();
  } catch (e: any) {
    if (e?.status !== 400) throw e;
    // 선택 기능 조합이 거부되면 가장 기본 요청으로 한 번만
    msg = await client.messages.stream({ ...base, output_config: { effort } } as any, { signal }).finalMessage();
  }
  if (msg.stop_reason === "refusal") throw new RefusalError(msg.stop_details?.explanation || "refused");
  const text = (msg.content as any[])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  if (msg.stop_reason === "max_tokens" && !text.trim().endsWith("}")) throw new TruncatedError("max_tokens");
  return text;
}
