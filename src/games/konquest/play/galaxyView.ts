import { svg } from '../../../platform/web/dom';
import { Fleet, FleetOrder, NEUTRAL, Planet, PublicState, TurnEvent, travelTime } from '../api';
import { colorOf } from './colors';
import type { Display } from './settings';

/** Size of a sector, in SVG units. */
const S = 40;
const PLANET_R = 13;

/** Who is looking: a seat, everyone (a spectator) or no one in particular (hot seat between players). */
export const SPECTATOR = -1;
export const NOBODY = -2;

export interface Viewpoint {
  viewer: number;
  display: Display;
}

export const FULL_VIEW: Display = { blindMap: false, neutralShips: true, neutralStats: true };

/** Whether `viewer` may see a planet's ships, as KDE's options say. */
export function seesShips(p: Pick<Planet, 'owner'>, { viewer, display }: Viewpoint): boolean {
  if (viewer === SPECTATOR || p.owner === viewer) return true;
  if (p.owner === NEUTRAL) return display.neutralShips && !display.blindMap;
  return !display.blindMap;
}

/** Whether `viewer` may see a planet's production and kill percentage. */
export function seesStats(p: Pick<Planet, 'owner'>, { viewer, display }: Viewpoint): boolean {
  if (viewer === SPECTATOR || p.owner === viewer) return true;
  return p.owner === NEUTRAL ? display.neutralStats : !display.blindMap;
}

export const seesFleet = (f: Pick<Fleet, 'owner'>, { viewer, display }: Viewpoint): boolean =>
  viewer === SPECTATOR || f.owner === viewer || !display.blindMap;

/** How far along its way a fleet is while turn `turn` is planned (0 at launch, 1 on arrival). */
const progress = (f: Fleet, turn: number) => Math.min(1, (turn - f.launched) / (f.arrival - f.launched + 1));

const centre = (p: Pick<Planet, 'x' | 'y'>) => ({ cx: (p.x + 0.5) * S, cy: (p.y + 0.5) * S });

export interface Marks {
  selected?: number | null;
  hovered?: number | null;
  /** Orders being written, drawn as arrows. */
  orders?: readonly FleetOrder[];
  /** Standing orders, drawn fainter. */
  standing?: readonly FleetOrder[];
}

export interface GalaxyHandlers {
  click?(planet: number | null): void;
  hover?(planet: number | null, event: PointerEvent | null): void;
}

/** The galaxy grid, its planets and its fleets, as an SVG that scales to its box. */
export class GalaxyView {
  readonly root: HTMLElement;
  private readonly svgEl: SVGSVGElement;
  private readonly grid = svg('g', { class: 'kq-grid' });
  private readonly routes = svg('g', { class: 'kq-routes' });
  private readonly planetsLayer = svg('g', { class: 'kq-planets' });
  private readonly fleetsLayer = svg('g', { class: 'kq-fleets' });
  private readonly effects = svg('g', { class: 'kq-effects' });
  private size = { width: 0, height: 0 };
  private state: PublicState | null = null;
  private point: Viewpoint = { viewer: SPECTATOR, display: FULL_VIEW };
  private marks: Marks = {};

  constructor(private readonly handlers: GalaxyHandlers = {}) {
    const defs = svg('defs');
    for (let look = 0; look < 10; look++) {
      // Ten planet looks, as KDE has ten planet pictures.
      const hue = (look * 37) % 360;
      defs.append(
        svg(
          'radialGradient',
          { id: `kq-look-${look}`, cx: '35%', cy: '30%', r: '75%' },
          svg('stop', { offset: '0%', 'stop-color': `hsl(${hue} 70% 82%)` }),
          svg('stop', { offset: '55%', 'stop-color': `hsl(${hue} 45% 45%)` }),
          svg('stop', { offset: '100%', 'stop-color': `hsl(${hue} 50% 12%)` }),
        ),
      );
    }
    this.svgEl = svg(
      'svg',
      { class: 'kq-svg', preserveAspectRatio: 'xMidYMid meet' },
      defs,
      this.grid,
      this.routes,
      this.planetsLayer,
      this.fleetsLayer,
      this.effects,
    );
    this.root = document.createElement('div');
    this.root.className = 'kq-galaxy';
    this.root.append(this.svgEl);
    this.svgEl.addEventListener('click', (e) => {
      if (e.target === this.svgEl || (e.target as Element).closest('.kq-grid')) this.handlers.click?.(null);
    });
  }

