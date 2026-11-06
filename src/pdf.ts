/** pdf.js(렌더·텍스트 위치) + pdf-lib(선택 페이지 추출) */
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { TItem } from "./pdfgeom";
import { buildRescue, type Rescue } from "./fontfix";
import { unreadable } from "./symbols";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
// 절대 주소로 (아티팩트에선 워커가 blob URL이라 상대 주소를 못 푼다)
const BASE = new URL(import.meta.env.BASE_URL + "pdfjs/", document.baseURI).href;

export type Pdf = PDFDocumentProxy;

const blobOf = new WeakMap<Pdf, Blob>();
const rescueOf = new WeakMap<Pdf, Promise<Rescue | null>>();

/**
 * 아티팩트는 정해진 웹 파일 종류만 올릴 수 있어서, pdf.js 워커와 글자 표(cMap)는 base64 텍스트(.b64.txt)로 올리고
 * 여기서 풀어 쓴다 (워커는 blob URL, 글자 표는 pdf.js의 BinaryDataFactory로).
 */
const inArtifactView = () => !!(globalThis as any).claude?.use;
const b64Bytes = async (url: string) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error("fetch " + url);
  const bin = atob((await r.text()).trim());
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
};
class ArtifactDataFactory {
  [k: string]: any;
  constructor(o: { cMapUrl?: string; standardFontDataUrl?: string; wasmUrl?: string }) {
    Object.assign(this, o);
  }
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const url = `${this[kind]}${filename}`;
    if (kind === "cMapUrl") return b64Bytes(url + ".b64.txt");
    const r = await fetch(url); // ttf·wasm은 그대로 올라가 있다 (pfb는 없음 → pdf.js가 대체 글꼴 사용)
    if (!r.ok) throw new Error("fetch " + url);
    return new Uint8Array(await r.arrayBuffer());
  }
}
let workerReady: Promise<void> | null = null;
function ensureWorker() {
  if (!inArtifactView()) return Promise.resolve();
  if (!workerReady)
    workerReady = (async () => {
      try {
        const js = new Blob([await b64Bytes(workerUrl.replace(/\.mjs($|\?)/, ".b64.txt$1"))], { type: "text/javascript" });
        pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(js);
      } catch {}
    })();
  return workerReady;
}

export async function openPdf(blob: Blob): Promise<Pdf> {
  await ensureWorker();
  const data = new Uint8Array(await blob.arrayBuffer());
  const extra = inArtifactView() ? { useWorkerFetch: false, BinaryDataFactory: ArtifactDataFactory } : {};
  const pdf = await pdfjs.getDocument({ data, cMapUrl: BASE + "cmaps/", cMapPacked: true, standardFontDataUrl: BASE + "standard_fonts/", wasmUrl: BASE + "wasm/", ...extra } as any).promise;
  blobOf.set(pdf, blob);
  return pdf;
}

/** 대응표 없는 글꼴 글자 살리기 (필요할 때 한 번만 만든다) */
function rescue(pdf: Pdf): Promise<Rescue | null> {
  let r = rescueOf.get(pdf);
  if (!r) {
    const blob = blobOf.get(pdf);
    r = blob ? blob.arrayBuffer().then(buildRescue).catch(() => null) : Promise.resolve(null);
    rescueOf.set(pdf, r);
  }
  return r;
}

const itemCache = new WeakMap<Pdf, Map<number, { items: TItem[]; w: number; h: number }>>();

