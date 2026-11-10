/** 게이지 입력 화면: 무늬별로 도안 · 세탁 전 · 세탁 후 */
import { compare, convertRows, convertSt, findEase, gaugeToSwatch, myGauge, needleMm, recommendSize, rowsToCm, sizeAdvice, stToCm, swatchToGauge, washChange } from "./gauge";
import { getSetting, setSetting } from "./db";
import { sizeChart, type SizeRow } from "./parse";
import { toLines } from "./pdfgeom";
import { textItems } from "./pdf";
import { commit, pdfOf } from "./store";
import { ask, dialog, fmtShort, h } from "./ui";
import type { Gauge, GaugeSet, Pattern, Rep, Swatch } from "./types";
import { partNames, partRows, suggestReps } from "./model";

const num = (v: string) => {
  const n = parseFloat(v.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export function openGauge(p: Pattern, onSaved: () => void, onResize?: (size: string) => void) {
  const sets: GaugeSet[] = p.gauges.length ? p.gauges.map((s) => ({ ...s })) : [{ label: "메리야스", pattern: null, before: null, after: null }];
  const list = h("div", { style: "display:flex;flex-direction:column;gap:14px" });

  // 무늬 스와치: 정해진 콧수·단수로 뜨고 전체 너비·길이(cm)를 잰다
  const sizeRow = (label: string, sw: Swatch, g: Gauge | null, set: (g: Gauge | null) => void, onChange: () => void) => {
    const cur = g ? gaugeToSwatch(sw, g) : null;
    const w = h("input", { type: "number", min: 0, step: "0.1", inputmode: "decimal", value: cur ? String(cur.w) : "", "aria-label": label + " 너비 cm", style: "width:5em" });
    const hh = h("input", { type: "number", min: 0, step: "0.1", inputmode: "decimal", value: cur ? String(cur.h) : "", "aria-label": label + " 길이 cm", style: "width:5em" });
    const upd = () => { const a = num(w.value), b = num(hh.value); set(a && b ? swatchToGauge(sw, a, b) : null); onChange(); };
    w.oninput = upd; hh.oninput = upd;
    return h("div", { class: "gauge-row" }, h("span", { class: "gauge-lab", text: label }), w, h("span", { text: "×" }), hh, h("span", { text: "cm" }));
  };
  const gaugeRow = (label: string, g: Gauge | null, set: (g: Gauge | null) => void, onChange: () => void) => {
    const st = h("input", { type: "number", min: 0, step: "0.5", inputmode: "decimal", value: g ? String(g.st) : "", "aria-label": label + " 콧수", style: "width:5em" });
    const rows = h("input", { type: "number", min: 0, step: "0.5", inputmode: "decimal", value: g ? String(g.rows) : "", "aria-label": label + " 단수", style: "width:5em" });
    const upd = () => { const a = num(st.value), b = num(rows.value); set(a && b ? { st: a, rows: b } : null); onChange(); };
    st.oninput = upd; rows.oninput = upd;
    return h("div", { class: "gauge-row" }, h("span", { class: "gauge-lab", text: label }), st, h("span", { text: "코" }), rows, h("span", { text: "단" }));
  };

  // 사이즈 추천: 내 몸 치수 + 여유 → 도안 사이즈별 완성 치수(내 게이지로 뜬 크기)와 비교
  const sizeBox = h("section", { class: "gauge-set", hidden: true });
  let table: { order: string[]; rows: SizeRow[]; body?: boolean } | null = null;
  let patEase: number | null = null;
  let body: { chest?: number; ease?: number } = {};
  getSetting<{ chest?: number; ease?: number }>("body").then((b) => { if (b) { body = b; updateSize(); } }).catch(() => {});
  const resizeBtn = (to: string) => onResize && to.toUpperCase() !== (p.size || "").toUpperCase()
    ? h("div", { class: "actions" }, h("button", { class: "btn primary", type: "button", text: `${to} 사이즈로 바꿔서 다시 읽기`, on: { click: async () => {
        if (!(await ask("사이즈 바꾸기", `${p.size || "지금"} → ${to}로 바꾸고 도안을 그 사이즈로 다시 읽어요. 단 목록이 새 사이즈로 바뀌고, 게이지·진행 기록은 그대로 둬요.`, "바꾸기"))) return;
        p.gauges = sets.filter((x) => x.pattern || x.before || x.after || x.label.trim());
        commit(p);
        dl.close();
        onResize(to);
      } } }))
    : null;
  // 어느 사이즈든 골라서 바꾸기 (추천이 S여도 M을 뜨고 싶을 수 있다)
  const chooseBtn = (to: string) => onResize
    ? h("button", { class: "btn ghost", type: "button", text: "이 사이즈로", on: { click: async () => {
        if (!(await ask("사이즈 바꾸기", `${p.size || "지금"} → ${to}로 바꾸고 도안을 그 사이즈로 다시 읽어요. 단 목록이 새 사이즈로 바뀌고, 게이지·진행 기록은 그대로 둬요.`, "바꾸기"))) return;
        p.gauges = sets.filter((x) => x.pattern || x.before || x.after || x.label.trim());
        commit(p);
        dl.close();
        onResize(to);
      } } })
    : null;
  let chestIn: HTMLInputElement | null = null, easeIn: HTMLInputElement | null = null;
  const updateSize = () => {
    const row = table?.rows.find((r) => /가슴|둘레|품|chest|bust|width|너비/i.test(r.label)) || table?.rows[0];
    if (!table || !row) { sizeBox.hidden = true; return; }
    sizeBox.hidden = false;
    // 입력 칸은 다시 만들지 않는다 (치는 중에 포커스가 사라지지 않게)
    const focused = document.activeElement;
    if (!chestIn) {
      chestIn = h("input", { type: "number", min: 0, step: "0.5", inputmode: "decimal", placeholder: "예: 92", "aria-label": "내 가슴둘레 cm", style: "width:5.5em" });
      easeIn = h("input", { type: "number", step: "1", inputmode: "decimal", "aria-label": "여유분 cm", style: "width:4.5em" });
      const save = () => { body = { chest: num(chestIn!.value) || undefined, ease: easeIn!.value.trim() === "" ? undefined : parseFloat(easeIn!.value) }; setSetting("body", body).catch(() => {}); updateSize(); };
      chestIn.oninput = save; easeIn.oninput = save;
    }
    if (focused !== chestIn) chestIn.value = body.chest ? String(body.chest) : "";
    if (focused !== easeIn) easeIn!.value = String(body.ease ?? patEase ?? 10);
    // 몸판 무늬 게이지를 쟀으면 그것으로 (무늬가 몸판 너비를 정한다), 아니면 잰 게이지 중 첫째
    const measured = sets.filter((x) => x.pattern && myGauge(x));
    const set = measured.find((x) => /무늬|pattern/i.test(x.label)) || measured[0] || null;
    const mine = set ? myGauge(set) : null;
    const f = set && mine ? set.pattern!.st / mine.st : 1;
    const u = row.unit || "cm";
    const half = /품/.test(row.label) && !/둘레/.test(row.label);
    const out: (Node | null)[] = [
      h("b", { text: "사이즈 추천" }),
      h("div", { class: "gauge-row" }, h("span", { class: "gauge-lab", text: "내 가슴둘레" }), chestIn, h("span", { text: "cm" }), h("span", { class: "gauge-lab", style: "margin-left:8px", text: "여유" }), easeIn!, h("span", { text: "cm" })),
      h("p", { class: "gen", style: "margin:0", text: table.body
        ? "이 도안은 사이즈를 '몸 치수(To fit)'로 정해요 — 디자이너가 여유를 이미 넣어 뒀으니 내 가슴둘레가 들어가는 사이즈를 골라요 (여유 칸은 쓰지 않아요)."
        : (patEase != null ? `도안 권장 여유 +${patEase}cm. ` : "여유: 몸에 붙게 0~5, 보통 10, 넉넉하게 20 이상. ") + (set && mine ? `'${set.label}' 내 게이지(${mine.st}코)로 뜬 크기로 비교해요.` : "스와치를 재서 적으면 내 게이지로 뜬 크기까지 반영해요.") }),
    ];
    if (body.chest) {
      const ease = table.body ? 0 : num(easeIn!.value) || (parseFloat(easeIn!.value) === 0 ? 0 : patEase ?? 10);
      const rec = recommendSize(table.order, row.values, body.chest, ease, table.body ? 1 : f, half);
      out.push(
        h("p", { style: "margin:0", text: rec.best ? `원하는 완성 ${half ? "품" : "가슴둘레"} ${rec.want}cm에 가장 가까운 건 ${rec.best} 사이즈예요. 더 넉넉하게나 딱 맞게 입고 싶으면 다른 사이즈를 골라도 돼요.` : "도안 치수를 읽지 못했어요." }),
        h("div", { class: "size-pick" }, ...rec.list.map((x) => {
          const now = x.sz.toUpperCase() === (p.size || "").toUpperCase();
          const fit = !Number.isFinite(x.ease) ? "" : x.ease - ease < -4 ? "작게" : x.ease - ease > 6 ? "넉넉하게" : "권장 여유";
          return h("div", { class: "size-opt" + (x.sz === rec.best ? " best" : "") + (now ? " cur" : "") },
            h("div", {},
              h("b", { text: x.sz }), x.sz === rec.best ? h("span", { class: "tag", text: "추천" }) : null, now ? h("span", { class: "tag cur", text: "지금" }) : null,
              h("div", { class: "gen", text: `${row.label} ${Number.isFinite(x.pat) ? x.pat + u : "(PDF에서 읽지 못함)"}` + (f !== 1 && Number.isFinite(x.fin) ? ` → 내 게이지 ${x.fin}${u}` : "") + (Number.isFinite(x.ease) ? ` · 몸보다 ${x.ease >= 0 ? "+" : ""}${x.ease}cm${fit ? ` (${fit})` : ""}` : "") })),
            now ? null : chooseBtn(x.sz));
        })),
      );
    } else if (set && mine) {
      // 몸 치수가 없으면: 지금 사이즈의 도안 크기에 가장 가까운 사이즈 (스와치로 다시 고르기)
      const a = sizeAdvice(table.order, row.values, p.size, set.pattern!, mine);
      out.push(
        h("p", { class: "gen", style: "margin:0", text: `가슴둘레를 적으면 몸에 맞춰 추천해요. 지금은 '${set.label}' 내 게이지로 도안 콧수대로 뜨면 ${row.label}가 이렇게 돼요${p.size ? ` (지금 ${p.size}: 도안 ${a.target}${u})` : ""}.` }),
        h("ul", { class: "info-list", style: "padding-left:18px" }, ...a.list.map((x) => h("li", { style: x.sz === a.best ? { fontWeight: "700" } : {} },
          `${x.sz}: 도안 ${Number.isFinite(x.pat) ? x.pat + u : "?"} → 내 게이지 ${Number.isFinite(x.mine) ? x.mine + u : "?"}`,
          x.sz.toUpperCase() === (p.size || "").toUpperCase() ? " · 지금 사이즈" : "",
          x.sz === a.best && x.sz.toUpperCase() !== (p.size || "").toUpperCase() ? " · 원하던 크기에 가장 가까움" : ""))),
        a.best ? resizeBtn(a.best) : null,
      );
    }
    sizeBox.replaceChildren(...(out.filter(Boolean) as Node[]));
  };
  // 사이즈별 치수는 PDF 앞쪽(사이즈·게이지 쪽)에서 찾는다
  (async () => {
    const pdf = await pdfOf(p);
    if (!pdf) return;
    const lines: string[] = [];
    for (let n = 1; n <= Math.min(6, pdf.numPages); n++) { const t = await textItems(pdf, n); lines.push(...toLines(t.items, t.w)); }
    table = sizeChart(lines.join("\n")) || sizeChart(p.info || "");
    patEase = findEase(lines.join("\n")) ?? findEase(p.info || "");
    updateSize();
  })().catch(() => {});

  const render = () => {
    list.innerHTML = "";
    sets.forEach((s, i) => {
      const out = h("div", { class: "gauge-out", "aria-live": "polite" });
      const calcIn = h("input", { type: "number", min: 1, inputmode: "numeric", placeholder: "예: 120", style: "width:6em", "aria-label": "도안에 적힌 콧수나 단수" });
      const calcOut = h("div", { class: "gen" });
      const refresh = () => {
        s.at = Date.now();
        out.innerHTML = "";
        const mine = myGauge(s);
        const lines: (string | Node)[] = [];
        if (s.pattern && mine) {
          const c = compare(s.pattern, mine);
          // 내 바늘(없으면 도안 바늘)에서 반 호수 굵게·가늘게
          const mm = needleMm(s.myNeedle) ?? needleMm(s.needle);
          const adv = mm && !c.stOk ? `${c.advice.split("→")[0]}→ 바늘을 반 호수 ${c.stPct > 0 ? "굵게" : "가늘게"}: ${mm}mm 대신 ${Math.round((mm + (c.stPct > 0 ? 0.5 : -0.5)) * 100) / 100}mm로 떠 보세요.` : c.advice;
          lines.push(h("b", { text: adv, style: { color: c.stOk && c.rowOk ? "var(--ok)" : "var(--warn)" } }));
          lines.push(`콧수 ${sign(c.stPct)}% ${c.stOk ? "✓" : ""} · 단수 ${sign(c.rowPct)}% ${c.rowOk ? "✓" : ""} (${s.after ? "세탁 후" : "세탁 전"} 기준)`);
          lines.push(`도안 콧수 그대로 뜨면 너비 ${sign(c.widthPct)}%, 도안 단수 그대로 뜨면 길이 ${sign(c.lengthPct)}%`);
        }
        if (s.before && s.after) {
          const w = washChange(s.before, s.after);
          lines.push(`세탁 후 너비 ${sign(w.widthPct)}%, 길이 ${sign(w.lengthPct)}% 변함`);
        } else if (s.before && !s.after) lines.push("세탁·건조 후 다시 재서 '세탁 후'에 적으면 더 정확해요.");
        if (!lines.length) lines.push("10cm 안의 콧수·단수를 적어 주세요. 소수점도 돼요 (예: 18.5).");
        for (const l of lines) out.append(h("div", {}, l));
        updateSize();
        const n = parseInt(calcIn.value, 10);
        calcOut.textContent = "";
        if (n && s.pattern && mine)
          calcOut.textContent = `도안 ${n}코(${stToCm(n, s.pattern)}cm)는 내 게이지로 ${convertSt(n, s.pattern, mine)}코 · 도안 ${n}단(${rowsToCm(n, s.pattern)}cm)은 내 게이지로 ${convertRows(n, s.pattern, mine)}단`;
        else if (n && (mine || s.pattern)) {
          const g = (mine || s.pattern)!;
          calcOut.textContent = `${n}코 = ${stToCm(n, g)}cm · ${n}단 = ${rowsToCm(n, g)}cm`;
        }
      };
      calcIn.oninput = refresh;
      const label = h("input", { type: "text", value: s.label, "aria-label": "무늬 이름", style: "flex:1;min-width:6em" });
      label.oninput = () => (s.label = label.value);
      const needle = h("input", { type: "text", value: s.needle || "", placeholder: "도안 바늘 (예: 4.5mm)", "aria-label": "도안 바늘", style: "width:9em" });
      needle.oninput = () => (s.needle = needle.value);
      const myNeedle = h("input", { type: "text", value: s.myNeedle || "", placeholder: s.needle ? `예: ${s.needle}` : "예: 5mm", "aria-label": "내가 뜬 바늘", style: "width:7em" });
      myNeedle.oninput = () => { s.myNeedle = myNeedle.value.trim() || undefined; refresh(); };
      const myNeedleRow = h("div", { class: "gauge-row" }, h("span", { class: "gauge-lab", text: "내가 뜬 바늘" }), myNeedle, h("span", { class: "gen", text: "스와치를 뜬 바늘 굵기" }));
      list.append(h("section", { class: "gauge-set" },
        h("div", { class: "actions", style: "align-items:center" }, label, needle,
          sets.length > 1 ? h("button", { class: "btn ghost", type: "button", text: "빼기", on: { click: () => { sets.splice(i, 1); render(); } } }) : null),
        ...(s.swatch ? [
          h("p", { class: "hint", style: "margin:0" }, `스와치를 ${s.swatch.st}코 × ${s.swatch.rows}단으로 뜨고, 다 뜬 스와치 전체의 너비·길이를 재요. 도안 크기: `, h("b", { text: `${s.swatch.w} × ${s.swatch.h} cm` }), ` (10cm에 ${s.pattern?.st ?? "?"}코 ${s.pattern?.rows ?? "?"}단)`),
          sizeRow("세탁 전", s.swatch, s.before, (g) => (s.before = g), refresh),
          sizeRow("세탁 후", s.swatch, s.after, (g) => (s.after = g), refresh),
          myNeedleRow,
        ] : [
          gaugeRow("도안 게이지", s.pattern, (g) => (s.pattern = g), refresh),
          gaugeRow("세탁 전", s.before, (g) => (s.before = g), refresh),
          gaugeRow("세탁 후", s.after, (g) => (s.after = g), refresh),
          myNeedleRow,
        ]),
        out,
        h("div", { class: "actions", style: "align-items:center" }, h("span", { class: "gen", text: "콧수·단수 바꿔 보기: 도안에 적힌 숫자" }), calcIn), calcOut,
        s.at ? h("span", { class: "gen", text: "마지막 수정 " + fmtShort(s.at) }) : null,
      ));
      refresh();
    });
  };
  render();

  // 기장 조절: 파트의 한 구간을 한 번 더 뜨거나 뺀다 (저장할 때 적용)
  const reps: Record<string, Rep> = JSON.parse(JSON.stringify(p.rep || {}));
  const repBox = h("section", { class: "gauge-set" });
  const renderRep = () => {
    repBox.innerHTML = "";
    const rowsPer10 = (sets.map((x) => myGauge(x)).find(Boolean) || sets.find((x) => x.pattern)?.pattern)?.rows || null;
    const cm = (n: number) => (rowsPer10 ? `약 ${Math.round(((n * 10) / rowsPer10) * 10) / 10}cm` : `${n}단`);
    repBox.append(h("b", { text: "기장 조절 (구간 한 번 더 · 빼기)" }),
      h("p", { class: "gen", style: "margin:0", text: "무늬 한 단위(예: 하트 1개)를 더 뜨거나 빼서 기장을 조절해요. 고르면 '다음 단'이 그대로 따라가요." }));
    for (const [s, r] of Object.entries(reps)) {
      const len = r.to - r.from + 1;
      const pick = (t: number) => h("button", { class: "btn" + (r.times === t ? " primary" : " ghost"), type: "button", "aria-pressed": String(r.times === t), text: t < 0 ? "빼기" : t === 0 ? "그대로" : `+${t}회`, on: { click: () => { r.times = t; r.pass = Math.min(r.pass || 0, Math.max(t, 0)); renderRep(); } } });
      repBox.append(h("div", { class: "rep-row" },
        h("div", {}, h("b", { text: `${s} ${r.from}~${r.to}단` }), h("span", { class: "gen", text: ` ${r.label ? r.label + " · " : ""}${len}단 · ${cm(len)}` })),
        h("div", { class: "actions" }, pick(-1), pick(0), pick(1), pick(2),
          h("button", { class: "link", type: "button", text: "구간 지우기", on: { click: () => { delete reps[s]; renderRep(); } } })),
        h("span", { class: "gen", text: r.times < 0 ? `기장 ${cm(len)} 짧게 — ${r.from - 1}단 다음에 ${r.to + 1}단으로 건너뛰어요` : r.times > 0 ? `기장 ${cm(len * r.times)} 길게 — ${r.to}단을 뜨면 ${r.from}단으로 돌아가 ${r.times}번 더 떠요` : "원래 도안대로" })));
    }
    // 도안에서 찾은 반복 구간 추천 (아직 정하지 않은 파트만)
    const sug = suggestReps(p).filter((x) => !reps[x.s]);
    if (sug.length) repBox.append(h("div", { class: "actions", style: "align-items:center" }, h("span", { class: "gen", text: "도안에서 찾은 반복 구간:" }),
      ...sug.map((x) => h("button", { class: "btn ghost", type: "button", text: `${x.s} ${x.from}~${x.to}단 (${x.label})`, on: { click: () => { reps[x.s] = { from: x.from, to: x.to, times: 0, pass: 0, label: x.label }; renderRep(); } } }))));
    if (!Object.keys(reps).length && !sug.length) repBox.append(h("p", { class: "gen", style: "margin:0", text: "되풀이되는 구간을 찾지 못했어요. 차트만 따르는 도안은 아래에 직접 구간을 적어 주세요 (예: 무늬 한 단위의 시작·끝 단)." }));
    // 구간 새로 정하기
    const names = partNames(p);
    const sel = h("select", { "aria-label": "파트" }, ...names.map((n) => new Option(n, n)));
    const a = h("input", { type: "number", min: 1, inputmode: "numeric", placeholder: "시작 단", style: "width:5.5em", "aria-label": "구간 시작 단" });
    const b = h("input", { type: "number", min: 1, inputmode: "numeric", placeholder: "끝 단", style: "width:5.5em", "aria-label": "구간 끝 단" });
    const lb = h("input", { type: "text", placeholder: "이름 (예: 하트 1개)", style: "flex:1;min-width:7em", "aria-label": "구간 이름" });
    const add = h("button", { class: "btn", type: "button", text: "구간 추가", on: { click: () => {
      const from = parseInt(a.value, 10), to = parseInt(b.value, 10), ns = partRows(p, sel.value).map((x) => x.n);
      if (!(from <= to) || !ns.includes(from) || !ns.includes(to)) { a.focus(); return; }
      reps[sel.value] = { from, to, times: 0, pass: 0, label: lb.value.trim() || undefined };
      renderRep();
    } } });
    repBox.append(h("div", { class: "actions", style: "align-items:center" }, sel, a, h("span", { text: "~" }), b, lb, add));
  };
  renderRep();

  const dl = dialog("게이지 (10cm 기준)", [
    h("p", { class: "hint", text: "무늬마다 도안 게이지와 내 스와치(세탁 전·후)를 적으면 차이와 바늘 조정, 콧수·단수 환산을 보여줘요." }),
    list,
    sizeBox,
    repBox,
    h("div", { class: "actions" },
      h("button", { class: "btn", type: "button", text: "+ 무늬 게이지 추가", on: { click: () => { sets.push({ label: "무늬", pattern: null, before: null, after: null }); render(); } } })),
    h("div", { class: "actions" },
      h("button", { class: "btn primary", type: "button", text: "저장", on: { click: () => {
        p.gauges = sets.filter((s) => s.pattern || s.before || s.after || s.label.trim());
        p.rep = reps;
        p.rev = (p.rev || 0) + 1; // 다른 기기에도 도안 내용(구간)이 바뀐 걸로 전해지게
        commit(p);
        dl.close();
        onSaved();
      } } }),
      h("button", { class: "btn ghost", type: "button", text: "취소", on: { click: () => dl.close() } })),
  ]);
}

const sign = (v: number) => (v > 0 ? "+" : "") + v;

/** 스와치 탭 요약 (무늬마다 한 줄) */
export function gaugeSummary(p: Pattern): string | null {
  const fmt = (g: Gauge) => `${g.st}코 ${g.rows}단`;
  const lines = p.gauges.map((s) => {
    const mine = myGauge(s);
    const name = s.label.replace(/\s*\(원문.*$/, "");
    if (s.swatch) {
      const sw = s.swatch;
      const m2 = mine ? gaugeToSwatch(sw, mine) : null;
      return `${name}: 스와치 ${sw.st}코 ${sw.rows}단 → 도안 ${sw.w}×${sw.h}cm` + (m2 ? ` · 내 ${m2.w}×${m2.h}cm${s.myNeedle ? ` (${s.myNeedle})` : ""} ${s.pattern && compare(s.pattern, mine!).stOk && compare(s.pattern, mine!).rowOk ? "✓ 맞음" : ""}` : " · 떠서 재 보세요");
    }
    if (s.pattern && mine) {
      const c = compare(s.pattern, mine);
      return `${name}: 도안 ${fmt(s.pattern)} · 내 ${fmt(mine)}${s.myNeedle ? ` (${s.myNeedle})` : ""} ${c.stOk && c.rowOk ? "✓ 맞음" : `· 콧수 ${sign(c.stPct)}%`}`;
    }
    if (s.pattern) return `${name}: 도안 ${fmt(s.pattern)}${s.needle ? " · " + s.needle : ""}`;
    if (mine) return `${name}: 내 ${fmt(mine)}`;
    return "";
  }).filter(Boolean);
  if (!lines.length) return "게이지 적기 (도안 · 세탁 전 · 세탁 후)";
  return "게이지 — " + lines.join(" / ") + (p.gauges.some((s) => myGauge(s)) ? "" : " · 스와치를 재면 비교해 드려요");
}
