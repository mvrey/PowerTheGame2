import { afterAll, describe, expect, it } from 'vitest';
import { ADJ, HQ, NODES, NODE_BY_ID, REACH, ROUNDS, TERRITORY, canReach, useMap } from '../src/engine/board';
import { newGame, withinBudget } from '../src/engine/game';
import { MAPS } from '../src/engine/maps';
import { resolveRound } from '../src/engine/resolve';
import { Order } from '../src/engine/types';
import { BALANCED } from '../src/ai/evaluate';
import { makeRng, planOrders } from '../src/ai/planner';

afterAll(() => useMap('classic'));

describe.each(MAPS.map((m) => [m.id] as const))('map %s', (id) => {
  it('is a sound board', () => {
    useMap(id);
    ADJ.forEach((list, a) => list.forEach((b) => {
      expect(ADJ[b]).toContain(a);
      expect(NODES[a].kind === 'sea' && NODES[b].kind === 'sea').toBe(false);
    }));
    for (let a = 0; a < 4; a++) {
      expect(TERRITORY[a].length).toBeGreaterThan(0);
      // The HQ opens onto its own territory, and infantry can walk out of it.
      expect(ADJ[HQ[a]].some((n) => NODES[n].kind === 'sector' && NODES[n].army === a)).toBe(true);
    }
  });

  it('lets every kind of unit travel between any two HQs', () => {
    useMap(id);
    for (const cls of ['inf', 'tank', 'air', 'naval'] as const)
      for (let a = 0; a < 4; a++)
        for (let b = 0; b < 4; b++) expect(ROUNDS[cls][HQ[a]][HQ[b]]).toBeLessThan(Infinity);
  });

  it('is fair: every army sees the same distances to its neighbours', () => {
    useMap(id);
    for (const cls of ['inf', 'tank', 'air', 'naval'] as const) {
      const profile = (a: number) => [1, 2, 3].map((k) => ROUNDS[cls][HQ[a]][HQ[(a + k) % 4]]).join(',');
      for (let a = 1; a < 4; a++) expect(profile(a)).toBe(profile(0));
    }
    const sizes = TERRITORY.map((t) => t.length);
    expect(new Set(sizes).size).toBe(1);
  });

  it('never lets ground or air units into the sea, nor ships inland', () => {
    useMap(id);
    NODES.forEach((_, from) => {
      for (const cls of ['inf', 'tank', 'air'] as const) for (const to of REACH[cls][from]) expect(NODES[to].kind).not.toBe('sea');
      for (const to of REACH.naval[from]) expect(NODES[to].kind === 'sector' && !NODES[to].coastal).toBe(false);
    });
  });

  it('plays out AI games with only legal orders', () => {
    for (const mode of [4, 3, 2] as const) {
      const players = mode === 2
        ? [{ name: 'A', kind: 'ai' as const, armies: [0, 1] }, { name: 'B', kind: 'ai' as const, armies: [2, 3] }]
        : Array.from({ length: mode }, (_, a) => ({ name: 'P' + a, kind: 'ai' as const, armies: [a] }));
      const s = newGame({ map: id, mode, players });
      expect(s.map).toBe(id);
      const rng = makeRng(7 + mode);
      let illegal = 0;
      while (!s.over && s.round <= 70) {
        const orders: Order[][] = s.players.map((p) => (p.alive ? planOrders(s, p.id, { level: 2, style: BALANCED, rng }) : []));
        s.players.forEach((p) => {
          const prior: Order[] = [];
          for (const o of orders[p.id]) {
            expect(withinBudget(s, p.id, prior, o)).toBe(true);
            prior.push(o);
          }
        });
        for (const e of resolveRound(s, orders, { record: true, lastRound: s.round === 70 }))
          if (e.t === 'order' && e.error && e.error !== 'cancelled') illegal++;
      }
      expect(illegal).toBe(0);
      expect(s.over).toBe(true);
    }
  }, 120000);
});

describe('map specifics', () => {
  it('continent: territories touch and tanks cross the border in one move', () => {
    useMap('continent');
    const N = NODE_BY_ID;
    expect(ADJ[N.G3]).toContain(N.B5);
    expect(canReach('tank', N.G4, N.B2)).toBe(true);
    expect(NODES.some((n) => n.kind === 'island')).toBe(false);
    expect(NODES[N.G0].coastal).toBe(false);
    expect(NODES[N.G8].coastal).toBe(true);
  });
  it('ring: opposite armies are farther apart than neighbours', () => {
    useMap('ring');
    expect(ROUNDS.inf[HQ[0]][HQ[2]]).toBeGreaterThan(ROUNDS.inf[HQ[0]][HQ[1]]);
    expect(NODE_BY_ID.IX).toBeUndefined();
  });
  it('crossroads: a ship sails from one HQ to the next in two moves', () => {
    useMap('crossroads');
    expect(ROUNDS.naval[HQ[0]][HQ[1]]).toBe(2);
    expect(NODES.filter((n) => n.kind === 'island').length).toBe(1);
  });
  it('archipelago: infantry needs four hops between neighbouring territories', () => {
    useMap('archipelago');
    const N = NODE_BY_ID;
    expect(NODES.filter((n) => n.kind === 'island').length).toBe(17);
    expect(ROUNDS.inf[N.G0][N.B0]).toBe(4);
    expect(ADJ[N.IA].map((n) => NODES[n].id)).toContain('G0');
  });
});
