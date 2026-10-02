import { BoardNode, HQ, NODES, RESERVE } from '../engine/board';
import { PIECE_TYPES, PieceType, Snapshot } from '../engine/types';
import { svg } from './dom';
import { Layout, Point, layout } from './geometry';
import { ARMY_COLORS, isBig } from './icons';

export type Mark = 'dest' | 'target' | 'source';
export interface Arrow { from: number; to: number; army: number; kind: 'move' | 'launch' }

interface Handlers {
  click(node: number): void;
  hover(node: number | null, event?: MouseEvent): void;
  label(node: number): string;
}

// Terrain per army seat: grassland, snow, forest, desert.
const LAND = ['#86b85c', '#eef3f9', '#3c7a43', '#e2b257'];
const BASE = ['#5f8f43', '#b9c6d6', '#2d5c34', '#b98a3a'];
const TOKEN_W = 40, TOKEN_H = 30.6, GAP = 3;
/** Tokens are drawn in a 34x26 box and scaled up to TOKEN_W. */
const TOKEN_ZOOM = TOKEN_W / 34;

function inset(polygon: Point[], by: number): string {
  const cx = polygon.reduce((s, p) => s + p[0], 0) / polygon.length;
  const cy = polygon.reduce((s, p) => s + p[1], 0) / polygon.length;
  return polygon.map(([x, y]) => {
    const d = Math.hypot(x - cx, y - cy);
    return `${x - ((x - cx) / d) * by},${y - ((y - cy) / d) * by}`;
  }).join(' ');
}

let instances = 0;

/** Static terrain. `uid` keeps filter and clip ids apart when several boards share the page. */
function terrain(lay: Layout, nodes: BoardNode[], uid: string): string {
  const land = (id: string, seed: number, beach: string, erode: number) => `
    <filter id="${uid}${id}" x="-15%" y="-15%" width="130%" height="130%">
      ${erode ? `<feMorphology in="SourceGraphic" operator="erode" radius="${erode}" result="core"/>` : ''}
      <feTurbulence type="fractalNoise" baseFrequency="0.017" numOctaves="3" seed="${seed}" result="n"/>
      <feDisplacementMap in="${erode ? 'core' : 'SourceGraphic'}" in2="n" scale="36" xChannelSelector="R" yChannelSelector="G" result="shape"/>
      <feMorphology in="shape" operator="dilate" radius="5" result="fat"/>
      <feFlood flood-color="${beach}"/><feComposite in2="fat" operator="in" result="beach"/>
      <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="4" seed="${seed + 5}"/>
      <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1.5 -0.62"/>
      <feComposite in2="shape" operator="in" result="shade"/>
      <feMerge><feMergeNode in="beach"/><feMergeNode in="shape"/><feMergeNode in="shade"/></feMerge>
    </filter>`;
  let out = `<defs>
    <radialGradient id="${uid}sea" cx="50%" cy="50%" r="72%">
      <stop offset="0" stop-color="#3a8fdc"/><stop offset="1" stop-color="#143c74"/>
    </radialGradient>
    ${land('land0', 3, '#d9cf9a', 0)}${land('land1', 9, '#c9d6e6', 0)}${land('land2', 14, '#cdbf7a', 0)}${land('land3', 21, '#f1dfa6', 0)}
    ${land('isle', 30, '#e6d9a2', 24)}
    <marker id="${uid}head" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
      <path d="M0 0 10 5 0 10Z" fill="context-stroke"/>
    </marker>`;
  nodes.forEach((n) => {
    if (n.kind === 'island') out += `<clipPath id="${uid}clip${n.idx}"><path d="${lay.shapes[n.idx].path}"/></clipPath>`;
  });
  for (let a = 0; a < 4; a++) out += `<clipPath id="${uid}terr${a}"><path d="${lay.territories[a]}"/></clipPath>`;
  out += `</defs><rect width="${lay.width}" height="${lay.height}" fill="url(#${uid}sea)"/>
    <path d="${lay.voids}" fill="#070d18" opacity=".72"/>`;

  for (let a = 0; a < 4; a++) {
    out += `<path d="${lay.territories[a]}" fill="#7cc4f2" opacity=".5"/>
      <g clip-path="url(#${uid}terr${a})"><path d="${lay.land[a]}" fill="${LAND[a]}" filter="url(#${uid}land${a})"/></g>`;
  }
  nodes.forEach((n) => {
    const shape = lay.shapes[n.idx];
    if (n.kind === 'island') {
      out += `<path d="${shape.path}" fill="#7cc4f2" opacity=".5"/>
        <g clip-path="url(#${uid}clip${n.idx})"><path d="${shape.path}" fill="#9cba62" filter="url(#${uid}isle)"/></g>`;
    } else if (n.kind === 'hq') {
      out += `<path d="${shape.path}" fill="${BASE[n.army]}"/>
        <polygon points="${inset(shape.loops[0], 9)}" fill="none" stroke="rgba(0,0,0,.28)" stroke-width="2" stroke-dasharray="7 5"/>`;
    }
  });
  if (lay.bridges) {
    out += `<path d="${lay.bridges}" stroke="#e6d9a2" stroke-width="15" stroke-linecap="round"/>
      <path d="${lay.bridges}" stroke="#9cba62" stroke-width="7" stroke-linecap="round"/>`;
  }
  return out;
}

