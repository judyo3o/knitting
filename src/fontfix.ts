/**
 * 글자 대응표(ToUnicode)가 없는 글꼴의 글자 살리기.
 * 같은 글꼴 파일(예: AppleSDGothicNeoR00)을 쓰는 다른 글꼴 항목이 대응표를 갖고 있으면 빌려 쓰고,
 * 빈 칸은 글꼴 안 글자 순서(유니코드 순서로 들어 있는 구간)로 채운다.
 * pdf.js는 대응표가 없으면 글자 번호(CID)를 그대로 문자로 내주므로, 그 번호를 다시 읽는다.
 */
export type Rescue = { decode: (s: string) => string; size: number };

export function parseToUnicode(cm: string, into = new Map<number, string>()) {
  const hex = (h: string) => {
    let s = "";
    for (let i = 0; i + 4 <= h.length; i += 4) s += String.fromCharCode(parseInt(h.slice(i, i + 4), 16));
    return h.length === 2 ? String.fromCharCode(parseInt(h, 16)) : s;
  };
  for (const blk of cm.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))
    for (const m of blk[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) into.set(parseInt(m[1], 16), hex(m[2]));
  for (const blk of cm.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of blk[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<([0-9A-Fa-f]+)>|\[([^\]]*)\])/g)) {
      const a = parseInt(m[1], 16), b = parseInt(m[2], 16);
      if (m[4]) {
        const base = hex(m[4]);
        const last = base.charCodeAt(base.length - 1);
        for (let k = a; k <= b && k - a < 65536; k++) into.set(k, base.slice(0, -1) + String.fromCharCode(last + (k - a)));
      } else if (m[5]) {
        const list = [...m[5].matchAll(/<([0-9A-Fa-f]+)>/g)].map((x) => hex(x[1]));
        list.forEach((u, i) => into.set(a + i, u));
      }
    }
  }
  return into;
}

/** 빈 글자 번호: 앞뒤로 알려진 번호가 같은 간격으로 유니코드와 맞으면(같은 구간) 그 사이를 채운다 */
export function makeDecoder(map: Map<number, string>): (code: number) => string | undefined {
  const known = [...map.entries()].filter(([, u]) => u.length === 1).map(([g, u]) => [g, u.charCodeAt(0)] as [number, number]).sort((a, b) => a[0] - b[0]);
  return (g) => {
    const hit = map.get(g);
    if (hit) return hit;
    let lo = -1, hi = known.length;
    for (let i = 0; i < known.length; i++) {
      if (known[i][0] < g) lo = i;
      else { hi = i; break; }
    }
    if (lo < 0 || hi >= known.length) return undefined;
    const [g1, u1] = known[lo], [g2, u2] = known[hi];
    if (u2 - u1 !== g2 - g1) return undefined; // 같은 구간이 아니면 모름
    return String.fromCharCode(u1 + (g - g1));
  };
}

/** PDF 전체에서 대응표 없는 Type0 글꼴의 짝(같은 글꼴 이름) 대응표를 모은다 */
export async function buildRescue(bytes: ArrayBuffer): Promise<Rescue | null> {
  const { PDFDocument, PDFDict, PDFName, PDFRawStream, decodePDFRawStream, PDFArray, PDFRef } = await import("pdf-lib");
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const maps = new Map<string, Map<number, string>>();
  const missing = new Set<string>();
  const look = (v: any) => (v instanceof PDFRef ? doc.context.lookup(v) : v);
  /** 글꼴 파일까지 같은지: 이름(부분집합 접두어 뺌) + 내장 글꼴 파일 크기 */
  const keyOf = (font: any) => {
    const base = (font.get(PDFName.of("BaseFont"))?.toString() || "").replace(/^\/([A-Z]{6}\+)?/, "");
    let len = 0;
    try {
      const desc = look(font.get(PDFName.of("DescendantFonts")));
      const d0 = look(desc instanceof PDFArray ? desc.get(0) : desc);
      const fd = look(d0.get(PDFName.of("FontDescriptor")));
      const ff = look(fd.get(PDFName.of("FontFile2")) || fd.get(PDFName.of("FontFile3")));
      len = ff?.contents?.length || 0;
    } catch {}
    return `${base}#${len}`;
  };
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    if (obj.get(PDFName.of("Subtype"))?.toString() !== "/Type0") continue;
    const key = keyOf(obj);
    const tu: any = look(obj.get(PDFName.of("ToUnicode")));
    if (tu instanceof PDFRawStream) {
      try {
        const txt = new TextDecoder("latin1").decode(decodePDFRawStream(tu).decode());
        parseToUnicode(txt, maps.get(key) || maps.set(key, new Map()).get(key)!);
      } catch {}
    } else missing.add(key);
  }
  const merged = new Map<number, string>();
  for (const b of missing) for (const [k, v] of maps.get(b) || []) merged.set(k, v);
  if (!merged.size) return null;
  const dec = makeDecoder(merged);
  // 공백은 그대로 (pdf.js가 제어 문자 번호를 공백으로 바꿔 주기 때문에 다시 매기면 틀린다)
  return { size: merged.size, decode: (s) => [...s].map((ch) => (/\s/.test(ch) ? ch : dec(ch.codePointAt(0)!) ?? ch)).join("").replace(/\s+/g, " ") };
}
