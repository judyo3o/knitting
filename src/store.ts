/** 앱 상태 · 즉시 기기 저장 · 10분 간격 스냅샷 */
import { AUTOSAVE_MS } from "./config";
import * as db from "./db";
import { applyDrawing, expand, mergeSections, newPattern, normalize } from "./model";
import { openPdf, type Pdf } from "./pdf";
import { migrateSettings, type AiSettings } from "./ai";
import { getAssets, inArtifact, myCollection } from "./artifact";
import { toast } from "./ui";
import type { AiSection, Drawing, Pattern } from "./types";

export const state = {
  patterns: {} as Record<string, Pattern>,
  activeId: null as string | null,
  lastSaved: 0,
  dirty: false,
  ai: { provider: "manual" } as AiSettings,
};

/* ---------- 예시 도안 (내 도안이 없을 때만) ---------- */
const EXAMPLE_SECTIONS: AiSection[] = [
  { name: "고무단", round: true, rows: [
    { from: 1, to: 1, side: "RS", text: "4mm 바늘로 일반코잡기 60코. 시작마커 걸고 원통으로 연결, (겉1, 안1) 30번 반복", stitches: "60코" },
    { from: 2, to: 8, text: "(겉1, 안1) 30번 반복", stitches: "60코" } ] },
  { name: "몸통", round: true, rows: [
    { from: 1, to: 1, text: "5mm 바늘로 바꾸고 겉뜨기 끝까지" },
    { from: 2, to: 2, text: "(겉5, M1L) 12번 반복", stitches: "72코" },
    { from: 3, to: 20, text: "겉뜨기 끝까지 (메리야스뜨기)", stitches: "72코" },
    { from: 21, to: 21, text: "(겉4, k2tog) 12번 반복", stitches: "60코" } ] },
  { name: "배색 띠", round: true, rows: [{ from: 1, to: 7, text: "" }] },
  { name: "마무리", round: true, rows: [
    { from: 1, to: 4, text: "4mm 바늘로 (겉1, 안1) 30번 반복" },
    { from: 5, to: 5, text: "고무단 코막음 후 실 정리" } ] },
];
const EXAMPLE_DRAW: Drawing = (() => {
  const rows = ["000000000000", "001000001000", "011100011100", "111110111110", "011100011100", "001000001000", "000000000000"];
  return { w: 12, h: rows.length, start: 1, cells: rows.join("") };
})();

export function makeExample(): Pattern {
  const { rows, secs } = expand(mergeSections([], EXAMPLE_SECTIONS));
  const p = newPattern({ id: "example", name: "예시 · 넥워머", rows, secs, example: true, updatedAt: 0 });
  p.notes = "예시 도안이에요. 내 도안을 올리면 여기에 정리돼요. '배색 띠'는 직접 그린 배색 격자 예시예요.";
  p.info = "사이즈: 한 사이즈 (둘레 56cm, 높이 22cm)\n실: A 아이보리 · B 버건디 (DK 굵기)\n바늘: 4mm 줄바늘 40cm\n게이지: 메리야스 22코 30단 (10cm)";
  p.colors = [{ code: "A", name: "아이보리", hex: "#EFE8D8" }, { code: "B", name: "버건디", hex: "#8E2B3A" }];
  p.draw["배색 띠"] = EXAMPLE_DRAW;
  p.secs["배색 띠"] = { round: true, odd: "RS" };
  applyDrawing(p, "배색 띠");
  p.pos["몸통"] = 12;
  p.tab = "몸통";
  return p;
}
let example: Pattern | null = null;

export function active(): Pattern {
  const p = state.activeId && state.patterns[state.activeId];
  if (p) return p;
  const ids = Object.keys(state.patterns);
  if (ids.length) {
    ids.sort((a, b) => (state.patterns[b].updatedAt || 0) - (state.patterns[a].updatedAt || 0));
    state.activeId = ids[0];
    return state.patterns[ids[0]];
  }
  return (example ||= makeExample());
}

