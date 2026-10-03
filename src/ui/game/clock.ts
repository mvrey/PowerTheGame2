/** The optional time limit of a whole game (official rule): the round under way when it runs out is the last. */
export const GAME_LIMIT_MS = 2 * 60 * 60 * 1000;
const TICK_MS = 250;

export interface ClockOptions {
  /** Time already played (a continued game). */
  elapsedMs: number;
  gameLimit: boolean;
  /** Whether the clocks run now: only while the human writes orders. */
  isRunning(): boolean;
  /** Every tick while running. */
  onTick(): void;
  /** Once, when the game limit is reached. */
  onLastRound(): void;
  /** When the order timer runs out. */
  onTimeUp(): void;
}

/** The game's clocks: total time played and this round's order timer. Both stop while paused. */
export class GameClock {
  elapsedMs: number;
  orderMsLeft = Infinity;
  private pauses = 0;
  private lastTick = performance.now();
  private timer = 0;
  private lastRoundAnnounced = false;

  constructor(private readonly opts: ClockOptions) {
    this.elapsedMs = opts.elapsedMs;
  }

  start(): void {
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
  }

  stop(): void {
    clearInterval(this.timer);
  }

  /** Restarts the order timer for a new round (Infinity when it is off). */
  startOrderTimer(ms: number): void {
    this.orderMsLeft = ms;
    this.lastTick = performance.now();
  }

  /** Pauses nest: every pause needs its resume. */
  pause(): void {
    this.pauses++;
  }

  resume(): void {
    this.pauses = Math.max(0, this.pauses - 1);
    this.lastTick = performance.now();
  }

  /** Forgets every pending pause (the dialogs that held them were closed). */
  clearPauses(): void {
    this.pauses = 0;
  }

  get paused(): boolean {
    return this.pauses > 0;
  }

  get isLastRound(): boolean {
    return this.opts.gameLimit && this.elapsedMs >= GAME_LIMIT_MS;
  }

  get gameMsLeft(): number {
    return GAME_LIMIT_MS - this.elapsedMs;
  }

  private tick(): void {
    const now = performance.now();
    const dt = now - this.lastTick;
    this.lastTick = now;
    if (!this.opts.isRunning() || this.paused || document.hidden) return;
    this.elapsedMs += dt;
    this.orderMsLeft -= dt;
    if (this.isLastRound && !this.lastRoundAnnounced) {
      this.lastRoundAnnounced = true;
      this.opts.onLastRound();
    }
    this.opts.onTick();
    if (this.orderMsLeft <= 0) this.opts.onTimeUp();
  }
}

/** "1:05:09", "4:07". */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}
