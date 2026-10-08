import { AnyGame } from './game';
import { BotMessage, RefereeMessage } from './protocol';

/** Languages participants may submit bots in. */
export type Language = 'python' | 'javascript';
export const LANGUAGES: readonly Language[] = ['python', 'javascript'];

/**
 * A trusted bot that runs inside the referee's process: the organizer's reference opponents.
 * It speaks the bot protocol, as objects instead of lines. Never used for participants' code.
 */
export interface InProcessBot {
  receive(message: RefereeMessage): Promise<BotMessage | null> | BotMessage | null;
  /** Called when the referee is done with the bot: abandon any work in progress. */
  stop?(): void;
}

export interface BuiltinBot {
  /** Unique within the game, e.g. "okoye:3". Referred to as "builtin:<id>". */
  id: string;
  name: string;
  description: string;
  create(): InProcessBot;
}

/** A starter bot that `jam new` copies, with the SDK files it needs. Paths are relative to the repository. */
export interface BotTemplate {
  dir: string;
  sdk: readonly string[];
}

/** Everything an edition's game brings to the platform. */
export interface GamePackage {
  game: AnyGame;
  /** A sentence for listings. */
  summary: string;
  builtins: readonly BuiltinBot[];
  templates: Partial<Record<Language, BotTemplate>>;
  /** Defaults for matches and tournaments. */
  defaults: {
    maxTurns: number;
    variants: readonly string[];
    /** The built-in bot that `jam check` plays a new bot against: simple and quick. */
    sparring: string;
  };
  /**
   * The Phase-1 checks of `npm run research` (Design.md §2), as built-in bot ids: bots that play
   * themselves for seat balance, and duels of the generic search baseline (first) against
   * hand-written strategy (second).
   */
  research: {
    balance: readonly string[];
    versus: readonly (readonly [string, string])[];
  };
}