  /** Draws a position. */
  render(state: PublicState, point: Viewpoint = this.point, marks: Marks = {}): void {
    this.state = state;
    this.point = point;
    this.marks = marks;
    if (state.width !== this.size.width || state.height !== this.size.height) this.drawGrid(state);
    this.drawRoutes();
    this.drawPlanets(state.planets);
    this.drawFleets(
      state,
      state.fleets.map((f) => ({ fleet: f, at: progress(f, state.turn) })),
    );
    this.effects.replaceChildren();
  }

  /** Redraws the marks only (selection, hover, orders being written). */
  mark(marks: Marks): void {
    if (!this.state) return;
    this.marks = marks;
    this.drawRoutes();
    this.drawPlanets(this.state.planets);
  }

  /**
   * Animates a turn: the fleets fly (the new ones from their planets), the arrivals land with a
   * flash, then the position after the turn is drawn. `skipping` cuts it short.
   */
  async animate(
    before: PublicState,
    events: readonly TurnEvent[],
    after: PublicState,
    ms: number,
    skipping: () => boolean,
  ): Promise<void> {
    if (ms <= 0 || skipping()) return this.render(after, this.point, {});
    this.render(before, this.point, {});
    const launched = events.flatMap((e) => (e.kind === 'launch' ? [e.fleet] : []));
    const flying = [...before.fleets, ...launched];
    const from = (f: Fleet) => (f.launched === before.turn ? 0 : progress(f, before.turn));
    const to = (f: Fleet) => progress(f, before.turn + 1);
    // The new fleets leave their planets at once.
    const shown = before.planets.map((p) => ({ ...p }));
    for (const f of launched) shown[f.from].ships -= f.ships;
    this.drawPlanets(shown);

    const fly = ms * 0.65;
    const start = performance.now();
    await new Promise<void>((resolve) => {
      const frame = (now: number) => {
        const k = Math.min(1, (now - start) / fly);
        if (skipping()) return resolve();
        const eased = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
        this.drawFleets(
          before,
          flying.map((f) => ({ fleet: f, at: from(f) + (to(f) - from(f)) * eased })),
        );
        if (k < 1) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
    if (skipping()) return this.render(after, this.point, {});

    // Landings: a flash of the attacker's colour where a fleet arrives, a ring where a planet changes hands.
    this.drawFleets(
      after,
      after.fleets.map((f) => ({ fleet: f, at: progress(f, after.turn) })),
    );
    for (const e of events) {
      if (e.kind !== 'battle' && e.kind !== 'reinforce') continue;
      const planet = before.planets[e.planet];
      const owner = e.kind === 'battle' ? e.attacker : e.owner;
      if (!seesFleet({ owner }, this.point) && !seesShips(planet, this.point)) continue;
      const { cx, cy } = centre(planet);
      const burst = svg('circle', {
        cx,
        cy,
        r: PLANET_R,
        class: `kq-burst ${e.kind === 'battle' ? (e.conquered ? 'conquered' : 'held') : 'reinforce'}`,
        style: `--c:${colorOf(owner)}`,
      });
      this.effects.append(burst);
    }
    this.drawPlanets(after.planets);
    await new Promise((resolve) => setTimeout(resolve, skipping() ? 0 : ms * 0.35));
    this.render(after, this.point, {});
  }

  private drawGrid(state: PublicState): void {
    this.size = { width: state.width, height: state.height };
    this.svgEl.setAttribute('viewBox', `0 0 ${state.width * S} ${state.height * S}`);
    this.root.style.setProperty('--ratio', String(state.width / state.height));
    const lines: SVGElement[] = [svg('rect', { x: 0, y: 0, width: state.width * S, height: state.height * S })];
    for (let x = 1; x < state.width; x++)
      lines.push(svg('line', { x1: x * S, y1: 0, x2: x * S, y2: state.height * S }));
    for (let y = 1; y < state.height; y++)
      lines.push(svg('line', { x1: 0, y1: y * S, x2: state.width * S, y2: y * S }));
    this.grid.replaceChildren(...lines);
  }

  private drawRoutes(): void {
    const { planets } = this.state!;
    const arrow = (o: FleetOrder, cls: string) => {
      const a = centre(planets[o.from]);
      const b = centre(planets[o.to]);
      return svg(
        'g',
        { class: cls },
        svg('line', { x1: a.cx, y1: a.cy, x2: b.cx, y2: b.cy }),
        svg('text', { x: (a.cx + b.cx) / 2, y: (a.cy + b.cy) / 2 - 4 }, String(o.ships)),
      );
    };
    this.routes.replaceChildren(
      ...(this.marks.standing ?? []).map((o) => arrow(o, 'kq-route standing')),
      ...(this.marks.orders ?? []).map((o) => arrow(o, 'kq-route')),
    );
  }

  private drawPlanets(planets: readonly Planet[]): void {
    const { selected, hovered } = this.marks;
    this.planetsLayer.replaceChildren(
      ...planets.map((p) => {
        const { cx, cy } = centre(p);
        const known = seesShips(p, this.point);
        const g = svg(
          'g',
          {
            class: `kq-planet${p.id === selected ? ' selected' : ''}${p.id === hovered ? ' hovered' : ''}`,
            'data-id': p.id,
            style: `--c:${colorOf(p.owner)}`,
          },
          svg('rect', { class: 'kq-hit', x: p.x * S, y: p.y * S, width: S, height: S }),
          svg('circle', { class: 'kq-ring', cx, cy, r: PLANET_R + 3 }),
          svg('circle', { class: 'kq-body', cx, cy, r: PLANET_R, fill: `url(#kq-look-${p.id % 10})` }),
          svg('text', { class: 'kq-name', x: p.x * S + 3, y: p.y * S + 11 }, p.name),
          svg('text', { class: 'kq-ships', x: cx, y: p.y * S + S - 2 }, known ? String(p.ships) : '?'),
        );
        g.addEventListener('click', (e) => {
          e.stopPropagation();
          this.handlers.click?.(p.id);
        });
        g.addEventListener('pointerenter', (e) => this.handlers.hover?.(p.id, e));
        g.addEventListener('pointermove', (e) => this.handlers.hover?.(p.id, e));
        g.addEventListener('pointerleave', () => this.handlers.hover?.(null, null));
        return g;
      }),
    );
  }

  private drawFleets(state: PublicState, fleets: { fleet: Fleet; at: number }[]): void {
    const { planets } = state;
    this.fleetsLayer.replaceChildren(
      ...fleets
        .filter(({ fleet, at }) => at < 1 && seesFleet(fleet, this.point))
        .map(({ fleet, at }) => {
          const a = centre(planets[fleet.from]);
          const b = centre(planets[fleet.to]);
          const x = a.cx + (b.cx - a.cx) * at;
          const y = a.cy + (b.cy - a.cy) * at;
          const angle = (Math.atan2(b.cy - a.cy, b.cx - a.cx) * 180) / Math.PI;
          return svg(
            'g',
            { class: 'kq-fleet', style: `--c:${colorOf(fleet.owner)}` },
            svg('line', { class: 'kq-trail', x1: x, y1: y, x2: b.cx, y2: b.cy }),
            svg('path', { d: 'M7 0 L-5 -5 L-2 0 L-5 5 Z', transform: `translate(${x} ${y}) rotate(${angle})` }),
            svg('text', { x, y: y - 7 }, String(fleet.ships)),
          );
        }),
    );
  }
}

/** Turns a fleet takes between two planets of a state. */
export const flightTurns = (state: PublicState, from: number, to: number) =>
  travelTime(state.planets[from], state.planets[to]);
