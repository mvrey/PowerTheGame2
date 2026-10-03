type Child = Node | string | null | undefined | false;

/** Tiny hyperscript helper: h('div.card', { onclick }, child, ...). */
export function h<K extends keyof HTMLElementTagNameMap>(
  spec: K | `${K}.${string}`,
  props?: Record<string, unknown> | null,
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const [tag, ...classes] = spec.split('.');
  const el = document.createElement(tag) as HTMLElementTagNameMap[K];
  if (classes.length) el.className = classes.join(' ');
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value as EventListener);
    else if (key === 'html') el.innerHTML = String(value);
    else if (key === 'class') el.className += ' ' + value;
    else if (key in el && key !== 'list') (el as unknown as Record<string, unknown>)[key] = value;
    else el.setAttribute(key, String(value));
  }
  for (const child of children.flat()) if (child) el.append(child);
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
  ...children: (SVGElement | string)[]
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  el.append(...children);
  return el;
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
