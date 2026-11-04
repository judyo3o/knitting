/** 기호 이름 점검: 한 단의 칸마다 눌러 본 결과를 그림에 적는다 */
import { chartBitmap } from "../src/chart";
import { openPdf, textItems } from "../src/pdf";
import { chartFor, findLegend, LEGEND_RE, rowH, rowY } from "../src/pdfgeom";
import { debugTemplates, identify } from "../src/symbolid";
import { gridLattice } from "../src/symbols";
import { newPattern } from "../src/model";

(window as any).symcheck = async (b64: string, page: number, rows: number[]) => {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  const pdf = await openPdf(new Blob([u]));
  const p = newPattern({ id: "chk", name: "chk" });
  for (let n = 1; n <= Math.min(14, pdf.numPages); n++) {
    const t = await textItems(pdf, n);
    if (!t.items.some((i) => LEGEND_RE.test(i.str))) continue;
    const lg = findLegend(t.items);
    if (lg) { p.legend = { page: n, ...lg }; break; }
  }
  const bmp = await chartBitmap(pdf, "chk", page);
  // 기호표 항목 번호 매기기용 (첫 identify가 캐시를 채운다)
  const { legendEntries } = await import("../src/symbols");
  const lgT = await textItems(pdf, (p.legend as any).page);
  const legendIdx = legendEntries(lgT.items, p.legend as any).map((e) => e.cy);
  const S = bmp.scale;
  const out: any[] = [];
  for (const n of rows) {
    const c = chartFor(bmp.charts, n)!;
    const h = rowH(c);
    const ctx = bmp.canvas.getContext("2d", { willReadFrequently: true })!;
    const img = ctx.getImageData(0, 0, bmp.canvas.width, bmp.canvas.height);
    const dark = (x: number, y: number) => { const i = (Math.round(y) * img.width + Math.round(x)) * 4; const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2]; return r + g + b < 3 * 236 && Math.max(r, g, b) - Math.min(r, g, b) < 14; };
    const lat = gridLattice(dark, c.x0 * S, c.x1 * S, (rowY(c, Math.min(c.nMax, n + 6)) - h / 2) * S, (rowY(c, Math.max(c.nMin, n - 6)) + h / 2) * S);
    if (!lat) { out.push({ n, err: "격자 없음" }); continue; }
    const cells = lat.xs.length ? Math.round((Math.max(...lat.xs) - Math.min(...lat.xs)) / lat.w) : 0;
    const x0 = Math.min(...lat.xs);
    const labels: string[] = [];
    for (let k = 0; k < cells; k++) {
      const x = (x0 + (k + 0.5) * lat.w) / S;
      const hit = await identify(p, pdf, page, bmp, x, rowY(c, n));
      const idx = hit?.entry ? legendIdx.indexOf(hit.entry.cy) : -1;
      labels.push(hit ? (hit.guess ? "~" : "") + "#" + idx + "=" + (hit.sym || "").slice(0, 8) : "?");
    }
    // 그림: 그 단 ±1단을 크게 + 칸마다 이름
    const Z = 3, cw = (lat.w / S) * Z * 8;
    const W = cells * cw, H = 3 * h * Z * 8 + 260;
    const cv = document.createElement("canvas");
    cv.width = Math.min(16000, W); cv.height = H;
    const g = cv.getContext("2d")!;
    g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, H);
    g.imageSmoothingEnabled = false;
    g.drawImage(bmp.canvas, x0, (rowY(c, n + 1) - h / 2) * S, cells * lat.w, 3 * h * S, 0, 260, W, 3 * h * Z * 8);
    g.strokeStyle = "#E83E8C"; g.lineWidth = 3; g.strokeRect(0, 260 + h * Z * 8, W, h * Z * 8);
    g.font = "15px sans-serif"; g.fillStyle = "#111";
    labels.forEach((l, k) => { g.save(); g.translate(k * cw + cw / 2 + 5, 255); g.rotate(-Math.PI / 2); g.fillText(l.split("=")[0] + " " + l.split("=")[1], 0, 0); g.restore(); });
    out.push({ n, cells, cellW: +(lat.w / S).toFixed(2), labels, url: cv.toDataURL("image/png") });
  }
  // 기호표 항목 목록 그림 (번호 + 줄 그림)
  const ents = legendEntries(lgT.items, p.legend as any);
  const first = await identify(p, pdf, page, bmp, (bmp.charts[0].x0 + bmp.charts[0].x1) / 2, rowY(bmp.charts[0], bmp.charts[0].nMin));
  void first;
  const tm = await debugTemplates(p, pdf);
  return { tmpls: tm, rows: out, legend: ents.map((e, i) => `#${i} ${e.sym ? "[" + e.sym + "] " : ""}${e.name}`) };
};
(window as any).dbg = async (b64: string, page: number, n: number, cellK: number) => {
  (globalThis as any).__symdebug = [];
  const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  const pdf = await openPdf(new Blob([u]));
  const p = newPattern({ id: "chk2", name: "chk" });
  const t3 = await textItems(pdf, 3); p.legend = { page: 3, ...findLegend(t3.items)! };
  const bmp = await chartBitmap(pdf, "chk2", page);
  const c = chartFor(bmp.charts, n)!; const S = bmp.scale; const h = rowH(c);
  const img = bmp.canvas.getContext("2d")!.getImageData(0, 0, bmp.canvas.width, bmp.canvas.height);
  const dark = (x: number, y: number) => { const i = (Math.round(y) * img.width + Math.round(x)) * 4; const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2]; return r + g + b < 3 * 236 && Math.max(r, g, b) - Math.min(r, g, b) < 14; };
  const lat = gridLattice(dark, c.x0 * S, c.x1 * S, (rowY(c, n + 6) - h / 2) * S, (rowY(c, n - 6) + h / 2) * S)!;
  const x0 = Math.min(...lat.xs);
  const res = [];
  for (let k = cellK; k < cellK + 40; k++) {
    (globalThis as any).__symdebug = [];
    const hit = await identify(p, pdf, page, bmp, (x0 + (k + 0.5) * lat.w) / S, rowY(c, n));
    if (hit?.sym === "|" && hit.entry && !hit.entry.sym && hit.entry.cy < 340) res.push({ k, d: (globalThis as any).__symdebug.sort((a: any, b: any) => a[1] - b[1]).slice(0, 3) });
  }
  return res.slice(0, 2);
};
(window as any).ready = true;

