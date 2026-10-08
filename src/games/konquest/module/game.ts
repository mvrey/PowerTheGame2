import {
  ActionProblem,
  FormatInfo,
  GameModule,
  MatchResult,
  MatchSetup,
  Placement,
  PreviousTurn,
} from '../../../platform/core/game';
import {
  GALAXIES,
  GameState,
  HOME_KILL,
  HOME_PRODUCTION,
  NEUTRAL_KILL_MIN,
  NEUTRAL_KILL_RANGE,
  NEUTRAL_PRODUCTION_MIN,
  NEUTRAL_PRODUCTION_RANGE,
  TurnEvent,
  checkOrders,
  cloneState,
  createGame,
  galaxyById,
  planetsOf,
  publicState,
  resolveTurn,
  shipsOf,
} from '../api';
import { KonquestAction, KonquestMatchInfo, KonquestObservation } from './schema';

/** Bumped with every change to the rules or to the JSON in schema.ts. */
export const KONQUEST_GAME_VERSION = '1.0.0';

/** Orders looked at in one answer: more than any galaxy has planets to send from. */
const MAX_ORDERS_READ = 200;

const FORMATS: readonly FormatInfo[] = [
  { id: 'duel', players: 2, description: 'One against one' },
  { id: 'ffa4', players: 4, description: 'Four players, each for themselves' },
  { id: 'ffa6', players: 6, description: 'Six players, each for themselves' },
];

export interface KonquestState {
  game: GameState;
  maxTurns: number;
  /** The turn in which each player lost their last planet and fleet; null while still in. */
  eliminatedIn: (number | null)[];
}

export const konquestGame: GameModule<KonquestState, KonquestAction, TurnEvent> = {
  id: 'konquest',
  version: KONQUEST_GAME_VERSION,
  title: 'Konquest',
  formats: FORMATS,
  variants: GALAXIES.map((g) => g.id),

  setup(setup: MatchSetup): KonquestState {
    const format = FORMATS.find((f) => f.id === setup.format);
    if (!format) throw new Error(`Konquest has no format "${setup.format}"`);
    if (!galaxyById(setup.variant)) throw new Error(`Konquest has no galaxy "${setup.variant}"`);
    // Seats are anonymous: the galaxy (and every home in it) is the same whoever sits where.
    const game = createGame({ players: format.players, galaxy: setup.variant, seed: setup.seed });
    return { game, maxTurns: setup.maxTurns, eliminatedIn: game.players.map(() => null) };
  },

  turn: (state) => state.game.turn,

  toAct: (state) => (state.game.over ? [] : state.game.players.filter((p) => p.alive).map((p) => p.id)),

  matchInfo(state, seat): KonquestMatchInfo {
    const { game } = state;
    return {
      you: seat,
      players: game.players.length,
      width: game.width,
      height: game.height,
      homes: game.players.map((p) => game.planets.find((planet) => planet.home === p.id)!.id),
      rules: { ...game.rules },
      constants: {
        homeProduction: HOME_PRODUCTION,
        homeKill: HOME_KILL,
        neutralKill: [NEUTRAL_KILL_MIN, NEUTRAL_KILL_MIN + NEUTRAL_KILL_RANGE],
        neutralProduction: [NEUTRAL_PRODUCTION_MIN, NEUTRAL_PRODUCTION_MIN + NEUTRAL_PRODUCTION_RANGE - 1],
      },
      maxTurns: state.maxTurns,
    };
  },

  observe(state, seat, previous: PreviousTurn<KonquestAction, TurnEvent> | null): KonquestObservation {
    return {
      turn: state.game.turn,
      maxTurns: state.maxTurns,
      you: seat,
      state: publicState(state.game),
      previous: previous && {
        turn: previous.turn,
        orders: previous.actions.map((a) => a?.orders ?? null),
        events: previous.events,
        problems: previous.problems,
      },
    };
  },

  parseAction(state, seat, raw) {
    const orders = (raw as { orders?: unknown } | null)?.orders;
    if (!Array.isArray(orders)) return { action: { orders: [] }, problems: [{ code: 'malformed' }] };
    const checked = checkOrders(state.game, seat, orders.slice(0, MAX_ORDERS_READ));
    const problems: ActionProblem[] = checked.problems.map((p) => ({ code: p.error, index: p.index }));
    if (orders.length > MAX_ORDERS_READ) problems.push({ code: 'tooMany', index: MAX_ORDERS_READ });
    return { action: { orders: checked.orders }, problems };
  },

  noAction: () => ({ orders: [] }),

  resolve(state, actions) {
    const game = cloneState(state.game);
    const events = resolveTurn(
      game,
      actions.map((a) => a.orders),
      { lastTurn: state.game.turn >= state.maxTurns },
    );
    const eliminatedIn = state.eliminatedIn.map(
      (turn, p) => turn ?? (state.game.players[p].alive && !game.players[p].alive ? state.game.turn : null),
    );
    return { state: { game, maxTurns: state.maxTurns, eliminatedIn }, events };
  },

  result(state): MatchResult | null {
    if (!state.game.over) return null;
    return { placements: placements(state), reason: state.game.endReason! };
  },
};

/**
 * How everyone finished: the last player standing first; the others by how long they lasted
 * (still in at the turn limit beats any elimination), then by planets held, then by ships. The
 * score is the ships a player has at the end, on planets and in flight.
 */
export function placements(state: KonquestState): Placement[] {
  const { game } = state;
  const standing = game.players.map((p) => ({
    won: game.winner === p.id,
    lasted: state.eliminatedIn[p.id] ?? Infinity,
    planets: planetsOf(game, p.id),
    score: shipsOf(game, p.id),
  }));
  type Standing = (typeof standing)[number];
  const beats = (a: Standing, b: Standing) =>
    a.won !== b.won
      ? a.won
      : a.lasted !== b.lasted
        ? a.lasted > b.lasted
        : a.planets !== b.planets
          ? a.planets > b.planets
          : a.score > b.score;
  return standing.map((me) => ({ rank: 1 + standing.filter((other) => beats(other, me)).length, score: me.score }));
}
