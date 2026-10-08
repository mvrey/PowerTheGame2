import { describe, expect, it } from 'vitest';
import { connectInProcess } from '../../src/platform/core/inProcess';
import { runMatch } from '../../src/platform/core/referee';
import { verifyReplay } from '../../src/platform/core/verify';
import {
  KonquestObservation,
  KonquestState,
  konquestGame,
  konquestPackage,
  placements,
} from '../../src/games/konquest/module';

const setup = (format = 'duel', variant = 'small', maxTurns = 30) => ({ format, variant, maxTurns, seed: 7 });
const builtin = (id: string) => konquestPackage.builtins.find((b) => b.id === id)!;

describe('the Konquest game module', () => {
  it('seats two, four or six players on the galaxies', () => {
    expect(konquestGame.setup(setup('duel')).game.players).toHaveLength(2);
    expect(konquestGame.setup(setup('ffa4', 'standard')).game.players).toHaveLength(4);
    expect(konquestGame.setup(setup('ffa6', 'large')).game.players).toHaveLength(6);
    expect(() => konquestGame.setup(setup('chess'))).toThrow();
    expect(() => konquestGame.setup(setup('duel', 'andromeda'))).toThrow();
  });

  it('keeps the legal orders of an answer, says why the others were refused, and drops unknown fields', () => {
    const state = konquestGame.setup(setup());
    const { action, problems } = konquestGame.parseAction(state, 0, {
      orders: [{ from: 0, to: 2, ships: 4, note: 'x' }, { from: 1, to: 2, ships: 1 }, 'nonsense'],
    });
    expect(action.orders).toEqual([{ from: 0, to: 2, ships: 4 }]);
    expect(problems).toEqual([
      { code: 'notYours', index: 1 },
      { code: 'malformed', index: 2 },
    ]);
    expect(konquestGame.parseAction(state, 0, 'attack!').problems).toEqual([{ code: 'malformed' }]);
    expect(konquestGame.parseAction(state, 0, { orders: Array(500).fill({}) }).problems.at(-1)).toEqual({
      code: 'tooMany',
      index: 200,
    });
  });

  it('observations are plain JSON, hide the dice, and report the previous turn', () => {
    let state = konquestGame.setup(setup());
    const info = konquestGame.matchInfo(state, 1) as { homes: number[]; you: number };
    expect(info.you).toBe(1);
    expect(state.game.planets[info.homes[1]].owner).toBe(1);
    const first = konquestGame.observe(state, 0, null) as KonquestObservation;
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
    expect(JSON.stringify(first)).not.toContain('dice');
    const order = { from: info.homes[0], to: info.homes[1], ships: 5 };
    const turn = konquestGame.resolve(state, [{ orders: [order] }, { orders: [] }]);
    state = turn.state;
    const next = konquestGame.observe(state, 1, {
      turn: 1,
      actions: [{ orders: [order] }, { orders: [] }],
      events: turn.events,
      problems: [],
    }) as KonquestObservation;
    expect(next.turn).toBe(2);
    expect(next.previous?.orders[0]).toEqual([order]);
    expect(next.state.fleets).toHaveLength(1);
  });

  it('ranks the last one standing first, then by how long, then planets, then ships', () => {
    const state = konquestGame.setup(setup('ffa4', 'standard'));
    const game = structuredClone(state.game);
    // Player 2 holds everything; 0 and 3 fell in turn 7, 1 in turn 3.
    for (const p of game.planets) p.owner = 2;
    game.over = true;
    game.winner = 2;
    game.players = game.players.map((p) => ({ ...p, alive: p.id === 2 }));
    const finished: KonquestState = { ...state, game, eliminatedIn: [7, 3, null, 7] };
    expect(placements(finished).map((p) => p.rank)).toEqual([2, 4, 1, 2]);

    const atLimit: KonquestState = { ...state, game: { ...state.game, over: true, endReason: 'turn-limit' } };
    atLimit.game.planets = atLimit.game.planets.map((p) => (p.owner === 3 ? { ...p, owner: 0 } : p));
    // Nobody won: player 0 holds two planets, the others one each (and 3 none but is still in).
    expect(placements(atLimit).map((p) => p.rank)).toEqual([1, 2, 2, 4]);
  });

  it.each([
    ['duel', 'small', ['rookie', 'kde:1']],
    ['ffa4', 'standard', ['becai', 'kde:2', 'greedy', 'passive']],
  ] as const)(
    'plays a whole %s between built-in bots, with a replay that verifies',
    async (format, variant, ids) => {
      const bots = ids.map(builtin);
      const replay = await runMatch({
        game: konquestGame,
        matchId: 'm1',
        setup: setup(format, variant, 40),
        bots: bots.map((b) => ({ id: `builtin:${b.id}`, name: b.name, version: 'builtin' })),
        launchers: bots.map((b) => async () => connectInProcess(b.create())),
        limits: { turnMs: 5000 },
      });
      expect(replay.result.placements).toHaveLength(ids.length);
      expect(replay.turns.flatMap((t) => t.failures).every((f) => f === null)).toBe(true);
      expect(replay.turns.flatMap((t) => t.problems.flat())).toEqual([]);
      expect(verifyReplay(konquestGame, replay)).toEqual({ ok: true, problems: [] });
    },
    60000,
  );
});
