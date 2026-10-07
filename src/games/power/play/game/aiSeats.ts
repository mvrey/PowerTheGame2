import {
  Bot,
  BotLevel,
  LocalGameClient,
  Match,
  Order,
  Rng,
  playTurn,
  randomSeed,
  runHeadless,
  seatRng,
  timeSlicer,
} from '../../api';
import { DEFAULT_BOT_ID, bots } from '../../bots';
import { wait } from '../dom';
import { SeatConfig } from '../settings';

/** Bots get the thread back to the page after thinking this long, so animations stay smooth. */
const THINK_SLICE_MS = 9;
/** Most rounds played when the rest of a game is finished without animation. */
const MAX_INSTANT_ROUNDS = 60;

/** The bots playing the AI seats of a game in the browser. */
export class AiSeats {
  private readonly bots: (Bot | null)[];
  private readonly rngs: Rng[];
  private readonly abort = new AbortController();
  private thinking: Promise<void> = Promise.resolve();

  constructor(
    private readonly match: Match,
    private readonly seats: SeatConfig[],
  ) {
    this.bots = match.state.players.map((p) => (this.isAi(p.id) ? this.createBot(p.id) : null));
    const seed = randomSeed();
    this.rngs = match.state.players.map((p) => seatRng(seed, p.id));
  }

  isAi(player: number): boolean {
    return this.seats[player]?.kind === 'ai';
  }

  /** Living AI players that have not handed in this round's orders yet. */
  get anyThinking(): boolean {
    return this.match.state.players.some((p) => this.isAi(p.id) && p.alive && !this.match.hasSubmitted(p.id));
  }

  /** The bots think while the human does, in slices so the page stays responsive. */
  startThinking(onBotDone: () => void): void {
    const signal = this.abort.signal;
    const checkpoint = this.checkpoint();
    this.thinking = (async () => {
      for (const p of this.match.state.players) {
        const bot = this.bots[p.id];
        if (!bot || !p.alive) continue;
        try {
          await playTurn(bot, new LocalGameClient(this.match, p.id), {
            rng: this.rngs[p.id],
            checkpoint,
            signal,
            onProblem: (problem) => console.warn(`Bot ${this.seats[p.id].bot} (player ${p.id}):`, problem),
          });
        } catch {
          return; // Aborted: the game was closed.
        }
        onBotDone();
      }
    })();
  }

  /** Settles once every bot has handed in its orders for the round. */
  get done(): Promise<void> {
    return this.thinking;
  }

  /** Stops every bot for good. */
  stop(): void {
    this.abort.abort();
  }

  /** Plays the rest of the game without animation: the same bots, at their quickest. */
  async finishGame(): Promise<void> {
    this.stop();
    const quick = this.match.state.players.map((p) => (this.isAi(p.id) ? this.createBot(p.id, 1) : null));
    await runHeadless(this.match, quick, {
      seed: randomSeed(),
      maxRounds: this.match.state.round + MAX_INSTANT_ROUNDS - 1,
    });
  }

  /** Orders the balanced general would give for `player`; a debugging stand-in for the human. */
  standIn(player: number): Promise<Order[]> {
    const general = bots.create(DEFAULT_BOT_ID, { level: 2 });
    return Promise.resolve(
      general.decide(this.match.view(player), {
        rng: seatRng(randomSeed(), player),
        checkpoint: this.checkpoint(),
        signal: this.abort.signal,
      }),
    );
  }

  /** The bot chosen for a seat; a bot that is no longer installed is replaced by the default general. */
  private createBot(player: number, level?: BotLevel): Bot {
    const seat = this.seats[player];
    const id = bots.has(seat.bot) ? seat.bot! : DEFAULT_BOT_ID;
    return bots.create(id, { level: level ?? seat.level ?? 2 });
  }

  private checkpoint(): () => Promise<void> {
    return timeSlicer(THINK_SLICE_MS, () => wait(0), this.abort.signal);
  }
}
