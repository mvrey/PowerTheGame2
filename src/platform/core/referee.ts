import { ActionProblem, GameModule, MatchSetup, PreviousTurn, seatsOf } from './game';
import { DEFAULT_LIMITS, Limits, PROTOCOL_VERSION, RefereeMessage, asBotMessage } from './protocol';
import { botSeed, fingerprint } from './random';
import { Failure, REPLAY_FORMAT, REPLAY_VERSION, Replay, ReplayBot, SeatDiagnostics, TurnRecord } from './replay';
import { actionsOf } from './verify';
import { PLATFORM_VERSION } from './version';

/** What a connection to a bot delivers when the referee waits for it. */
export type Received =
  | { kind: 'message'; value: unknown }
  /** A line that is not JSON. */
  | { kind: 'invalid'; reason: string }
  | { kind: 'timeout' }
  /** The bot is gone (exited, crashed, or stopped for breaking a limit). Nothing more will come. */
  | { kind: 'closed'; reason: string };

/** A running bot, however it is hosted (sandboxed process, local process, in-process). */
export interface BotConnection {
  send(message: RefereeMessage): void;
  /** The next message, waiting at most `timeoutMs`. */
  receive(timeoutMs: number): Promise<Received>;
  /** Ends the bot: closes its input, gives it a moment, then kills it. Safe to call twice. */
  close(): Promise<{ exit: string; stderr: string }>;
}

/** Starts the bot of a seat. A launcher that throws leaves the seat without a bot. */
export type BotLauncher = () => Promise<BotConnection>;

export interface MatchOptions<State, Action, Event> {
  game: GameModule<State, Action, Event>;
  matchId: string;
  setup: MatchSetup;
  /** By seat. */
  bots: Omit<ReplayBot, 'seat'>[];
  /** By seat. */
  launchers: BotLauncher[];
  limits?: Partial<Limits>;
  /** Free text for viewers, e.g. "Group A · duel 3". */
  label?: string;
  /** Milliseconds clock, for answer times. */
  now?: () => number;
  /** Called after every turn (progress reports, live views). */
  onTurn?: (record: TurnRecord, state: State) => void;
}

/** A game that has not ended this many turns past its limit is considered broken. */
const TURN_LIMIT_SLACK = 10;

interface Seat {
  connection: BotConnection | null;
  ready: boolean;
  consecutiveTimeouts: number;
  failures: Partial<Record<Failure, number>>;
  exit: string;
  stderr: string;
}

/**
 * Plays one match: starts the bots, says hello, asks every seat to act each turn (in parallel,
 * with deadlines), lets the game resolve the turn, and records everything in a replay.
 *
 * A bot can never stop the match: a missing, late or broken answer becomes the game's noAction,
 * and a bot that crashes or keeps timing out is disconnected for the rest of the match.
 */