/** 한 단 전체 읽기 점검: readRow → rowText */
(window as any).readrows = async (b64: string, page: number, rows: number[]) => {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  const pdf = await openPdf(new Blob([u]));
  const p = newPattern({ id: "rr", name: "rr" });
  for (let n = 1; n <= Math.min(14, pdf.numPages); n++) {
    const t = await textItems(pdf, n);
    if (!t.items.some((i) => LEGEND_RE.test(i.str))) continue;
    const lg = findLegend(t.items);
    if (lg) { p.legend = { page: n, ...lg }; break; }
  }
  const bmp = await chartBitmap(pdf, "rr", page);
  const { readRow, rowText } = await import("../src/symbolid");
  const out: string[] = [];
  for (const n of rows) {
    const t0 = performance.now();
    const ws = n % 2 === 0;
    const st = await readRow(p, pdf, page, bmp, n, ws);
    out.push(`${n}단 ${ws ? "WS" : "RS"} (${Math.round(performance.now() - t0)}ms, ${st ? st.reduce((a, x) => a + x.cells, 0) : 0}칸): ${st ? rowText(st, ws) : "못 읽음"}`);
  }
  return out;
};

/** 누르기 점검: 단 n에서 코 번호 v 자리, 그리고 단 번호 칸(차트 왼쪽 끝) */
(window as any).taps = async (b64: string, page: number, n: number, vs: number[]) => {
  const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  const pdf = await openPdf(new Blob([u]));
  const p = newPattern({ id: "tp", name: "tp" });
  for (let k = 1; k <= Math.min(14, pdf.numPages); k++) { const t = await textItems(pdf, k); if (!t.items.some((i) => LEGEND_RE.test(i.str))) continue; const lg = findLegend(t.items); if (lg) { p.legend = { page: k, ...lg }; break; } }
  const bmp = await chartBitmap(pdf, "tp", page);
  const c = chartFor(bmp.charts, n)!;
  const { stitchAxis } = await import("../src/pdfgeom");
  const ax = stitchAxis((await textItems(pdf, page)).items, c)!;
  const out: string[] = [];
  const show = (lbl: string, hit: any) => out.push(`${lbl}: ${hit ? `${hit.name} · 오른쪽부터 ${hit.fromRight} · 왼쪽부터 ${hit.fromLeft}` : "null(코 아님)"}`);
  show("단 번호 칸", await identify(p, pdf, page, bmp, c.x0 + 3, rowY(c, n)));
  for (const v of vs) show(`코 ${v}`, await identify(p, pdf, page, bmp, ax.a + ax.b * v, rowY(c, n)));
  return out;
};

