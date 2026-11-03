// 기능 점검: 단계마다 성공/실패를 모아 보고 (실패해도 다음 단계 계속)  node scripts/qa.mjs
import { createServer } from "vite";
import { execSync, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
let chromium;
try { ({ chromium } = await import("playwright")); } catch { ({ chromium } = createRequire(execSync("npm root -g").toString().trim() + "/")("playwright")); }
mkdirSync("check-out/qa", { recursive: true });
const pdfPath = "check-out/synthetic-pattern.pdf";
if (!existsSync(pdfPath)) execFileSync("python3", ["scripts/make-fixture.py", pdfPath]);

const server = await createServer({ server: { port: 5191 }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
const page = await ctx.newPage();
const consoleErr = [];
page.on("pageerror", (e) => consoleErr.push("pageerror: " + e.message));
page.on("console", (m) => m.type() === "error" && consoleErr.push("console: " + m.text().slice(0, 200)));
const results = [];
let n = 0;
async function step(name, fn) {
  n++;
  try {
    const note = await fn();
    results.push(`✓ ${name}${note ? " — " + note : ""}`);
  } catch (e) {
    results.push(`✗ ${name} — ${String(e.message || e).split("\n")[0].slice(0, 220)}`);
    await page.screenshot({ path: `check-out/qa/fail-${n}.png` }).catch(() => {});
    await page.keyboard.press("Escape").catch(() => {});
    await page.evaluate(() => document.querySelectorAll(".editor, .viewer, .dlg").forEach((e) => e.remove())).catch(() => {});
  }
}
const ok = (c, msg) => { if (!c) throw new Error(msg); };
const T = (s) => page.locator(s);
const txt = async (s) => (await T(s).first().textContent({ timeout: 5000 })) || "";

await page.goto("http://localhost:5191/");
await page.waitForSelector(".now");

/* ---------- 예시로 진행 기능 ---------- */
await step("예시: 파트 탭 전환과 파트별 위치 기억", async () => {
  await T(".ptab:has-text('고무단')").click();
  const a = await txt(".rowno b");
  await T("#nextBtn").click(); await T("#nextBtn").click();
  ok((await txt(".rowno b")) === String(+a + 2), "다음 단 두 번 후 단 번호");
  await T(".ptab:has-text('몸통')").click();
  await T(".ptab:has-text('고무단')").click();
  ok((await txt(".rowno b")) === String(+a + 2), "탭 돌아왔을 때 위치 유지 안 됨");
  return `고무단 ${a}→${+a + 2}`;
});
await step("예시: 이전 단 → 완료 기록 지움", async () => {
  const before = await txt(".ptab[aria-selected=true] small");
  await T("#prevBtn").click();
  const after = await txt(".ptab[aria-selected=true] small");
  ok(before !== after, `완료 수 변화 없음 ${before}`);
  return `${before} → ${after}`;
});
await step("예시: 파트 마지막 단 → 완료 → 다음 파트", async () => {
  await T(".ptab:has-text('고무단')").click();
  for (let i = 0; i < 12; i++) {
    const label = await txt("#nextBtn");
    if (/다음 파트/.test(label)) break;
    await T("#nextBtn").click();
  }
  ok(/완료/.test(await txt(".now")), "완료 표시 없음");
  await T("#nextBtn").click();
  const tab = await txt(".ptab[aria-selected=true]");
  ok(!/고무단/.test(tab), "다음 파트로 안 넘어감: " + tab);
  return "→ " + tab.replace(/\d+\/\d+/, "");
});
await step("예시: 묶음 누르기·다시 누르면 하나 전으로", async () => {
  await T(".ptab:has-text('몸통')").click();
  await T("form input[type=number]").fill("2"); await T("form button[type=submit]").click();
  const chunks = T(".chunk");
  ok((await chunks.count()) >= 1, "묶음 없음");
  await chunks.nth(0).click();
  ok(/1\/\d+ 묶음/.test(await txt(".chunk-meta")), "묶음 진행 표시 없음");
  await T(".chunk").nth(0).click();
  ok((await T(".chunk.done").count()) === 0, "다시 눌렀는데 그대로 완료");
});
const openSub = async (name) => { if (await T(".sub-head").count()) await T(".sub-head .round-btn").click(); await T(`.sub-link:has-text('${name}')`).click(); await T(".sub-head").waitFor(); };
const backSub = async () => { if (await T(".sub-head").count()) await T(".sub-head .round-btn").click(); };
await step("예시: 단 목록 누르면 그 단으로", async () => {
  await openSub("단 목록");
  await T(".rows2 button").nth(4).click();
  ok((await txt(".rowno b")) === "5", "목록 5번째 → " + (await txt(".rowno b")));
});
await step("예시: 키보드 → ← 스페이스", async () => {
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  const a = +(await txt(".rowno b"));
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press(" ");
  ok(+(await txt(".rowno b")) === a + 2, "→/스페이스");
  await page.keyboard.press("ArrowLeft");
  ok(+(await txt(".rowno b")) === a + 1, "←");
});
await step("예시: 배색 띠 차트 확대/축소/전체", async () => {
  await T(".ptab:has-text('배색 띠')").click();
  const w0 = await T(".chartview canvas").evaluate((c) => c.clientWidth);
  await T("button[aria-label='확대']").click();
  const w1 = await T(".chartview canvas").evaluate((c) => c.clientWidth);
  ok(w1 > w0, `확대해도 그대로 ${w0}→${w1}`);
  await T("button[aria-label='축소']").click();
  await T("text=차트 전체").click();
  ok((await txt(".charttools")).includes("주변만"), "전체 보기 토글");
  await T("text=주변만").click();
});

/* ---------- PDF 올리기 ---------- */
await step("PDF: 썸네일·자동 선택·범위·해제·사이즈 바꾸기", async () => {
  await T("#addBtn").click();
  await T("input[placeholder='예: L']").fill("L");
  await T("#fileIn").setInputFiles(pdfPath);
  await page.waitForFunction(() => /골랐어요/.test(document.querySelector(".pg-tools .hint")?.textContent || ""), null, { timeout: 60000 });
  ok((await T(".pg").count()) === 14, "썸네일 수");
  await page.waitForFunction(() => document.querySelectorAll(".pg canvas").length >= 3, null, { timeout: 30000 });
  const pickL = await T("input[aria-label='페이지 범위']").inputValue();
  await T("input[placeholder='예: L']").fill("M");
  await page.waitForTimeout(900);
  const pickM = await T("input[aria-label='페이지 범위']").inputValue();
  ok(pickM !== pickL, `사이즈 바꿔도 같은 선택 ${pickL}`);
  await T("text=선택 해제").click();
  ok((await T(".pg[aria-pressed=true]").count()) === 0, "해제 안 됨");
  await T("input[aria-label='페이지 범위']").fill("2, 5, 7-12");
  await T("text=범위 선택").click();
  ok((await T(".pg[aria-pressed=true]").count()) === 8, "범위 선택 수");
  await T(".pg").nth(0).click();
  ok((await T(".pg[aria-pressed=true]").count()) === 9, "썸네일 눌러 추가");
  await T(".pg").nth(0).click();
  await T("input[placeholder='예: L']").fill("L");
  return `L: ${pickL} / M: ${pickM}`;
});
await step("PDF: 기기에서 읽기 → 도안 만들어짐", async () => {
  await T("#uploadView button:has-text('도안 읽기')").click();
  await T("#uploadView").waitFor({ state: "detached", timeout: 60000 });
  const tabs = await T(".ptab").allTextContents();
  ok(tabs.length >= 3, "파트 수 " + tabs.length);
  return tabs.map((t) => t.replace(/\d+\/\d+$/, "")).join(", ");
});
await step("PDF: 원본 보기 (앞뒤 쪽·확대·닫기)", async () => {
  await T("text=원본 p").first().click();
  await T(".viewer canvas").waitFor({ timeout: 30000 });
  const lab = await txt(".viewer .prog");
  await T(".viewer button[aria-label='다음 쪽']").click();
  await page.waitForFunction((l) => document.querySelector(".viewer .prog")?.textContent !== l, lab);
  await T(".viewer >> text=확대").click();
  ok(await T(".viewer-body.zoom").count(), "확대 안 됨");
  await T(".viewer >> text=닫기").click();
  ok((await T(".viewer").count()) === 0, "닫기 안 됨");
  return lab + " → 다음";
});
await step("PDF: 차트 쪽 바꾸기 → 띠 표시", async () => {
  const tab = (await T(".ptab").allTextContents()).find((t) => !/스와치/.test(t));
  await T(`.ptab:has-text("${tab.replace(/\d+\/\d+$/, "")}")`).first().click();
  await T("text=차트 쪽 바꾸기").click();
  await T(".dlg input").first().fill("13");
  await T(".dlg .actions button.primary").click();
  await T(".chartview canvas").waitFor({ timeout: 60000 });
  return "p13";
});
await step("PDF: 기호 누르기 → 말풍선 → 다시 누르면 닫힘", async () => {
  // 차트 가운데로 가로 스크롤한 뒤 보이는 그림 안쪽을 누른다 (끝은 단 번호 칸이라 기호가 없음)
  await T(".chartview").evaluate((el) => { el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2; });
  const v = await T(".chartview").boundingBox(), c = await T(".chartview canvas").boundingBox();
  const x = Math.max(v.x, c.x) + (Math.min(v.x + v.width, c.x + c.width) - Math.max(v.x, c.x)) * 0.5;
  const y = Math.max(v.y, c.y) + (Math.min(v.y + v.height, c.y + c.height) - Math.max(v.y, c.y)) * 0.5;
  await page.mouse.click(x, y);
  await T(".sympop").waitFor({ timeout: 20000 });
  const t = await txt(".sympop");
  await page.mouse.click(x, y);
  await page.waitForTimeout(400);
  ok((await T(".sympop").count()) === 0, "같은 자리 다시 눌러도 안 닫힘");
  return t.replace(/\s+/g, " ").slice(0, 50);
});
await step("PDF: 원통뜨기 체크 → 방향 바뀜", async () => {
  const d0 = await txt(".chip.dir");
  await T(".charttools input[type=checkbox]").check();
  const d1 = await txt(".chip.dir");
  ok(/원통/.test(d1), "원통 방향 아님: " + d1);
  await T(".charttools input[type=checkbox]").uncheck();
  return `${d0} → ${d1}`;
});
await step("PDF: 기호표 접기/펴기", async () => {
  if (!(await T(".legend").count())) return "기호표 없음(건너뜀)";
  await T(".legend >> text=접기").click();
  ok(await T(".legend.closed").count(), "접기 안 됨");
  await T(".legend >> text=기호표").click();
  ok(!(await T(".legend.closed").count()), "펴기 안 됨");
});
await step("PDF: 기호표 크게 보기", async () => {
  if (!(await T(".legend").count())) return "기호표 없음(건너뜀)";
  await T(".legend >> text=크게 보기").click();
  await T(".viewer[aria-label='기호표 크게 보기'] canvas").waitFor({ timeout: 30000 });
  const w = await T(".viewer canvas").evaluate((c) => c.width);
  await T(".viewer >> text=확대").click();
  ok(await T(".viewer-body.zoom").count(), "확대 안 됨");
  await T(".viewer >> text=닫기").click();
  ok((await T(".viewer").count()) === 0, "닫기 안 됨");
  return `그림 폭 ${w}px`;
});
await step("PDF: 차트 글로 풀기(키 없음 → 복사·붙여넣기 창) → 답 붙여넣기", async () => {
  await T("text=이 단 차트를 글로 풀기").click();
  await T(".dlg textarea[readonly]").waitFor({ timeout: 60000 });
  ok((await T(".dlg button:has-text('이미지 받기')").count()) >= 1, "이미지 받기 버튼 없음");
  await T(".dlg textarea:not([readonly])").fill("겉2, 안2, 겉2 (6코)\n점검: 일치");
  await T("text=붙여넣은 답으로 계속").click();
  await T(".explain").waitFor({ timeout: 10000 });
  return (await txt(".explain")).slice(0, 40);
});
await step("이 단 서술 수정 → 묶음 초기화", async () => {
  await T(".row-actions button:has-text('이 단 서술 수정')").click();
  await T(".now textarea").fill("겉3, 안3 (6코)");
  await T(".now button:has-text('저장')").first().click();
  ok((await T(".chunk").allTextContents()).join("|") === "겉3|안3 (6코)", "고친 서술: " + (await T(".chunk").allTextContents()).join("|"));
});
await step("단 번호로 이동 (없는 단이면 알림)", async () => {
  await T("form input[type=number]").fill("999");
  await T("form button[type=submit]").click();
  await page.waitForFunction(() => /없어요/.test(document.getElementById("status")?.textContent || ""));
});
await step("진행 기록 목록", async () => {
  await openSub("진행 기록");
  const items = await T(".hist-row").allTextContents();
  const empty = await T(".hist-wrap >> text=아직 기록이 없어요").count();
  await backSub();
  ok(items.length >= 1 || empty, "진행 기록 화면이 비었음");
  return items.length ? items[0].replace(/\s+/g, " ").slice(0, 50) : "기록 없음 안내";
});
await step("게이지: 스와치 탭에서 적기 → 요약", async () => {
  await T(".ptab:has-text('스와치')").click();
  await T(".gauge-line").click();
  await T(".gauge-set >> nth=0 >> input[aria-label='세탁 전 콧수']").fill("19");
  await T(".gauge-set >> nth=0 >> input[aria-label='세탁 전 단수']").fill("24");
  await T(".dlg .actions button.primary").click();
  ok(/내 19코 24단/.test(await txt(".gauge-line")), "요약에 세탁 전 값 없음: " + (await txt(".gauge-line")));
});
await step("지금 저장 · 마지막 저장 시각", async () => {
  await T("#meta >> text=지금 저장").click();
  await page.waitForFunction(() => /마지막 저장/.test(document.getElementById("meta")?.textContent || ""));
});
await step("내보내기 → 가져오기", async () => {
  await openSub("진행 기록");
  const [dl] = await Promise.all([page.waitForEvent("download"), T("text=진행 내보내기").click()]);
  const f = "check-out/qa/export.json";
  await dl.saveAs(f);
  const j = JSON.parse(readFileSync(f, "utf8"));
  ok(j.patterns?.length >= 1, "내보낸 도안 없음");
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), T("text=가져오기").first().click()]);
  await chooser.setFiles(f);
  await page.waitForFunction(() => /가져왔어요|새 기록이 없어요/.test(document.getElementById("status")?.textContent || ""));
  return `도안 ${j.patterns.length}개`;
});
await step("백업에서 복원 창", async () => {
  await T("text=백업에서 복원").click();
  await T(".dlg").waitFor();
  const n2 = await T(".dlg .hist li").count();
  await T(".dlg >> text=닫기").click();
  ok(n2 >= 1, "백업 없음 (지금 저장 뒤인데)");
  return `백업 ${n2}개`;
});
await step("페이지 더 읽어서 붙이기 화면 열고 닫기", async () => {
  await T("text=페이지 더 읽어서 붙이기").click();
  await T("#uploadView").waitFor();
  ok(/붙이기/.test(await txt("#uploadView h2")), "제목");
  await T("#uploadView >> text=돌아가기").click();
  await T("#uploadView").waitFor({ state: "detached" });
});

