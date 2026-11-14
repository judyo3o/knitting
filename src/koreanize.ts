/**
 * 영어 단 서술 → 한국어 도안 형식 (기기에서 읽을 때). 기법 약어(M1L, ssk, k2tog, yo, DS, PM …)는 영어 그대로.
 *   "K4, [k1, M1L, k1] to last 3 sts, k3—127 sts." → "겉4, [겉1, M1L, 겉1]을 끝 3코 전까지 반복, 겉3 (바늘에 127코)"
 * 이미 한국어 서술이면 그대로 둔다. 모르는 긴 문장은 영어로 남긴다(틀리게 옮기지 않게).
 */
const hasKorean = (t: string) => /[가-힣]/.test(t);

export function koreanizeRow(text: string): string {
  if (!text || hasKorean(text)) return text;
  let t = text.trim();
  // 단 번호 머리말 ("Row 1 (RS):", "Rnd 3:", "Inc Row 2 (RS):"는 이름 남김)
  t = t.replace(/^(?:row|rnd|round)\s*\d+\s*(?:\((?:RS|WS)\))?\s*[:.]\s*/i, "");
  t = t.replace(/^((?:[A-Z][a-z]+\s+)*(?:Row|Rnd)\s*\d*)\s*\((RS|WS)\)\s*:\s*/, "$1: ");
  // 콧수 꼬리 "—127 sts." / "(127 sts)" / "127 sts rem"
  t = t.replace(/\s*[—–-]\s*(\d+)\s*sts?\s*(?:dec['’]?d|inc['’]?d)?\.?$/i, " (바늘에 $1코)");
  t = t.replace(/\((\d+)\s*sts?\)/gi, "($1코)");
  t = t.replace(/(\d+)\s*sts?\s+rem(?:ain)?\b/gi, "$1코 남음");
  // 반복 묶음
  t = t.replace(/(\[[^\]]+\])\s*to\s+last\s+(\d+)\s*sts?/gi, "$1을 끝 $2코 전까지 반복");
  t = t.replace(/(\[[^\]]+\])\s*to\s+end/gi, "$1을 끝까지 반복");
  t = t.replace(/(\[[^\]]+\])\s*(\d+)\s*times(?:\s+across)?/gi, "$1 $2번 반복");
  t = t.replace(/(\[[^\]]+\])\s*once\s+more/gi, "$1 한 번 더");
  // 흔한 문장
  t = t.replace(/\bknit\s+to\s+end\b/gi, "끝까지 겉뜨기").replace(/\bpurl\s+to\s+end\b/gi, "끝까지 안뜨기");
  t = t.replace(/\bknit\s+to\s+last\s+(\d+)\s*sts?\b/gi, "끝 $1코 전까지 겉뜨기").replace(/\bpurl\s+to\s+last\s+(\d+)\s*sts?\b/gi, "끝 $1코 전까지 안뜨기");
  t = t.replace(/\bknit\s+to\s+m\b/gi, "마커까지 겉뜨기").replace(/\bpurl\s+to\s+m\b/gi, "마커까지 안뜨기");
  t = t.replace(/\bknit\s+all\s+(?:rnds|rounds)\b/gi, "모두 겉뜨기");
  t = t.replace(/\bturn(?:\s+work)?\b/gi, "턴");
  t = t.replace(/\bwork\s+(\d+)\s+rows?\s+in\s+st(?:ockinette)?\s*st\b/gi, "메리야스 $1단");
  t = t.replace(/\bin\s+st(?:ockinette)?\s*st\b/gi, "메리야스로");
  // 겉N · 안N (k2tog, p2tog 같은 약어는 건드리지 않게 숫자 뒤가 글자면 제외)
  t = t.replace(/\b[kK](\d+)(?![\w/])/g, "겉$1").replace(/\b[pP](\d+)(?![\w/])/g, "안$1");
  t = t.replace(/\bKnit\b/g, "겉뜨기").replace(/\bknit\b/g, "겉뜨기").replace(/\bPurl\b/g, "안뜨기").replace(/\bpurl\b/g, "안뜨기");
  return t.replace(/\s{2,}/g, " ").trim();
}
