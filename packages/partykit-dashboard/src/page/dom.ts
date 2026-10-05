// A tiny DOM builder. Strings always become text nodes: data is never parsed as HTML.

export type Child = Node | string | number | null | undefined | false | Child[];
type Attrs = Record<string, unknown> | null;

function append(parent: Node, children: Child[]) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(parent, child);
    else parent.appendChild(typeof child === "string" || typeof child === "number" ? document.createTextNode(String(child)) : child);
  }
}

function applyAttrs(el: Element, attrs: Attrs) {
  if (!attrs) return;
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2), value as EventListener);
    } else if (key === "style" && typeof value === "object") {
      Object.assign((el as HTMLElement).style, value);
    } else if (value === true) {
      el.setAttribute(key, "");
    } else {
      el.setAttribute(key, String(value));
    }
  }
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  applyAttrs(el, attrs ?? null);
  append(el, children);
  return el;
}

export function svg(tag: string, attrs?: Attrs, ...children: Child[]): SVGElement {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  applyAttrs(el, attrs ?? null);
  append(el, children);
  return el;
}

export function replace(container: Element, ...children: Child[]) {
  container.replaceChildren();
  append(container, children);
}
