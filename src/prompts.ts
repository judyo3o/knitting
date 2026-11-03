/** §4 Claude 프롬프트. 문구는 PLAN.md 그대로. */
import type { Side } from "./types";

export type StructureArgs = {
  kind: "pdf" | "images" | "text";
  pages?: number[]; // 원본 PDF 기준 번호
  size?: string;
  known?: string[]; // 이미 읽은 파트 이름
  imageOffset?: number; // 사진이 전체 중 몇 번째부터인지 (0-based)
  text?: string;
};

export function structurePrompt(a: StructureArgs): string {
  let src: string;
  if (a.kind === "pdf") {
    const pg = a.pages || [];
    const map = pg.map((n, i) => `${i + 1}쪽=원본 ${n}쪽`).join(", ");
    src = `첨부 문서는 뜨개 도안 PDF의 ${pg.join(", ")} 페이지야.\n(이 페이지들만 잘라낸 PDF라서 첨부 문서의 ${map}이야. page·chart 번호는 모두 원본 기준으로 써.)`;
  } else if (a.kind === "images") {
    src = "첨부 이미지는 뜨개 도안 사진이야 (순서대로).";
    if (a.imageOffset) src += `\n(이 사진들은 전체 중 ${a.imageOffset + 1}번째부터야. page 번호는 ${a.imageOffset + 1}부터 세.)`;
  } else src = "아래는 뜨개 도안 원문 텍스트야.";
  const sz = a.size
    ? `뜨는 사이즈: ${a.size}. 이 사이즈에 해당하는 내용만 남겨.`
    : "사이즈 구분이 있는 도안이면 첫 번째(가장 작은) 사이즈 기준으로 정리하고 notes에 그렇게 했다고 적어.";
  const known = a.known && a.known.length ? `\n이미 읽은 파트 이름: ${a.known.join(", ")}. 같은 파트가 이어지면 이름을 똑같이 써.` : "";
  return `너는 뜨개(대바늘·코바늘) 서술 도안을 파트별 '단별 진행표'로 바꾸는 도우미야.
${src}
${sz}${known}

JSON 하나만 답해:
{"title": string|null,
 "sections": [{"name": string, "chart": int|null, "round": boolean, "rows": [{"from": int, "to": int, "side": "RS"|"WS"|null, "text": string, "stitches": string|null, "page": int|null, "chart": int|null}]}],
 "colors": [{"code": string, "name": string|null, "hex": string|null}]|null,
 "notes": string|null}
(배색 도안이면 rows 항목에 "colors": [string] 도 넣어.)

규칙:
1. "100 (104) 110 (114) 124 (134)"처럼 괄호로 사이즈가 나열된 숫자는 사이즈 순서대로야. 해당 사이즈의 숫자 하나만 남겨. 사이즈별로 따로 적힌 표나 줄이 있으면 해당 사이즈 것만 써.
2. 따로 뜨는 부분(스와치, 뒷판, 오른쪽 앞판, 왼쪽 앞판, 몸통, 오른쪽 소매, 왼쪽 소매, 고무단, 버튼밴드, 카라 등)마다 section을 나누고 도안 순서대로 적어. 이름은 도안 표현 그대로 짧게.
3. 왼쪽에 단 번호, 오른쪽에 서술이 있는 표는 같은 높이의 줄끼리 짝지어. 서술은 원문 표현과 약어를 그대로 옮기고, 없는 단계를 지어내지 마.
4. "1단과 동일", "[3단, 4단] 반복"처럼 다른 단을 가리키면 각 단에서 실제로 뭘 하는지 알 수 있게 풀어 써. 매 단 지시가 같은 구간은 from~to 하나로 묶어도 돼. 끝 단이 정해지지 않은 반복("원하는 길이만큼", "13코 남을 때까지")은 from=to=시작 단 하나로 쓰고 text에 조건을 그대로 적어.
5. 서술 없이 차트만 따르는 구간(예: "16단~58단까지 차트를 따라 진행")은 그 범위를 from/to로 쓰고 text는 원문 문장 그대로.
6. section.chart: 그 파트에 쓰는 이 사이즈 차트의 PDF 페이지 번호(예: [차트 S:p13 / M:p18 / L:p23]에서 L이면 23). 차트가 없으면 null. 한 파트 안에서 차트가 바뀌면 해당 rows의 chart에 적어.
7. section.round: 원통뜨기(링으로 연결)로 뜨는 파트면 true, 평면뜨기면 false.
8. 단 끝 콧수(예: "(48코)", "바늘에 206코가 있습니다")는 그 단의 stitches에 "206코"처럼. (RS)/(WS) 표기가 있으면 side에. page에는 그 서술이 실린 PDF 페이지 번호(사진이면 몇 번째 사진인지).
9. 기초코·코줍기·바늘 교체 같은 준비 작업은 그 section 1단 text 맨 앞에 붙여.
10. 게이지(스와치) 정보가 있으면 맨 앞에 "스와치" section을 만들어: 무늬 스와치 차트가 있으면 그 차트의 단 번호대로 rows를 만들고 chart에 그 페이지, 기초코 방법·콧수와 시작 면(예: "코잡기가 1단, 2단 안면부터")을 도안대로 1단에 적어. 차트가 없으면 게이지 콧수로 기초코, 게이지 단수만큼 무늬대로 뜨기, 마지막 단에 "세탁·건조 후 10cm 안 콧수·단수 재기(목표: 게이지 값)".
11. 재료·약어 설명은 rows에 넣지 말고 꼭 필요한 것만 notes에 300자 이내로.
12. 배색(여러 색 실) 도안이면 colors에 도안의 색 기호(예: "A", "MC", "C1")와 색 이름(예: "아이보리", 실 색번호 포함)을 도안 표기대로 적고, hex에는 그 색에 가까운 "#RRGGBB"(모르면 null). 각 row의 text에서는 색 표기를 원문대로 남기고, 그 단에 쓰는 색 기호를 row.colors에 순서대로 적어. 배색이 아니면 colors는 null.${a.text ? "\n\n도안 원문:\n" + a.text : ""}`;
}

