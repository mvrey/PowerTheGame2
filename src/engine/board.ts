// Board graph for Power, built from a map definition (see maps.ts).
//
// The module exposes the board of the map currently in play; `useMap` switches it.
// Importers see the new board through the live bindings below.

import { DEFAULT_MAP, MapDef, mapById } from './maps';

export type NodeKind = 'sector' | 'hq' | 'island' | 'sea';
export type MoveClass = 'inf' | 'tank' | 'air' | 'naval';

export interface BoardNode {
  idx: number;
  id: string;
  kind: NodeKind;
  /** Territory / HQ owner (army index), -1 for neutral nodes. */
  army: number;
  /** Sector number for sectors, -1 otherwise. */
  num: number;
  /** Sectors only: touches a sea lane, so ships may enter. */
  coastal: boolean;
  cells: [number, number][];
}

/** Armies in clockwise seat order. */
export const ARMY_LETTERS = ['G', 'B', 'Y', 'R'] as const;
export const ARMY_KEYS = ['green', 'blue', 'yellow', 'red'] as const;
export const NUM_ARMIES = 4;
export const RESERVE = -1;

const CLASSES: MoveClass[] = ['inf', 'tank', 'air', 'naval'];
const RANGE: Record<MoveClass, number> = { inf: 2, tank: 3, air: 5, naval: 1 };
type ByClass<T> = Record<MoveClass, T>;

interface Board {
  map: MapDef;
  nodes: BoardNode[];
  byId: Record<string, number>;
  /** grid[y][x] = node index, or -1 for an empty cell. */
  grid: number[][];
  hq: number[];
  territory: number[][];
  adj: number[][];
  reach: ByClass<number[][]>;
  reachSet: ByClass<Set<number>[]>;
  rounds: ByClass<number[][]>;
}

function parse(map: MapDef): { nodes: BoardNode[]; grid: number[][] } {
  const cellsOf = new Map<string, [number, number][]>();
  const tokens = map.rows.map((row) => row.trim().split(/\s+/));
  const width = tokens[0].length;
  tokens.forEach((row, y) => {
    if (row.length !== width) throw new Error(`Map ${map.id}: row ${y} has ${row.length} cells, expected ${width}`);
    row.forEach((token, x) => {
      if (token === '.') return;
      if (!cellsOf.has(token)) cellsOf.set(token, []);
      cellsOf.get(token)!.push([x, y]);
    });
  });

  const drafts: Omit<BoardNode, 'idx'>[] = [];
  for (const [id, cells] of cellsOf) {
    let match: RegExpMatchArray | null;
    if ((match = id.match(/^([GBYR])(\d+)$/))) {
      drafts.push({ id, kind: 'sector', army: ARMY_LETTERS.indexOf(match[1] as 'G'), num: Number(match[2]), coastal: false, cells });
    } else if ((match = id.match(/^HQ([GBYR])$/))) {
      drafts.push({ id, kind: 'hq', army: ARMY_LETTERS.indexOf(match[1] as 'G'), num: -1, coastal: false, cells });
    } else if (/^I\w+$/.test(id)) {
      drafts.push({ id, kind: 'island', army: -1, num: -1, coastal: false, cells });
    } else if (/^S\d+$/.test(id)) {
      drafts.push({ id, kind: 'sea', army: -1, num: Number(id.slice(1)), coastal: false, cells });
    } else {
      throw new Error(`Map ${map.id}: unknown cell "${id}"`);
    }
  }
  // Stable order: sectors by army and number, HQs by army, islands as written, sea lanes by number.
  const rank = { sector: 0, hq: 1, island: 2, sea: 3 };
  drafts.sort((a, b) => rank[a.kind] - rank[b.kind] || a.army - b.army || (a.kind === 'island' ? 0 : a.num - b.num));
  const nodes = drafts.map((d, idx): BoardNode => ({ ...d, idx, num: d.kind === 'sector' ? d.num : -1 }));
  for (let a = 0; a < NUM_ARMIES; a++) {
    if (!nodes.some((n) => n.kind === 'hq' && n.army === a) || !nodes.some((n) => n.kind === 'sector' && n.army === a))
      throw new Error(`Map ${map.id}: army ${ARMY_LETTERS[a]} needs an HQ and at least one sector`);
  }
  const grid = tokens.map((row) => row.map(() => -1));
  for (const n of nodes) for (const [x, y] of n.cells) grid[y][x] = n.idx;
  return { nodes, grid };
}

