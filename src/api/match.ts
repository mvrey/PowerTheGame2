import { Board, boardOf } from '../engine/board';
import { GameConfig, cloneState, newGame, snapshot } from '../engine/game';
import { resolveRound } from '../engine/resolve';
import { GameState, Mode, Order, ReadonlyGameState, RoundEvent, Snapshot } from '../engine/types';
import { OrderProblem, checkOrders } from './orderSheet';
import { PlayerView, createView } from './view';

/** Where a match stands. Plain JSON. */
export interface MatchStatus {
  map: string;
  mode: Mode;
  /** The round being planned (or the last one played, once the game is over). */
  round: number;
  /** Player who acts first this round. */
  referee: number;
  over: boolean;
  /** Winning players once the game is over (several on a draw, none if nobody survived). */
  winners: number[];
  endReason: 'flags' | 'time' | null;
  /** Living players whose orders for this round have not arrived yet. */
  waitingFor: number[];
  players: { id: number; name: string; armies: number[]; alive: boolean }[];
}

export interface SubmitResult {
  accepted: boolean;
  /** Why the whole submission was refused, when it was. */
  reason?: 'over' | 'unknownPlayer' | 'eliminated' | 'illegal';
  /** With reason 'illegal': which orders are wrong. Nothing is stored in that case. */
  problems: OrderProblem[];
}

export interface RoundReport {
  /** The round that was played. */
  round: number;
  /** Everybody's orders, by player. */
  orders: Order[][];
  /** What happened, in order. */
  events: RoundEvent[];
  /** The board before the round. */
  before: Snapshot;
  /** Where the match stands now. */
  status: MatchStatus;
}

export interface MatchResolveOptions {
  /** The time limit has expired: the game ends after this round. */
  lastRound?: boolean;
  /** Attach a board snapshot to every event (for animated playback). */
  snapshots?: boolean;
}

/**
 * One game, as seen by whoever hosts it (the browser UI, the HTTP server, the arena).
 *
 * It hands out views, collects each player's orders for the round and plays the round when the
 * host says so, usually once `ready`. It never decides anything itself: bots and people do, through
 * `view` and `submit`. Bots never get the Match itself, only a GameClient for their seat.
 */
export class Match {
  private orders = new Map<number, Order[]>();
  private listeners = new Set<(report: RoundReport) => void>();

  private constructor(private game: GameState) {}

  static create(config: GameConfig): Match {
    return new Match(newGame(config));
  }

  /** Continues a game from a saved state. */
  static restore(state: ReadonlyGameState): Match {
    return new Match(cloneState(state));
  }

  /** The live state, for the host to read. */
  get state(): ReadonlyGameState {
    return this.game;
  }

  get board(): Board {
    return boardOf(this.game);
  }

  /** A copy of the state, for saving. */
  exportState(): GameState {
    return cloneState(this.game);
  }

  view(player: number): PlayerView {
    return createView(this.game, player, this.orders.has(player));
  }

  status(): MatchStatus {
    const s = this.game;
    return {
      map: s.map,
      mode: s.mode,
      round: s.round,
      referee: s.referee,
      over: s.over,
      winners: [...s.winners],
      endReason: s.endReason,
      waitingFor: this.waitingFor(),
      players: s.players.map((p) => ({ id: p.id, name: p.name, armies: [...p.armies], alive: p.alive })),
    };
  }

  /**
   * Hands in a player's orders for this round, replacing any given before. All or nothing:
   * if any order is illegal (in sequence, as an OrderSheet would see it) nothing is stored.
   */
  submit(player: number, orders: readonly Order[]): SubmitResult {
    if (this.game.over) return { accepted: false, reason: 'over', problems: [] };
    const who = this.game.players[player];
    if (!who) return { accepted: false, reason: 'unknownPlayer', problems: [] };
    if (!who.alive) return { accepted: false, reason: 'eliminated', problems: [] };
    if (!Array.isArray(orders))
      return { accepted: false, reason: 'illegal', problems: [{ index: -1, error: 'malformed' }] };
    const problems = checkOrders(this.game, player, orders);
    if (problems.length) return { accepted: false, reason: 'illegal', problems };
    this.orders.set(player, structuredClone([...orders]));
    return { accepted: true, problems: [] };
  }

  hasSubmitted(player: number): boolean {
    return this.orders.has(player);
  }

  /** Living players whose orders are still missing. */
  waitingFor(): number[] {
    if (this.game.over) return [];
    return this.game.players.filter((p) => p.alive && !this.orders.has(p.id)).map((p) => p.id);
  }

  /** Every living player has handed in orders. */
  get ready(): boolean {
    return !this.game.over && this.waitingFor().length === 0;
  }

  /** Plays the round with the orders handed in; players who gave none play no orders. */
  resolveRound(opts: MatchResolveOptions = {}): RoundReport {
    if (this.game.over) throw new Error('The game is over');
    const round = this.game.round;
    const orders = this.game.players.map((p) => this.orders.get(p.id) ?? []);
    const before = snapshot(this.game);
    const events = resolveRound(this.game, orders, {
      record: true,
      snapshots: opts.snapshots,
      lastRound: opts.lastRound,
    });
    this.orders.clear();
    const report: RoundReport = { round, orders, events, before, status: this.status() };
    for (const listener of [...this.listeners]) listener(report);
    return report;
  }

  /** Calls `listener` after every round. Returns a function that stops it. */
  onRound(listener: (report: RoundReport) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
