/** 작은 DOM 도우미 · 날짜 표시 · 토스트 */
type Attrs = Record<string, any> & { class?: string; text?: string; on?: Record<string, (e: any) => void> };
type Child = Node | string | null | undefined | false | 0;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k === "on") for (const [ev, fn] of Object.entries(v as Record<string, any>)) el.addEventListener(ev, fn);
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k === "value" || (k in el && typeof v !== "string")) (el as any)[k] = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of kids.flat()) if (c != null && c !== false && c !== 0) el.append(c);
  return el;
}
export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;

let toastT: number | undefined;
export function toast(msg: string, ms = 2600) {
  let el = document.getElementById("status");
  if (!el) {
    el = h("div", { id: "status", class: "status", role: "status" });
    document.body.append(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastT);
  toastT = window.setTimeout(() => el!.classList.remove("show"), ms);
}

const DAY = ["일", "월", "화", "수", "목", "금", "토"];
export function fmtTime(t: number) {
  const d = new Date(t);
  const hh = d.getHours(), mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh < 12 ? "오전" : "오후"} ${hh % 12 || 12}:${mm}`;
}
export const fmtDay = (t: number) => {
  const d = new Date(t);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${DAY[d.getDay()]})`;
};
export const fmtFull = (t: number) => `${fmtDay(t)} ${fmtTime(t)}`;
export const fmtShort = (t: number) => {
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
/** 오늘이면 시각만 */
export const fmtSmart = (t: number) => (new Date(t).toDateString() === new Date().toDateString() ? fmtTime(t) : fmtShort(t));

export function download(name: string, data: Blob) {
  const url = URL.createObjectURL(data);
  const a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** 모달 대화상자. close()로 닫는다 */
export function dialog(title: string, body: Node[], opts: { onClose?: () => void; label?: string } = {}) {
  const box = h("div", { class: "dlg-in", role: "dialog", "aria-modal": "true", "aria-label": opts.label || title }, h("h2", { text: title }), ...body);
  const wrap = h("div", { class: "dlg" }, box);
  const close = () => {
    wrap.remove();
    document.removeEventListener("keydown", onKey);
    opts.onClose?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) close();
  });
  document.addEventListener("keydown", onKey);
  document.body.append(wrap);
  (box.querySelector("button, input, textarea, select") as HTMLElement | null)?.focus();
  return { close, box };
}
