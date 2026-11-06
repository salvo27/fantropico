// Costruzione sicura del DOM: solo textContent e attributi espliciti, mai innerHTML con dati

const BLOCKED_ATTRS = /^(on|style$|srcdoc$|formaction$)/i;

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "on") for (const [event, handler] of Object.entries(value)) el.addEventListener(event, handler);
    else if (key === "dataset") Object.assign(el.dataset, value);
    else if (key === "value") el.value = value;
    else if (key === "href") el.setAttribute("href", safeHref(value));
    else if (BLOCKED_ATTRS.test(key)) throw new Error(`Attributo non consentito: ${key}`);
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

// Link interni con # o URL https già validati
function safeHref(value) {
  const text = String(value);
  if (text.startsWith("#")) return text;
  const url = new URL(text);
  if (url.protocol !== "https:") throw new Error("Link non sicuro");
  return url.href;
}

// Icone disegnate a mano, nessun testo dinamico dentro
const SVG_NS = "http://www.w3.org/2000/svg";

export function icon(name, size = 22) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const [shape, attrs] of ICONS[name]) {
    const node = document.createElementNS(SVG_NS, shape);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    svg.append(node);
  }
  return svg;
}

const ICONS = {
  menu: [
    ["line", { x1: "4", y1: "7", x2: "20", y2: "7" }],
    ["line", { x1: "4", y1: "12", x2: "20", y2: "12" }],
    ["line", { x1: "4", y1: "17", x2: "20", y2: "17" }],
  ],
  back: [["polyline", { points: "15 5 8 12 15 19" }]],
  send: [
    ["line", { x1: "5", y1: "12", x2: "19", y2: "12" }],
    ["polyline", { points: "13 6 19 12 13 18" }],
  ],
};

export function pitchLogo() {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", "30");
  svg.setAttribute("height", "30");
  svg.setAttribute("viewBox", "0 0 30 30");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "logo");
  const parts = [
    ["rect", { x: "2", y: "5", width: "26", height: "20", rx: "3" }],
    ["line", { x1: "15", y1: "5", x2: "15", y2: "25" }],
    ["circle", { cx: "15", cy: "15", r: "4" }],
  ];
  for (const [shape, attrs] of parts) {
    const node = document.createElementNS(SVG_NS, shape);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    svg.append(node);
  }
  return svg;
}

export function field({ id, label, hint, ...inputProps }) {
  const input = h("input", { id, class: "input", ...inputProps });
  return {
    input,
    el: h("div", { class: "field" }, h("label", { class: "field__label", for: id }, label), input, hint ? h("p", { class: "field__hint", id: `${id}-hint` }, hint) : null),
  };
}

export function errorBox() {
  const el = h("p", { class: "alert alert--error", role: "alert", hidden: true });
  return {
    el,
    show(message) {
      el.textContent = message;
      el.hidden = false;
    },
    clear() {
      el.textContent = "";
      el.hidden = true;
    },
  };
}

export const DISCLAIMER = "Fantropico non è affiliato ad Anthropic.";

export function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Rome" }).format(date);
}

export function formatNumber(value) {
  return new Intl.NumberFormat("it-IT").format(value);
}
