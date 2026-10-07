import { GameModule } from './game';
import { fingerprint } from './random';
import { REPLAY_FORMAT, REPLAY_VERSION, Replay, TurnRecord } from './replay';

/** One turn of a replay, played again through the game. */
export interface ReplayStep<State, Action, Event> {
  record: TurnRecord;
  before: State;
  after: State;
  actions: Action[];
  events: Event[];
  /** By seat, what the game refused this time (should equal record.problems). */
  problems: TurnRecord['problems'];
}

/** The actions a turn record stands for: the game parses the recorded answers again. */
export function actionsOf<State, Action>(
  game: GameModule<State, Action, unknown>,
  state: State,
  record: Pick<TurnRecord, 'toAct' | 'responses' | 'failures'>,
) {
  const actions: Action[] = [];
  const problems: TurnRecord['problems'] = [];
  record.failures.forEach((failure, seat) => {
    if (record.toAct.includes(seat) && failure === null) {
      const parsed = game.parseAction(state, seat, record.responses[seat]);
      actions[seat] = parsed.action;
      problems[seat] = parsed.problems;
    } else {
      actions[seat] = game.noAction(state, seat);
      problems[seat] = [];
    }
  });
  return { actions, problems };
}

/** Plays a replay's turns again, yielding every state along the way. */
export function* replaySteps<State, Action, Event>(
  game: GameModule<State, Action, Event>,
  replay: Replay,
): Generator<ReplayStep<State, Action, Event>> {
  let state = game.setup(replay.match.setup);
  for (const record of replay.turns) {
    const { actions, problems } = actionsOf(game, state, record);
    const outcome = game.resolve(state, actions);
    yield { record, before: state, after: outcome.state, actions, events: outcome.events, problems };
    state = outcome.state;
  }
}

export interface Verification {
  ok: boolean;
  /** What differs, in plain words; empty when the replay checks out. */
  problems: string[];
}

/**
 * Checks a replay against the game: same initial state, and every recorded answer leads to the
 * same problems, events, states and final result. Fails on the first divergence.
 */
export function verifyReplay<State, Action, Event>(
  game: GameModule<State, Action, Event>,
  replay: Replay,
): Verification {
  const problems: string[] = [];
  const check = (ok: boolean, message: string) => {
    if (!ok) problems.push(message);
    return ok;
  };
  if (
    !check(
      replay.format === REPLAY_FORMAT && replay.formatVersion === REPLAY_VERSION,
      'not a replay of a supported version',
    )
  )
    return { ok: false, problems };
  if (!check(replay.game.id === game.id, `replay of ${replay.game.id}, not ${game.id}`)) return { ok: false, problems };
  check(
    replay.game.version === game.version,
    `recorded with ${game.id} ${replay.game.version}, checking with ${game.version}`,
  );
  if (!check(fingerprint(game.setup(replay.match.setup)) === replay.initialHash, 'the initial state differs'))
    return { ok: false, problems };

  let last: State | null = null;
  for (const step of replaySteps(game, replay)) {
    const turn = step.record.turn;
    const same =
      check(
        JSON.stringify(step.problems) === JSON.stringify(step.record.problems),
        `turn ${turn}: the refused orders differ`,
      ) &&
      check(JSON.stringify(step.events) === JSON.stringify(step.record.events), `turn ${turn}: the events differ`) &&
      check(fingerprint(step.after) === step.record.hash, `turn ${turn}: the resulting state differs`);
    if (!same) return { ok: false, problems };
    last = step.after;
  }
  const result = last === null ? game.result(game.setup(replay.match.setup)) : game.result(last);
  check(JSON.stringify(result) === JSON.stringify(replay.result), 'the final result differs');
  return { ok: problems.length === 0, problems };
}
