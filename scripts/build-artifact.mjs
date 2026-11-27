// Claude 아티팩트용 빌드: npm run build:artifact → dist-artifact/
//   knit.html (아티팩트 페이지 본문) + files.json (함께 올릴 파일 목록: 스크립트·스타일·pdf.js 글꼴 표·wasm)
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, statSync, rmSync } from "node:fs";
import { join, relative } from "node:path";

rmSync("dist-artifact", { recursive: true, force: true });
execSync("node scripts/copy-pdfjs.mjs && npx vite build", { stdio: "inherit", env: { ...process.env, ARTIFACT: "1" } });

const out = "dist-artifact";
// 아티팩트는 제어 문자가 든 텍스트 파일을 받지 않는다: 문자열 안 제어 문자를 \xHH 이스케이프로 (뜻은 같음)
// pdf.js 워커는 내용을 고치지 않고 바이너리(.bin)로 올려, 앱이 받아서 blob URL로 띄운다 (pdf.ts)
for (const f of readdirSync(join(out, "assets"))) {
  if (/^pdf\.worker.*\.mjs$/.test(f)) {
    const p = join(out, "assets", f);
    writeFileSync(p.replace(/\.mjs$/, ".b64.txt"), readFileSync(p).toString("base64"));
    rmSync(p);
  }
}
// 글자 표(cMap)도 base64 텍스트로 (아티팩트가 .bcmap 종류를 안 받음)
for (const f of readdirSync(join(out, "pdfjs", "cmaps"))) {
  const p = join(out, "pdfjs", "cmaps", f);
  if (f.endsWith(".bcmap")) { writeFileSync(p + ".b64.txt", readFileSync(p).toString("base64")); rmSync(p); }
}
for (const f of readdirSync(join(out, "assets"))) {
  if (!/\.(m?js)$/.test(f)) continue;
  const p = join(out, "assets", f);
  const src = readFileSync(p, "latin1");
  const fixed = src.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, (c) => "\\x" + c.charCodeAt(0).toString(16).padStart(2, "0"));
  if (fixed !== src) writeFileSync(p, fixed, "latin1");
  // "�"(U+FFFD) 글자도 받지 않는다 → 같은 뜻의 \ufffd 이스케이프 (모두 문자열 안에 있음)
  const u = readFileSync(p, "utf8");
  if (u.includes("\ufffd")) writeFileSync(p, u.replaceAll("\ufffd", "\\ufffd"), "utf8");
}
const idx = readFileSync(join(out, "index.html"), "utf8");
const css = [...idx.matchAll(/<link rel="stylesheet"[^>]*href="\.\/([^"]+)"/g)].map((m) => m[1]);
const js = [...idx.matchAll(/<script type="module"[^>]*src="\.\/([^"]+)"/g)].map((m) => m[1]);
// 아티팩트는 페이지 본문만 쓴다 (doctype·head·body는 게시할 때 감싸 줌)
const page = `<title>도안 단수 카운터</title>
<meta name="claude:viewport-fit-sides" content="cover">
${css.map((c) => `<link rel="stylesheet" href="${c}">`).join("\n")}
<div id="app"></div>
${js.map((j) => `<script type="module" src="${j}"></script>`).join("\n")}
`;
writeFileSync(join(out, "knit.html"), page);

const files = {};
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else {
      const rel = relative(out, p);
      if (/\.(html|webmanifest)$|^(sw|workbox|registerSW)|^icon|^files\.json$|LICENSE|quickjs|nowasm_fallback/.test(rel)) continue;
      // 글자 표(cMap): 한국어 전부 + 일본어·중국어 기본만 (아티팩트 파일 수 한도)
      if (rel.startsWith("pdfjs/cmaps/") && !/(UniKS|KSC|Korea1|UCS2)/.test(rel)) continue;
      if (rel.endsWith(".pfb")) continue; // 아티팩트가 안 받는 종류 → pdf.js 대체 글꼴
      files[rel] = rel.endsWith(".txt") ? { from: p, contentType: "text/plain" } : p;
    }
  }
};
walk(out);
writeFileSync(join(out, "files.json"), JSON.stringify(files, null, 1));
const total = Object.values(files).reduce((s, p) => s + statSync(typeof p === "string" ? p : p.from).size, 0);
console.log(`artifact: knit.html + ${Object.keys(files).length}개 파일, ${(total / 1e6).toFixed(1)}MB`);