/* ---------- 아티팩트: 진행 기록을 사람마다 서버(db)에 (다른 기기에서도) ---------- */
const MAX_DOC = 240_000; // 문서 하나 256KiB 한도보다 조금 작게
const remoteTimers = new Map<string, number>();
let remoteFail = false;
function queueRemote(p: Pattern) {
  if (!inArtifact) return;
  clearTimeout(remoteTimers.get(p.id));
  remoteTimers.set(p.id, window.setTimeout(async () => {
    remoteTimers.delete(p.id);
    const col = await myCollection();
    if (!col) return;
    const body = JSON.parse(JSON.stringify(state.patterns[p.id] || p));
    if (JSON.stringify(body).length > MAX_DOC) {
      if (!remoteFail) toast("도안이 커서 이 브라우저에만 저장했어요.", 3600);
      remoteFail = true;
      return;
    }
    try {
      await col.doc(p.id).set(body);
    } catch (e: any) {
      if (!remoteFail) toast(e?.code === "quota_exceeded" ? "저장 공간이 가득 찼어요. 안 쓰는 도안을 지워주세요." : "이 브라우저에만 저장했어요. 다음에 다시 올릴게요.", 3600);
      remoteFail = true;
    }
  }, 1200));
}
/** 서버 기록을 불러와 더 최신인 것으로 맞춘다. 바뀐 게 있으면 true */
export async function syncRemote(): Promise<boolean> {
  if (!inArtifact) return false;
  const col = await myCollection();
  if (!col) return false;
  let changed = false;
  try {
    const snap = await col.get();
    const remoteIds = new Set<string>();
    for (const d of snap.docs) {
      const v = d.data();
      if (!v || !Array.isArray(v.rows)) continue;
      remoteIds.add(d.id);
      const rp = normalize({ ...v, id: d.id });
      const lp = state.patterns[d.id];
      if (!lp || (rp.updatedAt || 0) > (lp.updatedAt || 0)) {
        state.patterns[d.id] = rp;
        db.savePattern(rp).catch(() => {});
        changed = true;
      }
    }
    // 이 브라우저에만 있던 도안은 올린다
    for (const p of Object.values(state.patterns)) if (!remoteIds.has(p.id)) queueRemote(p);
  } catch {}
  return changed;
}

export async function load() {
  try {
    for (const p of await db.loadPatterns()) state.patterns[p.id] = normalize(p);
    state.activeId = (await db.getSetting<string>("activeId")) || null;
    state.ai = migrateSettings(await db.getSetting("ai"));
    state.lastSaved = (await db.getSetting<number>("lastSaved")) || 0;
  } catch {
    /* 사생활 보호 모드 등: 메모리에서만 */
  }
}

/** 모든 변경마다 즉시 기기 저장 */
export function commit(p: Pattern, touch = true) {
  if (p.example) return;
  if (touch) p.updatedAt = Date.now();
  state.patterns[p.id] = p;
  state.dirty = true;
  db.savePattern(p).catch(() => {});
  queueRemote(p);
}
export function setActive(id: string) {
  state.activeId = id;
  db.setSetting("activeId", id).catch(() => {});
}
export async function saveAi(s: AiSettings) {
  state.ai = s;
  await db.setSetting("ai", s);
}
export async function removePattern(id: string) {
  const gone = state.patterns[id]?.remote?.ids || [];
  if (gone.length) getAssets().then((a) => { if (a) for (const x of gone) a.delete(x).catch(() => {}); }).catch(() => {});
  delete state.patterns[id];
  if (state.activeId === id) state.activeId = null;
  pdfCache.delete(id);
  await db.deletePattern(id);
  if (inArtifact) (await myCollection())?.doc(id).delete().catch(() => {});
}

/** 백업 스냅샷 (+ 클라우드 동기화를 붙인다면 여기서 업로드) */
export async function saveNow() {
  try {
    await Promise.all(Object.values(state.patterns).map((p) => db.savePattern(p)));
    state.lastSaved = await db.snapshot(Object.values(state.patterns));
    await db.setSetting("lastSaved", state.lastSaved);
    state.dirty = false;
  } catch {}
  return state.lastSaved;
}
export function startAutosave(onSaved: () => void) {
  setInterval(async () => {
    if (state.dirty) {
      await saveNow();
      onSaved();
    }
  }, AUTOSAVE_MS);
  const flush = () => {
    if (state.dirty) saveNow().then(onSaved);
  };
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush());
  window.addEventListener("pagehide", flush);
}

