// 앱 전체 흐름 점검 (Playwright): npm run e2e  → check-out/e2e-*.png
import { createServer } from "vite";
import { execFileSync, execSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";

let chromium;
try { ({ chromium } = await import("playwright")); } catch { ({ chromium } = createRequire(execSync("npm root -g").toString().trim() + "/")("playwright")); }
mkdirSync("check-out", { recursive: true });
const pdfPath = "check-out/synthetic-pattern.pdf";
if (!existsSync(pdfPath)) execFileSync("python3", ["scripts/make-fixture.py", pdfPath], { stdio: "inherit" });

const server = await createServer({ server: { port: 5198 }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 2, permissions: ["clipboard-read", "clipboard-write"] });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const shot = (n) => page.screenshot({ path: `check-out/e2e-${n}.png`, fullPage: true });
const step = (s) => console.log("•", s);

await page.goto("http://localhost:5198/");
await page.waitForSelector(".now");
step("예시 도안 표시");
assert.equal(await page.textContent(".rowno b"), "12");
await shot("1-example");

step("다음 단 → 완료 시각 기록, 이전 단 → 취소");
await page.click("#nextBtn");
assert.equal(await page.textContent(".rowno b"), "13");
await page.click("#prevBtn");
assert.equal(await page.textContent(".rowno b"), "12");

step("묶음 누르기 → 진행 저장 + 콧수 추정");
await page.click(".ptab:has-text('몸통')");
await page.fill("form input[type=number]", "2");
await page.click("form button[type=submit]");
await page.click(".chunk >> nth=0");
const meta = await page.textContent(".chunk-meta");
assert.match(meta, /1\/1 묶음 · 왼바늘에서 약 60코 뜸/); // (겉5, M1L)×12: 왼바늘에서 60코 소모 (M1L은 0)
console.log("  ", meta);

step("배색 띠 파트: 그린 격자 + 자동 서술");
await page.click(".ptab:has-text('배색 띠')");
await page.waitForSelector(".chartview canvas");
const chunkText = await page.locator(".chunk").allTextContents();
console.log("  ", chunkText.join(" | "));
assert.ok(chunkText[0].startsWith("A "));
await shot("2-colorwork-row");

step("배색 편집기: 칠하고 저장");
await page.click("text=배색 고치기");
await page.waitForSelector(".editor canvas");
const box = await page.locator(".editor canvas").boundingBox();
await page.mouse.click(box.x + 40, box.y + box.height - 25);
await shot("3-editor");
await page.click(".editor >> text=저장");
await page.waitForSelector(".editor", { state: "detached" });

step("설정: 복사·붙여넣기 기본");
await page.click("#setBtn");
assert.ok(await page.isChecked("input[value=manual]"));
await page.keyboard.press("Escape");

step("PDF 올리기 + L 자동 페이지 선택");
await page.click("#addBtn");
await page.fill("input[placeholder='예: L']", "L");
await page.setInputFiles("#fileIn", pdfPath);
await page.waitForFunction(() => /쪽을 골랐어요/.test(document.querySelector(".pg-tools .hint")?.textContent || ""), null, { timeout: 30000 });
const pick = await page.inputValue("input[aria-label='페이지 범위']");
console.log("   자동 선택:", pick);
assert.equal(pick, "2, 5, 7-12");
await shot("4-upload");

step("읽기 (복사·붙여넣기 모드) → 답 붙여넣기");
const answer = (pages) => JSON.stringify({
  title: "하트 체인 가디건", notes: "L 사이즈 기준", colors: pages.includes(2) ? [{ code: "A", name: "버건디", hex: "#B23A48" }, { code: "B", name: "네이비", hex: "#2F5D8A" }] : null,
  sections: pages.includes(2)
    ? [{ name: "스와치", chart: 2, round: false, rows: [{ from: 1, to: 1, side: "RS", text: "일반코잡기 38코 (코잡기가 1단)", stitches: "38코", page: 2, chart: null, colors: null }, { from: 2, to: 31, side: null, text: "차트대로 무늬뜨기, 2단 안면부터", stitches: "38코", page: 2, chart: null, colors: null }] },
       { name: "뒷판", chart: 13, round: false, rows: [{ from: 1, to: 1, side: "RS", text: "110코 기초코. 겉11, DS, 턴, 겉3", stitches: "110코", page: 5, chart: null, colors: null }, { from: 2, to: 15, side: null, text: "겉2, (안1, 겉1) 3번 반복, 2/1LC", stitches: null, page: 5, chart: null, colors: null }] }]
    : [{ name: "뒷판", chart: 13, round: false, rows: [{ from: 16, to: 116, side: null, text: "16단~116단까지 차트를 따라 진행", stitches: null, page: 7, chart: null, colors: null }] },
       { name: "몸통", chart: 14, round: true, rows: [{ from: 73, to: 130, side: null, text: "차트를 따라 진행", stitches: "206코", page: 9, chart: null, colors: null }] }],
});
await page.click("text=도안 읽기");
for (let i = 0; i < 2; i++) {
  await page.waitForSelector(".dlg textarea[readonly]", { timeout: 60000 });
  const prompt = await page.inputValue(".dlg textarea[readonly]");
  const pages = (prompt.match(/PDF의 ([\d, ]+) 페이지/) || [])[1].split(",").map(Number);
  console.log("   요청 쪽:", pages.join(","), "/ 원본 매핑 문구:", /1쪽=원본/.test(prompt));
  if (i === 0) await shot("5-manual-dialog");
  await page.fill(".dlg textarea:not([readonly])", "```json\n" + answer(pages) + "\n```");
  await page.click("text=붙여넣은 답으로 계속");
  await page.waitForSelector(".dlg", { state: "detached" });
}
await page.waitForSelector("#uploadView", { state: "detached", timeout: 30000 });
await page.waitForSelector(".ptab:has-text('뒷판')");
const tabs = await page.locator(".ptab").allTextContents();
console.log("   파트:", tabs.join(" / "));
assert.ok(tabs[0].startsWith("스와치"));

step("뒷판 60단: 차트 p13 띠 + 기호표");
await page.click(".ptab:has-text('뒷판')");
await page.fill("form input[type=number]", "60");
await page.click("form button[type=submit]");
await page.waitForSelector(".chartview canvas", { timeout: 30000 });
await page.waitForSelector(".legend canvas", { timeout: 30000 });
assert.match(await page.textContent(".chip.dir"), /왼쪽에서 오른쪽/);
await shot("6-back-row60");

step("스와치: 배색 차트 색 뽑기");
await page.click(".ptab:has-text('스와치')");
await page.fill("form input[type=number]", "16");
await page.click("form button[type=submit]");
await page.waitForSelector(".yarn.sample", { timeout: 30000 });
await shot("7-swatch-colors");

step("새로고침 후 위치 유지");
await page.reload();
await page.waitForSelector(".now");
assert.equal(await page.textContent(".rowno b"), "16");
await page.click(".ptab:has-text('뒷판')");
assert.equal(await page.textContent(".rowno b"), "60");

await browser.close();
await server.close();
if (errors.length) { console.error("콘솔 오류:", errors); process.exit(1); }
console.log("e2e OK");
