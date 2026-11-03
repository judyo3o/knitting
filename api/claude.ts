/**
 * Vercel 서버리스 함수 — 선택 사항 (개인 배포용).
 * 환경변수: ANTHROPIC_API_KEY, APP_PASSWORD
 * 본문: CallReq (src/anthropicCall.ts). 응답: { text } 또는 { code }.
 */
import Anthropic from "@anthropic-ai/sdk";
import { callAnthropic, type CallReq } from "../src/anthropicCall";

const MAX_TOKENS_CAP = 32000;

export async function POST(request: Request): Promise<Response> {
  const pw = process.env.APP_PASSWORD;
  if (!pw || request.headers.get("x-app-password") !== pw) return json({ code: "auth" }, 401);
  if (!process.env.ANTHROPIC_API_KEY) return json({ code: "server" }, 500);
  let req: CallReq;
  try {
    req = await request.json();
  } catch {
    return json({ code: "too_large" }, 413);
  }
  if (!Array.isArray(req?.parts) || !req.parts.length) return json({ code: "bad_request" }, 400);
  req.maxTokens = Math.min(Math.max(256, Number(req.maxTokens) || 16000), MAX_TOKENS_CAP);
  const client = new Anthropic({ maxRetries: 1 });
  try {
    const text = await callAnthropic(client, req, request.signal);
    return json({ text });
  } catch (e: any) {
    if (e?.code === "refused") return json({ code: "refused" }, 422);
    if (e?.code === "truncated") return json({ code: "truncated" }, 422);
    if (e instanceof Anthropic.RateLimitError) return json({ code: "rate_limited" }, 429);
    if (e instanceof Anthropic.AuthenticationError) return json({ code: "server" }, 500);
    if (e instanceof Anthropic.BadRequestError) return json({ code: "too_large", detail: e.message }, 400);
    if (e instanceof Anthropic.APIError) return json({ code: "server", detail: e.message }, 502);
    return json({ code: "network" }, 502);
  }
}

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
