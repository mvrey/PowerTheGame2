import { rngStep } from '../../../platform/core/random';
import {
  EndReason,
  Fleet,
  FleetOrder,
  GameState,
  NEUTRAL,
  OrderError,
  Planet,
  ReadonlyGameState,
  TurnEvent,
} from './types';

type Position = Pick<Planet, 'x' | 'y'>;
/** The parts of a state the queries read: any state, the public one too. */
type Galaxy = Pick<ReadonlyGameState, 'planets' | 'fleets'>;

/** KDE's distance between two planets: half the straight line between their sectors. */
export function distance(a: Position, b: Position): number {
  return Math.hypot(a.x - b.x, a.y - b.y) / 2;
}

/** Turns a fleet takes between two planets (at least one): it lands at the end of its last turn. */
export const travelTime = (a: Position, b: Position): number => Math.max(1, Math.ceil(distance(a, b)));

export const cloneState = (state: ReadonlyGameState): GameState => structuredClone(state) as GameState;

/** Ships a player has: on their planets and in flight. */
export function shipsOf(state: Galaxy, player: number): number {
  return (
    state.planets.reduce((sum, p) => sum + (p.owner === player ? p.ships : 0), 0) +
    state.fleets.reduce((sum, f) => sum + (f.owner === player ? f.ships : 0), 0)
  );
}

export const planetsOf = (state: Galaxy, player: number): number =>
  state.planets.filter((p) => p.owner === player).length;

/** Ships a player builds next turn (what their planets produce). */
export const productionOf = (state: Galaxy, player: number): number =>
  state.planets.reduce((sum, p) => sum + (p.owner === player ? p.production : 0), 0);

/** KDE's Player::isDead: no planet and no fleet in flight. */
export const isOut = (state: Galaxy, player: number): boolean =>
  !state.planets.some((p) => p.owner === player) && !state.fleets.some((f) => f.owner === player);

/**
 * Checks one order against what is left on its planet (`left`, by planet id: ships not yet sent
 * this turn). Null if it is legal.
 */
export function orderError(state: Galaxy, player: number, order: unknown, left: readonly number[]): OrderError | null {
  const o = order as Partial<FleetOrder> | null;
  if (typeof o !== 'object' || o === null || ![o.from, o.to, o.ships].every(Number.isInteger)) return 'malformed';
  const { from, to, ships } = o as FleetOrder;
  if (!state.planets[from] || !state.planets[to]) return 'noPlanet';
  if (state.planets[from].owner !== player) return 'notYours';
  if (from === to) return 'samePlanet';
  if (ships < 1) return 'badShips';
  if (ships > left[from]) return 'notEnough';
  return null;
}

/**
 * The legal part of a player's orders, judged one by one in order: each order may only use the
 * ships its planet still has after the orders before it. Unknown fields are dropped.
 */
export function checkOrders(
  state: Galaxy,
  player: number,
  orders: readonly unknown[],
): { orders: FleetOrder[]; problems: { index: number; error: OrderError }[] } {
  const left = state.planets.map((p) => p.ships);
  const kept: FleetOrder[] = [];
  const problems: { index: number; error: OrderError }[] = [];
  orders.forEach((order, index) => {
    const error = orderError(state, player, order, left);
    if (error) return problems.push({ index, error });
    const { from, to, ships } = order as FleetOrder;
    left[from] -= ships;
    kept.push({ from, to, ships });
  });
  return { orders: kept, problems };
}

export interface ResolveOptions {
  /** The turn limit is reached: the game ends after this turn, whoever is left. */
  lastTurn?: boolean;
}

/**
 * Plays a turn on `state` (changed in place) with every player's orders, which must be legal
 * (see checkOrders). As in KDE: the fleets leave; then, player by player in seat order and each
 * player's fleets in launch order, the fleets due this turn land, joining a friendly planet or
 * fighting for a hostile one; then every planet produces; then the players without planets or
 * fleets are out, and the last one standing wins.
 */
