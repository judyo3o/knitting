/** IndexedDB: 도안·원본 파일·Claude 응답 캐시·스냅샷·설정 — 전부 이 기기 안에만 */
import { openDB, type IDBPDatabase } from "idb";
import { MAX_SNAPSHOTS } from "./config";
import type { Pattern } from "./types";

export type FileRec = { type: "pdf"; blob: Blob } | { type: "images"; blobs: Blob[] };

let dbp: Promise<IDBPDatabase> | null = null;
function db() {
  if (!dbp)
    dbp = openDB("knit-row-counter", 1, {
      upgrade(d) {
        d.createObjectStore("patterns", { keyPath: "id" });
        d.createObjectStore("files");
        d.createObjectStore("cache");
        d.createObjectStore("snapshots", { keyPath: "t" });
        d.createObjectStore("settings");
      },
    });
  return dbp;
}

export const loadPatterns = async (): Promise<Pattern[]> => (await db()).getAll("patterns");
export const savePattern = async (p: Pattern) => {
  await (await db()).put("patterns", structuredClone(p));
};
export const deletePattern = async (id: string) => {
  const d = await db();
  await d.delete("patterns", id);
  await d.delete("files", id);
};

export const putFile = async (id: string, f: FileRec) => {
  await (await db()).put("files", f, id);
};
export const getFile = async (id: string): Promise<FileRec | undefined> => (await db()).get("files", id);

export const cacheGet = async <T>(k: string): Promise<T | undefined> => (await db()).get("cache", k);
export const cacheSet = async (k: string, v: unknown) => {
  await (await db()).put("cache", v, k);
};

export const getSetting = async <T>(k: string): Promise<T | undefined> => (await db()).get("settings", k);
export const setSetting = async (k: string, v: unknown) => {
  await (await db()).put("settings", v, k);
};

/** 10분 간격 백업 스냅샷 (최근 MAX_SNAPSHOTS개만) */
export async function snapshot(patterns: Pattern[]) {
  const d = await db();
  const t = Date.now();
  await d.put("snapshots", { t, data: structuredClone(patterns) });
  const keys = (await d.getAllKeys("snapshots")) as number[];
  for (const k of keys.sort((a, b) => a - b).slice(0, Math.max(0, keys.length - MAX_SNAPSHOTS))) await d.delete("snapshots", k);
  return t;
}
export async function listSnapshots(): Promise<{ t: number; data: Pattern[] }[]> {
  return ((await (await db()).getAll("snapshots")) as { t: number; data: Pattern[] }[]).sort((a, b) => b.t - a.t);
}