/** 사이즈 선 점검: 라벨 색, 단마다 범위, 칸 수 */
(window as any).sizedbg = async (b64: string, page: number, size: string, rows: number[]) => {
  const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  const pdf = await openPdf(new Blob([u]));
  const bmp = await chartBitmap(pdf, "sz", page);
  const items = (await textItems(pdf, page)).items;
  const { chartsForSize, sizeRange } = await import("../src/pdfgeom");
  const { labelColor, sizeLabelColors, sizeLineRange, chartKey } = await import("../src/chart");
  const charts = chartsForSize(items, bmp.charts, size);
  const out: string[] = [`charts ${bmp.charts.length} → ${charts.length}`, "key " + JSON.stringify(chartKey(bmp, items).map((k) => [k.code, k.rgb.map(Math.round)]))];
  for (const n of rows) {
    const c = chartFor(charts, n)!;
    const col = labelColor(bmp, items, c, size);
    const all = sizeLabelColors(bmp, items, c);
    const others = all.filter((x) => !x.sizes.includes(size)).map((x) => x.rgb);
    const rr = col ? sizeLineRange(bmp, c, n, col, others) : null;
    out.push(`${n}: col ${col?.map(Math.round)} all ${JSON.stringify(all.map((x) => [x.sizes.join("/"), x.rgb.map(Math.round)]))} row ${rr?.map((v) => v.toFixed(1))} static ${sizeRange(items, c, size)?.map((v) => v.toFixed(1))} chart x ${c.x0.toFixed(1)}-${c.x1.toFixed(1)}`);
  }
  return out;
};

(window as any).splitdbg = async (b64: string, page: number) => {
  const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  const pdf = await openPdf(new Blob([u]));
  const bmp = await chartBitmap(pdf, "sp", page);
  const items = (await textItems(pdf, page)).items;
  const g = await import("../src/pdfgeom"); const ch = await import("../src/chart");
  return bmp.charts.map((c) => {
    const top = g.rowY(c, c.nMax) - g.rowH(c) / 2, bot = g.rowY(c, Math.min(c.nMax, c.nMin + 10));
    const parts = ch.splitChartByGap(bmp, c);
    const fs = g.chartsForSize(items, parts, "2XL");
    const sc = parts.map((q) => `${g.chartSizes(items, q).join("/")}:${g.partTitleScore("LEFT FRONT", g.chartTitle(items, q))}`);
    return `size→${fs.length} ${sc.join(" ; ")} chart x ${c.x0.toFixed(0)}-${c.x1.toFixed(0)} rows ${c.nMin}-${c.nMax} top ${top.toFixed(0)} bot ${bot.toFixed(0)} titles ${g.chartTitleCount(items, c)} | split → ${parts.map((q) => q.x0.toFixed(0) + "-" + q.x1.toFixed(0) + " [" + g.chartTitle(items, q).slice(0, 50) + "]").join(" / ")}`;
  });
};

(window as any).frontdbg = async (b64: string, page: number, part: string, size: string, rows: number[]) => {
  const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  const pdf = await openPdf(new Blob([u]));
  const bmp0 = await chartBitmap(pdf, "fd", page);
  const items = (await textItems(pdf, page)).items;
  const g = await import("../src/pdfgeom"); const ch = await import("../src/chart");
  let charts: any[] = [];
  for (const c of bmp0.charts) charts.push(...(g.chartTitleCount(items, c) >= 2 ? ch.splitChartByGap(bmp0, c) : [c]));
  charts = g.chartsForSize(items, charts, size);
  const sc = charts.map((c) => g.partTitleScore(part, g.chartTitle(items, c)));
  const best = Math.max(...sc); charts = charts.filter((_, i) => sc[i] === best);
  const bmp = { ...bmp0, charts };
  const out: string[] = [`charts ${charts.map((c) => c.x0.toFixed(0) + "-" + c.x1.toFixed(0) + " axes " + c.axes.map((a: number) => a.toFixed(0))).join(" / ")}`];
  for (const n of rows) {
    const c = g.chartFor(charts, n)!;
    if (!c) { out.push(n + ": no chart"); continue; }
    const col = ch.labelColor(bmp, items, c, size);
    const others = ch.sizeLabelColors(bmp, items, c).filter((x) => !x.sizes.includes(size)).map((x) => x.rgb);
    const row = col ? ch.sizeLineRange(bmp, c, n, col, others) : null;
    out.push(`${n}: col ${col?.map(Math.round)} row ${row?.map((v) => v.toFixed(1))} fixed ${g.sizeRange(items, c, size)?.map((v) => v.toFixed(1))} marks ${JSON.stringify(g.sizeMarks(items, c).map((m) => [m.sizes.join("/"), Math.round(m.x)]))}`);
  }
  return out;
};