export function resolveTurn(
  state: GameState,
  orders: readonly (readonly FleetOrder[] | undefined)[],
  opts: ResolveOptions = {},
): TurnEvent[] {
  const events: TurnEvent[] = [];
  const turn = state.turn;

  for (const player of state.players) {
    if (!player.alive) continue;
    for (const order of orders[player.id] ?? []) {
      const from = state.planets[order.from];
      const to = state.planets[order.to];
      from.ships -= order.ships;
      const fleet: Fleet = {
        id: state.nextFleetId++,
        owner: player.id,
        from: order.from,
        to: order.to,
        ships: order.ships,
        launched: turn,
        arrival: turn + travelTime(from, to) - 1,
      };
      state.fleets.push(fleet);
      player.stats.fleetsLaunched++;
      events.push({ kind: 'launch', fleet: { ...fleet } });
    }
  }

  for (const player of state.players)
    for (const fleet of state.fleets.filter((f) => f.owner === player.id && f.arrival === turn))
      events.push(arrive(state, fleet));
  state.fleets = state.fleets.filter((f) => f.arrival !== turn);

  for (const planet of state.planets) produce(state, planet);
  events.push({ kind: 'production', ships: state.planets.map((p) => p.ships) });

  for (const player of state.players)
    if (player.alive && isOut(state, player.id)) {
      player.alive = false;
      events.push({ kind: 'out', player: player.id });
    }

  const alive = state.players.filter((p) => p.alive);
  const reason: EndReason | null =
    alive.length === 0 ? 'mutual-destruction' : alive.length === 1 ? 'conquest' : opts.lastTurn ? 'turn-limit' : null;
  if (reason) {
    state.over = true;
    state.endReason = reason;
    state.winner = reason === 'conquest' ? alive[0].id : null;
    events.push({ kind: 'end', winner: state.winner, reason });
  }
  state.turn++;
  return events;
}

/** A number in [0, 1) from the game's dice. */
function roll(state: GameState): number {
  const { value, state: next } = rngStep(state.dice);
  state.dice = next;
  return value;
}

/** KDE's Game::doFleetArrival. */
function arrive(state: GameState, fleet: Fleet): TurnEvent {
  const planet = state.planets[fleet.to];
  if (planet.owner === fleet.owner) {
    planet.ships += fleet.ships;
    return { kind: 'reinforce', fleet: fleet.id, owner: fleet.owner, planet: planet.id, ships: fleet.ships };
  }

  // The attackers fight with the kill percentage of the planet they left (as it is now).
  const attackKill = state.planets[fleet.from].kill;
  const defendKill = planet.kill;
  const defender = planet.owner;
  const stats = (player: number) => (player === NEUTRAL ? null : state.players[player].stats);
  const start = { attackers: fleet.ships, defenders: planet.ships };
  let attackers = fleet.ships;
  let defenders = planet.ships;
  let conquered: boolean;
  for (;;) {
    const attackRoll = roll(state);
    const defendRoll = roll(state);
    // KDE's special case for two planets that never hit: the higher roll wins the exchange.
    if (defendKill === 0 && attackKill === 0) {
      if (attackRoll < defendRoll) defenders--;
      else attackers--;
    }
    if (defendRoll < defendKill) {
      attackers--;
      if (stats(defender)) stats(defender)!.enemyShipsDestroyed++;
    }
    if (attackers <= 0) {
      conquered = false;
      break;
    }
    if (attackRoll < attackKill) {
      defenders--;
      stats(fleet.owner)!.enemyShipsDestroyed++;
    }
    if (defenders <= 0) {
      conquered = true;
      break;
    }
  }

  if (conquered) {
    stats(fleet.owner)!.enemyFleetsDestroyed++;
    stats(fleet.owner)!.planetsConquered++;
    planet.owner = fleet.owner;
    planet.ships = attackers;
    planet.production = planet.baseProduction;
    planet.justConquered = true;
  } else {
    if (stats(defender)) stats(defender)!.enemyFleetsDestroyed++;
    planet.ships = defenders;
  }
  return {
    kind: 'battle',
    fleet: fleet.id,
    planet: planet.id,
    attacker: fleet.owner,
    defender,
    ...start,
    attackersLeft: Math.max(0, attackers),
    defendersLeft: Math.max(0, conquered ? 0 : defenders),
    conquered,
  };
}

/** KDE's Planet::turn. */
function produce(state: GameState, planet: Planet): void {
  const { rules } = state;
  if (rules.productionAfterConquest || !planet.justConquered) {
    const built = planet.owner === NEUTRAL ? rules.neutralProduction : planet.production;
    planet.ships = Math.max(0, planet.ships + built);
    if (planet.owner !== NEUTRAL) state.players[planet.owner].stats.shipsBuilt += built;
    if (rules.cumulativeProduction) planet.production++;
  }
  planet.justConquered = false;
}
