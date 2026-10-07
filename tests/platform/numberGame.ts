import { GameModule } from '../../src/platform/core/game';

// A tiny game to test the platform without any real game: each turn every player names a number
// from 0 to 9; the highest number named by nobody else scores a point. Most points after
// `maxTurns` turns wins.

export interface NumberState {
  turn: number;
  maxTurns: number;
  points: number[];
}
export type NumberAction = { n: number | null };
export type NumberEvent = { winner: number | null; numbers: (number | null)[] };

export const numberGame: GameModule<NumberState, NumberAction, NumberEvent> = {
  id: 'numbers',
  version: '1.0.0',
  title: 'Numbers',
  formats: [
    { id: 'duel', players: 2, description: 'two players' },
    { id: 'trio', players: 3, description: 'three players' },
  ],
  variants: ['standard'],
  setup: (setup) => ({ turn: 1, maxTurns: setup.maxTurns, points: Array(setup.format === 'trio' ? 3 : 2).fill(0) }),
  turn: (state) => state.turn,
  toAct: (state) => (state.turn > state.maxTurns ? [] : state.points.map((_, i) => i)),
  matchInfo: (state, seat) => ({ seat, players: state.points.length }),
  observe: (state, seat, previous) => ({
    points: state.points,
    seat,
    previous: previous?.actions ?? null,
    problems: previous?.problems ?? [],
  }),
  parseAction(_state, _seat, raw) {
    const n = (raw as { n?: unknown } | null)?.n;
    if (Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 9)
      return { action: { n: n as number }, problems: [] };
    return { action: { n: null }, problems: [{ code: 'badNumber' }] };
  },
  noAction: () => ({ n: null }),
  resolve(state, actions) {
    const numbers = actions.map((a) => a.n);
    const unique = numbers.filter((n): n is number => n !== null && numbers.filter((m) => m === n).length === 1);
    const best = unique.length ? Math.max(...unique) : null;
    const winner = best === null ? null : numbers.indexOf(best);
    const points = state.points.map((p, i) => p + (i === winner ? 1 : 0));
    return { state: { ...state, turn: state.turn + 1, points }, events: [{ winner, numbers }] };
  },
  result(state) {
    if (state.turn <= state.maxTurns) return null;
    const placements = state.points.map((p) => ({ rank: 1 + state.points.filter((q) => q > p).length, score: p }));
    return { placements, reason: 'turn-limit' };
  },
};
