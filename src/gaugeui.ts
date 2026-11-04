/** 게이지 입력 화면: 무늬별로 도안 · 세탁 전 · 세탁 후 */
import { compare, convertRows, convertSt, findEase, gaugeToSwatch, myGauge, needleMm, recommendSize, rowsToCm, sizeAdvice, stToCm, swatchToGauge, washChange } from "./gauge";
import { getSetting, setSetting } from "./db";
import { sizeTable, type SizeRow } from "./parse";
import { toLines } from "./pdfgeom";
import { textItems } from "./pdf";
import { commit, pdfOf } from "./store";
import { ask, dialog, fmtShort, h } from "./ui";
import type { Gauge, GaugeSet, Pattern, Swatch } from "./types";

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
  let table: { order: string[]; rows: SizeRow[] } | null = null;
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
      h("p", { class: "gen", style: "margin:0", text: (patEase != null ? `도안 권장 여유 +${patEase}cm. ` : "여유: 몸에 붙게 0~5, 보통 10, 넉넉하게 20 이상. ") + (set && mine ? `'${set.label}' 내 게이지(${mine.st}코)로 뜬 크기로 비교해요.` : "스와치를 재서 적으면 내 게이지로 뜬 크기까지 반영해요.") }),
    ];
    if (body.chest) {
      const ease = num(easeIn!.value) || (parseFloat(easeIn!.value) === 0 ? 0 : patEase ?? 10);
      const rec = recommendSize(table.order, row.values, body.chest, ease, f, half);
      out.push(
        h("ul", { class: "info-list", style: "padding-left:18px" }, ...rec.list.map((x) => h("li", { style: x.sz === rec.best ? { fontWeight: "700" } : {} },
          `${x.sz}: ${row.label} 도안 ${Number.isFinite(x.pat) ? x.pat + u : "(PDF에서 읽지 못함)"}` + (f !== 1 && Number.isFinite(x.fin) ? ` → 내 게이지 ${x.fin}${u}` : "") + (Number.isFinite(x.ease) ? ` · 몸보다 ${x.ease >= 0 ? "+" : ""}${x.ease}cm` : ""),
          x.sz.toUpperCase() === (p.size || "").toUpperCase() ? " · 지금 사이즈" : "",
          x.sz === rec.best ? " · 추천" : ""))),
        h("p", { style: "margin:0", text: rec.best ? `원하는 완성 ${half ? "품" : "가슴둘레"} ${rec.want}cm에 가장 가까운 건 ${rec.best} 사이즈예요.` : "도안 치수를 읽지 못했어요." }),
        rec.best ? resizeBtn(rec.best) : null,
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
    table = sizeTable(lines.join("\n"));
    patEase = findEase(lines.join("\n")) ?? findEase(p.info || "");
    updateSize();
  })().catch(() => {});

  const render = () => {
    list.innerHTML = "";
    sets.forEach((s, i) => {
      const out = h("div", { class: "gauge-out", "aria-live": "polite" });
      const calcIn = h("input", { type: "number", min: 1, inputmode: "numeric", placeholder: "도안 숫자", style: "width:6em", "aria-label": "도안 콧수나 단수" });
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
          const adv = mm && !c.stOk ? `${c.advice.split("→")[0]}→ ${mm}mm 대신 ${Math.round((mm + (c.stPct > 0 ? 0.5 : -0.5)) * 100) / 100}mm로 다시 떠 보세요.` : c.advice;
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
          calcOut.textContent = `콧수라면 → ${convertSt(n, s.pattern, mine)}코 (${stToCm(n, s.pattern)}cm) · 단수라면 → ${convertRows(n, s.pattern, mine)}단 (${rowsToCm(n, s.pattern)}cm)`;
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
        h("div", { class: "actions", style: "align-items:center" }, h("span", { class: "gen", text: "환산" }), calcIn), calcOut,
        s.at ? h("span", { class: "gen", text: "마지막 수정 " + fmtShort(s.at) }) : null,
      ));
      refresh();
    });
  };
  render();

  const dl = dialog("게이지 (10cm 기준)", [
    h("p", { class: "hint", text: "무늬마다 도안 게이지와 내 스와치(세탁 전·후)를 적으면 차이와 바늘 조정, 콧수·단수 환산을 보여줘요." }),
    list,
    sizeBox,
    h("div", { class: "actions" },
      h("button", { class: "btn", type: "button", text: "+ 무늬 게이지 추가", on: { click: () => { sets.push({ label: "무늬", pattern: null, before: null, after: null }); render(); } } })),
    h("div", { class: "actions" },
      h("button", { class: "btn primary", type: "button", text: "저장", on: { click: () => {
        p.gauges = sets.filter((s) => s.pattern || s.before || s.after || s.label.trim());
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
