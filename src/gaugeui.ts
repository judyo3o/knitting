/** 게이지 입력 화면: 무늬별로 도안 · 세탁 전 · 세탁 후 */
import { compare, convertRows, convertSt, gaugeToSwatch, myGauge, rowsToCm, sizeAdvice, stToCm, swatchToGauge, washChange } from "./gauge";
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

  // 스와치로 사이즈 다시 고르기: 도안의 사이즈별 치수를 내 게이지로 환산
  const sizeBox = h("section", { class: "gauge-set", hidden: true });
  let table: { order: string[]; rows: SizeRow[] } | null = null;
  const updateSize = () => {
    sizeBox.innerHTML = "";
    const set = sets.find((x) => x.pattern && myGauge(x));
    const row = table?.rows.find((r) => /가슴|둘레|품|chest|bust|width|너비/i.test(r.label)) || table?.rows[0];
    if (!table || !row || !set) { sizeBox.hidden = true; return; }
    sizeBox.hidden = false;
    const a = sizeAdvice(table.order, row.values, p.size, set.pattern!, myGauge(set)!);
    const u = row.unit || "";
    sizeBox.append(
      h("b", { text: "사이즈 다시 고르기" }),
      h("p", { class: "gen", style: "margin:0", text: `'${set.label}' 내 게이지로 도안 콧수대로 뜨면 ${row.label}가 이렇게 돼요${p.size ? ` (지금 ${p.size}: 도안 ${a.target}${u})` : ""}.` }),
      h("ul", { class: "info-list", style: "padding-left:18px" }, ...a.list.map((x) => h("li", { style: x.sz === a.best ? { fontWeight: "700" } : {} },
        `${x.sz}: 도안 ${Number.isFinite(x.pat) ? x.pat + u : "?"} → 내 게이지 ${Number.isFinite(x.mine) ? x.mine + u : "?"}`,
        x.sz.toUpperCase() === (p.size || "").toUpperCase() ? " · 지금 사이즈" : "",
        x.sz === a.best && x.sz.toUpperCase() !== (p.size || "").toUpperCase() ? " · 원하던 크기에 가장 가까움" : ""))),
      a.best && a.best.toUpperCase() !== (p.size || "").toUpperCase() && onResize
        ? h("div", { class: "actions" }, h("button", { class: "btn", type: "button", text: `${a.best} 사이즈로 바꿔서 다시 읽기`, on: { click: async () => {
            if (!(await ask("사이즈 바꾸기", `${p.size || "지금"} → ${a.best}로 바꾸고 도안을 그 사이즈로 다시 읽어요. 단 목록이 새 사이즈로 바뀌고, 게이지·진행 기록은 그대로 둬요.`, "바꾸기"))) return;
            p.gauges = sets.filter((x) => x.pattern || x.before || x.after || x.label.trim());
            commit(p);
            dl.close();
            onResize(a.best!);
          } } }))
        : h("p", { class: "gen", style: "margin:0", text: a.best ? "지금 사이즈 그대로 떠도 돼요." : "" }),
    );
  };
  // 사이즈별 치수는 PDF 앞쪽(사이즈·게이지 쪽)에서 찾는다
  (async () => {
    const pdf = await pdfOf(p);
    if (!pdf) return;
    const lines: string[] = [];
    for (let n = 1; n <= Math.min(6, pdf.numPages); n++) { const t = await textItems(pdf, n); lines.push(...toLines(t.items, t.w)); }
    table = sizeTable(lines.join("\n"));
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
          lines.push(h("b", { text: c.advice, style: { color: c.stOk && c.rowOk ? "var(--ok)" : "var(--warn)" } }));
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
      const needle = h("input", { type: "text", value: s.needle || "", placeholder: "바늘 (예: 4.5mm)", "aria-label": "바늘", style: "width:9em" });
      needle.oninput = () => (s.needle = needle.value);
      list.append(h("section", { class: "gauge-set" },
        h("div", { class: "actions", style: "align-items:center" }, label, needle,
          sets.length > 1 ? h("button", { class: "btn ghost", type: "button", text: "빼기", on: { click: () => { sets.splice(i, 1); render(); } } }) : null),
        ...(s.swatch ? [
          h("p", { class: "hint", style: "margin:0" }, `스와치를 ${s.swatch.st}코 × ${s.swatch.rows}단으로 뜨고, 다 뜬 스와치 전체의 너비·길이를 재요. 도안 크기: `, h("b", { text: `${s.swatch.w} × ${s.swatch.h} cm` }), ` (10cm에 ${s.pattern?.st ?? "?"}코 ${s.pattern?.rows ?? "?"}단)`),
          sizeRow("세탁 전", s.swatch, s.before, (g) => (s.before = g), refresh),
          sizeRow("세탁 후", s.swatch, s.after, (g) => (s.after = g), refresh),
        ] : [
          gaugeRow("도안 게이지", s.pattern, (g) => (s.pattern = g), refresh),
          gaugeRow("세탁 전", s.before, (g) => (s.before = g), refresh),
          gaugeRow("세탁 후", s.after, (g) => (s.after = g), refresh),
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
      return `${name}: 스와치 ${sw.st}코 ${sw.rows}단 → 도안 ${sw.w}×${sw.h}cm` + (m2 ? ` · 내 ${m2.w}×${m2.h}cm ${s.pattern && compare(s.pattern, mine!).stOk && compare(s.pattern, mine!).rowOk ? "✓ 맞음" : ""}` : " · 떠서 재 보세요");
    }
    if (s.pattern && mine) {
      const c = compare(s.pattern, mine);
      return `${name}: 도안 ${fmt(s.pattern)} · 내 ${fmt(mine)} ${c.stOk && c.rowOk ? "✓ 맞음" : `· 콧수 ${sign(c.stPct)}%`}`;
    }
    if (s.pattern) return `${name}: 도안 ${fmt(s.pattern)}${s.needle ? " · " + s.needle : ""}`;
    if (mine) return `${name}: 내 ${fmt(mine)}`;
    return "";
  }).filter(Boolean);
  if (!lines.length) return "게이지 적기 (도안 · 세탁 전 · 세탁 후)";
  return "게이지 — " + lines.join(" / ") + (p.gauges.some((s) => myGauge(s)) ? "" : " · 스와치를 재면 비교해 드려요");
}