function build(map: MapDef): Board {
  const { nodes, grid } = parse(map);
  const links = nodes.map(() => new Set<number>());
  grid.forEach((row, y) => row.forEach((a, x) => {
    if (a < 0) return;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const b = grid[y + dy]?.[x + dx] ?? -1;
        if (b < 0 || b === a || (nodes[a].kind === 'sea' && nodes[b].kind === 'sea')) continue;
        links[a].add(b);
      }
    }
  }));
  const adj = links.map((set) => [...set].sort((a, b) => a - b));
  for (const n of nodes) n.coastal = n.kind === 'sector' && adj[n.idx].some((b) => nodes[b].kind === 'sea');

  const enter = (cls: MoveClass, node: number) => {
    const n = nodes[node];
    return cls === 'naval' ? n.kind !== 'sector' || n.coastal : n.kind !== 'sea';
  };
  const reachFrom = (cls: MoveClass, from: number): number[] => {
    const dist = new Map<number, number>([[from, 0]]);
    let frontier = [from];
    for (let d = 1; d <= RANGE[cls]; d++) {
      const next: number[] = [];
      for (const u of frontier) {
        // Ground units must stop when they enter an island or an HQ.
        const kind = nodes[u].kind;
        if (u !== from && (cls === 'inf' || cls === 'tank') && (kind === 'island' || kind === 'hq')) continue;
        for (const v of adj[u]) {
          if (dist.has(v) || !enter(cls, v)) continue;
          dist.set(v, d);
          next.push(v);
        }
      }
      frontier = next;
    }
    dist.delete(from);
    return [...dist.keys()].sort((a, b) => a - b);
  };
  const perClass = <T>(make: (cls: MoveClass) => T) =>
    Object.fromEntries(CLASSES.map((cls) => [cls, make(cls)])) as ByClass<T>;

  const reach = perClass((cls) => nodes.map((n) => (enter(cls, n.idx) ? reachFrom(cls, n.idx) : [])));
  const rounds = perClass((cls) => nodes.map((n) => {
    const d = new Array<number>(nodes.length).fill(Infinity);
    if (!enter(cls, n.idx)) return d;
    d[n.idx] = 0;
    let frontier = [n.idx];
    for (let r = 1; frontier.length; r++) {
      const next: number[] = [];
      for (const u of frontier)
        for (const v of reach[cls][u])
          if (d[v] === Infinity) {
            d[v] = r;
            next.push(v);
          }
      frontier = next;
    }
    return d;
  }));

  return {
    map,
    nodes,
    grid,
    byId: Object.fromEntries(nodes.map((n) => [n.id, n.idx])),
    hq: [0, 1, 2, 3].map((a) => nodes.find((n) => n.kind === 'hq' && n.army === a)!.idx),
    territory: [0, 1, 2, 3].map((a) => nodes.filter((n) => n.kind === 'sector' && n.army === a).map((n) => n.idx)),
    adj,
    reach,
    reachSet: perClass((cls) => reach[cls].map((list) => new Set(list))),
    rounds,
  };
}

const built = new Map<string, Board>();
let board: Board;

export let MAP: MapDef;
export let NODES: BoardNode[];
export let NUM_NODES: number;
export let NODE_BY_ID: Record<string, number>;
/** GRID[y][x] = node index, or -1 for an empty cell. */
export let GRID: number[][];
export let HQ: number[];
/** Sector node indices per territory. */
export let TERRITORY: number[][];
export let ADJ: number[][];
/** REACH[class][from] = nodes reachable in one move. Empty when the class cannot stand on `from`. */
export let REACH: ByClass<number[][]>;
/** ROUNDS[class][from][to] = rounds needed to get from `from` to `to` (Infinity if impossible). */
export let ROUNDS: ByClass<number[][]>;

/** Makes `id` the map in play. Boards are built once and cached. */
export function useMap(id: string | undefined): void {
  const map = mapById(id);
  if (board?.map === map) return;
  if (!built.has(map.id)) built.set(map.id, build(map));
  board = built.get(map.id)!;
  MAP = board.map;
  NODES = board.nodes;
  NUM_NODES = board.nodes.length;
  NODE_BY_ID = board.byId;
  GRID = board.grid;
  HQ = board.hq;
  TERRITORY = board.territory;
  ADJ = board.adj;
  REACH = board.reach;
  ROUNDS = board.rounds;
}

export function canEnter(cls: MoveClass, node: number): boolean {
  const n = NODES[node];
  return cls === 'naval' ? n.kind !== 'sector' || n.coastal : n.kind !== 'sea';
}

export function canReach(cls: MoveClass, from: number, to: number): boolean {
  return board.reachSet[cls][from].has(to);
}

useMap(DEFAULT_MAP);
