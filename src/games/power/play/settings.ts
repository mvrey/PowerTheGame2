import type { BotLevel, GameState, Mode, PlayerConfig } from '../api';
import { readStored as read, removeStored, writeStored as write } from '../../../platform/web/storage';
import { Lang } from './i18n';

/** Playback speed of a round: 1 normal, 2 fast, 3 very fast. */
export type Speed = 1 | 2 | 3;
export const SPEEDS: readonly Speed[] = [1, 2, 3];

export interface Settings {
  lang: Lang;
  music: number;
  sfx: number;
  voices: boolean;
  speed: Speed;
  hints: boolean;
}

/** Who sits in a seat: the person at this computer, or a bot from the registry. */
export interface SeatConfig extends PlayerConfig {
  kind: 'human' | 'ai';
  /** Registry id of the bot playing an 'ai' seat. */
  bot?: string;
  level?: BotLevel;
}

export interface Setup {
  map?: string;
  mode: Mode;
  players: SeatConfig[];
  orderTimer: boolean;
  gameLimit: boolean;
}

export interface SavedGame {
  v: 3;
  setup: Setup;
  state: GameState;
  elapsedMs: number;
  log: string[];
}

const SETTINGS_KEY = 'power.settings';
const SAVE_KEY = 'power.save';
const SETUP_KEY = 'power.setup';

const DEFAULTS: Settings = {
  lang: typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('es') ? 'es' : 'en',
  music: 0.5,
  sfx: 0.8,
  voices: true,
  speed: 1,
  hints: true,
};

export const settings: Settings = { ...DEFAULTS, ...(read<Partial<Settings>>(SETTINGS_KEY) ?? {}) };
export const saveSettings = () => write(SETTINGS_KEY, settings);

/** Before version 3, AI seats named their general in `general` instead of `bot`. */
function migrateSetup(setup: Setup | null): Setup | null {
  if (!setup?.players) return setup;
  for (const seat of setup.players as (SeatConfig & { general?: string })[]) {
    if (seat.kind === 'ai' && !seat.bot && seat.general) seat.bot = seat.general;
    delete seat.general;
  }
  return setup;
}

export function loadGame(): SavedGame | null {
  const save = read<Omit<SavedGame, 'v'> & { v: number }>(SAVE_KEY);
  if (!save || (save.v !== 2 && save.v !== 3) || !save.state || save.state.over) return null;
  migrateSetup(save.setup);
  return { ...save, v: 3 };
}
export const saveGame = (save: SavedGame) => write(SAVE_KEY, save);
export const clearSave = () => removeStored(SAVE_KEY);

export const loadSetup = () => migrateSetup(read<Setup>(SETUP_KEY));
export const saveSetup = (setup: Setup) => write(SETUP_KEY, setup);
