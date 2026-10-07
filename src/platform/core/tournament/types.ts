import { MatchSetup, Placement } from '../game';
import { Limits } from '../protocol';
import { Failure } from '../replay';

// The World Cup format: groups with a round robin of duels plus a free-for-all set, then a
// knockout of seat-swapped series. See Docs/Tournament.md for the rules in plain words.

export interface Entrant {
  /** Unique in the tournament (the submission folder name, or "builtin:<id>"). */
  id: string;
  name: string;
}

export interface WorldCupConfig {
  /** Target group size (groups of this size or one less). */
  groupSize: number;
  /** Bots per group that go through to the playoff. */
  qualifiersPerGroup: number;
  /** Group duels: every pair plays every variant twice, seats swapped. */
  duel: { format: string; variants: string[]; maxTurns: number };
  /** The group's free-for-all set: one match per seat rotation. Format by player count; null to skip. */
  ffa: { formats: Record<string, string>; variants: string[]; maxTurns: number } | null;
  playoff: {
    variants: string[];
    maxTurns: number;
    /** Extra seat-swapped pairs when a series is level on points and material. */
    suddenDeath: number;
    thirdPlace: boolean;
    /** An unscored free-for-all of the semifinalists, for the show. */
    exhibition: boolean;
  };
  points: { win: number; draw: number; loss: number };
}

export type Stage = 'group' | 'playoff' | 'exhibition';

/** One match of the tournament, known in advance (groups) or once its entrants are (playoff). */
export interface Fixture {
  /** Stable and filename-safe: "A-D07", "A-F2", "QF1-G3", "F-SD1B", "EXH". */
  id: string;
  stage: Stage;
  group?: string;
  /** Playoff tie, e.g. "QF1". */
  tie?: string;
  kind: 'duel' | 'ffa';
  /** Entrant ids by seat. */
  seats: string[];
  setup: MatchSetup;
  /** For people: "Group A · duel 7 · ring". */
  label: string;
}

export interface FixtureResult {
  fixtureId: string;
  /** By seat, as the game ranked them. */
  placements: Placement[];
  /** Where the replay is stored, relative to the tournament folder. */
  replay: string;
  /** By seat: how often each bot failed to answer (for the organizer's disqualification rules). */
  failures?: Partial<Record<Failure, number>>[];
}

export interface StandingRow {
  id: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  /** Duel points plus free-for-all points. */
  points: number;
  duelPoints: number;
  ffaPoints: number;
  /** Duels: sum of (my score − opponent's score). */
  material: number;
}

export interface GroupState {
  name: string;
  entrants: string[];
  standings: StandingRow[];
  complete: boolean;
}

export type Decision = 'points' | 'material' | 'sudden death' | 'lottery' | 'bye';

export interface TieState {
  id: string;
  round: string;
  /** Entrant ids; null while not known yet, or for a bye. */
  a: string | null;
  b: string | null;
  fixtures: string[];
  score: [number, number];
  material: [number, number];
  winner: string | null;
  decidedBy: Decision | null;
}

export interface TournamentPlan {
  groups: GroupState[];
  /** Every fixture known so far, played or not. */
  fixtures: Fixture[];
  /** Fixtures that can be played now. */
  pending: Fixture[];
  playoff: { rounds: { name: string; ties: TieState[] }[]; thirdPlace: TieState | null } | null;
  /** Final ranking once the tournament is over. */
  ranking: string[] | null;
}

/** What a tournament was started with: a resumed run must match it exactly. */
export interface TournamentRecord {
  id: string;
  title: string;
  game: { id: string; version: string };
  platformVersion: string;
  seed: number;
  config: WorldCupConfig;
  limits: Limits;
  runner: string;
  entrants: (Entrant & { version: string })[];
}

/** The state of a tournament, published for the viewer after every match. */
export interface LiveStatus {
  record: TournamentRecord;
  plan: TournamentPlan;
  running: string[];
  results: FixtureResult[];
  updatedAt: string;
}
