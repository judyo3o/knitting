# AI 도우미용 안내 (Claude Code · ChatGPT · Codex 등)

이 저장소를 받은 AI 도우미가 앱을 실행·수정할 때 필요한 것만 적었어요. 사용자에게 답할 때는 한국어로.

## 실행 · 확인
- 설치 `npm install`, 개발 서버 `npm run dev`, 빌드 `npm run build`
- 고친 뒤에는 `npm run typecheck`와 `npm test`를 실행하고, 화면을 바꿨으면 `npm run e2e`까지 (Playwright + Chromium 필요)
- 차트 표시를 바꿨으면 `npm run check`로 PNG를 만들어 띠가 단 번호와 같은 높이인지 눈으로 확인

## 구조 (src/)
| 파일 | 하는 일 |
|---|---|
| `types.ts` | 데이터 모델 (Pattern, Row, Drawing, Yarn) |
| `model.ts` | Claude 결과 펼치기·병합, 파트별 현재 단, 다음/이전 단, 완료 시각, 세션 로그, 그린 배색 → 서술 |
| `parse.ts` | 기기 읽기: 줄 → 파트·단, 사이즈 숫자 고르기, 차트 쪽 참조, Claude가 필요한지 판단 |
| `chunks.ts` | 서술 묶음 나누기 · 묶음별 콧수 |
| `pdfgeom.ts` | 서술 페이지 자동 선택, 차트 단 번호 축 감지, 기호표 찾기 (순수 함수) |
| `drawing.ts` | 배색 격자 편집 연산, 단 서술, 플로트, 이미지 색 → 격자 |
| `prompts.ts` | AI 프롬프트와 JSON 스키마 (바꾸면 `config.ts`의 `PROMPT_VERSION`을 올려 캐시 무효화) |
| `ai.ts` / `anthropicCall.ts` | Claude 연결: 내 Claude API 키(브라우저에서 직접) 또는 키 없이 claude.ai 복사·붙여넣기 |
| `gauge.ts` / `gaugeui.ts` | 게이지 비교·환산, 도안 문구에서 게이지 찾기 |
| `imageimport.ts` | 이미지로 배색 시작 (자르기·색 추출) |
| `pdf.ts` / `chart.ts` | pdf.js 렌더·텍스트, 차트 비트맵·띠·화살표·색 추출 |
| `store.ts` / `db.ts` | 상태, IndexedDB 저장, 10분 스냅샷, 내보내기/가져오기 |
| `main.ts` / `upload.ts` / `drawui.ts` / `dialogs.ts` | 화면 |

## 지킬 것
- 모델 ID는 `src/config.ts`의 `MODEL` 한 곳에서만 바꾼다.
- 기기에서 할 수 있는 일은 기기에서. Claude 호출은 기기 읽기가 부족할 때와 '차트를 글로 풀기'뿐.
- API 키를 코드나 저장소에 넣지 않는다. 사용자 키는 그 기기 저장소에만.
- 도안 PDF(저작물)를 커밋하지 않는다. 실제 도안 점검은 `fixtures/`(gitignore)에 두고 `scripts/analyze.mjs`, `scripts/real-e2e.mjs`로.
- 진행 데이터 모양(`Pattern`)을 바꾸면 `model.ts`의 `normalize()`에서 옛 데이터를 맞춰 준다.

## 도안을 AI 채팅에 직접 넣어 JSON 받기
앱 없이도 `src/prompts.ts`의 `structurePrompt()` 문구와 도안 PDF를 Claude/ChatGPT에 주면 같은 JSON을 받을 수 있고, 앱의 복사·붙여넣기 칸에 그대로 붙여넣으면 돼요.