/** structured outputs용 JSON 스키마 (§4-1 JSON 모양과 같음) */
export const STRUCTURE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "sections", "notes", "colors"],
  properties: {
    title: { type: ["string", "null"] },
    colors: {
      anyOf: [
        {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["code", "name", "hex"],
            properties: { code: { type: "string" }, name: { type: ["string", "null"] }, hex: { type: ["string", "null"] } },
          },
        },
        { type: "null" },
      ],
    },
    notes: { type: ["string", "null"] },
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "chart", "round", "rows"],
        properties: {
          name: { type: "string" },
          chart: { type: ["integer", "null"] },
          round: { type: "boolean" },
          rows: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["from", "to", "side", "text", "stitches", "page", "chart", "colors"],
              properties: {
                from: { type: "integer" },
                to: { type: "integer" },
                side: { anyOf: [{ type: "string", enum: ["RS", "WS"] }, { type: "null" }] },
                text: { type: "string" },
                stitches: { type: ["string", "null"] },
                page: { type: ["integer", "null"] },
                chart: { type: ["integer", "null"] },
                colors: { anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }] },
              },
            },
          },
        },
      },
    },
  },
} as const;

/* ---------------- §4-2 차트 → 서술 ---------------- */

export function directionSentence(side: Side, round: boolean): string {
  if (round) return "원통뜨기라 매 단 겉면에서 오른쪽→왼쪽으로 차트 그대로 읽어.";
  return side === "RS"
    ? "이 단은 겉면(RS)이라 오른쪽→왼쪽으로 차트 그대로 읽어."
    : "이 단은 안면(WS)이라 왼쪽→오른쪽으로 읽고, 겉뜨기↔안뜨기를 바꿔서(기호 반대로) 써.";
}

export type YarnLite = { code: string; name: string | null };

export function explainHead(n: number, side: Side, round: boolean, hasLegend: boolean, yarns: YarnLite[] = []): string {
  const legend = hasLegend ? " 두 번째 이미지는 이 도안의 기호표야." : "";
  const rule = yarns.length
    ? `도안 규칙: 배색 차트야. 칸의 색이 실 색이고, 색 기호는 ${yarns.map((y) => y.code + (y.name ? `(${y.name})` : "")).join(", ")}야. 기호가 있는 칸은 기호표대로 뜨고, 겉면에서 보이는 모양으로 그려져 있어.`
    : "도안 규칙: 차트에는 안뜨기 기호가 생략되어 빈칸이 안뜨기, 세로줄(|)이 겉뜨기이고, 겉면에서 보이는 모양으로 그려져 있어.";
  return `첫 번째 이미지는 뜨개 차트의 일부야. 분홍 테두리로 표시된 가로줄이 ${n}단이야.${legend}
${rule} ${directionSentence(side, round)}`;
}

/** 배색이면 1차 지시에 색 표기 형식을 덧붙인다 */
export const explainDraft = (colorwork: boolean) =>
  colorwork
    ? EXPLAIN_DRAFT + ' 배색이라 묶음마다 색 기호를 앞에 붙여 "A 겉3, B 겉1, …"처럼 쓰고, 같은 색·같은 기법이 이어지면 숫자로 묶어.'
    : EXPLAIN_DRAFT;

export const EXPLAIN_DRAFT =
  '분홍 테두리 줄의 칸을 하나도 빼지 말고 끝에서 끝까지 읽어서 서술 도안처럼 "안3, 겉2, 2/1LC, …" 형식으로 써줘. 같은 기호가 연속되면 숫자로 묶고, 교차뜨기는 기호표 이름 그대로. 마지막에 총 콧수를 "(N코)"로. 서술 한 줄만 써.';

export const explainCheck = (draft: string) =>
  `아래는 이 단을 서술로 옮긴 초안이야: ${draft} / 이미지의 분홍 테두리 줄과 칸 단위로 다시 대조해서 점검해: 읽는 방향, 각 묶음의 콧수, 교차뜨기 이름, (배색이면) 각 묶음의 색, 총 콧수가 차트와 같은지. 틀린 곳은 고쳐. 답은 두 줄만: 첫 줄은 최종 서술, 둘째 줄은 "점검: 일치" 또는 "점검: 고친 곳 - …" 또는 "점검: 확인 필요 - …".`;
