// 차트 정렬 점검 PNG 만들기 (PLAN §6)
//   npm run check                       → 합성 테스트 PDF로
//   npm run check -- fixtures/도안.pdf 2,23,24,25,26,27   → 실제 도안으로
// 결과: check-out/index.html (띠가 양옆 단 번호와 같은 높이인지 눈으로 확인)
import { createServer } from "vite";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync, execSync } from "node:child_process";
import { createRequire } from "node:module";

// playwright: 프로젝트에 설치돼 있으면 그것, 없으면 전역 설치본 (npm i -g playwright && npx playwright install chromium)
let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  const g = execSync("npm root -g").toString().trim();
  ({ chromium } = createRequire(g + "/")("playwright"));
}

mkdirSync("check-out", { recursive: true });
let [pdfPath, pageSpec] = process.argv.slice(2);
if (!pdfPath) {
  pdfPath = "check-out/synthetic-pattern.pdf";
  if (!existsSync(pdfPath)) execFileSync("python3", ["scripts/make-fixture.py", pdfPath], { stdio: "inherit" });
  pageSpec ||= "2,13,14";
}
const pages = (pageSpec || "2,23,24,25,26,27").split(",").flatMap((s) => {
  const [a, b] = s.split("-").map(Number);
  return b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [a];
});

const server = await createServer({ server: { port: 5199 }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.error("page error:", e.message));
await page.goto("http://localhost:5199/tools/check.html");
await page.waitForFunction(() => (window).checkReady, null, { timeout: 60000 });
const b64 = readFileSync(pdfPath).toString("base64");
const res = await page.evaluate(([b, p]) => (window).runCheck(b, p), [b64, pages]);
await browser.close();
await server.close();

const save = (name, url) => {
  writeFileSync(`check-out/${name}.png`, Buffer.from(url.split(",")[1], "base64"));
  return `${name}.png`;
};
let html = `<!doctype html><meta charset="utf-8"><title>차트 정렬 점검</title><style>body{font-family:sans-serif;margin:16px;background:#f3f5f2}img{max-width:100%;border:1px solid #ccc;background:#fff;display:block;margin:4px 0 14px}code{font-size:12px}</style><h1>차트 정렬 점검 · ${pdfPath}</h1>
<p>확인: ① 분홍 띠가 양옆 단 번호와 같은 높이 ② 띠가 차트 가로 전체를 덮음 ③ 아래 코 번호 줄을 단으로 착각하지 않음 ④ RS(홀수)는 화살표 ← 오른쪽, WS(짝수)는 → 왼쪽, 원통은 ←</p>`;
for (const pg of res.pages) {
  html += `<h2>p${pg.page}</h2><code>${JSON.stringify(pg.charts)}</code>`;
  if (!pg.charts.length) html += `<p style="color:#b00">단 번호 축을 찾지 못함</p>`;
  for (const im of pg.imgs) html += `<div>${im.name}</div><img src="${save(im.name, im.url)}">`;
  console.log(`p${pg.page}:`, pg.charts.length ? pg.charts.map((c) => `${c.nMin}–${c.nMax}단, 간격 ${Math.abs(c.b)}pt, 축 x=${c.axes.join("/")}`).join(" | ") : "축 없음");
}
if (res.legend) {
  html += `<h2>기호표 (p${res.legend.page})</h2><code>${JSON.stringify(res.legend.box)}</code><img src="${save("legend", res.legend.url)}" style="max-width:420px">`;
  console.log(`기호표: p${res.legend.page}`, res.legend.box);
} else console.log("기호표: 못 찾음");
writeFileSync("check-out/index.html", html);
console.log("→ check-out/index.html");
