import { describe, expect, it } from 'vitest';
import { newGame, playerStrength, withinBudget } from '../src/engine/game';
import { resolveRound } from '../src/engine/resolve';
import { GameState, Order } from '../src/engine/types';
import { BALANCED } from '../src/ai/evaluate';
import { makeRng, planOrders } from '../src/ai/planner';

function play(state: GameState, levels: number[], seed: number, maxRounds: number) {
  const rng = makeRng(seed);
  let illegal = 0, empty = 0;
  while (!state.over && state.round <= maxRounds) {
    const orders: Order[][] = state.players.map((p) =>
      p.alive ? planOrders(state, p.id, { level: levels[p.id] as 1 | 2 | 3, style: BALANCED, rng }) : []);
    state.players.forEach((p) => {
      if (!p.alive) return;
      const assets = state.pieces.some((q) => p.armies.includes(q.army)) || p.armies.some((a) => state.armies[a].power >= 2);
      if (!orders[p.id].length && assets) empty++;
      const prior: Order[] = [];
      for (const o of orders[p.id]) {
        expect(withinBudget(state, p.id, prior, o)).toBe(true);
        prior.push(o);
      }
    });
    const events = resolveRound(state, orders, { record: true, lastRound: state.round === maxRounds });
    for (const e of events) if (e.t === 'order' && e.error && e.error !== 'cancelled') illegal++;
    for (const p of state.pieces) expect(p.loc >= -1 && state.armies[p.army].alive).toBe(true);
  }
  return { illegal, empty };
}

const four = () => newGame({ mode: 4, players: [0, 1, 2, 3].map((a) => ({ name: 'P' + a, kind: 'ai' as const, armies: [a] })) });
const three = () => newGame({ mode: 3, players: [0, 1, 2].map((a) => ({ name: 'P' + a, kind: 'ai' as const, armies: [a] })) });
const two = () => newGame({ mode: 2, players: [{ name: 'A', kind: 'ai', armies: [0, 1] }, { name: 'B', kind: 'ai', armies: [2, 3] }] });

describe('AI self-play', () => {
  it.each([['4 players', four, [2, 2, 2, 2]], ['3 players', three, [2, 2, 2]], ['2 players', two, [2, 2]]] as const)(
    '%s: only legal, non-empty plans', (_n, make, levels) => {
      for (let seed = 1; seed <= 6; seed++) {
        const s = make();
        const r = play(s, [...levels], seed, 60);
        expect(r.illegal).toBe(0);
        expect(r.empty).toBe(0);
        expect(s.over).toBe(true);
      }
    }, 120000);

  it('the general out-plays the recruit', () => {
    let wins = 0;
    const games = 12;
    for (let seed = 1; seed <= games; seed++) {
      const s = two();
      const strong = seed % 2;
      const levels = strong === 0 ? [3, 1] : [1, 3];
      play(s, levels, 100 + seed, 50);
      if (s.winners.length === 1 && s.winners[0] === strong) wins++;
      else if (!s.winners.length && playerStrength(s, strong) > playerStrength(s, 1 - strong)) wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(9);
  }, 240000);
});
