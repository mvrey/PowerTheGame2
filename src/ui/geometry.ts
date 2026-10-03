import { ARMY_IDS, Board, BoardNode, NodeKind } from '../api';

// Board drawing geometry, derived from the map grid. The longer side measures 1000 units.
// Islands and HQs ("hubs") bulge out of their cell into the neighbouring ones, which is
// what gives the classic board its octagonal territories.

export type Point = [number, number];

export interface NodeShape {
  /** SVG path of the space outline. */
  path: string;
  loops: Point[][];
  /** Where tokens are laid out, and the box available for them. */
  center: Point;
  box: [number, number];
  label: Point;
}

export interface Layout {
  width: number;
  height: number;
  shapes: NodeShape[];
  /** Outline of each army's territory. */
  territories: string[];
  /** Land mass of each territory, pulled back from the shore. */
  land: string[];
  /** Cells that are not part of the board. */
  voids: string;
  /** Short causeways joining islands that only touch at a corner. */
  bridges: string;
}

/** Board units of a row or column with sectors, and of one without (sea lanes, islands, HQs). */
const WIDE = 122,
  NARROW = 92;
/** How far a hub bulges into a neighbouring cell, and how far land keeps from the shore. */
const BULGE = 60,
  SHORE = 22;

/** The map grid in board units: where each cell is, and how hubs reshape their neighbours. */
class CellGrid {
  readonly rows: number;
  readonly cols: number;
  /** Board units per map unit: the longer side measures 1000. */
  readonly unit: number;
  /** Edges of the columns and rows, in board units. */
  readonly xs: number[];
  readonly ys: number[];
  private readonly bulge: number;

  constructor(private readonly board: Board) {
    const { grid, def } = board;
    this.rows = grid.length;
    this.cols = grid[0].length;
    const hasSector = (cells: number[]) => cells.some((n) => n >= 0 && board.nodes[n].kind === 'sector');
    const widths =
      def.cols ?? Array.from({ length: this.cols }, (_, x) => (hasSector(grid.map((row) => row[x])) ? WIDE : NARROW));
    const heights = def.heights ?? grid.map((row) => (hasSector(row) ? WIDE : NARROW));
    const sum = (list: number[]) => list.reduce((a, b) => a + b, 0);
    this.unit = 1000 / Math.max(sum(widths), sum(heights));
    const edges = (sizes: number[]) =>
      sizes.reduce((acc, size) => [...acc, acc[acc.length - 1] + size * this.unit], [0]);
    this.xs = edges(widths);
    this.ys = edges(heights);
    this.bulge = BULGE * this.unit;
  }

  get width(): number {
    return this.xs[this.cols];
  }

  get height(): number {
    return this.ys[this.rows];
  }

  kindAt(x: number, y: number): NodeKind | null {
    const node = this.board.grid[y]?.[x] ?? -1;
    return node < 0 ? null : this.board.nodes[node].kind;
  }

  /** Islands and HQs: they bulge into their neighbours. */
  isHub(x: number, y: number): boolean {
    const kind = this.kindAt(x, y);
    return kind === 'island' || kind === 'hq';
  }

  /** The four corners of a cell, without any reshaping. */
  rectangle(x: number, y: number): Point[] {
    const { xs, ys } = this;
    return [
      [xs[x], ys[y]],
      [xs[x + 1], ys[y]],
      [xs[x + 1], ys[y + 1]],
      [xs[x], ys[y + 1]],
    ];
  }

  /**
   * Polygon of one cell. `margin` pulls the sides that do not face another sector further in,
   * which is how the land mass is drawn inside its territory.
   */
  polygon(x: number, y: number, margin = 0): Point[] {
    return this.isHub(x, y) ? this.hubPolygon(x, y) : this.plainPolygon(x, y, margin);
  }

  /** How far the hub next to cell (x, y) in direction (dx, dy) pushes into it. */
  private push(x: number, y: number, dx: number, dy: number): number {
    if (this.kindAt(x, y) === null || this.isHub(x, y) || !this.isHub(x + dx, y + dy)) return 0;
    // A cell flanked by another hub is left alone: two hubs bulging into it would collide.
    const [px, py] = dx ? [0, 1] : [1, 0];
    if (this.isHub(x + px, y + py) || this.isHub(x - px, y - py)) return 0;
    const size = dx ? this.xs[x + 1] - this.xs[x] : this.ys[y + 1] - this.ys[y];
    const squeezed = this.isHub(x - dx, y - dy);
    return Math.min(this.bulge, size * (squeezed ? 0.3 : 0.5));
  }

