export type Side = "RS" | "WS";

export type Row = {
  s: string; // 파트 이름
  n: number; // 파트 안 단 번호 (차트 단 번호와 같게)
  t: string; // 서술 원문
  st: string | null; // 그 단 끝 콧수 "206코"
  side: Side | null;
  pg: number | null; // 서술이 있는 PDF 쪽(사진이면 몇 번째)
  ch: number | null; // 이 단에 쓰는 차트 PDF 쪽
  span: [number, number] | null; // 범위 지시였으면 원래 범위
  x?: string; // 차트→서술 풀이(점검 결과 포함)
  auto?: boolean; // 그린 배색에서 자동으로 만든 서술 (격자를 고치면 다시 만든다)
  co?: string[]; // 배색: 이 단에 쓰는 색 기호 (예: ["A","B"])
};

/** 배색 도안의 색 (도안 표기 그대로) */
export type Yarn = { code: string; name: string | null; hex: string | null };

export type SecInfo = { ch?: number | null; round?: boolean; odd?: Side };

export type LogEntry = { a: number; b: number; s: string; from: number; to: number };

export type Legend =
  | { page: number; x0: number; y0: number; x1: number; y1: number; auto?: boolean }
  | { none: true };

export type Pattern = {
  id: string;
  name: string;
  size: string;
  notes: string;
  rows: Row[];
  secs: Record<string, SecInfo>;
  tab: string;
  pos: Record<string, number>; // 파트별 현재 단 (rows 안 파트별 인덱스가 아니라 단 번호 n)
  done: Record<string, number>; // "파트#단" → 완료 시각
  fin: Record<string, number>; // 파트 완료 시각
  part: Record<string, { i: number; t: number }>; // 묶음 진행
  log: LogEntry[];
  legend?: Legend;
  colors: Yarn[];
  draw: Record<string, Drawing>; // 파트별 직접 그린 배색 격자
  src: "pdf" | "images" | "text" | null;
  srcPages: number | null;
  readPages: number[];
  pdfHash?: string;
  rev: number;
  updatedAt: number;
  example?: boolean;
};

/** Claude가 돌려주는 구조 (§4-1) */
export type AiRow = {
  from: number;
  to: number;
  side?: Side | null;
  text: string;
  stitches?: string | null;
  page?: number | null;
  chart?: number | null;
  colors?: string[] | null;
};
export type AiSection = { name: string; chart?: number | null; round?: boolean; rows: AiRow[] };
export type AiResult = { title?: string | null; sections: AiSection[]; notes?: string | null; colors?: Yarn[] | null };

/**
 * 직접 그린 배색 격자. cells는 아래 단부터 한 줄씩(왼→오), 한 글자 = 한 코.
 * "." = 빈칸, "0-9a-z" = colors 배열 인덱스.
 */
export type Drawing = { w: number; h: number; start: number; cells: string };
