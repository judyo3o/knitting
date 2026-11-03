// pdf.js의 cMap(한글 CID 글꼴)·표준 글꼴·wasm을 public/pdfjs/로 복사 (오프라인에서도 쓰게)
import { cpSync, existsSync, mkdirSync } from "node:fs";
const src = "node_modules/pdfjs-dist";
mkdirSync("public/pdfjs", { recursive: true });
for (const d of ["cmaps", "standard_fonts", "wasm"]) if (existsSync(`${src}/${d}`)) cpSync(`${src}/${d}`, `public/pdfjs/${d}`, { recursive: true });
console.log("pdfjs assets copied");
