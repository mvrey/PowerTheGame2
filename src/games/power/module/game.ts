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
  GameState,
  MAPS,
  MERC,
  MISSILE_COST,
  MOVE_RANGE,
  Match,
  Mode,
  ORDERS_PER_ARMY,
  OrderSheet,
  PIECES,
  RESERVE,
  RoundEvent,
  boardInfo,
  createView,
  defaultSeating,
  getBoard,
  legalOrders,
  playerStrength,
  simulate,
} from '../api';
import { PowerAction, PowerMatchInfo, PowerObservation } from './schema';

/** Bumped with every change to the rules or to the JSON in schema.ts. */
export const POWER_GAME_VERSION = '2.0.0';

/** Orders looked at in one answer; the allowance is at most 20, the rest is noise. */
const MAX_ORDERS_READ = 100;

const FORMATS: readonly (FormatInfo & { mode: Mode })[] = [
  { id: 'duel', players: 2, mode: 2, description: 'One against one, two allied armies each' },
  { id: 'ffa3', players: 3, mode: 3, description: 'Three players, the fourth army is mercenary' },
  { id: 'ffa4', players: 4, mode: 4, description: 'Four players, one army each' },
];

export interface PowerState {
  game: GameState;
  maxRounds: number;
  /** The round in which each player lost their last army; null while still in the game. */
  eliminatedIn: (number | null)[];
}

export const powerGame: GameModule<PowerState, PowerAction, RoundEvent> = {
  id: 'power',
  version: POWER_GAME_VERSION,
  title: 'Power',
  formats: FORMATS.map(({ id, players, description }) => ({ id, players, description })),
  variants: MAPS.map((m) => m.id),

  setup(setup: MatchSetup): PowerState {
    const format = FORMATS.find((f) => f.id === setup.format);
    if (!format) throw new Error(`Power has no format "${setup.format}"`);
    if (!MAPS.some((m) => m.id === setup.variant)) throw new Error(`Power has no map "${setup.variant}"`);
    // Seats are anonymous inside the game: bots cannot tell who they are playing.
    const players = defaultSeating(format.mode).map((armies, seat) => ({ name: `Player ${seat + 1}`, armies }));
    const game = Match.create({ map: setup.variant, mode: format.mode, players }).exportState();
    return { game, maxRounds: setup.maxTurns, eliminatedIn: players.map(() => null) };
  },

  turn: (state) => state.game.round,

  toAct: (state) => (state.game.over ? [] : state.game.players.filter((p) => p.alive).map((p) => p.id)),

  matchInfo(state, seat): PowerMatchInfo {
    return {
      board: boardInfo(getBoard(state.game.map)),
      pieces: PIECES,
      rules: {
        missileCost: MISSILE_COST,
        ordersPerArmy: ORDERS_PER_ARMY,
        reserve: RESERVE,
        mercenary: MERC,
        moveRange: MOVE_RANGE,
      },
      you: seat,
      seats: state.game.players.map((p) => ({ armies: p.armies })),
      maxRounds: state.maxRounds,
    };
  },

  observe(state, seat, previous: PreviousTurn<PowerAction, RoundEvent> | null): PowerObservation {
    const view = createView(state.game, seat);
    return {
      round: state.game.round,
      maxRounds: state.maxRounds,
      you: seat,
      armies: view.armies,
      commandable: view.commandable,
      maxOrders: view.maxOrders,
      ordersPerArmy: view.ordersPerArmy,
      state: view.state,
      legal: legalOrders(new OrderSheet(state.game, seat)),
      previous: previous && {
        round: previous.turn,
        orders: previous.actions.map((a) => a?.orders ?? null),
        events: previous.events,
        problems: previous.problems,
      },
    };
  },

  parseAction(state, seat, raw) {
    const orders = (raw as { orders?: unknown } | null)?.orders;
    if (!Array.isArray(orders)) return { action: { orders: [] }, problems: [{ code: 'malformed' }] };
    const sheet = new OrderSheet(state.game, seat);
    const problems: ActionProblem[] = sheet
      .addAll(orders.slice(0, MAX_ORDERS_READ))
      .map((p) => ({ code: p.error, index: p.index }));
    if (orders.length > MAX_ORDERS_READ) problems.push({ code: 'tooMany', index: MAX_ORDERS_READ });
    return { action: { orders: [...sheet.orders] }, problems };
  },

  noAction: () => ({ orders: [] }),

  resolve(state, actions) {
    const lastRound = state.game.round >= state.maxRounds;
    const { state: game, events } = simulate(
      state.game,
      actions.map((a) => a.orders),
      { events: true, lastRound },
    );
    const eliminatedIn = state.eliminatedIn.map(
      (round, p) => round ?? (state.game.players[p].alive && !game.players[p].alive ? state.game.round : null),
    );
    return { state: { game, maxRounds: state.maxRounds, eliminatedIn }, events };
  },

  result(state): MatchResult | null {
    if (!state.game.over) return null;
    const reason =
      state.game.endReason === 'time' ? 'turn-limit' : state.game.winners.length ? 'conquest' : 'mutual-destruction';
    return { placements: placements(state), reason };
  },
};

/**
 * How everyone finished: the winners share first place; the others are ranked by how long they
 * lasted, then by their final material. Score is the final material (total Power on the table).
 */
export function placements(state: PowerState): Placement[] {
  const { game } = state;
  const standing = game.players.map((p) => ({
    won: game.winners.includes(p.id),
    lasted: state.eliminatedIn[p.id] ?? Infinity,
    score: playerStrength(game, p.id),
  }));
  const beats = (a: (typeof standing)[number], b: (typeof standing)[number]) =>
    a.won !== b.won ? a.won : !a.won && (a.lasted !== b.lasted ? a.lasted > b.lasted : a.score > b.score);
  return standing.map((me) => ({ rank: 1 + standing.filter((other) => beats(other, me)).length, score: me.score }));
}
