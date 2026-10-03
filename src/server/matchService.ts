import { randomUUID } from 'node:crypto';
import {
  Bot,
  CreateMatchRequest,
  CreateMatchResponse,
  LocalGameClient,
  MAPS,
  Match,
  MatchStatus,
  MatchSummary,
  NUM_ARMIES,
  Order,
  PlayerView,
  RoundReport,
  Rng,
  SeatInfo,
  SubmitResult,
  defaultSeating,
  isBotLevel,
  isMode,
  movedPast,
  playTurn,
  randomSeed,
  seatRng,
  timeSlicer,
} from '../api';
import { BotRegistry } from '../bots';

/** A request the service cannot honour; `status` is the HTTP status that fits. */
export class ServiceError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface ServiceOptions {
  /** Bots that may play server-side seats. */
  registry: BotRegistry;
  /** Longest a status request waits for the next round (ms). */
  longPollMs?: number;
  /** Server bots pause to let requests through after thinking this long (ms). */
  botSliceMs?: number;
  /** Finished matches kept for reading; the oldest are forgotten beyond this. */
  keepFinished?: number;
  log?: (message: string) => void;
}

interface Seat extends SeatInfo {
  instance?: Bot;
  rng: Rng;
}

interface Hosted {
  id: string;
  match: Match;
  seats: Seat[];
  maxRounds: number;
  orderTimeoutMs?: number;
  timer?: ReturnType<typeof setTimeout>;
  /** Stops this round's server bots. */
  round: AbortController;
  reports: RoundReport[];
  resolving: boolean;
}

const breathe = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * Matches hosted by the server. Seats are either remote (a client submits orders with the seat's
 * token) or played here by a registered bot. A round is played as soon as every living player has
 * handed in orders, or when the order timeout expires.
 */
export class MatchService {
  private readonly matches = new Map<string, Hosted>();
  private readonly registry: BotRegistry;
  private readonly longPollMs: number;
  private readonly botSliceMs: number;
  private readonly keepFinished: number;
  private readonly log: (message: string) => void;

  constructor(opts: ServiceOptions) {
    this.registry = opts.registry;
    this.longPollMs = opts.longPollMs ?? 25000;
    this.botSliceMs = opts.botSliceMs ?? 20;
    this.keepFinished = opts.keepFinished ?? 100;
    this.log = opts.log ?? (() => {});
  }

  create(req: CreateMatchRequest): CreateMatchResponse {
    if (!req || !Array.isArray(req.seats)) throw new ServiceError(400, 'seats: expected a list of seats');
    const mode = req.mode ?? req.seats.length;
    if (!isMode(mode)) throw new ServiceError(400, 'mode must be 2, 3 or 4');
    if (req.seats.length !== mode) throw new ServiceError(400, `a ${mode}-player match needs ${mode} seats`);
    if (req.map !== undefined && !MAPS.some((m) => m.id === req.map))
      throw new ServiceError(400, `unknown map "${req.map}"; maps: ${MAPS.map((m) => m.id).join(', ')}`);
    const maxRounds = req.maxRounds ?? 100;
    if (!Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > 1000)
      throw new ServiceError(400, 'maxRounds must be 1..1000');
    if (req.orderTimeoutMs !== undefined && !(Number.isFinite(req.orderTimeoutMs) && req.orderTimeoutMs >= 100))
      throw new ServiceError(400, 'orderTimeoutMs must be at least 100');

    const used = new Set<number>();
    const seed = Number.isInteger(req.seed) ? req.seed! : randomSeed();
    const seating = defaultSeating(mode);
    const seats: Seat[] = req.seats.map((s, player) => {
      const armies = s?.armies ?? seating[player];
      const perSeat = seating[0].length;
      const isFreeArmy = (a: unknown) =>
        Number.isInteger(a) && (a as number) >= 0 && (a as number) < NUM_ARMIES && !used.has(a as number);
      if (!Array.isArray(armies) || armies.length !== perSeat || !armies.every(isFreeArmy))
        throw new ServiceError(
          400,
          `seat ${player}: armies must be ${perSeat} distinct army numbers (0-${NUM_ARMIES - 1}) not used by another seat`,
        );
      armies.forEach((a) => used.add(a));
      const rng = seatRng(seed, player);
      if (s.bot === undefined)
        return { player, name: s.name ?? `Player ${player + 1}`, armies, token: randomUUID(), rng };
      if (!this.registry.has(s.bot)) throw new ServiceError(400, `seat ${player}: unknown bot "${s.bot}"`);
      const level = s.level ?? 2;
      if (!isBotLevel(level)) throw new ServiceError(400, `seat ${player}: level must be 1, 2 or 3`);
      const def = this.registry.get(s.bot);
      return { player, name: s.name ?? def.name, armies, bot: def.id, instance: def.create({ level }), rng };
    });

    const match = Match.create({ map: req.map, mode, players: seats.map((s) => ({ name: s.name, armies: s.armies })) });
    const id = randomUUID().slice(0, 8);
    const hosted: Hosted = {
      id,
      match,
      seats,
      maxRounds,
      orderTimeoutMs: req.orderTimeoutMs,
      round: new AbortController(),
      reports: [],
      resolving: false,
    };
    this.matches.set(id, hosted);
    this.forgetOldMatches();
    this.log(`match ${id}: ${match.state.map}, ${seats.map((s) => s.bot ?? 'remote').join(' / ')}`);
    this.beginRound(hosted);
    return { id, seats: seats.map((s) => this.seatInfo(s, true)), status: match.status() };
  }

