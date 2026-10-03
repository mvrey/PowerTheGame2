import { Order } from '../engine/types';
import { Match, MatchStatus, SubmitResult } from './match';
import { PlayerView } from './view';

/**
 * One seat at a match, as a bot sees it. Implementations talk to a Match in the same process
 * (LocalGameClient) or to a server (HttpGameClient); a bot driver works with either.
 */
export interface GameClient {
  /** The seat (player index). */
  readonly player: number;
  /**
   * Where the match stands. With `afterRound`, waits until the match has moved past that round
   * or ended. Remote clients may give up waiting and return earlier: check the round.
   */
  status(afterRound?: number): Promise<MatchStatus>;
  /** This seat's view of the round being planned. */
  view(): Promise<PlayerView>;
  /** Hands in this round's orders (replacing earlier ones). */
  submit(orders: readonly Order[]): Promise<SubmitResult>;
}

/** Whether the match has moved past `round`. */
export const movedPast = (status: MatchStatus, round: number) => status.over || status.round > round;

/** A seat at a Match in this process. */
export class LocalGameClient implements GameClient {
  constructor(
    private readonly match: Match,
    readonly player: number,
  ) {}

  status(afterRound?: number): Promise<MatchStatus> {
    const now = this.match.status();
    if (afterRound === undefined || movedPast(now, afterRound)) return Promise.resolve(now);
    return new Promise((resolve) => {
      const stop = this.match.onRound((report) => {
        if (!movedPast(report.status, afterRound)) return;
        stop();
        resolve(report.status);
      });
    });
  }

  async view(): Promise<PlayerView> {
    return this.match.view(this.player);
  }

  async submit(orders: readonly Order[]): Promise<SubmitResult> {
    return this.match.submit(this.player, orders);
  }
}
