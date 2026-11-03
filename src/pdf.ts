/** pdf.js(렌더·텍스트 위치) + pdf-lib(선택 페이지 추출) */
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { TItem } from "./pdfgeom";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
const BASE = import.meta.env.BASE_URL + "pdfjs/";

export type Pdf = PDFDocumentProxy;

export async function openPdf(blob: Blob): Promise<Pdf> {
  const data = new Uint8Array(await blob.arrayBuffer());
  return pdfjs.getDocument({ data, cMapUrl: BASE + "cmaps/", cMapPacked: true, standardFontDataUrl: BASE + "standard_fonts/", wasmUrl: BASE + "wasm/" } as any).promise;
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
  const out = { items, w: vp.width, h: vp.height };
  m.set(n, out);
  return out;
}

export async function pageSize(pdf: Pdf, n: number) {
  const vp = (await pdf.getPage(n)).getViewport({ scale: 1 });
  return { w: vp.width, h: vp.height };
}

/** 페이지를 scale 배율로 그린다 (흰 배경) */
export async function renderPage(pdf: Pdf, n: number, scale: number): Promise<HTMLCanvasElement> {
  const page = await pdf.getPage(n);
  const vp = page.getViewport({ scale });
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(vp.width));
  c.height = Math.max(1, Math.round(vp.height));
  const ctx = c.getContext("2d")!;
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