  list(): MatchSummary[] {
    return [...this.matches.values()].map((h) => this.summary(h));
  }

  summary(id: string | Hosted): MatchSummary {
    const h = typeof id === 'string' ? this.get(id) : id;
    return { id: h.id, seats: h.seats.map((s) => this.seatInfo(s, false)), ...h.match.status() };
  }

  /** The status; with `afterRound`, waits (up to the long-poll limit) for the match to move past that round. */
  status(id: string, afterRound?: number): Promise<MatchStatus> {
    const { match } = this.get(id);
    const now = match.status();
    if (afterRound === undefined || movedPast(now, afterRound)) return Promise.resolve(now);
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        stop();
        resolve(match.status());
      };
      const timer = setTimeout(done, this.longPollMs);
      const stop = match.onRound((report) => {
        if (movedPast(report.status, afterRound)) done();
      });
    });
  }

  view(id: string, player: number): PlayerView {
    const { match } = this.get(id);
    if (!match.state.players[player]) throw new ServiceError(404, `no player ${player}`);
    return match.view(player);
  }

  submit(id: string, player: number, token: string | undefined, orders: unknown): SubmitResult {
    const h = this.get(id);
    const seat = h.seats[player];
    if (!seat) throw new ServiceError(404, `no player ${player}`);
    if (seat.bot) throw new ServiceError(403, `player ${player} is played by the server bot "${seat.bot}"`);
    if (!token || token !== seat.token) throw new ServiceError(403, 'wrong or missing token for this seat');
    const result = h.match.submit(player, orders as Order[]);
    if (result.accepted) this.maybeResolve(h);
    return result;
  }

  /** Reports of the rounds played after round `since`. */
  rounds(id: string, since = 0): RoundReport[] {
    return this.get(id).reports.filter((r) => r.round > since);
  }

  /** Stops every timer and server bot (for shutting down). */
  close(): void {
    for (const h of this.matches.values()) {
      clearTimeout(h.timer);
      h.round.abort();
    }
  }

  private get(id: string): Hosted {
    const h = this.matches.get(id);
    if (!h) throw new ServiceError(404, `no match "${id}"`);
    return h;
  }

  private seatInfo(s: Seat, withToken: boolean): SeatInfo {
    const info: SeatInfo = { player: s.player, name: s.name, armies: s.armies };
    if (s.bot) info.bot = s.bot;
    if (withToken && s.token) info.token = s.token;
    return info;
  }

  private beginRound(h: Hosted): void {
    const { match } = h;
    if (match.state.over) return;
    h.round = new AbortController();
    const signal = h.round.signal;
    if (h.orderTimeoutMs !== undefined) h.timer = setTimeout(() => this.resolve(h), h.orderTimeoutMs);
    const checkpoint = timeSlicer(this.botSliceMs, breathe, signal);
    for (const seat of h.seats) {
      if (!seat.instance || !match.state.players[seat.player].alive) continue;
      void playTurn(seat.instance, new LocalGameClient(match, seat.player), {
        rng: seat.rng,
        checkpoint,
        signal,
        onProblem: (problem) =>
          this.log(`match ${h.id}: bot ${seat.bot} (player ${seat.player}) ${problem.kind} in round ${problem.round}`),
      }).then(
        () => this.maybeResolve(h),
        () => {},
      );
      // Rejections only come from aborts: the round was played without this bot.
    }
  }

  private maybeResolve(h: Hosted): void {
    // Deferred so the submitter gets its answer first; re-checked because another submission
    // in the meantime may already have played the round.
    if (h.match.ready) setImmediate(() => h.match.ready && this.resolve(h));
  }

  private resolve(h: Hosted): void {
    if (h.resolving || h.match.state.over) return;
    h.resolving = true;
    try {
      clearTimeout(h.timer);
      h.round.abort();
      const report = h.match.resolveRound({ lastRound: h.match.state.round >= h.maxRounds });
      h.reports.push(report);
      if (report.status.over)
        this.log(
          `match ${h.id}: over after round ${report.round}, winners ${report.status.winners.join(', ') || 'none'}`,
        );
    } finally {
      h.resolving = false;
    }
    this.beginRound(h);
  }

  private forgetOldMatches(): void {
    const finished = [...this.matches.values()].filter((h) => h.match.state.over);
    for (const h of finished.slice(0, Math.max(0, finished.length - this.keepFinished))) this.matches.delete(h.id);
  }
}
