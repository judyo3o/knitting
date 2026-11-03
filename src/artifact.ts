/**
 * Claude 아티팩트 안에서 열렸을 때 쓰는 기능 (claude.ai 뷰어가 주는 것).
 *  - sample   : 보는 사람의 Claude (API 키 없이)
 *  - db + user: 진행 기록을 사람마다 따로 서버에 저장 (다른 기기에서도)
 *  - downloads: 파일 받기 (아티팩트에선 일반 다운로드 링크가 막혀 있음)
 * 아티팩트 밖(일반 웹앱)에서는 모두 null.
 */
type Use = (name: string) => Promise<any>;
const claudeUse = (): Use | null => {
  const c = (globalThis as any).claude;
  return c && typeof c.use === "function" ? c.use.bind(c) : null;
};

/** 아티팩트 뷰어 안인가 (페이지 스크립트보다 먼저 window.claude가 생김) */
export const inArtifact = !!claudeUse();

const memo = new Map<string, Promise<any>>();
function cap<T = any>(name: string): Promise<T | null> {
  const use = claudeUse();
  if (!use) return Promise.resolve(null);
  let p = memo.get(name);
  if (!p) {
    p = use(name).catch(() => null);
    memo.set(name, p);
  }
  return p;
}

export const getSample = () => cap<any>("sample");
export const getDb = () => cap<any>("db");
export const getUser = () => cap<any>("user");
export const getDownloads = () => cap<any>("downloads");

/** 사진을 보낼 수 있는지·한 번에 몇 장인지 */
export async function sampleLimits(): Promise<{ maxImages: number; maxBytes: number } | null> {
  const s = await getSample();
  if (!s) return null;
  const l = await s.limits().catch(() => null);
  if (!l?.images) return { maxImages: 0, maxBytes: 0 };
  return { maxImages: l.images.maxCount, maxBytes: l.images.maxInputBytes };
}

/** 내 진행 기록 저장 위치: data/users/<내 id>/<도안 id> (나만 읽고 씀) */
export async function myCollection(): Promise<any | null> {
  const [db, user] = await Promise.all([getDb(), getUser()]);
  if (!db || !user) return null;
  const id = await user.id().catch(() => null);
  if (!id) return null;
  return db.collection("data/users/" + id);
}