export class BoardView {
  readonly root: SVGSVGElement;
  /** Geometry and spaces of the map this board was created for. */
  private lay: Layout = layout();
  private nodes: BoardNode[] = NODES;
  private hq: number[] = HQ;
  private uid = `b${instances++}-`;
  private nodeEls: SVGPathElement[] = [];
  private tokens = svg('g', { class: 'tokens' });
  private arrows = svg('g', { class: 'arrows' });
  private flags = svg('g', { class: 'flags' });
  private fx = svg('g', { class: 'fx' });

  constructor(private handlers: Handlers) {
    const { lay, nodes } = this;
    this.root = svg('svg', { viewBox: `0 0 ${lay.width} ${lay.height}`, class: 'board' });
    this.root.innerHTML = terrain(lay, nodes, this.uid);

    const grid = svg('g', { class: 'grid' });
    const labels = svg('g', { class: 'labels' });
    nodes.forEach((node, i) => {
      const shape = lay.shapes[i];
      const el = svg('path', { d: shape.path, class: 'node ' + node.kind });
      el.addEventListener('click', () => handlers.click(i));
      el.addEventListener('mousemove', (e) => handlers.hover(i, e));
      el.addEventListener('mouseleave', () => handlers.hover(null));
      this.nodeEls.push(el);
      grid.append(el);
      const text = svg('text', { x: shape.label[0], y: shape.label[1], class: 'lbl ' + node.kind }, handlers.label(i));
      if (node.kind === 'sector' || node.kind === 'hq') text.style.fill = node.kind === 'hq' ? '#fff' : ARMY_COLORS[node.army].fill;
      labels.append(text);
    });
    const borders = svg('g', { class: 'borders' });
    for (let a = 0; a < 4; a++)
      borders.append(svg('path', { d: lay.territories[a], fill: 'none', stroke: ARMY_COLORS[a].fill, 'stroke-width': 5, 'stroke-linejoin': 'round' }));
    this.root.append(borders, grid, labels, this.flags, this.arrows, this.tokens, this.fx);
  }

  /** Width / height of the board. */
  get ratio(): number {
    return this.lay.width / this.lay.height;
  }

  relabel(): void {
    this.root.querySelectorAll<SVGTextElement>('.labels text').forEach((el, i) => (el.textContent = this.handlers.label(i)));
  }

  render(view: Snapshot): void {
    const groups: Map<string, { army: number; type: PieceType; count: number }>[] = this.nodes.map(() => new Map());
    for (const p of view.pieces) {
      if (p.loc === RESERVE) continue;
      const key = p.army + p.type;
      const g = groups[p.loc].get(key);
      if (g) g.count++;
      else groups[p.loc].set(key, { army: p.army, type: p.type, count: 1 });
    }
    this.tokens.replaceChildren();
    groups.forEach((map, node) => {
      if (!map.size) return;
      const list = [...map.values()].sort(
        (a, b) => a.army - b.army || PIECE_TYPES.indexOf(b.type) - PIECE_TYPES.indexOf(a.type));
      this.layout(node, list);
    });

    this.flags.replaceChildren();
    view.flags.forEach((held, army) => {
      if (!view.alive[army]) return;
      const shape = this.lay.shapes[this.hq[army]];
      const [lx, ly] = shape.label;
      const side = lx < this.lay.width / 2 ? 1 : -1;
      held.forEach((flag, i) => {
        const x = lx + side * (34 + i * 17) - 9;
        const use = svg('use', { href: '#ic-FLAG', x, y: ly - 15, width: 26, height: 18 });
        use.style.fill = ARMY_COLORS[flag].fill;
        use.style.stroke = '#111';
        use.style.strokeWidth = '0.8';
        this.flags.append(use);
      });
    });
    this.nodeEls.forEach((el, i) => {
      const n = this.nodes[i];
      el.classList.toggle('fallen', (n.kind === 'hq' || n.kind === 'sector') && !view.alive[n.army]);
    });
  }

