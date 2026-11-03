// 실제 도안 PDF로 앱 화면 흐름 점검 (fixtures/*.pdf — git에 올리지 말 것)
//   node scripts/real-e2e.mjs fixtures/a.pdf:L fixtures/b.pdf
import { createServer } from "vite";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
let chromium;
try { ({ chromium } = await import("playwright")); } catch { ({ chromium } = createRequire(execSync("npm root -g").toString().trim() + "/")("playwright")); }
mkdirSync("check-out/real", { recursive: true });
const server = await createServer({ server: { port: 5196 }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch();
for (const arg of process.argv.slice(2)) {
  const [pdf, size = ""] = arg.split(":");
  const tag = pdf.split("/").pop().replace(/\.pdf$/, "");
  const ctx = await browser.newContext({ viewport: { width: 430, height: 930 }, deviceScaleFactor: 2, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const shot = (n) => page.screenshot({ path: `check-out/real/${tag}-${n}.png`, fullPage: false });
  console.log(`\n=== ${tag} (사이즈 ${size || "-"})`);
  await page.goto("http://localhost:5196/");
  await page.waitForSelector(".now");
  await page.click("#addBtn");
  if (size) await page.fill("input[placeholder='예: L']", size);
  await page.setInputFiles("#fileIn", pdf);
  await page.waitForFunction(() => /골랐어요|찾지 못했어요/.test(document.querySelector(".pg-tools .hint")?.textContent || ""), null, { timeout: 120000 });
  console.log("  자동 선택:", await page.inputValue("input[aria-label='페이지 범위']"), "|", (await page.textContent(".pg-tools .hint")).slice(0, 60));
  await shot("1-upload");
  await page.click("text=도안 읽기");
  const what = await Promise.race([
    page.waitForSelector("#uploadView", { state: "detached", timeout: 120000 }).then(() => "local"),
    page.waitForSelector(".dlg h2:has-text('일부만')", { timeout: 120000 }).then(() => "partial"),
    page.waitForSelector(".dlg textarea[readonly]", { timeout: 120000 }).then(() => "manual"),
  ]);
  if (what === "partial") {
    console.log("  기기 읽기 일부:", (await page.textContent(".dlg p")).slice(0, 80));
    await shot("2-partial");
    // 복사·붙여넣기 요청이 제대로 만들어지는지 먼저 확인
    await page.click(".dlg >> text=Claude로 읽기");
    await page.waitForSelector(".dlg textarea[readonly]", { timeout: 120000 });
  }
  if (what !== "local") {
    const prompt = await page.inputValue(".dlg textarea[readonly]");
    console.log("  Claude 요청:", (prompt.match(/PDF의 ([\d, ]+) 페이지/) || [, "(텍스트/사진)"])[1], "| 원본 쪽 매핑:", /1쪽=원본/.test(prompt), "| 사이즈:", (prompt.match(/뜨는 사이즈: ([^.]+)/) || [, "-"])[1]);
    const btn = page.locator(".dlg button:has-text('PDF 받기')");
    if (await btn.count()) {
      const [dl] = await Promise.all([page.waitForEvent("download"), btn.click()]);
      const path = `check-out/real/${tag}-request.pdf`;
      await dl.saveAs(path);
      const info = execSync(`python3 -c "import pypdf,sys; r=pypdf.PdfReader(sys.argv[1]); print(len(r.pages), 'pages', round(__import__('os').path.getsize(sys.argv[1])/1024), 'KB')" ${path}`).toString().trim();
      console.log("  잘라낸 PDF:", info);
    }
    await shot("3-manual");
    await page.click(".dlg >> text=중지");
    if (what === "manual") { await ctx.close(); if (errors.length) console.log("  오류:", errors); continue; }
    // 일부 읽은 결과로 다시: 기기에서 읽은 대로 시작
    await page.click("text=도안 읽기");
    await page.waitForSelector(".dlg h2:has-text('일부만')");
    await page.click(".dlg >> text=기기에서 읽은 대로 시작");
    await page.waitForSelector("#uploadView", { state: "detached", timeout: 120000 });
  }
  const tabs = await page.locator(".ptab").allTextContents();
  console.log("  파트:", tabs.join(" / "));
  const g = await page.locator(".gauge-line").count() ? await page.textContent(".gauge-line") : "-";
  console.log("  게이지:", g);
  await shot("4-tracker");
  let k = 0;
  for (const t of tabs.slice(0, 8)) {
    const name = t.replace(/^✓ /, "").replace(/\d+\/\d+$/, "");
    await page.click(`.ptab:has-text("${name.replace(/"/g, '\\"')}")`);
    const chunks = (await page.locator(".chunk").allTextContents()).join(" | ").slice(0, 110);
    const st = await page.textContent(".rowno .st");
    await page.waitForFunction(() => !/그리는 중/.test(document.querySelector(".chartview")?.textContent || ""), null, { timeout: 90000 }).catch(() => {});
    const hasChart = await page.locator(".chartview canvas").count();
    let note = "";
    if (!hasChart) note = ((await page.locator(".chartview .empty").textContent().catch(() => "")) || "").slice(0, 30);
    else {
      await page.waitForFunction(() => document.querySelector(".chartview canvas")?.width > 0, null, { timeout: 60000 }).catch(() => {});
      await shot(`5-part${++k}`);
    }
    console.log(`   - ${name}: ${await page.textContent(".rowno b")}단 ${st || ""} | ${hasChart ? "차트 띠 ✓" : "차트 없음 " + note} | ${chunks}`);
    if (hasChart) {
      // 기호 몇 개 눌러 보기 (보이는 차트의 여러 자리)
      const bb = await page.locator(".chartview").boundingBox();
      const pops = [];
      for (const fx of [0.3, 0.5, 0.7, 0.9]) {
        await page.evaluate(() => document.querySelectorAll(".sympop").forEach((e) => e.remove()));
        await page.mouse.click(bb.x + bb.width * fx, bb.y + bb.height * 0.5);
        const txt = await page.waitForFunction(() => document.querySelector(".sympop")?.textContent, null, { timeout: 15000 }).then((h) => h.jsonValue()).catch(() => null);
        const ok = !!txt;
        if (ok) pops.push(String(txt).replace(/\s+/g, " ").trim());
        if (ok && fx === 0.5) await shot(`6-symbol-${k}`);
      }
      console.log("       기호:", pops.join(" / ") || "말풍선 없음");
    }
  }
  if (errors.length) console.log("  오류:", errors);
  await ctx.close();
}
await browser.close();
await server.close();
