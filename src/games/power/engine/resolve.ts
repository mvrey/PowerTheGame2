import { NUM_ARMIES, RESERVE, boardOf } from './board';
import {
  addPiece,
  armyStrength,
  livingArmies,
  playerFlags,
  playerStrength,
  seatOrder,
  snapshot,
  teamOf,
  withinBudget,
} from './game';
import { applyOrder, checkOrder } from './rules';
import { GameState, MERC, NO_ORIGIN, Order, OrderError, Piece, PIECES, RoundEvent } from './types';

export interface ResolveOptions {
  /** Collect the round's events. Simulations usually leave this off. */
  record?: boolean;
  /** Attach a snapshot of the board to every recorded event, for animated playback. */
  snapshots?: boolean;
  /** The time limit has expired: the game ends after this round. */
  lastRound?: boolean;
}

type Emit = (event: RoundEvent) => void;

/** Plays a full round: execution, missiles, conflicts, captures, Power and flags. Mutates `state`. */
export function resolveRound(state: GameState, orders: Order[][], opts: ResolveOptions = {}): RoundEvent[] {
  const events: RoundEvent[] = [];
  const emit: Emit = opts.record
    ? (event) => {
        if (opts.snapshots) event.snap = snapshot(state);
        events.push(event);
      }
    : () => {};

  executeOrders(state, orders, emit);
  detonate(state, emit);
  resolveTies(state, emit);
  resolveBattles(state, emit);
  collectPower(state, emit);
  captureFlags(state, emit);
  finishRound(state, opts.lastRound ?? false, emit);
  return events;
}

/** Players in execution order: the referee first, then clockwise. */
export function executionOrder(state: GameState): number[] {
  const seats = seatOrder(state);
  const start = seats.indexOf(state.referee);
  return start <= 0 ? seats : [...seats.slice(start), ...seats.slice(0, start)];
}

// ---------------------------------------------------------------- execution

function executeOrders(state: GameState, orders: Order[][], emit: Emit): void {
  const merc = mercenaryQuotas(state, orders);
  for (const player of executionOrder(state)) {
    emit({ kind: 'turn', player });
    const accepted: Order[] = [];
    let executed = 0;
    (orders[player] ?? []).forEach((order, index) => {
      let error: OrderError | null = withinBudget(state, player, accepted, order) ? null : 'budget';
      let merged = false;
      if (!error) accepted.push(order);
      if (!error && order.kind === 'move' && state.armies[order.army]?.controller === MERC) {
        const key = mercKey(order);
        const destKey = key + '>' + order.to;
        const left = merc.quota.get(destKey) ?? 0;
        if (merc.cancelled.has(key)) error = 'cancelled';
        // An earlier player already gave this very order: the piece has moved, nothing more to do.
        else if (left === 0) merged = true;
        else merc.quota.set(destKey, left - 1);
      }
      if (!error && !merged) error = checkOrder(state, player, order);
      if (!error) {
        if (!merged) applyOrder(state, order);
        if (order.kind === 'launch') bump(state, player, 'missiles', 1);
        executed++;
      }
      emit({ kind: 'order', player, index, order, error, merged });
    });
    if (executed === 0) penalise(state, player, emit);
  }
}

function mercKey(order: Extract<Order, { kind: 'move' }>): string {
  return `${order.army}:${order.type}:${order.from}`;
}

/**
 * Mercenary pieces may be ordered by several players. Orders by different players for the
 * same piece cancel out unless they agree on the destination, in which case they count once.
 */
function mercenaryQuotas(state: GameState, orders: Order[][]): { cancelled: Set<string>; quota: Map<string, number> } {
  const cancelled = new Set<string>();
  const quota = new Map<string, number>();
  const wanted = new Map<string, Map<number, number[]>>(); // key -> dest -> count per player
  orders.forEach((list, player) => {
    for (const order of list ?? []) {
      if (order.kind !== 'move' || state.armies[order.army]?.controller !== MERC) continue;
      const key = mercKey(order);
      if (!wanted.has(key)) wanted.set(key, new Map());
      const dests = wanted.get(key)!;
      if (!dests.has(order.to)) dests.set(order.to, []);
      const counts = dests.get(order.to)!;
      counts[player] = (counts[player] ?? 0) + 1;
    }
  });
  for (const [key, dests] of wanted) {
    const [army, type, from] = key.split(':');
    const available = state.pieces.filter(
      (p) => p.army === Number(army) && p.type === type && p.loc === Number(from),
    ).length;
    let need = 0;
    for (const [dest, counts] of dests) {
      const most = Math.max(...counts.filter((n) => n !== undefined));
      quota.set(key + '>' + dest, most);
      need += most;
    }
    if (need > available) cancelled.add(key);
  }
  return { cancelled, quota };
}

