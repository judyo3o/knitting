import { createServer } from "vite";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
let chromium;
try { ({ chromium } = await import("playwright")); } catch { ({ chromium } = createRequire(execSync("npm root -g").toString().trim() + "/")("playwright")); }
const [dataPath, pdfPath, out, part, rowsArg] = process.argv.slice(2);
const server = await createServer({ server: { port: 5193 }, logLevel: "error" });
await server.listen();
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1000, height: 900 } });
page.on("pageerror", (e) => console.log("ERR", e.message));
await page.goto("http://localhost:5193/");
await page.waitForSelector(".now");
const pat = JSON.parse(readFileSync(dataPath, "utf8"));
await page.evaluate(async ([pt, b64]) => {
  const store = await import("/src/store.ts"); const db = await import("/src/db.ts");
  const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  await db.putFile(pt.id, { type: "pdf", blob: new Blob([u], { type: "application/pdf" }) });
  await store.importJson(JSON.stringify({ patterns: [pt] })); store.setActive(pt.id); await store.saveNow();
}, [pat, readFileSync(pdfPath).toString("base64")]);
for (const n of rowsArg.split(",").map(Number)) {
  await page.evaluate(async ([s, n]) => { const store = await import("/src/store.ts"); const p = store.active(); p.tab = s; p.pos[s] = n; store.commit(p, false); }, [part, n]);
  await page.reload(); await page.waitForSelector(".now");
  await page.waitForFunction(() => !/읽는 중|그리는 중/.test(document.querySelector(".now")?.textContent || ""), null, { timeout: 90000 });
  const chunks = await page.locator(".now .chunk").allTextContents();
  const total = await page.evaluate(async (ch) => { const { countChunk } = await import("/src/chunks.ts"); return ch.reduce((a, c) => a + (countChunk(c) ?? 0), 0); }, chunks);
  console.log(`${part} ${n}단: ${total}코 | ${chunks.join(", ").slice(0, 150)} | ${(await page.locator(".size-note").allTextContents()).join("")}`);
  if (n === +rowsArg.split(",")[0]) await page.locator(".now").screenshot({ path: out });
}
await b.close(); await server.close();