await step("페이지 더 읽어서 붙이기: 같은 PDF의 다른 쪽 → 파트 늘어남", async () => {
  const before = (await T(".ptab").allTextContents()).length;
  await T("text=페이지 더 읽어서 붙이기").click();
  await T("#fileIn").setInputFiles(pdfPath);
  await page.waitForFunction(() => /골랐어요|없어요/.test(document.querySelector(".pg-tools .hint")?.textContent || ""), null, { timeout: 60000 });
  await T("input[aria-label='페이지 범위']").fill("4");
  await T("text=범위 선택").click();
  await T("#uploadView button:has-text('도안 읽기')").click();
  const r = await Promise.race([
    T("#uploadView").waitFor({ state: "detached", timeout: 60000 }).then(() => "done"),
    T(".dlg h2:has-text('일부만')").waitFor({ timeout: 60000 }).then(() => "partial"),
  ]);
  if (r === "partial") { await T(".dlg >> text=기기에서 읽은 대로 시작").click(); await T("#uploadView").waitFor({ state: "detached", timeout: 60000 }); }
  const after = (await T(".ptab").allTextContents()).length;
  ok(after >= before, `파트 ${before} → ${after}`);
  return `파트 ${before} → ${after}`;
});
await step("이 기기에 PDF 다시 연결 (쪽 안 고르고 연결만)", async () => {
  await T("text=이 기기에 PDF 다시 연결").click();
  await T("#fileIn").setInputFiles(pdfPath);
  await page.waitForFunction(() => /골라주세요|고르지 않아도/.test(document.querySelector(".pg-tools .hint")?.textContent || ""), null, { timeout: 60000 });
  await T("#uploadView button:has-text('PDF 연결')").click();
  await T("#uploadView").waitFor({ state: "detached", timeout: 30000 });
  await page.waitForFunction(() => /연결했어요/.test(document.getElementById("status")?.textContent || ""));
});
await step("백업에서 복원 → 실제로 되돌아감", async () => {
  await backSub();
  await T("#meta >> text=지금 저장").click();
  await page.waitForTimeout(300);
  const row0 = await txt(".rowno b");
  await T("#nextBtn").click(); await T("#nextBtn").click();
  await openSub("진행 기록");
  await T("text=백업에서 복원").click();
  await T(".dlg .hist button").first().click();
  await page.waitForTimeout(500);
  await backSub();
  ok((await txt(".rowno b")) === row0, `복원 후 단 ${await txt(".rowno b")} (기대 ${row0})`);
});
await step("사진 → 도안 읽기 (키 없음 → 이미지 첨부 요청)", async () => {
  await T("#addBtn").click();
  await T("#fileIn").setInputFiles("check-out/photo-chart.jpg");
  await T("#uploadView button:has-text('도안 읽기')").click();
  await T(".dlg textarea[readonly]").waitFor({ timeout: 30000 });
  ok(/사진/.test(await T(".dlg textarea[readonly]").inputValue()), "사진 프롬프트 아님");
  ok((await T(".dlg button:has-text('이미지 받기')").count()) === 1, "이미지 받기 버튼");
  await T(".dlg >> text=중지").click();
  await T("#uploadView >> text=돌아가기").click();
});
await step("이미지로 시작: 자르기 상자 끌기 → 칸 수 그대로·영역 바뀜", async () => {
  await T("#addBtn").click();
  await T("#fileIn").setInputFiles("check-out/photo-chart.jpg");
  await T("text=배색 차트로 읽기").click();
  const ed = ".editor[aria-label='이미지로 시작']";
  await page.waitForFunction((e) => document.querySelector(e + " input[aria-label='가로 콧수']")?.value === "38", ed, { timeout: 30000 });
  const cb = await T(ed + " canvas").boundingBox();
  // 왼쪽 위 핸들 근처를 안쪽으로 끌기
  const shot1 = await T(ed + " canvas").screenshot();
  // 자르기 상자 안쪽(차트 한가운데)을 잡고 옮기기
  await page.mouse.move(cb.x + cb.width * 0.5, cb.y + cb.height * 0.7);
  await page.mouse.down(); await page.mouse.move(cb.x + cb.width * 0.45, cb.y + cb.height * 0.65, { steps: 4 }); await page.mouse.up();
  const shot2 = await T(ed + " canvas").screenshot();
  ok(!shot1.equals(shot2), "끌어도 그림 그대로");
  await T(ed + " >> text=▦ 격자 자동 찾기").click();
  await T(ed + " >> text=취소").click();
  await T(".editor").waitFor({ state: "detached" }).catch(() => {});
  await page.evaluate(() => document.querySelectorAll(".editor").forEach((e) => e.remove()));
  await T("#uploadView >> text=돌아가기").click().catch(() => {});
});

