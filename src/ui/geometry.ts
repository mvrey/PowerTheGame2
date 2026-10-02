import { BoardNode, NODES } from '../engine/board';

// The board is drawn in a 1000x1000 box. Grid lines of the 9x9 cell model:
// a narrow outer band, three territory cells, the central channel, three cells, outer band.
const EDGE = [0, 92, 214, 336, 458, 542, 664, 786, 908, 1000];
/** How much of each territory corner is cut off to make room for islands and HQs. */
const CUT = 60;
export const BOARD_SIZE = 1000;

export type Point = [number, number];

export interface NodeShape {
  polygon: Point[];
  /** Where tokens are laid out. */
  center: Point;
  /** Box available for tokens around the centre. */
  box: [number, number];
  /** Where the label goes. */
  label: Point;
}

function rect(x0: number, y0: number, x1: number, y1: number): Point[] {
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

function sectorShape(node: BoardNode): NodeShape {
  const [gx, gy] = node.cells[0];
  const [x0, y0, x1, y1] = [EDGE[gx], EDGE[gy], EDGE[gx + 1], EDGE[gy + 1]];
  // Territory centre in grid cells: 2 or 6 on each axis.
  const tx = gx < 4 ? 2 : 6;
  const ty = gy < 4 ? 2 : 6;
  const corner = gx !== tx && gy !== ty;
  let polygon = rect(x0, y0, x1, y1);
  let center: Point = [(x0 + x1) / 2, (y0 + y1) / 2];
  const dx = Math.sign(gx - tx);
  const dy = Math.sign(gy - ty);
  if (corner) {
    // Replace the outer corner by the diagonal cut.
    const cx = dx > 0 ? x1 : x0;
    const cy = dy > 0 ? y1 : y0;
    polygon = polygon.flatMap((p): Point[] =>
      p[0] === cx && p[1] === cy ? orderCut([cx - dx * CUT, cy], [cx, cy - dy * CUT], dx, dy) : [p]);
    center = [center[0] - dx * 9, center[1] - dy * 9];
  }
  // Labels go in the top-left corner, moved inwards when that corner is the one cut off.
  const cutTopLeft = corner && dx < 0 && dy < 0;
  const label: Point = cutTopLeft ? [x0 + 34, y0 + 38] : [x0 + 13, y0 + 19];
  return { polygon, center, box: corner ? [104, 100] : [116, 112], label };
}

/** Keeps the polygon winding clockwise when a corner is replaced by two points. */
function orderCut(a: Point, b: Point, dx: number, dy: number): Point[] {
  return dx * dy > 0 ? [b, a] : [a, b];
}

function hqShape(node: BoardNode): NodeShape {
  const [gx, gy] = node.cells[0];
  const sx = gx === 0 ? 0 : BOARD_SIZE;
  const sy = gy === 0 ? 0 : BOARD_SIZE;
  const dx = gx === 0 ? 1 : -1;
  const dy = gy === 0 ? 1 : -1;
  const far = EDGE[1] + CUT;
  const near = EDGE[1];
  const polygon: Point[] = [
    [sx, sy], [sx + dx * far, sy], [sx + dx * far, sy + dy * near],
    [sx + dx * near, sy + dy * far], [sx, sy + dy * far],
  ];
  return {
    polygon,
    center: [sx + dx * 66, sy + dy * 74],
    box: [96, 104],
    label: [sx + dx * 66, sy + dy * 15 + 5],
  };
}

function rotate([x, y]: Point, times: number): Point {
  for (let i = 0; i < times; i++) [x, y] = [BOARD_SIZE - y, x];
  return [x, y];
}

function islandShape(node: BoardNode): NodeShape {
  const a = EDGE[4] - CUT, b = EDGE[4], c = EDGE[5], d = EDGE[5] + CUT;
  if (node.id === 'IX') {
    return {
      polygon: [[b, a], [c, a], [d, b], [d, c], [c, d], [b, d], [a, c], [a, b]],
      center: [500, 506],
      box: [150, 120],
      label: [500, 421],
    };
  }
  // The north island, rotated into place for the others.
  const turns = ['IN', 'IE', 'IS', 'IW'].indexOf(node.id);
  const north: Point[] = [[a, 0], [d, 0], [d, EDGE[1]], [c, EDGE[1] + CUT], [b, EDGE[1] + CUT], [a, EDGE[1]]];
  const vertical = turns % 2 === 1;
  return {
    polygon: north.map((p) => rotate(p, turns)),
    center: rotate([500, 78], turns),
    box: vertical ? [112, 150] : [170, 104],
    label: rotate([500, 17], turns),
  };
}

function seaShape(node: BoardNode): NodeShape {
  const xs = node.cells.map((c) => c[0]);
  const ys = node.cells.map((c) => c[1]);
  const vertical = xs[0] === xs[2];
  let x0 = EDGE[Math.min(...xs)], x1 = EDGE[Math.max(...xs) + 1];
  let y0 = EDGE[Math.min(...ys)], y1 = EDGE[Math.max(...ys) + 1];
  if (vertical) { y0 += CUT; y1 -= CUT; } else { x0 += CUT; x1 -= CUT; }
  const w = x1 - x0, h = y1 - y0;
  return {
    polygon: rect(x0, y0, x1, y1),
    center: [(x0 + x1) / 2, (y0 + y1) / 2],
    box: [w - 8, h - 8],
    label: vertical ? [(x0 + x1) / 2, y0 + 16] : [x0 + 20, (y0 + y1) / 2 + 5],
  };
}

export const SHAPES: NodeShape[] = NODES.map((node) =>
  node.kind === 'sector' ? sectorShape(node)
    : node.kind === 'hq' ? hqShape(node)
      : node.kind === 'island' ? islandShape(node)
        : seaShape(node));

/** Octagon outline of a territory (army index 0..3). */
export function territoryOutline(army: number): Point[] {
  const left = army === 0 || army === 3;
  const top = army === 0 || army === 1;
  const x0 = left ? EDGE[1] : EDGE[5], x1 = left ? EDGE[4] : EDGE[8];
  const y0 = top ? EDGE[1] : EDGE[5], y1 = top ? EDGE[4] : EDGE[8];
  return [
    [x0 + CUT, y0], [x1 - CUT, y0], [x1, y0 + CUT], [x1, y1 - CUT],
    [x1 - CUT, y1], [x0 + CUT, y1], [x0, y1 - CUT], [x0, y0 + CUT],
  ];
}

export const points = (polygon: Point[]) => polygon.map((p) => p.join(',')).join(' ');
