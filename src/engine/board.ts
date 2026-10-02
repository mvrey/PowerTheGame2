// Board graph for Power. The board is modelled on a 9x9 grid of cells:
// HQs on the four corners, islands on the edge midpoints and the centre,
// sea lanes as 1x3 strips and four 3x3 territories.

export type NodeKind = 'sector' | 'hq' | 'island' | 'sea';
export type MoveClass = 'inf' | 'tank' | 'air' | 'naval';

export interface BoardNode {
  idx: number;
  id: string;
  kind: NodeKind;
  /** Territory / HQ owner (army index), -1 for neutral nodes. */
  army: number;
  /** Sector number 0..8 for sectors, -1 otherwise. */
  num: number;
  cells: [number, number][];
}

/** Armies in clockwise seat order. */
export const ARMY_LETTERS = ['G', 'B', 'Y', 'R'] as const;
export const ARMY_KEYS = ['green', 'blue', 'yellow', 'red'] as const;
export const NUM_ARMIES = 4;
export const RESERVE = -1;

// Sector numbers of the yellow (south-east) territory, [row][col].
const CANON = [
  [0, 2, 5],
  [1, 4, 7],
  [3, 6, 8],
];
// Clockwise quarter turns needed to map the yellow territory onto each army's.
const ROTATIONS = [2, 3, 0, 1];

function rotate(x: number, y: number, times: number): [number, number] {
  for (let i = 0; i < times; i++) [x, y] = [8 - y, x];
  return [x, y];
}

const HQ_CELLS: [number, number][] = [[0, 0], [8, 0], [8, 8], [0, 8]];
const ISLANDS: [string, number, number][] = [
  ['IN', 4, 0], ['IE', 8, 4], ['IS', 4, 8], ['IW', 0, 4], ['IX', 4, 4],
];
// Sea lanes: [fixed axis, fixed value, range start]
const LANES: ['x' | 'y', number, number][] = [
  ['x', 4, 1], ['y', 4, 5], ['x', 4, 5], ['y', 4, 1], // S1..S4 inner
  ['x', 0, 1], ['y', 0, 1], ['y', 0, 5], ['x', 8, 1], // S5..S8
  ['x', 8, 5], ['y', 8, 5], ['y', 8, 1], ['x', 0, 5], // S9..S12
];

function build(): BoardNode[] {
  const nodes: BoardNode[] = [];
  const add = (id: string, kind: NodeKind, army: number, num: number, cells: [number, number][]) =>
    nodes.push({ idx: nodes.length, id, kind, army, num, cells });
  for (let a = 0; a < NUM_ARMIES; a++) {
    const byNum: [number, number][] = [];
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++) byNum[CANON[r][c]] = rotate(5 + c, 5 + r, ROTATIONS[a]);
    for (let n = 0; n < 9; n++) add(ARMY_LETTERS[a] + n, 'sector', a, n, [byNum[n]]);
  }
  for (let a = 0; a < NUM_ARMIES; a++) add('HQ' + ARMY_LETTERS[a], 'hq', a, -1, [HQ_CELLS[a]]);
  for (const [id, x, y] of ISLANDS) add(id, 'island', -1, -1, [[x, y]]);
  LANES.forEach(([axis, v, s], i) => {
    const cells: [number, number][] = [0, 1, 2].map((k) => (axis === 'x' ? [v, s + k] : [s + k, v]));
    add('S' + (i + 1), 'sea', -1, -1, cells);
  });
  return nodes;
}

export const NODES: BoardNode[] = build();
export const NUM_NODES = NODES.length;
export const NODE_BY_ID: Record<string, number> = Object.fromEntries(NODES.map((n) => [n.id, n.idx]));
export const HQ: number[] = [0, 1, 2, 3].map((a) => NODE_BY_ID['HQ' + ARMY_LETTERS[a]]);
/** Sector node indices per territory. */
export const TERRITORY: number[][] = [0, 1, 2, 3].map((a) =>
  NODES.filter((n) => n.kind === 'sector' && n.army === a).map((n) => n.idx),
);

function touching(a: BoardNode, b: BoardNode): boolean {
  for (const [ax, ay] of a.cells)
    for (const [bx, by] of b.cells) if (Math.abs(ax - bx) <= 1 && Math.abs(ay - by) <= 1) return true;
  return false;
}

export const ADJ: number[][] = NODES.map((a) =>
  NODES.filter((b) => b.idx !== a.idx && !(a.kind === 'sea' && b.kind === 'sea') && touching(a, b)).map((b) => b.idx),
);

export function canEnter(cls: MoveClass, node: number): boolean {
  const n = NODES[node];
  if (cls === 'naval') return !(n.kind === 'sector' && n.num === 4);
  return n.kind !== 'sea';
}

const RANGE: Record<MoveClass, number> = { inf: 2, tank: 3, air: 5, naval: 1 };

function computeReach(cls: MoveClass, from: number): number[] {
  const range = RANGE[cls];
  const dist = new Map<number, number>([[from, 0]]);
  let frontier = [from];
  for (let d = 1; d <= range; d++) {
    const next: number[] = [];
    for (const u of frontier) {
      // Ground units must stop when they enter an island or an HQ.
      const kind = NODES[u].kind;
      if (u !== from && (cls === 'inf' || cls === 'tank') && (kind === 'island' || kind === 'hq')) continue;
      for (const v of ADJ[u]) {
        if (dist.has(v) || !canEnter(cls, v)) continue;
        dist.set(v, d);
        next.push(v);
      }
    }
    frontier = next;
  }
  dist.delete(from);
  return [...dist.keys()].sort((a, b) => a - b);
}

const CLASSES: MoveClass[] = ['inf', 'tank', 'air', 'naval'];
/** REACH[class][from] = nodes reachable in one move. Empty when the class cannot stand on `from`. */
export const REACH: Record<MoveClass, number[][]> = Object.fromEntries(
  CLASSES.map((cls) => [cls, NODES.map((n) => (canEnter(cls, n.idx) ? computeReach(cls, n.idx) : []))]),
) as Record<MoveClass, number[][]>;

const REACH_SET: Record<MoveClass, Set<number>[]> = Object.fromEntries(
  CLASSES.map((cls) => [cls, REACH[cls].map((list) => new Set(list))]),
) as Record<MoveClass, Set<number>[]>;

export function canReach(cls: MoveClass, from: number, to: number): boolean {
  return REACH_SET[cls][from].has(to);
}

/** ROUNDS[class][from][to] = rounds needed to get from `from` to `to` (Infinity if impossible). */
export const ROUNDS: Record<MoveClass, number[][]> = Object.fromEntries(
  CLASSES.map((cls) => [
    cls,
    NODES.map((n) => {
      const d = new Array<number>(NUM_NODES).fill(Infinity);
      if (!canEnter(cls, n.idx)) return d;
      d[n.idx] = 0;
      let frontier = [n.idx];
      for (let r = 1; frontier.length; r++) {
        const next: number[] = [];
        for (const u of frontier)
          for (const v of REACH[cls][u])
            if (d[v] === Infinity) {
              d[v] = r;
              next.push(v);
            }
        frontier = next;
      }
      return d;
    }),
  ]),
) as Record<MoveClass, number[][]>;
