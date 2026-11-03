/**
 * AI 연결 방식
 *  - manual    : 키 없이. 프롬프트·파일을 사용자가 자기 Claude/ChatGPT 채팅에 넣고 답을 붙여넣는다.
 *  - anthropic : 내 Anthropic API 키로 브라우저에서 직접 (키는 이 기기에만)
 *  - openai    : 내 OpenAI API 키로 브라우저에서 직접
 *  - server    : 배포한 /api/claude 서버 함수 (키는 서버 환경변수, 접근 비밀번호)
 */
import type { CallReq, Part } from "./anthropicCall";
import { MODEL } from "./config";

export type Provider = "manual" | "anthropic" | "openai" | "server";
export type AiSettings = {
  provider: Provider;
  anthropicKey?: string;
  openaiKey?: string;
  openaiModel?: string;
  serverUrl?: string;
  serverPassword?: string;
};
export const DEFAULT_SETTINGS: AiSettings = { provider: "manual", openaiModel: "gpt-5", serverUrl: "/api/claude" };

export class AiError extends Error {
  constructor(public code: string, msg?: string) {
    super(msg || code);
  }
}

/** 수동 모드: UI가 이 요청을 보여 주고 사용자가 붙여넣은 답을 돌려준다 */
export type ManualHandler = (req: CallReq, label: string) => Promise<string>;

export async function callAi(s: AiSettings, req: CallReq, opts: { signal?: AbortSignal; manual: ManualHandler; label: string }): Promise<string> {
  try {
    if (s.provider === "manual") return await opts.manual(req, opts.label);
    if (s.provider === "anthropic") {
      if (!s.anthropicKey) throw new AiError("no_key");
      const [{ default: Anthropic }, { callAnthropic }] = await Promise.all([import("@anthropic-ai/sdk"), import("./anthropicCall")]);
      const client = new Anthropic({ apiKey: s.anthropicKey, dangerouslyAllowBrowser: true, maxRetries: 1 });
      return await callAnthropic(client, req, opts.signal);
    }
    if (s.provider === "openai") return await callOpenAI(s, req, opts.signal);
    return await callServer(s, req, opts.signal);
  } catch (e: any) {
    if (e instanceof AiError) throw e;
    if (e?.name === "AbortError" || opts.signal?.aborted) throw new AiError("cancelled");
    if (e?.code === "refused") throw new AiError("refused");
    if (e?.code === "truncated") throw new AiError("truncated");
    const st = e?.status;
    if (st === 401 || st === 403) throw new AiError("auth");
    if (st === 429) throw new AiError("rate_limited");
    if (st === 413) throw new AiError("too_large");
    if (st && st >= 500) throw new AiError("server");
    throw new AiError("network", String(e?.message || e));
  }
}

async function callServer(s: AiSettings, req: CallReq, signal?: AbortSignal) {
  const r = await fetch(s.serverUrl || "/api/claude", {
    method: "POST",
    headers: { "content-type": "application/json", "x-app-password": s.serverPassword || "" },
    body: JSON.stringify(req),
    signal,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (j?.code) throw new AiError(j.code);
    throw Object.assign(new Error("http " + r.status), { status: r.status });
  }
  return String(j.text || "");
}

/** OpenAI Responses API (PDF는 input_file, 사진은 input_image) */
async function callOpenAI(s: AiSettings, req: CallReq, signal?: AbortSignal) {
  if (!s.openaiKey) throw new AiError("no_key");
  const toContent = (parts: Part[]) => {
    const media = parts.filter((p) => p.kind !== "text");
    const texts = parts.filter((p) => p.kind === "text");
    return [...media, ...texts].map((p) =>
      p.kind === "pdf"
        ? { type: "input_file", filename: "pattern.pdf", file_data: "data:application/pdf;base64," + p.b64 }
        : p.kind === "image"
          ? { type: "input_image", image_url: `data:${p.media};base64,${p.b64}` }
          : { type: "input_text", text: p.text },
    );
  };
  const input: any[] = [{ role: "user", content: toContent(req.parts) }];
  if (req.followUp) {
    input.push({ role: "assistant", content: [{ type: "output_text", text: req.followUp.assistant }] });
    input.push({ role: "user", content: [{ type: "input_text", text: req.followUp.user }] });
  }
  const body: any = { model: s.openaiModel || "gpt-5", input, max_output_tokens: req.maxTokens * 2 };
  if (req.schema) body.text = { format: { type: "json_schema", name: "pattern", schema: req.schema, strict: true } };
  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + s.openaiKey },
    body: JSON.stringify(body),
    signal,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j?.error?.message || "http " + r.status), { status: r.status });
  const out: string[] = [];
  for (const o of j.output || []) for (const c of o.content || []) if (c.type === "output_text") out.push(c.text);
  if (!out.length && j.output_text) out.push(j.output_text);
  return out.join("");
}

/** 코드펜스 제거 → 첫 { ~ 마지막 } (§4) */
export function parseJson<T = any>(text: string): T {
  let t = text.replace(/```(?:json)?/gi, "");
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b <= a) throw new AiError("invalid_json");
  t = t.slice(a, b + 1);
  try {
    return JSON.parse(t);
  } catch {
    throw new AiError("invalid_json");
  }
}

export function errCopy(e: unknown): string {
  const c = (e as any)?.code;
  const m: Record<string, string> = {
    cancelled: "중지했어요.",
    no_key: "설정에서 API 키를 넣어 주세요. (키 없이 쓰려면 '복사·붙여넣기'를 고르세요)",
    auth: "키나 비밀번호가 맞지 않아요. 설정을 확인해 주세요.",
    rate_limited: "지금은 요청이 너무 많아요. 잠시 뒤 다시 눌러주세요.",
    too_large: "한 번에 보내기엔 너무 커요. 페이지를 더 적게 골라주세요.",
    invalid_json: "정리 결과를 해석하지 못했어요. '다시 시도'를 눌러주세요. 계속 안 되면 페이지를 더 적게 골라주세요.",
    refused: "이 내용은 읽지 못했어요. 다른 페이지로 시도해 주세요.",
    truncated: "답이 너무 길어 잘렸어요. 페이지를 더 적게 골라 다시 읽어주세요.",
    server: "AI 서버에 문제가 있어요. 잠시 뒤 다시 눌러주세요.",
    network: "연결에 문제가 있어요. 인터넷 연결을 확인하고 다시 눌러주세요.",
  };
  return m[c] || "읽는 중 문제가 생겼어요. 다시 눌러주세요.";
}

export const providerLabel = (p: Provider) =>
  ({ manual: "복사·붙여넣기 (내 Claude/ChatGPT 채팅)", anthropic: `내 Anthropic 키 (${MODEL})`, openai: "내 OpenAI 키", server: "서버 함수 /api/claude" })[p];
