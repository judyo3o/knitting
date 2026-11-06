// 한 단 전체 읽기 점검: node scripts/row-check.mjs fixtures/도안.pdf 23 3,4,5
import { createServer } from "vite";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
let chromium;
try { ({ chromium } = await import("playwright")); } catch { ({ chromium } = createRequire(execSync("npm root -g").toString().trim() + "/")("playwright")); }
const [pdf, page, rows] = process.argv.slice(2);
const server = await createServer({ server: { port: 5194 }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch();
const pg = await browser.newPage();
pg.on("pageerror", (e) => console.error("page error:", e.message));
await pg.goto("http://localhost:5194/tools/symcheck.html");
await pg.waitForFunction(() => window.ready);
const res = await pg.evaluate(([b, p, r]) => window.readrows(b, p, r), [readFileSync(pdf).toString("base64"), +page, rows.split(",").map(Number)]);
console.log(res.join("\n"));
await browser.close(); await server.close();
