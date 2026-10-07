// The contract between the platform and a game. The referee, the replay verifier, the tournament
// and the viewer only ever talk to a game through this interface, so an edition of the jam is
// "the platform + one GameModule". See Docs/Platform.md, "Adding a game".

/** A way to play the game, e.g. a duel or a four-player free-for-all. */
export interface FormatInfo {
  id: string;
  /** Number of seats. */
  players: number;
  description: string;
}

/** Everything that defines a match before it starts. Recorded in the replay. */
export interface MatchSetup {
  /** One of the game's formats. */
  format: string;
  /** One of the game's variants (a map, a scenario...). */
  variant: string;
  /** The game decides the winner (by its own tiebreak) once this many turns have been played. */
  maxTurns: number;
  /** For games with chance. Never shown to bots beyond what the rules allow. */
  seed: number;
}

/** Why part of a bot's answer was not accepted. Sent back to the bot and kept in the replay. */
export interface ActionProblem {
  code: string;
  /** Where in the answer, when it has parts (e.g. the index of an order). */
  index?: number;
}

/** How a seat finished. Rank 1 is best; seats that tie share a rank. */
export interface Placement {
  rank: number;
  /** A game-defined measure of how well the seat did (e.g. final material), for tiebreaks. */
  score: number;
}

export interface MatchResult {
  /** By seat. */
  placements: Placement[];
  /** How the match ended, in a word the game defines (e.g. 'conquest', 'turn-limit'). */
  reason: string;
}

/** What the game may tell a seat about the turn just played. The game decides what is public. */
export interface PreviousTurn<Action, Event> {
  turn: number;
  /** Every seat's accepted action (null for seats that did not act). */
  actions: (Action | null)[];
  events: Event[];
  /** The problems found in this seat's own answer. */
  problems: ActionProblem[];
}

/**
 * A game, as the platform sees it. Every function must be deterministic and must not mutate its
 * inputs: replays are verified by playing the recorded answers through it again.
 */
export interface GameModule<State, Action, Event> {
  readonly id: string;
  /** Bumped whenever the rules or the observation/action schemas change. Recorded in replays. */
  readonly version: string;
  readonly title: string;
  readonly formats: readonly FormatInfo[];
  readonly variants: readonly string[];

  setup(setup: MatchSetup): State;
  /** The turn about to be played (1-based). */
  turn(state: State): number;
  /** Seats that must act now: every live seat in a simultaneous game, one seat in a sequential one. */
  toAct(state: State): number[];
  /** Facts a seat gets once, when the match starts (the board, the rules constants...). JSON-serialisable. */
  matchInfo(state: State, seat: number): unknown;
  /** What a seat sees before acting. JSON-serialisable. */
  observe(state: State, seat: number, previous: PreviousTurn<Action, Event> | null): unknown;
  /** Turns a bot's raw answer into an action, keeping what is legal and saying what was not. */
  parseAction(state: State, seat: number, raw: unknown): { action: Action; problems: ActionProblem[] };
  /** The action of a seat that gave no (usable) answer. */
  noAction(state: State, seat: number): Action;
  /** Plays a turn. `actions` is indexed by seat; seats that did not act hold noAction. */
  resolve(state: State, actions: readonly Action[]): { state: State; events: Event[] };
  /** The result once the match is over, null before. */
  result(state: State): MatchResult | null;
}

/** Any game, for registries and generic code that does not look inside states or actions. */
// Methods (not function properties) keep the parameters bivariant, so every GameModule fits here.
export type AnyGame = GameModule<unknown, unknown, unknown>;

/** The number of seats of a format. Throws on an unknown format. */
export function seatsOf(game: Pick<AnyGame, 'formats' | 'id'>, format: string): number {
  const info = game.formats.find((f) => f.id === format);
  if (!info) throw new Error(`${game.id} has no format "${format}"`);
  return info.players;
}