/* ---------- 원본 PDF (이 기기에만) ---------- */
const pdfCache = new Map<string, Promise<Pdf | null>>();
/* ---------- 원본 파일: 기기(IndexedDB)와 아티팩트 저장소 둘 다에 ---------- */
const fileSig = (f: db.FileRec) => (f.type === "pdf" ? `pdf:${f.blob.size}` : `images:${f.blobs.map((b) => b.size).join(",")}`);
const uploading = new Set<string>();
/** 기기에 있는 원본을 아티팩트 저장소에도 올린다 (같은 Claude 계정의 다른 기기에서 받게). 바뀌었으면 다시 */
async function pushFile(p: Pattern, f: db.FileRec) {
  if (!inArtifact || p.example || uploading.has(p.id)) return;
  const sig = fileSig(f);
  if (p.remote?.sig === sig) return;
  const assets = await getAssets();
  if (!assets) return;
  uploading.add(p.id);
  try {
    const blobs = f.type === "pdf" ? [f.blob] : f.blobs;
    const ids: string[] = [];
    for (const b of blobs) {
      const type = f.type === "pdf" ? "application/pdf" : /^image\/(png|jpeg|webp|gif)$/.test(b.type) ? b.type : "image/jpeg";
      ids.push((await assets.upload(b, { type })).id);
    }
    const old = p.remote;
    p.remote = { type: f.type, ids, sig };
    commit(p, false);
    queueRemote(p);
    // 바꾼 파일이면 예전 것은 지운다 (이 도안만 가리키던 것)
    for (const id of old?.ids || []) if (!ids.includes(id)) assets.delete(id).catch(() => {});
  } catch (e: any) {
    if (e?.code === "too_large") toast("원본 파일이 20MB보다 커서 이 기기에만 저장했어요.", 4000);
    else if (e?.code === "quota_or_state") toast("저장 공간이 가득 차서 원본은 이 기기에만 저장했어요.", 4000);
  } finally {
    uploading.delete(p.id);
  }
}
/** 원본 파일: 이 기기 → 없으면 아티팩트 저장소에서 받아 이 기기에도 저장 */
export async function fileOf(p: Pattern): Promise<db.FileRec | null> {
  const f = await db.getFile(p.id).catch(() => undefined);
  if (f) { pushFile(p, f).catch(() => {}); return f; }
  if (!inArtifact || !p.remote?.ids.length) return null;
  try {
    const blobs = await Promise.all(p.remote.ids.map((id) => fetch("/_blob/" + id).then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))));
    const rec: db.FileRec = p.remote.type === "pdf" ? { type: "pdf", blob: new Blob([blobs[0]], { type: "application/pdf" }) } : { type: "images", blobs };
    await db.putFile(p.id, rec).catch(() => {});
    return rec;
  } catch {
    return null;
  }
}
/** 원본을 새로 저장: 기기에 저장하고 아티팩트 저장소에도 올린다 */
export async function saveFile(p: Pattern, f: db.FileRec) {
  await db.putFile(p.id, f);
  pdfCache.delete(p.id);
  pushFile(p, f).catch(() => {});
}
/** 이 기기에만 있는 원본들을 차례로 올린다 (앱을 열 때 한 번) */
export async function pushAllFiles() {
  if (!inArtifact) return;
  for (const p of Object.values(state.patterns)) {
    if (p.example || p.src === "text" || !p.src) continue;
    const f = await db.getFile(p.id).catch(() => undefined);
    if (f) await pushFile(p, f).catch(() => {});
  }
}

export function pdfOf(p: Pattern): Promise<Pdf | null> {
  if (p.src !== "pdf") return Promise.resolve(null);
  let c = pdfCache.get(p.id);
  if (!c) {
    c = (async () => {
      const f = await fileOf(p);
      if (!f || f.type !== "pdf") return null;
      return openPdf(f.blob);
    })().catch(() => null);
    pdfCache.set(p.id, c);
    // 못 찾았으면 기억하지 않는다 (다른 기기에서 원본이 올라오면 다시 받게)
    c.then((v) => { if (!v) pdfCache.delete(p.id); });
  }
  return c;
}
export const forgetPdf = (id: string) => pdfCache.delete(id);

/* ---------- 내보내기 / 가져오기 ---------- */
export function exportJson(): Blob {
  return new Blob([JSON.stringify({ app: "knit-row-counter", v: 3, exportedAt: Date.now(), patterns: Object.values(state.patterns) }, null, 1)], { type: "application/json" });
}
export async function importJson(text: string): Promise<number> {
  const j = JSON.parse(text);
  const list: Pattern[] = Array.isArray(j?.patterns) ? j.patterns : Array.isArray(j) ? j : [];
  let n = 0;
  for (const raw of list) {
    if (!raw?.id || !Array.isArray(raw.rows)) continue;
    const p = normalize(raw);
    const cur = state.patterns[p.id];
    if (cur && (cur.updatedAt || 0) > (p.updatedAt || 0)) continue; // 더 최신인 이 기기 기록은 유지
    commit(p, false);
    n++;
  }
  return n;
}
