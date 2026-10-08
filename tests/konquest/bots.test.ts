import { describe, expect, it } from 'vitest';
import { BotLevel, GameState, Match, NEUTRAL, createView, runHeadless } from '../../src/games/konquest/api';
import { bots } from '../../src/games/konquest/bots';

const create = (spec: string) => {
  const [id, level] = spec.split(':');
  return bots.create(id, { level: (Number(level) || 2) as BotLevel });
};
const ctx = { rng: () => 0.5, checkpoint: async () => {}, signal: new AbortController().signal };

/** Two homes and neutrals in a row: x = their column; ships and owner as given. */
function lineGalaxy(planets: { x: number; owner: number; ships: number; kill?: number; production?: number }[]) {
  const match = Match.create({ players: 2, seed: 1, width: 20, height: 1, neutrals: 0 });
  const state = match.exportState();
  state.planets = planets.map((p, id) => ({
    id,
    name: String(id),
    x: p.x,
    y: 0,
    owner: p.owner,
    ships: p.ships,
    production: p.production ?? 10,
    baseProduction: p.production ?? 10,
    kill: p.kill ?? 0.4,
    home: NEUTRAL,
    justConquered: false,
  }));
  return state as GameState;
}

describe('registry', () => {
  it("has KDE's AIs, the examples and the baselines", () => {
    expect(bots.list().map((d) => d.id)).toEqual(['kde', 'becai', 'greedy', 'rookie', 'passive', 'montecarlo']);
  });
});

describe("KDE's default AI, as ported", () => {
  it('sends 70% of its ships to the closest planet it outnumbers', async () => {
    const state = lineGalaxy([
      { x: 0, owner: 0, ships: 40 },
      { x: 3, owner: NEUTRAL, ships: 30 },
      { x: 6, owner: NEUTRAL, ships: 5 },
      { x: 9, owner: 1, ships: 10 },
    ]);
    // 28 ships: the planet at x=3 has 30, too many; the next closest is x=6.
    expect(await create('kde:2').decide(createView(state, 0), ctx)).toEqual([{ from: 0, to: 2, ships: 28 }]);
    // Weak and defensive need 20 and 30 ships to spare.
    expect(await create('kde:3').decide(createView(state, 0), ctx)).toEqual([]);
  });

  it('with nothing to attack, tops up its closest weak planet', async () => {
    const state = lineGalaxy([
      { x: 0, owner: 0, ships: 40 },
      { x: 2, owner: 0, ships: 2 },
      { x: 9, owner: 1, ships: 100 },
    ]);
    // Offensive: (40 - 2) / 2 = 19.
    expect(await create('kde:2').decide(createView(state, 0), ctx)).toEqual([{ from: 0, to: 1, ships: 19 }]);
  });

  it('does not send a second fleet where one of its fleets is already heading', async () => {
    const state = lineGalaxy([
      { x: 0, owner: 0, ships: 40 },
      { x: 3, owner: NEUTRAL, ships: 1 },
    ]);
    state.fleets = [{ id: 0, owner: 0, from: 0, to: 1, ships: 5, launched: 1, arrival: 3 }];
    expect(await create('kde:2').decide(createView(state, 0), ctx)).toEqual([]);
  });
});

describe('Becai, as ported', () => {
  it('keeps a defence and attacks with the surplus', async () => {
    const state = lineGalaxy([
      { x: 0, owner: 0, ships: 60 },
      { x: 2, owner: NEUTRAL, ships: 3, kill: 0.4 },
      { x: 18, owner: 1, ships: 60 },
    ]);
    const orders = await create('becai').decide(createView(state, 0), ctx);
    expect(orders.length).toBeGreaterThan(0);
    expect(orders[0]).toMatchObject({ from: 0, to: 1 });
    // Enough to take the neutral (3 + 1 turn of growth) and garrison it.
    expect(orders[0].ships).toBeGreaterThanOrEqual(4);
    expect(orders.reduce((sum, o) => sum + o.ships, 0)).toBeLessThan(60);
  });
});

describe('every registered bot', () => {
  it.each(bots.list().map((d) => [d.id] as const))(
    '%s plays legal, complete games',
    async (id) => {
      for (const players of [2, 4]) {
        const match = Match.create({ players, seed: 3, galaxy: 'small' });
        const problems: unknown[] = [];
        const seats = match.state.players.map((p) => create(p.id === 0 ? `${id}:1` : 'kde:2'));
        const end = await runHeadless(match, seats, {
          seed: 3,
          maxTurns: 40,
          onProblem: (_p, problem) => problems.push(problem),
        });
        expect(problems).toEqual([]);
        expect(end.over).toBe(true);
      }
    },
    120000,
  );

  it('Becai beats the weak default AI', async () => {
    let wins = 0;
    for (let seed = 0; seed < 6; seed++) {
      const match = Match.create({ players: 2, seed, galaxy: 'standard' });
      const becaiSeat = seed % 2;
      const seats = becaiSeat === 0 ? [create('becai'), create('kde:1')] : [create('kde:1'), create('becai')];
      const end = await runHeadless(match, seats, { seed, maxTurns: 150 });
      if (end.winner === becaiSeat) wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(5);
  }, 60000);
});
