/**
 * AI 연결 (기기에서 못 하는 일만: 도안 읽기를 내장으로 못 끝낼 때, 차트를 글로 풀기, 이 단 물어보기)
 *  - artifact: Claude 아티팩트 안에서 열었을 때 — 보는 사람의 Claude (키 없이)
 *  - claude  : 내 Claude API 키로 이 브라우저에서 바로 Anthropic API 호출 (키는 이 기기에만)
 *  - manual  : 키 없이. 프롬프트·파일을 내 Claude 채팅(claude.ai)에 넣고 답을 붙여넣는다
 */
import type { CallReq } from "./anthropicCall";
import { MODEL } from "./config";
import { getSample, inArtifact } from "./artifact";

export type Provider = "artifact" | "claude" | "manual";
export type AiSettings = { provider: Provider; claudeKey?: string };
export const DEFAULT_SETTINGS: AiSettings = { provider: inArtifact ? "artifact" : "manual" };

/** 예전 설정(anthropic/openai/server)을 지금 모양으로 */
export function migrateSettings(s: any): AiSettings {
  const key = s?.claudeKey || s?.anthropicKey || "";
  if (s?.provider === "artifact" || (inArtifact && !s)) return { provider: inArtifact ? "artifact" : "manual", claudeKey: key };
  return { provider: key && (s?.provider === "claude" || s?.provider === "anthropic") ? "claude" : inArtifact ? "artifact" : "manual", claudeKey: key };
}

export const hasKey = (s: AiSettings) => s.provider === "claude" && !!s.claudeKey;
/** 버튼 한 번으로 Claude를 부를 수 있나 (키 또는 아티팩트) */
export const canCallDirect = (s: AiSettings) => hasKey(s) || (s.provider === "artifact" && inArtifact);

export class AiError extends Error {
  constructor(public code: string, msg?: string) {
    super(msg || code);
  }
}

/** 복사·붙여넣기: UI가 요청을 보여 주고 사용자가 붙여넣은 답을 돌려준다 */
export type ManualHandler = (req: CallReq, label: string) => Promise<string>;

export async function callAi(s: AiSettings, req: CallReq, opts: { signal?: AbortSignal; manual: ManualHandler; label: string }): Promise<string> {
  try {
    if (s.provider === "artifact" && inArtifact) return await callSample(req, opts.signal);
    if (!hasKey(s)) return await opts.manual(req, opts.label);
    const [{ default: Anthropic }, { callAnthropic }] = await Promise.all([import("@anthropic-ai/sdk"), import("./anthropicCall")]);
    const client = new Anthropic({ apiKey: s.claudeKey, dangerouslyAllowBrowser: true, maxRetries: 1 });
    return await callAnthropic(client, req, opts.signal);
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

/** 아티팩트: 보는 사람의 Claude (sample). PDF는 못 받아서 쪽을 이미지로 바꿔 보낸다(upload에서). */
async function callSample(req: CallReq, signal?: AbortSignal): Promise<string> {
  const sample = await getSample();
  if (!sample) throw new AiError("not_granted");
  const images: Blob[] = [];
  for (const p of req.parts) {
    if (p.kind === "image") images.push(b64ToBlob(p.b64, p.media));
    if (p.kind === "pdf") throw new AiError("too_large", "pdf");
  }
  const text = req.parts.filter((p) => p.kind === "text").map((p: any) => p.text).join("\n\n");
  const input = req.followUp
    ? [{ role: "user", content: text }, { role: "assistant", content: req.followUp.assistant }, { role: "user", content: req.followUp.user }]
    : text;
  const opts: any = { signal, modelTier: "complex", ...(images.length ? { images } : {}) };
  try {
    if (req.schema) return JSON.stringify(await sample.json(input, opts));
    const r = await sample(input, opts);
    return r.text;
  } catch (e: any) {
    const map: Record<string, string> = { cancelled: "cancelled", not_granted: "not_granted", sampling_disabled: "not_granted", rate_limited: "rate_limited", prompt_too_large: "too_large", image_rejected: "too_large", refused: "refused", invalid_json: "invalid_json", images_unavailable: "not_granted" };
    throw new AiError(map[e?.code] || "server", e?.message);
  }
}

export function b64ToBlob(b64: string, type: string) {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Blob([u], { type });
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
    not_granted: "Claude 사용을 허용하지 않아서 읽지 못했어요. 다시 누르면 허용 창이 떠요.",
    auth: "Claude API 키가 맞지 않아요. ⚙ 설정에서 확인해 주세요.",
    rate_limited: "지금은 요청이 너무 많아요. 잠시 뒤 다시 눌러주세요.",
    too_large: "한 번에 보내기엔 너무 커요. 페이지를 더 적게 골라주세요.",
    invalid_json: "정리 결과를 해석하지 못했어요. '다시 시도'를 눌러주세요. 계속 안 되면 페이지를 더 적게 골라주세요.",
    refused: "이 내용은 읽지 못했어요. 다른 페이지로 시도해 주세요.",
    truncated: "답이 너무 길어 잘렸어요. 페이지를 더 적게 골라 다시 읽어주세요.",
    server: "Claude 서버에 문제가 있어요. 잠시 뒤 다시 눌러주세요.",
    network: "연결에 문제가 있어요. 인터넷 연결을 확인하고 다시 눌러주세요.",
  };
  return m[c] || "읽는 중 문제가 생겼어요. 다시 눌러주세요.";
}

export const providerLabel = (p: Provider) => ({ artifact: "이 아티팩트를 연 사람의 Claude (키 없이)", claude: `내 Claude API 키 (${MODEL})`, manual: "키 없이: 내 Claude 채팅에 복사·붙여넣기" })[p];
