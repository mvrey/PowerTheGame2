import { BuiltinBot, InProcessBot } from './bots';
import { Rng, makeRng } from './random';

// What every game's built-in bots share, whatever they decide: difficulty levels, a registry the
// game's menus and the jam both list, cooperative time slicing, seeded random numbers per seat,
// and the wrapper that lets a bot speak the protocol in-process. Games type it with their own
// Bot (the function that decides a turn).

export type { Rng };

/** What the host lends a bot while it thinks. */
export interface BotContext {
  /** Seeded random numbers. Use these instead of Math.random. */
  readonly rng: Rng;
  /**
   * Await this now and then during long computations. It gives the host a chance to breathe
   * (the browser keeps animating, the referee keeps its deadlines) and throws once the host has
   * stopped waiting for an answer. It returns at once when no break is due, so it is cheap.
   */
  checkpoint(): Promise<void>;
  /** Aborted when the host no longer wants an answer (the game was closed, say). */
  readonly signal: AbortSignal;
}

/** Difficulty chosen in the menus: 1 easy, 2 medium, 3 hard. Bots may ignore it. */
export type BotLevel = 1 | 2 | 3;
export const BOT_LEVELS: readonly BotLevel[] = [1, 2, 3];
export const isBotLevel = (value: unknown): value is BotLevel => BOT_LEVELS.includes(value as BotLevel);

export interface BotOptions {
  level: BotLevel;
}

/** Text in English, optionally with a Spanish version. */
export type Localized = string | { en: string; es?: string };

/** A description in the given language, falling back to English. */
export function localize(text: Localized | undefined, lang: string): string {
  if (!text) return '';
  if (typeof text === 'string') return text;
  return (lang === 'es' && text.es) || text.en;
}

/** A kind of bot, as listed in a game's menus and as a built-in bot of the jam (builtin:<id>). */
export interface BotDefinition<B> {
  /** Unique, stable id (used in saves, URLs and command lines): lowercase letters, digits and dashes. */
  id: string;
  /** Name shown to players. */
  name: string;
  /** One line about how it plays. */
  description?: Localized;
  /** Whether the level makes a difference (the menus hide the level picker otherwise). Default true. */
  levels?: boolean;
  /** Names of the levels, when the bot has its own (e.g. "Weak", "Offensive", "Defensive"). */
  levelNames?: Record<BotLevel, Localized>;
  /** Position in lists; lower comes first. Default 100. */
  order?: number;
  /** A new bot for one seat of one game. */
  create(options: BotOptions): B;
}

const ID = /^[a-z0-9][a-z0-9-]*$/;

/** The bots available to a host: a game's menus and the jam's built-in bots are listed and created here. */
export class BotRegistry<B> {
  private readonly defs = new Map<string, BotDefinition<B>>();

  constructor(definitions: Iterable<BotDefinition<B>> = []) {
    for (const def of definitions) this.register(def);
  }

  register(def: BotDefinition<B>): this {
    if (!ID.test(def.id)) throw new Error(`Bot id "${def.id}" must use lowercase letters, digits and dashes`);
    if (this.defs.has(def.id)) throw new Error(`Two bots share the id "${def.id}"`);
    if (typeof def.create !== 'function') throw new Error(`Bot "${def.id}" has no create() function`);
    this.defs.set(def.id, def);
    return this;
  }

  has(id: string | undefined): boolean {
    return id !== undefined && this.defs.has(id);
  }

  get(id: string): BotDefinition<B> {
    const def = this.defs.get(id);
    if (!def) throw new Error(`Unknown bot "${id}". Known: ${[...this.defs.keys()].join(', ')}`);
    return def;
  }

  /** All definitions, in menu order. */
  list(): BotDefinition<B>[] {
    return [...this.defs.values()].sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.name.localeCompare(b.name));
  }

  create(id: string, options: BotOptions): B {
    return this.get(id).create(options);
  }
}