export async function runMatch<State, Action, Event>(o: MatchOptions<State, Action, Event>): Promise<Replay> {
  const { game, setup } = o;
  const limits: Limits = { ...DEFAULT_LIMITS, ...o.limits };
  const now = o.now ?? (() => Date.now());
  const players = seatsOf(game, setup.format);
  if (o.bots.length !== players || o.launchers.length !== players)
    throw new Error(`${setup.format} needs ${players} bots, got ${o.bots.length}`);
  const startedAt = new Date().toISOString();

  let state = game.setup(setup);
  const initialHash = fingerprint(state);
  const seats: Seat[] = await Promise.all(o.launchers.map((launch) => startSeat(launch)));
  try {
    await Promise.all(seats.map((seat, i) => greet(seat, i)));
    const turns: TurnRecord[] = [];
    /** The turn just played, with every seat's problems; each seat is shown only its own. */
    let last: (Omit<PreviousTurn<Action, Event>, 'problems'> & { problems: ActionProblem[][] }) | null = null;
    for (let result = game.result(state); !result; result = game.result(state)) {
      const turn = game.turn(state);
      if (turn > setup.maxTurns + TURN_LIMIT_SLACK) throw new Error(`${game.id} did not end after ${turn - 1} turns`);
      const toAct = game.toAct(state);
      const answers = await Promise.all(
        Array.from({ length: players }, (_, i) =>
          toAct.includes(i)
            ? ask(seats[i], turn, game.observe(state, i, last && { ...last, problems: last.problems[i] }))
            : Promise.resolve(null),
        ),
      );
      const responses = answers.map((a) => (a && a.failure === null ? a.response : null));
      const failures = answers.map((a) => a?.failure ?? null);
      // Parsed exactly as the replay verifier will parse them again.
      const { actions, problems } = actionsOf(game, state, { toAct, responses, failures });
      const outcome = game.resolve(state, actions);
      state = outcome.state;
      const record: TurnRecord = {
        turn,
        toAct,
        responses,
        failures,
        ms: answers.map((a) => a?.ms ?? null),
        problems,
        events: outcome.events,
        hash: fingerprint(state),
      };
      turns.push(record);
      o.onTurn?.(record, state);
      last = { turn, actions: actions.map((a, i) => (toAct.includes(i) ? a : null)), events: outcome.events, problems };
    }
    const result = game.result(state)!;
    seats.forEach((seat, i) => seat.connection?.send({ type: 'end', seat: i, result }));
    await Promise.all(seats.map(stop));
    return {
      format: REPLAY_FORMAT,
      formatVersion: REPLAY_VERSION,
      platformVersion: PLATFORM_VERSION,
      protocol: PROTOCOL_VERSION,
      game: { id: game.id, version: game.version },
      match: { id: o.matchId, setup, label: o.label },
      bots: o.bots.map((bot, seat) => ({ seat, ...bot })),
      initialHash,
      turns,
      result,
      diagnostics: seats.map((seat, i): SeatDiagnostics => ({
        seat: i,
        ready: seat.ready,
        exit: seat.exit,
        stderr: seat.stderr,
        failures: seat.failures,
      })),
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  } finally {
    await Promise.all(seats.map(stop));
  }

  async function startSeat(launch: BotLauncher): Promise<Seat> {
    const seat: Seat = { connection: null, ready: false, consecutiveTimeouts: 0, failures: {}, exit: '', stderr: '' };
    try {
      seat.connection = await launch();
    } catch (error) {
      seat.exit = `failed to start: ${error instanceof Error ? error.message : String(error)}`;
    }
    return seat;
  }

  /** hello → ready. A seat that does not get ready plays the whole match without answers. */
  async function greet(seat: Seat, index: number): Promise<void> {
    if (!seat.connection) return;
    seat.connection.send({
      type: 'hello',
      protocol: PROTOCOL_VERSION,
      game: { id: game.id, version: game.version },
      match: {
        id: o.matchId,
        format: setup.format,
        variant: setup.variant,
        maxTurns: setup.maxTurns,
        seat: index,
        players,
        seed: botSeed(setup.seed, index),
      },
      limits: { startupMs: limits.startupMs, turnMs: limits.turnMs, maxMessageBytes: limits.maxMessageBytes },
      info: game.matchInfo(state, index),
    });
    const received = await seat.connection.receive(limits.startupMs);
    if (received.kind === 'message' && asBotMessage(received.value)?.type === 'ready') {
      seat.ready = true;
      return;
    }
    count(seat, received.kind === 'timeout' ? 'timeout' : received.kind === 'closed' ? 'crashed' : 'invalid');
    await disconnect(seat);
  }

  /** Sends a turn and waits for its answer, discarding late answers to earlier turns. */
  async function ask(seat: Seat, turn: number, observation: ReturnType<typeof game.observe>) {
    const connection = seat.connection;
    if (!connection || !seat.ready) return fail(seat, 'disconnected');
    const start = now();
    connection.send({ type: 'turn', turn, deadlineMs: limits.turnMs, observation });
    for (;;) {
      const left = limits.turnMs - (now() - start);
      const received = left > 0 ? await connection.receive(left) : ({ kind: 'timeout' } as const);
      if (received.kind === 'timeout') {
        seat.consecutiveTimeouts++;
        if (seat.consecutiveTimeouts >= limits.maxConsecutiveTimeouts) await disconnect(seat);
        return fail(seat, 'timeout');
      }
      if (received.kind === 'closed') {
        await disconnect(seat);
        return fail(seat, 'crashed');
      }
      if (received.kind === 'invalid') return fail(seat, 'invalid');
      const message = asBotMessage(received.value);
      if (message?.type === 'action' && message.turn < turn) continue;
      if (message?.type !== 'action' || message.turn !== turn) return fail(seat, 'invalid');
      seat.consecutiveTimeouts = 0;
      return { response: message.action, failure: null, ms: Math.round(now() - start) };
    }
  }

  function fail(seat: Seat, failure: Failure) {
    if (failure !== 'timeout') seat.consecutiveTimeouts = 0;
    count(seat, failure);
    return { response: null, failure, ms: null };
  }

  function count(seat: Seat, failure: Failure): void {
    seat.failures[failure] = (seat.failures[failure] ?? 0) + 1;
  }

  async function disconnect(seat: Seat): Promise<void> {
    seat.ready = false;
    await stop(seat);
  }

  async function stop(seat: Seat): Promise<void> {
    const connection = seat.connection;
    if (!connection) return;
    seat.connection = null;
    const { exit, stderr } = await connection.close();
    seat.exit = exit;
    seat.stderr = stderr;
  }
}
