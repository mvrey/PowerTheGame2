import { describe, expect, it } from 'vitest';
import { connectInProcess } from '../../src/platform/core/inProcess';
import { runMatch } from '../../src/platform/core/referee';
import { verifyReplay } from '../../src/platform/core/verify';
import { getBoard } from '../../src/games/power/api';
import { PowerObservation, PowerState, placements, powerGame, powerPackage } from '../../src/games/power/module';

const setup = (format = 'duel', variant = 'classic', maxTurns = 30) => ({ format, variant, maxTurns, seed: 7 });
const builtin = (id: string) => powerPackage.builtins.find((b) => b.id === id)!;

describe('the Power game module', () => {
  it('seats anonymous players with the usual armies', () => {
    const state = powerGame.setup(setup('ffa4'));
    expect(state.game.players.map((p) => p.name)).toEqual(['Player 1', 'Player 2', 'Player 3', 'Player 4']);
    expect(powerGame.setup(setup('duel')).game.players.map((p) => p.armies)).toEqual([
      [0, 1],
      [2, 3],
    ]);
    expect(() => powerGame.setup(setup('chess'))).toThrow();
    expect(() => powerGame.setup(setup('duel', 'atlantis'))).toThrow();
  });

  it('keeps the legal orders of an answer, says why the others were refused, and drops unknown fields', () => {
    const state = powerGame.setup(setup());
    const { hq, reach } = getBoard('classic');
    const to = reach.inf[hq[0]][0];
    const { action, problems } = powerGame.parseAction(state, 0, {
      orders: [
        { kind: 'move', army: 0, type: 'S', from: hq[0], to, note: 'x'.repeat(10) },
        { kind: 'buy', army: 2, type: 'S' },
        'nonsense',
      ],
    });
    expect(action.orders).toEqual([{ kind: 'move', army: 0, type: 'S', from: hq[0], to }]);
    expect(problems).toEqual([
      { code: 'notYours', index: 1 },
      { code: 'malformed', index: 2 },
    ]);
    expect(powerGame.parseAction(state, 0, 'attack!').problems).toEqual([{ code: 'malformed' }]);
    expect(powerGame.parseAction(state, 0, { orders: Array(500).fill({}) }).problems.at(-1)).toEqual({
      code: 'tooMany',
      index: 100,
    });
  });

  it('observations are plain JSON, list legal first orders, and report the previous round', () => {
    let state = powerGame.setup(setup());
    const first = powerGame.observe(state, 0, null) as PowerObservation;
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
    expect(first.legal.length).toBeGreaterThan(10);
    expect(first.legal.every((o) => powerGame.parseAction(state, 0, { orders: [o] }).problems.length === 0)).toBe(true);
    const move = first.legal.find((o) => o.kind === 'move')!;
    const turn = powerGame.resolve(state, [{ orders: [move] }, { orders: [] }]);
    state = turn.state;
    const next = powerGame.observe(state, 1, {
      turn: 1,
      actions: [{ orders: [move] }, { orders: [] }],
      events: turn.events,
      problems: [],
    }) as PowerObservation;
    expect(next.round).toBe(2);
    expect(next.previous?.orders[0]).toEqual([move]);
    expect(next.previous?.events.some((e) => e.kind === 'penalty' && e.player === 1)).toBe(true);
  });

  it('ranks winners first, then survivors and the last to fall, by material', () => {
    const state = powerGame.setup(setup('ffa4'));
    const finished: PowerState = {
      ...state,
      game: { ...state.game, over: true, winners: [2], endReason: 'flags' },
      eliminatedIn: [3, 7, null, 7],
    };
    finished.game.players = finished.game.players.map((p) => ({ ...p, alive: p.id === 2 }));
    const ranks = placements(finished).map((p) => p.rank);
    expect(ranks).toEqual([4, 2, 1, 2]);
  });

  it('plays a whole duel between built-in bots, with a replay that verifies', async () => {
    const bots = [builtin('rookie'), builtin('okoye:1')];
    const replay = await runMatch({
      game: powerGame,
      matchId: 'm1',
      setup: setup('duel', 'ring', 20),
      bots: bots.map((b) => ({ id: `builtin:${b.id}`, name: b.name, version: 'builtin' })),
      launchers: bots.map((b) => async () => connectInProcess(b.create())),
      limits: { turnMs: 5000 },
    });
    expect(replay.result.placements).toHaveLength(2);
    expect(replay.turns.flatMap((t) => t.failures).every((f) => f === null)).toBe(true);
    expect(verifyReplay(powerGame, replay)).toEqual({ ok: true, problems: [] });
  }, 60000);
});
