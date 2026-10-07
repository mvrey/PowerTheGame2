import { describe, expect, it } from 'vitest';
import { MAPS, getBoard, runHeadless } from '../../src/games/power/api';
import { bots } from '../../src/games/power/bots';
import { newMatch } from './helpers';

describe.each(MAPS.map((m) => [m.id] as const))('map %s', (id) => {
  const board = getBoard(id);
  const { adj, hq, nodes, reach, rounds, territory } = board;

  it('is a sound board', () => {
    adj.forEach((list, a) =>
      list.forEach((b) => {
        expect(adj[b]).toContain(a);
        expect(nodes[a].kind === 'sea' && nodes[b].kind === 'sea').toBe(false);
      }),
    );
    for (let a = 0; a < 4; a++) {
      expect(territory[a].length).toBeGreaterThan(0);
      // The HQ opens onto its own territory, and infantry can walk out of it.
      expect(adj[hq[a]].some((n) => nodes[n].kind === 'sector' && nodes[n].army === a)).toBe(true);
    }
  });

  it('lets every kind of unit travel between any two HQs', () => {
    for (const cls of ['inf', 'tank', 'air', 'naval'] as const)
      for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) expect(rounds[cls][hq[a]][hq[b]]).toBeLessThan(Infinity);
  });

  it('is fair: every army sees the same distances to its neighbours', () => {
    for (const cls of ['inf', 'tank', 'air', 'naval'] as const) {
      const profile = (a: number) => [1, 2, 3].map((k) => rounds[cls][hq[a]][hq[(a + k) % 4]]).join(',');
      for (let a = 1; a < 4; a++) expect(profile(a)).toBe(profile(0));
    }
    const sizes = territory.map((t) => t.length);
    expect(new Set(sizes).size).toBe(1);
  });

  it('never lets ground or air units into the sea, nor ships inland', () => {
    nodes.forEach((_, from) => {
      for (const cls of ['inf', 'tank', 'air'] as const)
        for (const to of reach[cls][from]) expect(nodes[to].kind).not.toBe('sea');
      for (const to of reach.naval[from]) expect(nodes[to].kind === 'sector' && !nodes[to].coastal).toBe(false);
    });
  });

  it('plays out AI games with only legal orders', async () => {
    for (const mode of [4, 3, 2] as const) {
      const match = newMatch(mode, id);
      expect(match.state.map).toBe(id);
      let problems = 0;
      const players = match.state.players.map(() => bots.create('okoye', { level: 2 }));
      const end = await runHeadless(match, players, { seed: 7 + mode, maxRounds: 70, onProblem: () => problems++ });
      expect(problems).toBe(0);
      expect(end.over).toBe(true);
    }
  }, 120000);
});

describe('map specifics', () => {
  it('continent: territories touch and tanks cross the border in one move', () => {
    const { adj, byId: N, canReach, nodes } = getBoard('continent');
    expect(adj[N.G3]).toContain(N.B5);
    expect(canReach('tank', N.G4, N.B2)).toBe(true);
    expect(nodes.some((n) => n.kind === 'island')).toBe(false);
    expect(nodes[N.G0].coastal).toBe(false);
    expect(nodes[N.G8].coastal).toBe(true);
  });
  it('ring: opposite armies are farther apart than neighbours', () => {
    const { byId, hq, rounds } = getBoard('ring');
    expect(rounds.inf[hq[0]][hq[2]]).toBeGreaterThan(rounds.inf[hq[0]][hq[1]]);
    expect(byId.IX).toBeUndefined();
  });
  it('crossroads: a ship sails from one HQ to the next in two moves', () => {
    const { hq, nodes, rounds } = getBoard('crossroads');
    expect(rounds.naval[hq[0]][hq[1]]).toBe(2);
    expect(nodes.filter((n) => n.kind === 'island').length).toBe(1);
  });
  it('archipelago: infantry needs four hops between neighbouring territories', () => {
    const { adj, byId: N, nodes, rounds } = getBoard('archipelago');
    expect(nodes.filter((n) => n.kind === 'island').length).toBe(17);
    expect(rounds.inf[N.G0][N.B0]).toBe(4);
    expect(adj[N.IA].map((n) => nodes[n].id)).toContain('G0');
  });
  it('boards of different maps coexist', () => {
    const classic = getBoard('classic'),
      ring = getBoard('ring');
    expect(classic.numNodes).toBe(57);
    expect(ring.numNodes).toBe(56);
    expect(getBoard('classic')).toBe(classic);
    const a = newMatch(4, 'ring'),
      c = newMatch(4, 'classic');
    expect(a.board).toBe(ring);
    expect(c.board).toBe(classic);
  });
});
