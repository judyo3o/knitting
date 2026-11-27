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

/**
 * 도안 앞쪽(최대 4쪽)에 들어 있는 사진 중 가장 큰 것을 찾아 썸네일(JPEG data URL)로 만든다.
 * 그림 그리기 명령(paintImageXObject)의 위치를 변환 행렬로 따라가 쪽 위 사각형을 구하고, 그 부분만 그려 자른다.
 */
export async function coverPhoto(pdf: Pdf, max = 240): Promise<string | null> {
  const O = pdfjs.OPS as Record<string, number>;
  let best: { n: number; x0: number; y0: number; x1: number; y1: number; score: number } | null = null;
  for (let n = 1; n <= Math.min(4, pdf.numPages); n++) {
    const page = await pdf.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const ops = await page.getOperatorList();
    let ctm = [1, 0, 0, 1, 0, 0];
    const stack: number[][] = [];
    for (let i = 0; i < ops.fnArray.length; i++) {
      const f = ops.fnArray[i], a = ops.argsArray[i];
      if (f === O.save) stack.push(ctm);
      else if (f === O.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
      else if (f === O.paintFormXObjectBegin) { stack.push(ctm); const m = a?.[0]; if (Array.isArray(m) || ArrayBuffer.isView(m)) { const t = Array.from(m as ArrayLike<number>); ctm = [ctm[0] * t[0] + ctm[2] * t[1], ctm[1] * t[0] + ctm[3] * t[1], ctm[0] * t[2] + ctm[2] * t[3], ctm[1] * t[2] + ctm[3] * t[3], ctm[0] * t[4] + ctm[2] * t[5] + ctm[4], ctm[1] * t[4] + ctm[3] * t[5] + ctm[5]]; } }
      else if (f === O.paintFormXObjectEnd) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
      else if (f === O.transform) ctm = [ctm[0] * a[0] + ctm[2] * a[1], ctm[1] * a[0] + ctm[3] * a[1], ctm[0] * a[2] + ctm[2] * a[3], ctm[1] * a[2] + ctm[3] * a[3], ctm[0] * a[4] + ctm[2] * a[5] + ctm[4], ctm[1] * a[4] + ctm[3] * a[5] + ctm[5]];
      else if (f === O.paintImageXObject || f === O.paintInlineImageXObject || f === O.paintImageXObjectRepeat) {
        const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map((p) => vp.convertToViewportPoint(p[0] * ctm[0] + p[1] * ctm[2] + ctm[4], p[0] * ctm[1] + p[1] * ctm[3] + ctm[5]));
        const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
        const x0 = Math.max(0, Math.min(...xs)), x1 = Math.min(vp.width, Math.max(...xs));
        const y0 = Math.max(0, Math.min(...ys)), y1 = Math.min(vp.height, Math.max(...ys));
        const w = x1 - x0, h = y1 - y0;
        if (w < vp.width * 0.1 || h < vp.height * 0.05) continue;
        const frac = (w * h) / (vp.width * vp.height);
        if (frac < 0.012 || (frac > 0.92 && n > 1)) continue; // 쪽 전체가 그림(스캔)인 건 표지 쪽만
        if (w / h > 4 || h / w > 4) continue; // 띠 장식
        const score = frac * (1 - 0.15 * (n - 1));
        if (!best || score > best.score) best = { n, x0, y0, x1, y1, score };
      }
    }
  }
  if (!best) return null;
  const { w } = await pageSize(pdf, best.n);
  const scale = Math.min(4, (max / Math.max(1, Math.max(best.x1 - best.x0, best.y1 - best.y0))) * 1.0);
  const page = await renderRegion(pdf, best.n, scale, best.y0, best.y1);
  const k = page.width / w;
  const cw = Math.max(1, Math.round((best.x1 - best.x0) * k)), ch = page.height;
  const c = document.createElement("canvas");
  c.width = cw; c.height = ch;
  c.getContext("2d")!.drawImage(page, Math.round(best.x0 * k), 0, cw, ch, 0, 0, cw, ch);
  page.width = page.height = 0;
  return c.toDataURL("image/jpeg", max > 600 ? 0.9 : 0.8);
}
