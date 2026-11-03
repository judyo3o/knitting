/** 차트 정렬 점검 (§6): 실제 앱 코드로 페이지마다 여러 단에 띠를 그려 PNG로 돌려준다 */
import { chartBitmap, drawPdfFull, drawPdfRows, legendCanvas } from "../src/chart";
import { openPdf, textItems } from "../src/pdf";
import { findLegend, LEGEND_RE } from "../src/pdfgeom";

(window as any).runCheck = async (b64: string, pages: number[]) => {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  const pdf = await openPdf(new Blob([u], { type: "application/pdf" }));
  const out: any[] = [];
  for (const page of pages) {
    const bmp = await chartBitmap(pdf, "check", page);
    const info = bmp.charts.map((c) => ({ nMin: c.nMin, nMax: c.nMax, b: +c.b.toFixed(3), a: +c.a.toFixed(2), axes: c.axes.map((x) => +x.toFixed(1)), x0: +c.x0.toFixed(1), x1: +c.x1.toFixed(1) }));
    const imgs: { name: string; url: string }[] = [];
    for (const c of bmp.charts) {
      const mid = Math.round((c.nMin + c.nMax) / 2);
      const rows = [...new Set([c.nMin === 2 ? 1 : c.nMin, c.nMin, c.nMin + 1, mid, mid + 1, c.nMax])];
      for (const n of rows) {
        const cv = document.createElement("canvas");
        const side = n % 2 ? "RS" : "WS";
        drawPdfRows(cv, bmp, { n, side, round: false, rowPx: 22 });
        imgs.push({ name: `p${page}-row${n}-${side}`, url: cv.toDataURL("image/png") });
      }
      const full = document.createElement("canvas");
      drawPdfFull(full, bmp, { n: mid, side: "RS", round: false, rowPx: 22 }, Math.min(2400, bmp.w * 2));
      imgs.push({ name: `p${page}-full-row${mid}`, url: full.toDataURL("image/png") });
      const rnd = document.createElement("canvas");
      drawPdfRows(rnd, bmp, { n: mid, side: "RS", round: true, rowPx: 22 });
      imgs.push({ name: `p${page}-row${mid}-round`, url: rnd.toDataURL("image/png") });
    }
    out.push({ page, charts: info, imgs });
  }
  // 기호표
  let legend: any = null;
  for (let n = 1; n <= Math.min(14, pdf.numPages); n++) {
    const t = await textItems(pdf, n);
    if (!t.items.some((i) => LEGEND_RE.test(i.str))) continue;
    const lg = findLegend(t.items);
    if (lg) {
      const cv = await legendCanvas(pdf, { page: n, ...lg }, 2);
      legend = { page: n, box: lg, url: cv.toDataURL("image/png") };
      break;
    }
  }
  return { numPages: pdf.numPages, pages: out, legend };
};
(window as any).checkReady = true;
