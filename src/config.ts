/** 모델은 여기 한 곳에서만 정한다. 서버 함수(api/claude.ts)도 이 값을 쓴다. */
export const MODEL = "claude-opus-5-5";

/** 프롬프트를 바꾸면 올려서 Claude 응답 캐시가 저절로 무효가 되게 한다. */
export const PROMPT_VERSION = 1;

export const MAX_TOKENS = { structure: 16000, explain: 1000 } as const;

/** 한 번에 Claude로 보내는 최대 쪽수 (§1-2) */
export const PAGES_PER_BATCH = 4;
/** Vercel 함수 본문 한도(약 4.5MB)를 넘지 않게 base64 합계를 이 아래로 */
export const MAX_BODY_BYTES = 4_000_000;

export const AUTOSAVE_MS = 10 * 60 * 1000;
export const SESSION_GAP_MS = 30 * 60 * 1000;
export const MAX_LOG = 300;
export const MAX_SNAPSHOTS = 20;
