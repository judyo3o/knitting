// 기호 이름 점검: node scripts/symbol-check.mjs fixtures/도안.pdf 23 57,59,61
import { createServer } from "vite";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
let chromium;
try { ({ chromium } = await import("playwright")); } catch { ({ chromium } = createRequire(execSync("npm root -g").toString().trim() + "/")("playwright")); }
const [pdf, page, rows] = process.argv.slice(2);
mkdirSync("check-out/sym", { recursive: true });
const server = await createServer({ server: { port: 5195 }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch();
const pg = await browser.newPage();
pg.on("pageerror", (e) => console.error("page error:", e.message));
await pg.goto("http://localhost:5195/tools/symcheck.html");
await pg.waitForFunction(() => window.ready);
const res = await pg.evaluate(([b, p, r]) => window.symcheck(b, p, r), [readFileSync(pdf).toString("base64"), +page, rows.split(",").map(Number)]);
await browser.close(); await server.close();
console.log(res.legend.join('\n'));
res.tmpls.forEach((u, i) => u && writeFileSync(`check-out/sym/tmpl-${i}.png`, Buffer.from(u.split(',')[1], 'base64')));
for (const r of res.rows) {
  if (r.err) { console.log(`p${page} ${r.n}단: ${r.err}`); continue; }
  const f = `check-out/sym/p${page}-row${r.n}.png`;
  writeFileSync(f, Buffer.from(r.url.split(",")[1], "base64"));
  const counts = {};
  for (const l of r.labels) counts[l] = (counts[l] || 0) + 1;
  console.log(`p${page} ${r.n}단 (${r.cells}칸, 칸 ${r.cellW}pt) → ${f}`);
  console.log("   " + Object.entries(counts).map(([k, v]) => `${k}×${v}`).join(" | "));
}
