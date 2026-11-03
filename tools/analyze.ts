/** 실제 도안 PDF로 앱 파이프라인 점검: 자동 페이지 선택 → 기기 읽기 → 차트 축 → 기호표 → 게이지 */
import { openPdf, textItems } from "../src/pdf";
import { autoPick, findCharts, findLegend, LEGEND_RE, pageInfo, toLines } from "../src/pdfgeom";
import { localGoodEnough, localParseLines, resolveSizes, sizeOrder } from "../src/parse";
import { findGauges } from "../src/gauge";
import { expand, mergeSections } from "../src/model";

(window as any).analyze = async (b64: string, size: string) => {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  const pdf = await openPdf(new Blob([u]));
  const info = [], pages: any[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const t = await textItems(pdf, n);
    const pi = pageInfo(n, t.items);
    info.push(pi);
    const charts = findCharts(t.items, t.w).map((c) => `${c.nMin}–${c.nMax}단 b=${c.b.toFixed(2)} 축=${c.axes.map((x) => x.toFixed(0)).join("/")}`);
    pages.push({ n, w: Math.round(t.w), h: Math.round(t.h), items: t.items.length, rowItems: pi.rowItems, ko: pi.ko, sizes: [...pi.sizes], gauge: pi.gauge, charts });
  }
  const pick = autoPick(info, size);
  const perPage = [];
  for (const n of pick.pages) { const t = await textItems(pdf, n); perPage.push({ n, lines: toLines(t.items, t.w) }); }
  const text = perPage.map((x) => x.lines.join("\n")).join("\n");
  const order = sizeOrder(text);
  const lines = perPage.flatMap((x) => x.lines.map((t) => ({ t: size ? resolveSizes(t, size, order) : t, pg: x.n })));
  const secs = localParseLines(lines, size);
  const good = localGoodEnough(secs, text);
  const { rows } = expand(mergeSections([], secs));
  let legend = null;
  for (let n = 1; n <= Math.min(14, pdf.numPages); n++) {
    const t = await textItems(pdf, n);
    if (!t.items.some((i) => LEGEND_RE.test(i.str))) continue;
    const lg = findLegend(t.items);
    if (lg) { legend = { page: n, ...lg }; break; }
  }
  const gtext = (await Promise.all(info.filter((x) => x.gauge).slice(0, 2).map(async (x) => (await textItems(pdf, x.n)).items.map((i) => i.str).join(" ")))).join(" ");
  return {
    numPages: pdf.numPages, pages, pick, order, good,
    sections: secs.map((s) => ({ name: s.name, chart: s.chart, round: s.round, rows: s.rows.length, first: s.rows.slice(0, 2).map((r) => `${r.from}${r.to !== r.from ? "~" + r.to : ""}단 ${r.side || ""} ${r.text.slice(0, 70)} ${r.stitches || ""} p${r.page}`) })),
    rowCount: rows.length, legend, gauges: findGauges(gtext), gtext: gtext.slice(Math.max(0, gtext.indexOf("게이지") - 20), gtext.indexOf("게이지") + 260),
    sampleLines: perPage.slice(0, 2).map((x) => ({ n: x.n, lines: x.lines.slice(0, 14) })),
  };
};
(window as any).ready = true;