  private layout(node: number, list: { army: number; type: PieceType; count: number }[]): void {
    const { center, box } = this.lay.shapes[node];
    let scale = 1, cols = 1, rows = 1;
    for (; scale > 0.45; scale -= 0.05) {
      cols = Math.max(1, Math.floor((box[0] + GAP) / ((TOKEN_W + GAP) * scale)));
      rows = Math.ceil(list.length / cols);
      if (rows * (TOKEN_H + GAP) * scale <= box[1] + GAP) break;
    }
    cols = Math.min(cols, list.length);
    rows = Math.ceil(list.length / cols);
    const stepX = (TOKEN_W + GAP) * scale, stepY = (TOKEN_H + GAP) * scale;
    list.forEach((item, i) => {
      const row = Math.floor(i / cols);
      const inRow = row === rows - 1 ? list.length - row * cols : cols;
      const x = center[0] - (inRow * stepX - GAP * scale) / 2 + (i % cols) * stepX;
      const y = center[1] - (rows * stepY - GAP * scale) / 2 + row * stepY;
      this.tokens.append(token(item.type, item.army, item.count, x, y, scale * TOKEN_ZOOM));
    });
  }

  setMarks(marks: Map<number, Mark>): void {
    this.nodeEls.forEach((el, i) => {
      el.classList.remove('mark-dest', 'mark-target', 'mark-source');
      const mark = marks.get(i);
      if (mark) el.classList.add('mark-' + mark);
    });
  }

  setArrows(list: Arrow[]): void {
    this.arrows.replaceChildren();
    for (const a of list) {
      const from = this.lay.shapes[a.from].center, to = this.lay.shapes[a.to].center;
      const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
      if (len < 1) continue;
      const ux = (to[0] - from[0]) / len, uy = (to[1] - from[1]) / len;
      const trim = Math.min(26, len / 3);
      const attrs = {
        x1: from[0] + ux * trim, y1: from[1] + uy * trim, x2: to[0] - ux * trim, y2: to[1] - uy * trim,
      };
      this.arrows.append(svg('line', { ...attrs, class: 'arrow-back' }));
      const line = svg('line', { ...attrs, class: 'arrow ' + a.kind, 'marker-end': `url(#${this.uid}head)` });
      line.style.stroke = a.kind === 'launch' ? '#ff5252' : ARMY_COLORS[a.army].fill;
      this.arrows.append(line);
    }
  }

  /** Screen position of a node centre, for effects drawn outside the SVG. */
  clientPoint(node: number): { x: number; y: number } {
    const r = this.root.getBoundingClientRect();
    const [x, y] = this.lay.shapes[node].center;
    return { x: r.left + (x * r.width) / this.lay.width, y: r.top + (y * r.height) / this.lay.height };
  }

  /** Pixels per board unit. */
  get scale(): number {
    return this.root.getBoundingClientRect().width / this.lay.width;
  }

  effect(node: number, kind: 'battle' | 'boom' | 'bounce' | 'trade', ms = 700): void {
    const [x, y] = this.lay.shapes[node].center;
    const g = svg('g', { class: 'fx-' + kind, transform: `translate(${x} ${y})` });
    g.style.setProperty('--ms', ms + 'ms');
    if (kind === 'boom') {
      g.append(svg('circle', { r: 70, class: 'flash' }), svg('circle', { r: 46, class: 'ring' }), svg('circle', { r: 30, class: 'core' }));
    } else if (kind === 'battle') {
      const star = Array.from({ length: 16 }, (_, i) => {
        const r = i % 2 ? 18 : 42;
        const t = (i * Math.PI) / 8;
        return [Math.cos(t) * r, Math.sin(t) * r].join(',');
      }).join(' ');
      g.append(svg('polygon', { points: star, class: 'star' }));
    } else {
      g.append(svg('circle', { r: 34, class: 'ring' }));
    }
    this.fx.append(g);
    setTimeout(() => g.remove(), ms);
  }

  floatText(node: number, text: string, color = '#fff', ms = 1100): void {
    const [x, y] = this.lay.shapes[node].center;
    const el = svg('text', { x, y: y - 24, class: 'float' }, text);
    el.style.fill = color;
    el.style.setProperty('--ms', ms + 'ms');
    this.fx.append(el);
    setTimeout(() => el.remove(), ms);
  }
}

function token(type: PieceType, army: number, count: number, x: number, y: number, scale: number): SVGGElement {
  const c = ARMY_COLORS[army];
  const g = svg('g', { class: 'tok', transform: `translate(${x} ${y}) scale(${scale})` });
  const big = isBig(type);
  g.append(svg('rect', {
    width: 34, height: 26, rx: 6, fill: c.fill,
    stroke: big ? '#ffe066' : c.dark, 'stroke-width': big ? 2.4 : 1.4,
  }));
  const use = svg('use', { href: '#ic-' + type, x: 3, y: 2.4, width: 28, height: 19.25 });
  use.style.fill = c.ink;
  g.append(use);
  if (count > 1) {
    g.append(svg('circle', { cx: 31, cy: 3, r: 7.5, class: 'badge' }));
    g.append(svg('text', { x: 31, y: 6.6, class: 'badge-n' }, String(count)));
  }
  return g;
}
