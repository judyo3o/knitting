// 아티팩트 빌드 점검: dist-artifact를 띄우고 window.claude(sample·db·user·downloads)를 흉내 내 확인
import { createServer } from "vite";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
let chromium;
try { ({ chromium } = await import("playwright")); } catch { ({ chromium } = createRequire(execSync("npm root -g").toString().trim() + "/")("playwright")); }
const page0 = readFileSync("dist-artifact/knit.html", "utf8");
const mock = `<script>
window.__calls = { sample: [], set: [] };
const store = new Map();
const col = (path) => ({
  doc: (id) => ({ set: async (d) => { window.__calls.set.push(id); store.set(path + "/" + id, d); }, delete: async () => store.delete(path + "/" + id) }),
  get: async () => ({ docs: [...store.entries()].filter(([k]) => k.startsWith(path + "/")).map(([k, v]) => ({ id: k.split("/").pop(), data: () => v })) }),
});
const sample = async (input, opts) => { window.__calls.sample.push({ input, images: (opts.images || []).length }); const text = "2/1 LC는 앞 2코를 꽈배기바늘에 옮겨 앞에 두고 다음 1코를 겉뜨기한 뒤 옮긴 2코를 겉뜨기해요."; opts.onText && opts.onText({ text, delta: text }); return { text, truncated: false }; };
sample.limits = async () => ({ maxPromptBytes: 262144, images: { maxCount: 20, maxInputBytes: 5e6, mediaTypes: ["image/jpeg"] } });
sample.json = async () => ({ title: null, notes: null, colors: null, sections: [] });
const caps = { sample, db: { collection: col }, user: { id: async () => "u1" }, downloads: { save: async (f) => { window.__calls.dl = f.filename; } } };
window.claude = { use: async (n) => caps[n] ?? null };
</script>`;
// 아티팩트처럼 엄격한 보안 규칙(CSP): eval 금지, 글꼴은 Google Fonts만, 외부 연결 금지
const CSP = process.env.NO_CSP ? "" : `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' blob:; worker-src 'self' blob:; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com">`;
writeFileSync("dist-artifact/smoke.html", `<!doctype html><html><head><meta charset="utf8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">${CSP}${mock}</head><body>${page0}</body></html>`);
const server = await createServer({ root: "dist-artifact", server: { port: 5193 }, logLevel: "error", configFile: false });
await server.listen();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) console.log("   [console]", m.text().slice(0, 200)); });
await page.goto("http://localhost:5193/smoke.html");
await page.waitForSelector(".now");
console.log("• 예시 도안 표시 (아티팩트 모드)");
await page.click(".ptab:has-text('몸통')");
await page.click("#nextBtn");
await page.waitForFunction(() => window.__calls.set.length > 0 || true);
await page.click("text=이 단 물어보기");
await page.fill(".dlg textarea", "이 단 어떻게 떠요?");
await page.click(".dlg >> text=보내기");
await page.waitForFunction(() => document.querySelectorAll(".bubble.ai").length >= 2 && !/생각하는/.test(document.querySelectorAll(".bubble.ai")[1].textContent));
const ans = await page.textContent(".bubble.ai >> nth=1");
console.log("• 이 단 물어보기 답:", ans.slice(0, 40));
const sent = await page.evaluate(() => window.__calls.sample[0].input[0].content);
assert.match(sent, /몸통/);
assert.match(sent, /지금 단: 13단/);
await page.screenshot({ path: "check-out/artifact-chat.png" });
await page.keyboard.press("Escape");
console.log("• 설정: 기본이 '이 아티팩트를 연 사람의 Claude'");
await page.click("#setBtn");
assert.ok(await page.isChecked("input[value=artifact]"));
await page.keyboard.press("Escape");
console.log("• 내보내기 → downloads 기능");
// 예시는 저장 안 되므로 새 배색 도안 하나 만들고 확인
await page.click("#addBtn");
await page.click("text=배색 차트 그리기");
await page.click("text=+ 빈 차트로 시작");
await page.click(".editor >> text=💾 저장");
await page.waitForTimeout(1600);
const sets = await page.evaluate(() => window.__calls.set.length);
console.log("   db에 저장된 문서 수:", sets);
assert.ok(sets >= 1);
await page.click(".sub-link:has-text('진행 기록')");
await page.click("text=진행 내보내기");
await page.waitForFunction(() => window.__calls.dl);
console.log("   받은 파일:", await page.evaluate(() => window.__calls.dl));
console.log("• PDF 열기 (변환한 pdf.js 워커)");
await page.goto("http://localhost:5193/smoke.html");
await page.waitForSelector(".now");
await page.click("#addBtn");
await page.fill("input[placeholder='예: L']", "L");
await page.setInputFiles("#fileIn", "check-out/synthetic-pattern.pdf");
await page.waitForFunction(() => /골랐어요/.test(document.querySelector(".pg-tools .hint")?.textContent || ""), null, { timeout: 60000 });
console.log("   자동 선택:", await page.inputValue("input[aria-label='페이지 범위']"));
await page.click("text=도안 읽기");
await page.waitForTimeout(4000);
console.log("   진행:", await page.textContent("#uploadView .progress").catch(() => "-"), "| 대화상자:", await page.locator(".dlg h2").allTextContents());
await page.waitForSelector("#uploadView", { state: "detached", timeout: 60000 });
await page.click(".ptab:has-text('스와치')");
await page.waitForFunction(() => !/그리는 중/.test(document.querySelector(".chartview")?.textContent || ""), null, { timeout: 60000 });
console.log("   차트 칸:", (await page.textContent(".chartview")).slice(0, 80) || "(그림)");
await page.waitForSelector(".chartview canvas", { timeout: 5000 });
console.log("   스와치 차트 띠 표시 ✓");
await browser.close(); await server.close();
if (errors.length) { console.error("오류:", errors); process.exit(1); }
console.log("artifact smoke OK");