/** A player who executed no order hands back one Power, converting their smallest piece if needed. */
function penalise(state: GameState, player: number, emit: Emit): void {
  const armies = livingArmies(state, player);
  if (!armies.length) return;
  const rich = armies
    .filter((a) => state.armies[a].power > 0)
    .sort((a, b) => state.armies[b].power - state.armies[a].power)[0];
  if (rich !== undefined) {
    state.armies[rich].power--;
    emit({ kind: 'penalty', player, army: rich, paid: true });
    return;
  }
  const smallest = state.pieces
    .filter((p) => armies.includes(p.army) && p.type !== 'M')
    .sort(
      (a, b) => PIECES[a.type].power - PIECES[b.type].power || Number(b.loc === RESERVE) - Number(a.loc === RESERVE),
    )[0];
  if (!smallest) {
    emit({ kind: 'penalty', player, army: armies[0], paid: false });
    return;
  }
  const army = state.armies[smallest.army];
  const def = PIECES[smallest.type];
  state.pieces = state.pieces.filter((p) => p.id !== smallest.id);
  if (def.group === 2) {
    // Break it into three small pieces: one becomes Power, two go to the Reserve.
    addPiece(state, def.base!, smallest.army, RESERVE);
    addPiece(state, def.base!, smallest.army, RESERVE);
    army.power += PIECES[def.base!].power - 1;
  } else {
    army.power += def.power - 1;
  }
  emit({ kind: 'penalty', player, army: smallest.army, paid: true });
}

// ----------------------------------------------------------------- missiles

function detonate(state: GameState, emit: Emit): void {
  const strikes = state.strikes;
  state.strikes = [];
  // All launched missiles land together, after every movement has been made.
  const doomed = new Set<number>();
  const wiped = new Set<number>();
  for (const s of strikes) {
    for (const p of state.pieces)
      if (s.target === RESERVE ? p.loc === RESERVE && p.army === s.targetArmy : p.loc === s.target) doomed.add(p.id);
    if (s.target === RESERVE) wiped.add(s.targetArmy);
  }
  for (const s of strikes) {
    const hit = state.pieces.filter(
      (p) =>
        doomed.has(p.id) && (s.target === RESERVE ? p.loc === RESERVE && p.army === s.targetArmy : p.loc === s.target),
    );
    let power = 0;
    for (const p of hit) {
      power += PIECES[p.type].power;
      const owner = teamOf(state, p.army);
      if (owner !== MERC) bump(state, owner, 'lost', PIECES[p.type].power);
    }
    if (s.target === RESERVE && wiped.has(s.targetArmy)) {
      power += state.armies[s.targetArmy].power;
      state.armies[s.targetArmy].power = 0;
    }
    const ids = new Set(hit.map((p) => p.id));
    state.pieces = state.pieces.filter((p) => !ids.has(p.id));
    emit({ kind: 'strike', army: s.army, target: s.target, targetArmy: s.targetArmy, destroyed: hit.length, power });
  }
}

// ---------------------------------------------------------------- conflicts

interface Side {
  team: number;
  power: number;
  pieces: Piece[];
}

function sidesAt(state: GameState, node: number): Side[] {
  const sides: Side[] = [];
  for (const p of state.pieces) {
    if (p.loc !== node) continue;
    const team = teamOf(state, p.army);
    let side = sides.find((s) => s.team === team);
    if (!side) sides.push((side = { team, power: 0, pieces: [] }));
    side.power += PIECES[p.type].power;
    side.pieces.push(p);
  }
  return sides.sort((a, b) => b.power - a.power);
}

function occupiedNodes(state: GameState): number[] {
  const seen = new Set<number>();
  for (const p of state.pieces) if (p.loc !== RESERVE) seen.add(p.loc);
  return [...seen].sort((a, b) => a - b);
}

/** Ties come first: tied forces that just moved in bounce back to where they came from, once per round. */
function resolveTies(state: GameState, emit: Emit): void {
  for (let changed = true; changed;) {
    changed = false;
    for (const node of occupiedNodes(state)) {
      const sides = sidesAt(state, node);
      if (sides.length < 2 || sides[0].power !== sides[1].power) continue;
      const movers = sides
        .filter((s) => s.power === sides[0].power)
        .flatMap((s) => s.pieces)
        .filter((p) => p.from !== NO_ORIGIN && !p.bounced);
      if (!movers.length) continue;
      for (const p of movers) {
        p.loc = p.from;
        p.bounced = true;
      }
      emit({ kind: 'bounce', node, moves: movers.map((p) => ({ type: p.type, army: p.army, to: p.loc })) });
      changed = true;
    }
  }
}

function resolveBattles(state: GameState, emit: Emit): void {
  for (const node of occupiedNodes(state)) {
    let sides = sidesAt(state, node);
    if (sides.length < 2) continue;
    const powers = sides.map((s) => ({ team: s.team, power: s.power }));
    while (sides.length >= 2) {
      const top = sides.filter((s) => s.power === sides[0].power);
      if (top.length > 1) {
        // Deadlocked forces stay put; whoever is left fights among themselves.
        emit({ kind: 'standoff', node, teams: top.map((s) => s.team) });
        sides = sides.slice(top.length);
        continue;
      }
      const winner = sides[0];
      const taker = receivingArmy(state, winner);
      const captured: { type: Piece['type']; army: number; to: number }[] = [];
      let value = 0;
      for (const side of sides.slice(1)) {
        for (const p of side.pieces) {
          const worth = PIECES[p.type].power;
          value += worth;
          if (side.team !== MERC) bump(state, side.team, 'lost', worth);
          captured.push({ type: p.type, army: p.army, to: taker });
          capture(p, taker);
        }
      }
      if (winner.team !== MERC) {
        bump(state, winner.team, 'captured', value);
        bump(state, winner.team, 'battlesWon', 1);
      }
      emit({ kind: 'battle', node, powers, winner: winner.team, captured, value });
      break;
    }
  }
}