/** 텍스트 항목 → scale 1 viewport 좌표 (y는 기준선) */
export async function textItems(pdf: Pdf, n: number) {
  let m = itemCache.get(pdf);
  if (!m) itemCache.set(pdf, (m = new Map()));
  const hit = m.get(n);
  if (hit) return hit;
  const page = await pdf.getPage(n);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const items: TItem[] = [];
  for (const it of tc.items as any[]) {
    if (!("str" in it) || !it.str) continue;
    const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
    const h = it.height || Math.hypot(it.transform[2], it.transform[3]) || 8;
    items.push({ str: it.str, x, y, w: it.width || 0, h });
  }
  // 깨진 글자(대응표 없는 글꼴)는 같은 글꼴의 대응표로 다시 읽는다
  if (items.some((i) => unreadable(i.str))) {
    const rs = await rescue(pdf);
    if (rs)
      for (const i of items) {
        if (!unreadable(i.str)) continue;
        const fixed = rs.decode(i.str);
        if (!unreadable(fixed)) i.str = fixed;
      }
  }
  const out = { items, w: vp.width, h: vp.height };
  m.set(n, out);
  return out;
}

export async function pageSize(pdf: Pdf, n: number) {
  const vp = (await pdf.getPage(n)).getViewport({ scale: 1 });
  return { w: vp.width, h: vp.height };
}

/** 페이지를 scale 배율로 그린다 (흰 배경) */
/** 한 그림의 최대 픽셀 수 — 휴대폰(특히 iPhone Safari)은 큰 캔버스를 거부한다 */
export const MAX_PIXELS = 5_000_000;

export async function renderPage(pdf: Pdf, n: number, scale: number): Promise<HTMLCanvasElement> {
  const page = await pdf.getPage(n);
  const v1 = page.getViewport({ scale: 1 });
  // 너무 크면 줄이고, 그래도 캔버스를 못 만들면 더 작게 다시 (최대 3번)
  scale = Math.min(scale, Math.sqrt(MAX_PIXELS / (v1.width * v1.height)));
  let lastErr: unknown = null;
  for (let tries = 0; tries < 3; tries++, scale *= 0.6) {
    const vp = page.getViewport({ scale });
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(vp.width));
    c.height = Math.max(1, Math.round(vp.height));
    const ctx = c.getContext("2d");
    if (!ctx) { lastErr = new Error(`캔버스를 만들지 못함 (${c.width}×${c.height})`); continue; }
    try {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, canvas: c, viewport: vp } as any).promise;
      return c;
    } catch (e) {
      lastErr = e;
      c.width = c.height = 0; // 메모리 바로 돌려주기
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
/** 쪽의 일부(가로 띠)만 높은 배율로 그린다 — 큰 캔버스 없이 자세히 보려고 (기호 찾기) */
export async function renderRegion(pdf: Pdf, n: number, scale: number, y0: number, y1: number): Promise<HTMLCanvasElement> {
  const page = await pdf.getPage(n);
  const v1 = page.getViewport({ scale: 1 });
  scale = Math.min(scale, Math.sqrt(MAX_PIXELS / (v1.width * Math.max(1, y1 - y0))));
  const vp = page.getViewport({ scale, offsetY: -y0 * scale });
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(v1.width * scale));
  c.height = Math.max(1, Math.round((y1 - y0) * scale));
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error(`캔버스를 만들지 못함 (${c.width}×${c.height})`);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, canvas: c, viewport: vp } as any).promise;
  return c;
}

export const renderWidth = async (pdf: Pdf, n: number, w: number) => renderPage(pdf, n, w / (await pageSize(pdf, n)).w);

/** 선택 페이지만 잘라낸 PDF (Claude document 블록용) */
export async function extractPages(blob: Blob, pages: number[]): Promise<Uint8Array> {
  const { PDFDocument } = await import("pdf-lib");
  const src = await PDFDocument.load(await blob.arrayBuffer(), { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, pages.map((n) => n - 1));
  copied.forEach((p) => out.addPage(p));
  return out.save();
}

export async function sha256(blob: Blob): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

export function b64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export async function blobB64(blob: Blob) {
  return b64(new Uint8Array(await blob.arrayBuffer()));
}
export const canvasBlob = (c: HTMLCanvasElement, type = "image/jpeg", q = 0.9) => new Promise<Blob>((r) => c.toBlob((b) => r(b!), type, q));
