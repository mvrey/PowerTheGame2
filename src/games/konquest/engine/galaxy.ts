import { Rng, makeRng } from '../../../platform/core/random';
import { distance, travelTime } from './rules';
import {
  DEFAULT_RULES,
  GameState,
  HOME_KILL,
  HOME_PRODUCTION,
  NEUTRAL,
  NEUTRAL_KILL_MIN,
  NEUTRAL_KILL_RANGE,
  NEUTRAL_PRODUCTION_MIN,
  NEUTRAL_PRODUCTION_RANGE,
  Planet,
  Rules,
} from './types';

// Galaxies. KDE scatters the home planets and the neutral ones at random over a grid of sectors,
// with random neutral stats. That is kept as the `kde` galaxy. The other galaxies keep KDE's
// planets and stats but place them fairly, since bots meet in a tournament: mirrored for two
// players, rotated for four on a square grid, and otherwise the most even of many random layouts.

export interface GalaxyDef {
  id: string;
  width: number;
  height: number;
  /** Neutral planets for a number of players. */
  neutrals(players: number): number;
  /** Place everything at random, exactly as KDE does. */
  random?: boolean;
}

export const GALAXIES: readonly GalaxyDef[] = [
  { id: 'small', width: 10, height: 10, neutrals: (n) => 4 + 2 * n },
  { id: 'standard', width: 14, height: 14, neutrals: (n) => 6 + 3 * n },
  { id: 'large', width: 18, height: 18, neutrals: (n) => 8 + 4 * n },
  // KDE's new-game defaults: a 10×10 grid and 3 neutral planets, all at random.
  { id: 'kde', width: 10, height: 10, neutrals: () => 3, random: true },
];

export const galaxyById = (id: string | undefined): GalaxyDef | undefined => GALAXIES.find((g) => g.id === id);

/** Everything that makes a new game: a galaxy (or a custom grid), the players, the rules, a seed. */
export interface NewGame {
  players: number;
  seed: number;
  galaxy?: string;
  /** A custom grid, for the browser game: overrides the galaxy's size and neutral count. */
  width?: number;
  height?: number;
  neutrals?: number;
  /** Place everything at random as KDE does (default: only for the `kde` galaxy). */
  random?: boolean;
  rules?: Partial<Rules>;
}

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 10;
/** Grid sizes the browser game allows (KDE's dialog allows 5 to 50). */
export const MIN_SIZE = 5;
export const MAX_SIZE = 30;

/** Planet names as KDE gives them: A … Z, AA, AB … */
export function planetName(index: number): string {
  let name = '';
  for (let n = index; ; n = Math.floor(n / 26) - 1) {
    name = String.fromCharCode(65 + (n % 26)) + name;
    if (n < 26) return name;
  }
}

type Spot = { x: number; y: number };
type Stats = { production: number; kill: number };

const neutralStats = (rng: Rng): Stats => ({
  kill: NEUTRAL_KILL_MIN + rng() * NEUTRAL_KILL_RANGE,
  production: NEUTRAL_PRODUCTION_MIN + Math.floor(rng() * NEUTRAL_PRODUCTION_RANGE),
});

/** A new game: the galaxy, every home planet with KDE's start (10 ships) and neutrals with their first ship. */
export function createGame(spec: NewGame): GameState {
  const def = galaxyById(spec.galaxy ?? 'standard');
  if (!def && spec.width === undefined) throw new Error(`Konquest has no galaxy "${spec.galaxy}"`);
  const width = spec.width ?? def!.width;
  const height = spec.height ?? def!.height;
  const n = spec.players;
  if (!Number.isInteger(n) || n < MIN_PLAYERS || n > MAX_PLAYERS)
    throw new Error(`Konquest plays with 2 to 10 players`);
  const room = width * height - n;
  const neutrals = Math.max(0, Math.min(room, spec.neutrals ?? def!.neutrals(n)));
  const rng = makeRng(spec.seed);

  const layout =
    (spec.random ?? def?.random)
      ? randomLayout(rng, width, height, n, neutrals)
      : n === 2
        ? symmetricLayout(rng, width, height, n, neutrals, (s) => ({ x: width - 1 - s.x, y: height - 1 - s.y }))
        : n === 4 && width === height
          ? symmetricLayout(rng, width, height, n, neutrals, (s) => ({ x: width - 1 - s.y, y: s.x }))
          : balancedLayout(rng, width, height, n, neutrals);

  const rules: Rules = { ...DEFAULT_RULES, ...spec.rules };
  const planets: Planet[] = [
    ...layout.homes.map((spot, seat) => ({
      spot,
      owner: seat,
      home: seat,
      stats: { production: HOME_PRODUCTION, kill: HOME_KILL },
    })),
    ...layout.neutrals.map(({ spot, stats }) => ({ spot, owner: NEUTRAL, home: NEUTRAL, stats })),
  ].map(({ spot, owner, home, stats }, id) => ({
    id,
    name: planetName(id),
    x: spot.x,
    y: spot.y,
    owner,
    // KDE plays a production turn before the first orders: homes start with a turn of ships.
    ships: owner === NEUTRAL ? Math.max(0, rules.neutralProduction) : stats.production,
    production: stats.production,
    baseProduction: stats.production,
    kill: stats.kill,
    home,
    justConquered: false,
  }));

  return {
    turn: 1,
    width,
    height,
    planets,
    fleets: [],
    players: Array.from({ length: n }, (_, id) => ({
      id,
      alive: true,
      stats: { shipsBuilt: 0, planetsConquered: 0, fleetsLaunched: 0, enemyFleetsDestroyed: 0, enemyShipsDestroyed: 0 },
    })),
    rules,
    // The battles' own stream, apart from the one that drew the galaxy.
    dice: Math.floor(rng() * 0x100000000) >>> 0,
    nextFleetId: 0,
    over: false,
    winner: null,
    endReason: null,
  };
}