/** With allied armies in the fight, prisoners go to the one that brought more power. */
function receivingArmy(state: GameState, side: Side): number {
  const byArmy = new Map<number, number>();
  for (const p of side.pieces) byArmy.set(p.army, (byArmy.get(p.army) ?? 0) + PIECES[p.type].power);
  return [...byArmy.entries()].sort(
    (a, b) => b[1] - a[1] || armyStrength(state, a[0]) - armyStrength(state, b[0]) || a[0] - b[0],
  )[0][0];
}

function capture(piece: Piece, army: number): void {
  piece.army = army;
  piece.loc = RESERVE;
  piece.moved = false;
  piece.fresh = false;
  piece.from = NO_ORIGIN;
  piece.bounced = false;
}

// ------------------------------------------------------------ power & flags

function collectPower(state: GameState, emit: Emit): void {
  const { nodes } = boardOf(state);
  const held: Set<number>[] = state.armies.map(() => new Set<number>());
  for (const p of state.pieces) {
    if (p.loc === RESERVE) continue;
    const node = nodes[p.loc];
    if (node.kind !== 'sector' || !state.armies[node.army].alive) continue;
    if (teamOf(state, node.army) !== teamOf(state, p.army)) held[p.army].add(node.army);
  }
  for (const army of state.armies) {
    const amount = held[army.id].size;
    if (!army.alive || !amount) continue;
    army.power += amount;
    if (army.controller !== MERC) bump(state, army.controller, 'income', amount);
    emit({ kind: 'income', army: army.id, amount, territories: [...held[army.id]] });
  }
}

function captureFlags(state: GameState, emit: Emit): void {
  const { hq } = boardOf(state);
  const first = state.players[state.referee]?.armies[0] ?? 0;
  for (let i = 0; i < NUM_ARMIES; i++) {
    const victim = state.armies[(first + i) % NUM_ARMIES];
    if (!victim.alive) continue;
    const sides = sidesAt(state, hq[victim.id]);
    if (sides.length !== 1 || sides[0].team === victim.controller) continue;
    const infantry = sides[0].pieces.filter((p) => p.type === 'S' || p.type === 'R');
    if (!infantry.length) continue;
    const captor = state.armies[receivingArmy(state, { ...sides[0], pieces: infantry })];

    let pieces = 0;
    for (const p of state.pieces) {
      if (p.army !== victim.id) continue;
      capture(p, captor.id);
      pieces++;
    }
    const power = victim.power;
    captor.power += power;
    captor.flags.push(...victim.flags);
    victim.power = 0;
    victim.flags = [];
    victim.alive = false;
    if (captor.controller !== MERC) bump(state, captor.controller, 'flags', 1);
    emit({ kind: 'flag', victim: victim.id, captor: captor.id, pieces, power });

    const owner = victim.controller;
    if (owner !== MERC && !livingArmies(state, owner).length) {
      state.players[owner].alive = false;
      emit({ kind: 'out', player: owner });
    }
  }
}

function finishRound(state: GameState, lastRound: boolean, emit: Emit): void {
  for (const p of state.pieces) {
    p.moved = false;
    p.fresh = false;
    p.from = NO_ORIGIN;
    p.bounced = false;
  }
  const alive = state.players.filter((p) => p.alive).map((p) => p.id);
  if (alive.length <= 1) {
    state.over = true;
    state.winners = alive;
    state.endReason = 'flags';
  } else if (lastRound) {
    // Time is up: highest total power wins, most flags breaks ties.
    const rank = (p: number) => [playerStrength(state, p), playerFlags(state, p)];
    const best = alive.map(rank).sort((a, b) => b[0] - a[0] || b[1] - a[1])[0];
    state.over = true;
    state.winners = alive.filter((p) => rank(p)[0] === best[0] && rank(p)[1] === best[1]);
    state.endReason = 'time';
  }
  if (state.over) {
    emit({ kind: 'end', winners: state.winners, reason: state.endReason! });
    return;
  }
  state.round++;
  state.referee = nextReferee(state);
}

/** The living player seated after the current referee. */
function nextReferee(state: GameState): number {
  const seats = seatOrder(state);
  const seatOf = (p: number) => state.players[p].armies[0];
  const here = seatOf(state.referee);
  return seats.find((p) => seatOf(p) > here) ?? seats[0];
}

function bump(state: GameState, player: number, stat: keyof GameState['players'][number]['stats'], by: number): void {
  state.players[player].stats[stat] += by;
}
