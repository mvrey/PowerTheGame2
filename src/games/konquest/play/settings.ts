import { readStored, removeStored, writeStored } from '../../../platform/web/storage';
import type { BotLevel, FleetOrder, GameState, Rules } from '../api';
import type { Message } from './game/messages';
import { Lang } from './i18n';

/** Animation of a turn: 1 normal, 2 fast, 3 instant. */
export type Speed = 1 | 2 | 3;
export const SPEEDS: readonly Speed[] = [1, 2, 3];

export interface Settings {
  lang: Lang;
  speed: Speed;
}

/** Who sits in a seat: someone at this computer, or a bot from the registry. */
export interface SeatConfig {
  name: string;
  kind: 'human' | 'ai';
  /** Registry id of the bot playing an 'ai' seat. */
  bot?: string;
  level?: BotLevel;
}

/** KDE's options that change only what the screen shows. */
export interface Display {
  blindMap: boolean;
  neutralShips: boolean;
  neutralStats: boolean;
}

export interface Setup {
  /** A galaxy id, or 'custom'. */
  galaxy: string;
  width: number;
  height: number;
  neutrals: number;
  /** Fair placement of homes (off: everything at random, as KDE does). */
  fair: boolean;
  seed: number;
  players: SeatConfig[];
  rules: Rules;
  display: Display;
  /** 0: no limit, as in KDE. */
  turnLimit: number;
}

export interface SavedGame {
  v: 1;
  setup: Setup;
  state: GameState;
  /** By seat: the standing orders of the humans. */
  standing: FleetOrder[][];
  log: Message[];
}

const SETTINGS_KEY = 'konquest.settings';
const SAVE_KEY = 'konquest.save';
const SETUP_KEY = 'konquest.setup';

const DEFAULTS: Settings = {
  lang: typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('es') ? 'es' : 'en',
  speed: 1,
};

export const settings: Settings = { ...DEFAULTS, ...(readStored<Partial<Settings>>(SETTINGS_KEY) ?? {}) };
export const saveSettings = () => writeStored(SETTINGS_KEY, settings);

export function loadGame(): SavedGame | null {
  const save = readStored<SavedGame>(SAVE_KEY);
  return save?.v === 1 && save.state && !save.state.over ? save : null;
}
export const saveGame = (save: SavedGame) => writeStored(SAVE_KEY, save);
export const clearSave = () => removeStored(SAVE_KEY);

export const loadSetup = () => readStored<Setup>(SETUP_KEY);
export const saveSetup = (setup: Setup) => writeStored(SETUP_KEY, setup);