  /** A hub: each side bulges by whatever this hub pushes into that neighbour. */
  private hubPolygon(x: number, y: number): Point[] {
    const [x0, x1, y0, y1] = [this.xs[x], this.xs[x + 1], this.ys[y], this.ys[y + 1]];
    const w = this.push(x - 1, y, 1, 0),
      e = this.push(x + 1, y, -1, 0);
    const n = this.push(x, y - 1, 0, 1),
      s = this.push(x, y + 1, 0, -1);
    const cuttable = (cx: number, cy: number) => this.kindAt(cx, cy) !== null && !this.isHub(cx, cy);
    const corner = (a: Point | null, b: Point | null, own: Point, diagonal: boolean): Point[] =>
      a && b ? (diagonal ? [a, b] : [a, own, b]) : a ? [a] : b ? [b] : [own];
    return [
      ...corner(w ? [x0 - w, y0] : null, n ? [x0, y0 - n] : null, [x0, y0], cuttable(x - 1, y - 1)),
      ...corner(n ? [x1, y0 - n] : null, e ? [x1 + e, y0] : null, [x1, y0], cuttable(x + 1, y - 1)),
      ...corner(e ? [x1 + e, y1] : null, s ? [x1, y1 + s] : null, [x1, y1], cuttable(x + 1, y + 1)),
      ...corner(s ? [x0, y1 + s] : null, w ? [x0 - w, y1] : null, [x0, y1], cuttable(x - 1, y + 1)),
    ];
  }

  /** Any other cell: pushed in by neighbouring hubs, with a corner cut off by a hub on a diagonal. */
  private plainPolygon(x: number, y: number, margin: number): Point[] {
    const open = (dx: number, dy: number) => (margin && this.kindAt(x + dx, y + dy) !== 'sector' ? margin : 0);
    const l = this.xs[x] + this.push(x, y, -1, 0) + open(-1, 0),
      r = this.xs[x + 1] - this.push(x, y, 1, 0) - open(1, 0);
    const t = this.ys[y] + this.push(x, y, 0, -1) + open(0, -1),
      b = this.ys[y + 1] - this.push(x, y, 0, 1) - open(0, 1);
    const cut = (dx: number, dy: number): [number, number] | null => {
      if (!this.isHub(x + dx, y + dy) || this.isHub(x + dx, y) || this.isHub(x, y + dy)) return null;
      const ex = this.push(x, y + dy, dx, 0),
        ey = this.push(x + dx, y, 0, dy);
      return ex && ey ? [ex + margin, ey + margin] : null;
    };
    const nw = cut(-1, -1),
      ne = cut(1, -1),
      se = cut(1, 1),
      sw = cut(-1, 1);
    return [
      ...(nw
        ? [
            [l, t + nw[1]],
            [l + nw[0], t],
          ]
        : [[l, t]]),
      ...(ne
        ? [
            [r - ne[0], t],
            [r, t + ne[1]],
          ]
        : [[r, t]]),
      ...(se
        ? [
            [r, b - se[1]],
            [r - se[0], b],
          ]
        : [[r, b]]),
      ...(sw
        ? [
            [l + sw[0], b],
            [l, b - sw[1]],
          ]
        : [[l, b]]),
    ] as Point[];
  }
}

function build(board: Board): Layout {
  const cells = new CellGrid(board);
  const sectorCells = (army: number) =>
    board.nodes.filter((n) => n.kind === 'sector' && n.army === army).flatMap((n) => n.cells);
  return {
    width: cells.width,
    height: cells.height,
    shapes: board.nodes.map((node) => nodeShape(cells, node)),
    territories: ARMY_IDS.map((a) => toPath(outline(sectorCells(a).map(([x, y]) => cells.polygon(x, y))))),
    land: ARMY_IDS.map((a) => toPath(sectorCells(a).map(([x, y]) => cells.polygon(x, y, SHORE * cells.unit)))),
    voids: voidPath(cells, board),
    bridges: bridgePath(cells),
  };
}

function nodeShape(cells: CellGrid, node: BoardNode): NodeShape {
  const polygons = node.cells.map(([x, y]) => cells.polygon(x, y));
  const loops = outline(polygons);
  const hub = node.kind === 'island' || node.kind === 'hq';
  let center: Point, box: [number, number];
  const straight =
    node.cells.every((c) => c[0] === node.cells[0][0]) || node.cells.every((c) => c[1] === node.cells[0][1]);
  if (node.cells.length > 1 && straight) {
    const [minX, maxX, minY, maxY] = bounds(polygons.flat());
    center = [(minX + maxX) / 2, (minY + maxY) / 2];
    box = [maxX - minX - 8, maxY - minY - 8];
  } else {
    // Irregular spaces keep their tokens on the middle cell.
    const poly = polygons[Math.floor(polygons.length / 2)];
    const [minX, maxX, minY, maxY] = bounds(poly);
    const fill = Math.sqrt(area(poly) / ((maxX - minX) * (maxY - minY)));
    const k = fill * (hub ? 0.72 : 0.95);
    center = centroid(poly);
    box = [(maxX - minX) * k, (maxY - minY) * k];
  }
  const { unit } = cells;
  const [fx, , fy] = bounds(polygons[0]);
  let label: Point = hub ? [center[0], fy + 18 * unit] : [fx + 14 * unit, fy + 19 * unit];
  if (!hub && !inside(label, polygons[0])) label = [fx + 36 * unit, fy + 40 * unit];
  return { path: toPath(loops), loops, center, box, label };
}

/** The cells that are not part of the board. */
function voidPath(cells: CellGrid, board: Board): string {
  const voids: Point[][] = [];
  board.grid.forEach((row, y) =>
    row.forEach((n, x) => {
      if (n < 0) voids.push(cells.rectangle(x, y));
    }),
  );
  return toPath(voids);
}