/* ---------- 텍스트 도안 ---------- */
await step("텍스트 도안: 기기에서 읽기", async () => {
  await T("#addBtn").click();
  await T(".tabs button:has-text('텍스트')").click();
  await T("input[placeholder='예: 리본 케이블 가디건']").fill("텍스트 테스트");
  await T("textarea[aria-label='도안 텍스트']").fill("[몸판]\n1단(RS): 겉뜨기 끝까지 (60코)\n2단(WS): 안뜨기 끝까지\n3단: 겉2, 안2 반복\n4단: 안2, 겉2 반복\n[소매]\n1단: 30코 기초코\n2단: 겉뜨기");
  await T("#uploadView button:has-text('도안 읽기')").click();
  await T("#uploadView").waitFor({ state: "detached", timeout: 20000 });
  const tabs = (await T(".ptab").allTextContents()).map((t) => t.replace(/\d+\/\d+$/, ""));
  ok(tabs.join() === "몸판,소매", "파트: " + tabs.join());
  ok((await txt(".rowno .st")) === "60코", "콧수");
});
await step("텍스트 도안: '1단과 동일' → Claude 필요(복사·붙여넣기 창)", async () => {
  await T("#addBtn").click();
  await T(".tabs button:has-text('텍스트')").click();
  await T("textarea[aria-label='도안 텍스트']").fill("1단: 겉뜨기\n2단: 안뜨기\n3단: 1단과 동일\n4단: 2단과 동일");
  await T("#uploadView button:has-text('도안 읽기')").click();
  await T(".dlg textarea[readonly]").waitFor({ timeout: 20000 });
  await T(".dlg >> text=중지").click();
  await T("#uploadView >> text=돌아가기").click();
});

