import { describe, expect, it } from 'vitest';
import {
  Bot, BotDefinition, LocalGameClient, Order, TurnProblem, defineBot, playTurn, playerStrength, runHeadless,
} from '../src/api';
import { BotRegistry, bots, definitionsIn } from '../src/bots';
import { countEmpty, newMatch } from './helpers';

describe('registry', () => {
  it('discovers the generals and the example bots', () => {
    const ids = bots.list().map((d) => d.id);
    expect(ids.slice(0, 6)).toEqual(['kruger', 'vega', 'okoye', 'ivanova', 'tanaka', 'dubois']);
    expect(ids).toContain('rookie');
    expect(ids).toContain('greedy');
  });

  it('rejects duplicate and badly formed ids', () => {
    const def = (id: string): BotDefinition => defineBot({ id, name: id, create: () => ({ decide: () => [] }) });
    expect(() => new BotRegistry([def('a'), def('a')])).toThrow(/share/);
    expect(() => new BotRegistry([def('Bad Id')])).toThrow(/lowercase/);
    expect(() => bots.get('nobody')).toThrow(/Unknown bot/);
  });

  it('finds definitions in a module: default export, arrays and named exports', () => {
    const a = defineBot({ id: 'a', name: 'A', create: () => ({ decide: () => [] }) });
    const b = defineBot({ id: 'b', name: 'B', create: () => ({ decide: () => [] }) });
    expect(definitionsIn({ default: [a], b, other: 42 }).map((d) => d.id)).toEqual(['a', 'b']);
  });
});

describe('every registered bot', () => {
  it.each(bots.list().map((d) => [d.id] as const))('%s plays legal, complete games', async (id) => {
    for (const mode of [4, 2] as const) {
      const match = newMatch(mode);
      const problems: TurnProblem[] = [];
      // The bot under test against the balanced general, at the quick level.
      const players = match.state.players.map((p) => bots.create(p.id === 0 ? id : 'okoye', { level: 1 }));
      const end = await runHeadless(match, players, { seed: 3, maxRounds: 25, onProblem: (_p, problem) => problems.push(problem) });
      expect(problems).toEqual([]);
      expect(end.over).toBe(true);
    }
  }, 120000);
});

describe('the generals', () => {
  it.each([[4, [2, 2, 2, 2]], [3, [2, 2, 2]], [2, [2, 2]]] as const)(
    '%s players: only legal, non-empty plans', async (mode, levels) => {
      for (let seed = 1; seed <= 6; seed++) {
        const match = newMatch(mode);
        const tally = { empty: 0 };
        let problems = 0;
        const players = levels.map((level) => countEmpty(bots.create('okoye', { level }), tally));
        const end = await runHeadless(match, players, { seed, maxRounds: 60, onProblem: () => problems++ });
        expect(problems).toBe(0);
        expect(tally.empty).toBe(0);
        expect(end.over).toBe(true);
      }
    }, 120000);

  it('the general out-plays the recruit', async () => {
    let wins = 0;
    const games = 12;
    for (let seed = 1; seed <= games; seed++) {
      const match = newMatch(2);
      const strong = seed % 2;
      const players = [0, 1].map((p) => bots.create('okoye', { level: p === strong ? 3 : 1 }));
      const end = await runHeadless(match, players, { seed: 100 + seed, maxRounds: 50 });
      const s = match.state;
      if (end.winners.length === 1 && end.winners[0] === strong) wins++;
      else if (!end.winners.length && playerStrength(s, strong) > playerStrength(s, 1 - strong)) wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(9);
  }, 240000);
});

describe('the driver keeps faulty bots from spoiling a game', () => {
  const run = async (bot: Bot) => {
    const match = newMatch(4);
    const problems: TurnProblem[] = [];
    const result = await playTurn(bot, new LocalGameClient(match, 0), { onProblem: (p) => problems.push(p) });
    return { match, problems, result };
  };

  it('a bot that throws gives no orders', async () => {
    const { match, problems, result } = await run({ decide: () => { throw new Error('boom'); } });
    expect(result.accepted).toBe(true);
    expect(match.hasSubmitted(0)).toBe(true);
    expect(problems.map((p) => p.kind)).toEqual(['crashed']);
  });

  it('illegal orders are dropped and the legal ones kept', async () => {
    const { hq, reach } = newMatch(4).board;
    const [to] = reach.inf[hq[0]];
    const { match, problems } = await run({
      decide: () => [
        { k: 'move', army: 0, type: 'S', from: hq[0], to },
        { k: 'move', army: 1, type: 'S', from: hq[1], to }, // not my army
        { k: 'teleport' } as unknown as Order, // nonsense
        { k: 'move', army: 0, type: 'T', from: hq[0], to },
      ],
    });
    expect(problems).toHaveLength(1);
    expect(problems[0].kind === 'illegal' && problems[0].problems.map((p) => p.error)).toEqual(['notYours', 'malformed']);
    const report = match.resolveRound();
    expect(report.orders[0]).toHaveLength(2);
  });

  it('an answer that is not a list counts as a crash', async () => {
    const { problems } = await run({ decide: () => 'attack!' as unknown as Order[] });
    expect(problems.map((p) => p.kind)).toEqual(['crashed']);
  });

  it('a bot that scribbles on its view cannot touch the game', async () => {
    const { match } = await run({
      decide(view) {
        view.state.pieces = [];
        view.state.armies[0].power = 999;
        return [];
      },
    });
    expect(match.state.pieces.length).toBeGreaterThan(0);
    expect(match.state.armies[0].power).toBe(0);
  });

  it('an aborted bot submits nothing', async () => {
    const match = newMatch(4);
    const stop = new AbortController();
    const bot: Bot = {
      async decide(_view, ctx) {
        stop.abort();
        await ctx.checkpoint();
        return [];
      },
    };
    await expect(playTurn(bot, new LocalGameClient(match, 0), { signal: stop.signal })).rejects.toBeTruthy();
    expect(match.hasSubmitted(0)).toBe(false);
  });
});