/**
 * Bot definitions exported by a module: its default export (one definition or an array of them)
 * plus any named export that looks like a definition.
 */
export function definitionsIn<B>(module: Record<string, unknown>): BotDefinition<B>[] {
  const found: BotDefinition<B>[] = [];
  const consider = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(consider);
    else if (isDefinition<B>(value) && !found.includes(value)) found.push(value);
  };
  consider(module.default);
  for (const [name, value] of Object.entries(module)) if (name !== 'default') consider(value);
  return found;
}

function isDefinition<B>(value: unknown): value is BotDefinition<B> {
  const v = value as BotDefinition<B> | null;
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.create === 'function'
  );
}

/**
 * A checkpoint that pauses (with `breathe`) once at least `sliceMs` have gone by since the last
 * pause, and throws once `signal` is aborted.
 */
export function timeSlicer(sliceMs: number, breathe: () => Promise<void>, signal?: AbortSignal): () => Promise<void> {
  let since = performance.now();
  return async () => {
    if (signal?.aborted) throw abortError(signal);
    if (performance.now() - since < sliceMs) return;
    await breathe();
    if (signal?.aborted) throw abortError(signal);
    since = performance.now();
  };
}

export function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new Error('Aborted');
}

/** The random numbers of one seat of a game: every seat gets its own stream from the game's seed. */
export function seatRng(seed: number, player: number): Rng {
  // Two primes keep the streams of neighbouring seeds and seats apart.
  return makeRng(seed * 7919 + player * 104729);
}

/** Built-in bots give the referee's timers a turn this often, so their deadlines are measured. */
const BREATHE_EVERY_MS = 9;

/**
 * A bot that answers protocol messages in-process: `decide` gets each turn's observation (and
 * the seat, from `hello`) and returns the action. It thinks in slices, with a seeded stream of
 * random numbers per seat, and is aborted when the match ends.
 */
export function protocolBot(
  decide: (observation: unknown, seat: number, ctx: BotContext) => unknown | Promise<unknown>,
): InProcessBot {
  let seat = 0;
  let rng: Rng = Math.random;
  const abort = new AbortController();
  return {
    async receive(message) {
      switch (message.type) {
        case 'hello':
          seat = message.match.seat;
          rng = seatRng(message.match.seed, seat);
          return { type: 'ready' };
        case 'turn': {
          const checkpoint = timeSlicer(
            BREATHE_EVERY_MS,
            () => new Promise((resolve) => setTimeout(resolve, 0)),
            abort.signal,
          );
          const action = await decide(message.observation, seat, { rng, checkpoint, signal: abort.signal });
          return { type: 'action', turn: message.turn, action };
        }
        case 'end':
          abort.abort();
          return null;
      }
    },
    stop: () => abort.abort(),
  };
}

const LEVEL_NAMES: Record<BotLevel, string> = { 1: 'Easy', 2: 'Medium', 3: 'Hard' };

/**
 * The bots of a registry as the jam's built-in bots: every level of a bot with levels
 * ("okoye:3"), and the bots without levels under their plain id ("rookie"). A bot's own
 * `levelNames` win over the game's `levelNames`.
 */
export function registryBuiltins<B>(
  registry: BotRegistry<B>,
  speak: (bot: B) => InProcessBot,
  levelNames: Record<BotLevel, string> = LEVEL_NAMES,
): BuiltinBot[] {
  const builtin = (def: BotDefinition<B>, level: BotLevel, id: string, name: string): BuiltinBot => ({
    id,
    name,
    description: localize(def.description, 'en'),
    create: () => speak(def.create({ level })),
  });
  return registry
    .list()
    .flatMap((def) =>
      def.levels === false
        ? [builtin(def, 2, def.id, def.name)]
        : BOT_LEVELS.map((level) =>
            builtin(
              def,
              level,
              `${def.id}:${level}`,
              `${def.name} (${def.levelNames ? localize(def.levelNames[level], 'en') : levelNames[level]})`,
            ),
          ),
    );
}
