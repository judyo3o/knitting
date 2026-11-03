/** 게이지 입력 화면: 무늬별로 도안 · 세탁 전 · 세탁 후 */
import { compare, convertRows, convertSt, myGauge, rowsToCm, stToCm, washChange } from "./gauge";
import { commit } from "./store";
import { dialog, fmtShort, h } from "./ui";
import type { Gauge, GaugeSet, Pattern } from "./types";

const num = (v: string) => {
  const n = parseFloat(v.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export function openGauge(p: Pattern, onSaved: () => void) {
  const sets: GaugeSet[] = p.gauges.length ? p.gauges.map((s) => ({ ...s })) : [{ label: "메리야스", pattern: null, before: null, after: null }];
  const list = h("div", { style: "display:flex;flex-direction:column;gap:14px" });

  const gaugeRow = (label: string, g: Gauge | null, set: (g: Gauge | null) => void, onChange: () => void) => {
    const st = h("input", { type: "number", min: 0, step: "0.5", inputmode: "decimal", value: g ? String(g.st) : "", "aria-label": label + " 콧수", style: "width:5em" });
    const rows = h("input", { type: "number", min: 0, step: "0.5", inputmode: "decimal", value: g ? String(g.rows) : "", "aria-label": label + " 단수", style: "width:5em" });
    const upd = () => { const a = num(st.value), b = num(rows.value); set(a && b ? { st: a, rows: b } : null); onChange(); };
    st.oninput = upd; rows.oninput = upd;
    return h("div", { class: "gauge-row" }, h("span", { class: "gauge-lab", text: label }), st, h("span", { text: "코" }), rows, h("span", { text: "단" }));
  };

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
        gaugeRow("도안 게이지", s.pattern, (g) => (s.pattern = g), refresh),
        gaugeRow("세탁 전", s.before, (g) => (s.before = g), refresh),
        gaugeRow("세탁 후", s.after, (g) => (s.after = g), refresh),
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
