import { describe, expect, it } from 'vitest';
import { InProcessBot } from '../../src/platform/core/bots';
import { connectInProcess } from '../../src/platform/core/inProcess';
import { BotLauncher, runMatch } from '../../src/platform/core/referee';
import { Replay } from '../../src/platform/core/replay';
import { verifyReplay } from '../../src/platform/core/verify';
import { numberGame } from './numberGame';

const LIMITS = { startupMs: 300, turnMs: 120, maxConsecutiveTimeouts: 3 };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A bot that answers every turn with `decide(observation, turn)`. */
function bot(decide: (observation: unknown, turn: number) => unknown): InProcessBot {
  return {
    async receive(message) {
      if (message.type === 'hello') return { type: 'ready' };
      if (message.type === 'turn')
        return { type: 'action', turn: message.turn, action: await decide(message.observation, message.turn) };
      return null;
    },
  };
}
const constant = (n: number) => bot(() => ({ n }));
const launch =
  (b: InProcessBot): BotLauncher =>
  async () =>
    connectInProcess(b);

function play(bots: InProcessBot[], turns = 5, launchers?: BotLauncher[]): Promise<Replay> {
  return runMatch({
    game: numberGame,
    matchId: 'test',
    setup: { format: bots.length === 3 ? 'trio' : 'duel', variant: 'standard', maxTurns: turns, seed: 1 },
    bots: bots.map((_, i) => ({ id: `b${i}`, name: `Bot ${i}`, version: 'v' })),
    launchers: launchers ?? bots.map(launch),
    limits: LIMITS,
  });
}

describe('the referee', () => {
  it('plays a match and records a replay that verifies', async () => {
    const replay = await play([constant(9), constant(3)]);
    expect(replay.turns).toHaveLength(5);
    expect(replay.result.placements).toEqual([
      { rank: 1, score: 5 },
      { rank: 2, score: 0 },
    ]);
    expect(replay.diagnostics.every((d) => d.ready)).toBe(true);
    expect(replay.turns[0].responses).toEqual([{ n: 9 }, { n: 3 }]);
    expect(verifyReplay(numberGame, replay)).toEqual({ ok: true, problems: [] });
  });

  it('tells each bot what was refused in its own answer, the turn after', async () => {
    const seen: unknown[] = [];
    const replay = await play(
      [
        bot((observation) => {
          seen.push((observation as { problems: unknown }).problems);
          return { n: 42 };
        }),
        constant(1),
      ],
      2,
    );
    expect(replay.turns[0].problems).toEqual([[{ code: 'badNumber' }], []]);
    expect(seen).toEqual([[], [{ code: 'badNumber' }]]);
  });

  it('a bot that never gets ready plays the whole match without answers', async () => {
    const mute: InProcessBot = { receive: () => null };
    const replay = await play([mute, constant(1)], 3);
    expect(replay.diagnostics[0].ready).toBe(false);
    expect(replay.turns.map((t) => t.failures[0])).toEqual(['disconnected', 'disconnected', 'disconnected']);
    expect(replay.result.placements[1].rank).toBe(1);
  });

  it('three timeouts in a row disconnect a bot', async () => {
    const sleepy = bot(async () => {
      await sleep(10_000);
      return { n: 1 };
    });
    const replay = await play([sleepy, constant(1)], 5);
    expect(replay.turns.map((t) => t.failures[0])).toEqual([
      'timeout',
      'timeout',
      'timeout',
      'disconnected',
      'disconnected',
    ]);
  });

  it('a late answer is not mistaken for the next turn', async () => {
    const lateOnce = bot(async (_observation, turn) => {
      if (turn === 1) await sleep(LIMITS.turnMs + 60);
      return { n: turn === 1 ? 9 : 5 };
    });
    const replay = await play([lateOnce, constant(1)], 3);
    expect(replay.turns[0].failures[0]).toBe('timeout');
    expect(replay.turns[1].responses[0]).toEqual({ n: 5 });
    expect(replay.turns[1].failures[0]).toBeNull();
  });

  it('garbage counts as an invalid answer, and the bot keeps playing', async () => {
    let calls = 0;
    const confused: InProcessBot = {
      receive(message) {
        if (message.type === 'hello') return { type: 'ready' };
        if (message.type !== 'turn') return null;
        calls++;
        return calls === 1 ? ({ type: 'shout' } as never) : { type: 'action', turn: message.turn, action: { n: 2 } };
      },
    };
    const replay = await play([confused, constant(1)], 2);
    expect(replay.turns.map((t) => t.failures[0])).toEqual(['invalid', null]);
  });

  it('a bot that throws is disconnected, and its error is kept', async () => {
    const crashing = bot((_observation, turn) => {
      if (turn === 2) throw new Error('kaboom');
      return { n: 4 };
    });
    const replay = await play([crashing, constant(1)], 4);
    expect(replay.turns.map((t) => t.failures[0])).toEqual([null, 'crashed', 'disconnected', 'disconnected']);
    expect(replay.diagnostics[0].stderr).toContain('kaboom');
  });

  it('a bot that cannot be started leaves its seat empty', async () => {
    const broken: BotLauncher = async () => {
      throw new Error('no such file');
    };
    const replay = await play([constant(1), constant(2)], 2, [broken, launch(constant(2))]);
    expect(replay.diagnostics[0].exit).toContain('no such file');
    expect(replay.turns[0].failures).toEqual(['disconnected', null]);
  });
});

describe('replay verification', () => {
  it('catches a changed answer, event or result', async () => {
    const replay = await play([constant(9), constant(3)], 3);
    const tampered = (change: (r: Replay) => void) => {
      const copy: Replay = JSON.parse(JSON.stringify(replay));
      change(copy);
      return verifyReplay(numberGame, copy);
    };
    expect(tampered((r) => (r.turns[1].responses[1] = { n: 9 })).ok).toBe(false);
    expect(tampered((r) => (r.turns[2].events = [])).ok).toBe(false);
    expect(tampered((r) => (r.result.placements[1].rank = 1)).ok).toBe(false);
    expect(tampered((r) => (r.match.setup.maxTurns = 4)).ok).toBe(false);
  });
});