/* ---------- 배색 ---------- */
await step("배색: 빈 차트로 시작 → 편집기 도구들", async () => {
  await T("#addBtn").click();
  await T(".tabs button:has-text('배색 차트 그리기')").click();
  await T("input[aria-label='콧수']").fill("10");
  await T("input[aria-label='단수']").fill("6");
  await T(".start-btn.blank").click();
  const cv = T(".editor canvas");
  await cv.waitFor();
  const b = await cv.boundingBox();
  const cell = async (c, r) => { // c: 왼쪽부터, r: 위에서부터 (0부터)
    const g = await page.evaluate(() => { const c = document.querySelector(".editor canvas"); return { w: c.clientWidth, h: c.clientHeight }; });
    const num = Math.max(20, Math.min(30, 20 * 1.4)), top = 14;
    return { x: b.x + num + c * 20 + 10, y: b.y + top + r * 20 + 10 };
  };
  let p = await cell(0, 5); await page.mouse.click(p.x, p.y); // 1단 맨 왼쪽 칠하기 (B)
  const d1 = await txt(".ed-desc");
  ok(/B 1코/.test(d1), "칠하기 후 서술: " + d1);
  await T(".editor >> text=⌫ 지우개").click();
  await page.mouse.click(p.x, p.y);
  ok(!/B 1코/.test(await txt(".ed-desc")), "지우개");
  await T(".editor button[aria-label='되돌리기']").click();
  ok(/B 1코/.test(await txt(".ed-desc")), "되돌리기");
  await T(".editor >> text=▦ 채우기").click();
  p = await cell(5, 0); await page.mouse.click(p.x, p.y);
  await T(".editor >> text=▭ 선택").click();
  const a = await cell(0, 5), z = await cell(2, 5);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(z.x, z.y); await page.mouse.up();
  ok(await T(".editor >> text=좌우 반전").isVisible(), "선택 막대 안 보임");
  await T(".editor >> text=좌우 반전").click();
  await T(".editor >> text=가로로 반복").click();
  await T(".editor >> text=복사").click();
  p = await cell(0, 3); await page.mouse.click(p.x, p.y);
  return (await txt(".ed-desc")).slice(0, 60);
});
await step("배색: 설정(게이지·보기·번호) 적용 + 픽셀 PNG 받기", async () => {
  await T(".editor >> text=⚙ 설정").click();
  await T(".set-nav >> text=게이지").click();
  const ins = T(".set-pane input[type=number]");
  await ins.nth(0).fill("18"); await ins.nth(1).fill("23");
  await T(".set-nav >> text=번호").click();
  await T(".set-pane select").first().selectOption("l");
  await T(".dlg >> text=적용").click();
  const h0 = await T(".editor canvas").evaluate((c) => c.clientHeight);
  ok(h0 < 6 * 20 + 28, "게이지 비율이 칸 높이에 반영 안 됨: " + h0);
  await T(".editor >> text=⚙ 설정").click();
  await T(".set-nav >> text=보기").click();
  const [dl] = await Promise.all([page.waitForEvent("download"), T(".set-pane >> text=픽셀 보기 받기").click()]);
  ok(/\.png$/.test(dl.suggestedFilename()), "파일 이름 " + dl.suggestedFilename());
  await page.waitForTimeout(300);
  await T(".dlg button:has-text('취소')").last().click();
});
await step("배색: 색 추가·편집", async () => {
  await T(".editor .ed-foot button[aria-label='색 추가']").click();
  await T(".dlg input[type=text]").first().fill("C");
  await T(".dlg input[type=text]").nth(1).fill("머스터드");
  await T(".dlg >> text=확인").click();
  ok((await T(".editor .pal button").allTextContents()).includes("C"), "색 C 없음");
});
await step("배색: 닫기(저장 안 함) → 확인 창 → 계속 편집", async () => {
  await T(".editor .ed-bar button:has-text('닫기')").click();
  await T(".dlg >> text=계속 편집").click();
  ok(await T(".editor").count(), "편집기가 닫힘");
  await T(".editor button:has-text('💾 저장')").click();
  await T(".editor").waitFor({ state: "detached" });
  const c = await T(".chunk").allTextContents();
  ok(c.length >= 1, "저장 후 서술 없음");
  return c.join(" | ").slice(0, 60);
});
await step("배색: 진행 화면 칸 누르기 → 색 이름", async () => {
  const bb = await T(".chartview").boundingBox();
  await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await T(".sympop").waitFor({ timeout: 5000 });
  return (await txt(".sympop")).replace(/\s+/g, " ");
});