interface Layout {
  homes: Spot[];
  neutrals: { spot: Spot; stats: Stats }[];
}

/** Free sectors, in grid order. */
function freeSpots(width: number, height: number, taken: Set<string>): Spot[] {
  const out: Spot[] = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (!taken.has(`${x},${y}`)) out.push({ x, y });
  return out;
}

const key = (s: Spot) => `${s.x},${s.y}`;
const pick = <T>(rng: Rng, items: T[]): T => items[Math.floor(rng() * items.length)];

/** KDE's Map::populateMap: homes, then neutrals, each on a random free sector. */
function randomLayout(rng: Rng, width: number, height: number, players: number, neutrals: number): Layout {
  const taken = new Set<string>();
  const place = () => {
    const spot = pick(rng, freeSpots(width, height, taken));
    taken.add(key(spot));
    return spot;
  };
  const homes = Array.from({ length: players }, place);
  return { homes, neutrals: Array.from({ length: neutrals }, () => ({ spot: place(), stats: neutralStats(rng) })) };
}

/**
 * Homes and neutrals in orbits of a symmetry of the grid (`turn` maps a sector to the next one in
 * its orbit, and `players` turns bring it back): every player sees the same galaxy from home.
 */
function symmetricLayout(
  rng: Rng,
  width: number,
  height: number,
  players: number,
  neutrals: number,
  turn: (s: Spot) => Spot,
): Layout {
  const orbit = (s: Spot): Spot[] => {
    const out = [s];
    for (let i = 1; i < players; i++) out.push(turn(out[i - 1]));
    return out;
  };
  const isFull = (o: Spot[]) => new Set(o.map(key)).size === players;
  const taken = new Set<string>();
  const all = freeSpots(width, height, taken);

  // Homes: a full orbit whose homes are far apart (at least 60% of the best possible).
  const spread = (o: Spot[]) => Math.min(...o.slice(1).map((s) => distance(o[0], s)));
  const orbits = all.map(orbit).filter(isFull);
  const best = Math.max(...orbits.map(spread));
  const homes = pick(
    rng,
    orbits.filter((o) => spread(o) >= best * 0.6),
  );
  homes.forEach((s) => taken.add(key(s)));

  // Neutrals: whole orbits with the same stats, and the centre (a one-sector orbit) for an odd one.
  const placed: Layout['neutrals'] = [];
  while (placed.length + players <= neutrals) {
    const options = freeSpots(width, height, taken)
      .map(orbit)
      .filter((o) => isFull(o) && o.every((s) => !taken.has(key(s))));
    if (!options.length) break;
    const chosen = pick(rng, options);
    const stats = neutralStats(rng);
    chosen.forEach((spot) => {
      taken.add(key(spot));
      placed.push({ spot, stats });
    });
  }
  const centre = freeSpots(width, height, taken).find((s) => key(turn(s)) === key(s));
  if (placed.length < neutrals && centre) placed.push({ spot: centre, stats: neutralStats(rng) });
  return { homes, neutrals: placed };
}

/** Tries for a fair galaxy when no symmetry of the grid fits the number of players. */
const BALANCE_TRIES = 120;

/**
 * The fairest of many random layouts with homes spread apart. Fairness: what each home can reach
 * (neutral production, discounted by travel time and defence) should be alike, and so should
 * the distance to the nearest rival.
 */
function balancedLayout(rng: Rng, width: number, height: number, players: number, neutrals: number): Layout {
  let best: Layout | null = null;
  let bestScore = Infinity;
  for (let i = 0; i < BALANCE_TRIES; i++) {
    const layout = spreadLayout(rng, width, height, players, neutrals);
    const score = unfairness(layout);
    if (score < bestScore) [best, bestScore] = [layout, score];
  }
  return best!;
}

/** Homes chosen one by one as far as possible from the others (among random candidates), neutrals at random. */
function spreadLayout(rng: Rng, width: number, height: number, players: number, neutrals: number): Layout {
  const taken = new Set<string>();
  const homes: Spot[] = [];
  for (let i = 0; i < players; i++) {
    const free = freeSpots(width, height, taken);
    let spot = pick(rng, free);
    if (homes.length) {
      const candidates = Array.from({ length: 12 }, () => pick(rng, free));
      const room = (s: Spot) => Math.min(...homes.map((h) => distance(h, s)));
      spot = candidates.reduce((a, b) => (room(b) > room(a) ? b : a));
    }
    homes.push(spot);
    taken.add(key(spot));
  }
  const placed = Array.from({ length: neutrals }, () => {
    const spot = pick(rng, freeSpots(width, height, taken));
    taken.add(key(spot));
    return { spot, stats: neutralStats(rng) };
  });
  return { homes, neutrals: placed };
}

function unfairness({ homes, neutrals }: Layout): number {
  const value = homes.map((home) =>
    neutrals.reduce((sum, { spot, stats }) => {
      // A neutral planet counts for its production, less the closer a rival home is to it.
      const mine = travelTime(home, spot);
      const theirs = Math.min(...homes.filter((h) => h !== home).map((h) => travelTime(h, spot)));
      const share = mine < theirs ? 1 : mine === theirs ? 0.5 : 0.15;
      return sum + (share * stats.production * (1.3 - stats.kill)) / mine;
    }, 0),
  );
  const rival = homes.map((home) => Math.min(...homes.filter((h) => h !== home).map((h) => distance(home, h))));
  const spreadOf = (xs: number[]) => (Math.max(...xs) - Math.min(...xs)) / Math.max(1e-9, Math.max(...xs));
  return spreadOf(value) + spreadOf(rival);
}