/** Hubs meeting at a corner are adjacent, but that is hard to see: a causeway marks it. */
function bridgePath(cells: CellGrid): string {
  const span = 15 * cells.unit;
  const bridges: Point[][] = [];
  for (let y = 0; y < cells.rows; y++) {
    for (let x = 0; x < cells.cols; x++) {
      if (!cells.isHub(x, y)) continue;
      for (const dx of [-1, 1]) {
        if (!cells.isHub(x + dx, y + 1)) continue;
        const cx = dx > 0 ? cells.xs[x + 1] : cells.xs[x],
          cy = cells.ys[y + 1];
        bridges.push([
          [cx - dx * span, cy - span],
          [cx + dx * span, cy + span],
        ]);
      }
    }
  }
  return bridges
    .map(([a, b]) => `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}`)
    .join('');
}

/** [minX, maxX, minY, maxY] */
function bounds(points: Point[]): [number, number, number, number] {
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1]);
  return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
}

function area(poly: Point[]): number {
  let twice = 0;
  poly.forEach(([x, y], i) => {
    const [nx, ny] = poly[(i + 1) % poly.length];
    twice += x * ny - nx * y;
  });
  return Math.abs(twice) / 2;
}

function centroid(poly: Point[]): Point {
  let twice = 0,
    cx = 0,
    cy = 0;
  poly.forEach(([x, y], i) => {
    const [nx, ny] = poly[(i + 1) % poly.length];
    const cross = x * ny - nx * y;
    twice += cross;
    cx += (x + nx) * cross;
    cy += (y + ny) * cross;
  });
  return [cx / (3 * twice), cy / (3 * twice)];
}

function inside([px, py]: Point, poly: Point[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i],
      [xj, yj] = poly[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

const key = (v: number) => Math.round(v * 100);

/** Outline of the union of polygons that only ever touch along axis-aligned edges. */
function outline(polygons: Point[][]): Point[][] {
  if (polygons.length === 1) return polygons;
  type Seg = [Point, Point];
  const kept: Seg[] = [];
  // Axis-aligned edges on the same line cancel wherever two polygons run in opposite directions.
  const lines = new Map<string, { a: number; b: number }[]>();
  for (const poly of polygons) {
    poly.forEach((p, i) => {
      const q = poly[(i + 1) % poly.length];
      const horizontal = key(p[1]) === key(q[1]),
        vertical = key(p[0]) === key(q[0]);
      if (!horizontal && !vertical) return void kept.push([p, q]);
      const id = horizontal ? 'h' + key(p[1]) : 'v' + key(p[0]);
      if (!lines.has(id)) lines.set(id, []);
      lines.get(id)!.push(horizontal ? { a: p[0], b: q[0] } : { a: p[1], b: q[1] });
    });
  }
  for (const [id, spans] of lines) {
    const fixed = Number(id.slice(1)) / 100;
    const stops = [...new Set(spans.flatMap((s) => [s.a, s.b]).map(key))].sort((a, b) => a - b).map((k) => k / 100);
    for (let i = 0; i + 1 < stops.length; i++) {
      const lo = stops[i],
        hi = stops[i + 1],
        mid = (lo + hi) / 2;
      let net = 0;
      for (const s of spans) if (mid > Math.min(s.a, s.b) && mid < Math.max(s.a, s.b)) net += s.b > s.a ? 1 : -1;
      if (!net) continue;
      const [from, to] = net > 0 ? [lo, hi] : [hi, lo];
      kept.push(
        id[0] === 'h'
          ? [
              [from, fixed],
              [to, fixed],
            ]
          : [
              [fixed, from],
              [fixed, to],
            ],
      );
    }
  }
  // Chain the surviving segments into closed loops.
  const at = (p: Point) => key(p[0]) + ',' + key(p[1]);
  const starts = new Map<string, Seg[]>();
  for (const seg of kept) {
    if (!starts.has(at(seg[0]))) starts.set(at(seg[0]), []);
    starts.get(at(seg[0]))!.push(seg);
  }
  const loops: Point[][] = [];
  for (const seg of kept) {
    if (!starts.get(at(seg[0]))!.includes(seg)) continue;
    const loop: Point[] = [];
    let current: Seg | undefined = seg;
    while (current) {
      const list: Seg[] = starts.get(at(current[0]))!;
      list.splice(list.indexOf(current), 1);
      loop.push(current[0]);
      current = starts.get(at(current[1]))?.[0];
    }
    loops.push(loop);
  }
  return loops;
}

function toPath(loops: Point[][]): string {
  return loops.map((loop) => 'M' + loop.map((p) => `${+p[0].toFixed(1)} ${+p[1].toFixed(1)}`).join('L') + 'Z').join('');
}

const cache = new Map<string, Layout>();

/** Drawing geometry of a board, built once per map. */
export function layout(board: Board): Layout {
  if (!cache.has(board.def.id)) cache.set(board.def.id, build(board));
  return cache.get(board.def.id)!;
}