/* ---------- 설정 · 삭제 · 다크 모드 ---------- */
await step("설정 창: 키 방식 고르면 키 칸 보임 / 빈 키 저장 막힘", async () => {
  await T("#setBtn").click();
  await T("input[value=claude]").check();
  ok(await T("input[aria-label='Claude API 키']").isVisible(), "키 칸 안 보임");
  await T(".dlg .actions button.primary").click();
  await page.waitForFunction(() => /키를 넣어/.test(document.getElementById("status")?.textContent || ""));
  await T(".dlg button:has-text('취소')").last().click();
});
await step("도안 삭제 (확인 단계)", async () => {
  const before = await T("#patSel option").count();
  await openSub("진행 기록");
  await T(".danger button:has-text('이 도안 삭제')").click();
  await T(".danger span button:has-text('삭제')").click();
  await page.waitForFunction((b) => document.querySelectorAll("#patSel option").length === b - 1, before, { timeout: 5000 });
  return `${before} → ${before - 1}`;
});
await step("다크 모드 화면", async () => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: "check-out/qa/dark.png", fullPage: false });
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.emulateMedia({ colorScheme: "light" });
  ok(bg !== "rgb(243, 245, 242)", "다크에서도 밝은 배경");
  return bg;
});
await step("단 안 적고 이동 → 그 파트 첫 단", async () => {
  const opts = await T(".tools select option").allTextContents();
  const target = opts[opts.length > 1 ? 1 : 0];
  await T(".tools select").selectOption(target);
  await T(".tools input[type=number]").fill("");
  await T(".tools button[type=submit]").click();
  await page.waitForTimeout(300);
  const chip = await txt(".now .chip");
  const first = String(await page.evaluate(async (s) => { const m = await import("/src/model.ts"); const st = await import("/src/store.ts"); return m.partRows(st.active(), s)[0].n; }, target));
  const now = await txt(".rowno b");
  ok(chip === target, `파트가 안 바뀜: ${chip}`);
  ok(now === first, `첫 단이 아님: ${now} (첫 단 ${first})`);
  return `${target} ${now}단`;
});
await step("뜨개 시작·중지", async () => {
  await T(".now .work button:has-text('시작')").click();
  await T(".now .work-clock").waitFor();
  await page.waitForTimeout(1200);
  const t = await txt(".now .work-clock");
  ok(/뜨는 중 0:00:0[1-9]/.test(t), "시계가 안 감: " + t);
  await T(".now .work button:has-text('중지')").click();
  ok(await T(".now .work button:has-text('시작')").count(), "중지 안 됨");
  return t;
});
await step("스트레칭 알림 → 타이머 자동 정지 → 다시 시작", async () => {
  await page.evaluate(async () => {
    const store = await import("/src/store.ts");
    const p = store.active();
    p.work = { on: Date.now() - 31 * 60000, spans: [] };
    store.commit(p, false);
    window.__app.render();
  });
  await T(".bar-next, #nextBtn, button:has-text('다음 단')").first().click();
  await T(".stretch").waitFor({ timeout: 5000 });
  ok(await T(".now .work button:has-text('시작')").count(), "타이머가 안 멈춤");
  await T(".stretch button:has-text('다시 시작')").click();
  ok(await T(".now .work button:has-text('중지')").count(), "다시 시작 안 됨");
  await T(".now .work button:has-text('중지')").click();
  await T("button:has-text('이전 단')").first().click();
  return "멈춤 → 다시 시작 ✓";
});
await step("진행 기록 지우기", async () => {
  await openSub("진행 기록");
  if (!(await T("text=진행 기록 지우기").count())) return "기록 없음(건너뜀)";
  await T("text=진행 기록 지우기").click();
  await T(".dlg button.primary:has-text('지우기')").click();
  await page.waitForTimeout(200);
  ok(!(await T("text=진행 기록 지우기").count()), "안 지워짐");
  await backSub();
});
await step("새로고침 후 유지 (도안·탭·단)", async () => {
  const sel = await T("#patSel").inputValue();
  const row = await txt(".rowno b");
  await page.reload();
  await page.waitForSelector(".now");
  ok((await T("#patSel").inputValue()) === sel, "도안 바뀜");
  ok((await txt(".rowno b")) === row, `단 바뀜 ${row}`);
});
await step("가로 스크롤 없음 (420px)", async () => {
  const w = await page.evaluate(() => document.documentElement.scrollWidth);
  ok(w <= 421, "페이지 너비 " + w);
});

await browser.close(); await server.close();
console.log(results.join("\n"));
if (consoleErr.length) console.log("\n콘솔 오류:\n" + [...new Set(consoleErr)].slice(0, 10).join("\n"));
