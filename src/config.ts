/** 모델은 여기 한 곳에서만 정한다. */
export const MODEL = "claude-opus-5-5";

/** 프롬프트를 바꾸면 올려서 Claude 응답 캐시가 저절로 무효가 되게 한다. */
export const PROMPT_VERSION = 3;

export const MAX_TOKENS = { structure: 16000, explain: 1000 } as const;

/** 한 번에 Claude로 보내는 최대 쪽수 (§1-2) */
export const PAGES_PER_BATCH = 4;
/** 한 요청에 보낼 잘라낸 PDF(base64) 최대 크기 (API 한도 32MB보다 넉넉히 작게) */
export const MAX_BODY_BYTES = 24_000_000;

export const AUTOSAVE_MS = 10 * 60 * 1000;
export const SESSION_GAP_MS = 30 * 60 * 1000;
export const MAX_LOG = 300;
export const MAX_SNAPSHOTS = 20;
