// 실제 도안으로 파이프라인 점검:  node scripts/analyze.mjs fixtures/도안.pdf L  (PDF는 git에 올리지 말 것)
import { createServer } from "vite";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
let chromium;
try { ({ chromium } = await import("playwright")); } catch { ({ chromium } = createRequire(execSync("npm root -g").toString().trim() + "/")("playwright")); }
const [pdf, size = ""] = process.argv.slice(2);
const server = await createServer({ server: { port: 5197 }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch();
const page = await browser.newPage();
page.on("pageerror", (e) => console.error("page error:", e.message));
await page.goto("http://localhost:5197/tools/analyze.html");
await page.waitForFunction(() => window.ready);
const res = await page.evaluate(([b, s]) => window.analyze(b, s), [readFileSync(pdf).toString("base64"), size]);
await browser.close(); await server.close();
mkdirSync("check-out", { recursive: true });
const out = `check-out/analyze-${pdf.split("/").pop().replace(/\.pdf$/, "")}.json`;
writeFileSync(out, JSON.stringify(res, null, 1));
console.log(`${pdf} (${res.numPages}쪽, 사이즈 ${size || "-"})`);
console.log("  자동 선택:", res.pick.pages.join(","), res.pick.scanned ? "(글자 없음)" : "", "| 사이즈 순서:", res.order.join(" "));
console.log("  차트 축:", res.pages.filter((p) => p.charts.length).map((p) => `p${p.n}[${p.charts.join("; ")}]`).join(" ") || "없음");
console.log("  기호표:", res.legend ? `p${res.legend.page}` : "없음", "| 게이지:", JSON.stringify(res.gauges));
console.log("  기기 읽기:", res.good.ok ? "충분" : "부족 → Claude (" + res.good.why + ")", `| ${res.rowCount}단`);
for (const s of res.sections) console.log(`   - ${s.name} (${s.rows}줄, 차트 ${s.chart ?? "-"}${s.round ? ", 원통" : ""}): ${s.first.join(" | ")}`);
console.log("  →", out);
