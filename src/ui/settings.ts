import { GameConfig } from '../engine/game';
import { GameState } from '../engine/types';
import { Lang } from './i18n';

export interface Settings {
  lang: Lang;
  music: number;
  sfx: number;
  voices: boolean;
  speed: 1 | 2 | 3;
  hints: boolean;
}

export interface Setup extends GameConfig {
  orderTimer: boolean;
  gameLimit: boolean;
}

export interface SavedGame {
  v: 1;
  setup: Setup;
  state: GameState;
  elapsedMs: number;
  log: string[];
}

const SETTINGS_KEY = 'power.settings';
const SAVE_KEY = 'power.save';
const SETUP_KEY = 'power.setup';

const DEFAULTS: Settings = {
  lang: (typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('es')) ? 'es' : 'en',
  music: 0.5,
  sfx: 0.8,
  voices: true,
  speed: 1,
  hints: true,
};

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable (private mode, quota): the game simply does not persist.
  }
}

export const settings: Settings = { ...DEFAULTS, ...(read<Partial<Settings>>(SETTINGS_KEY) ?? {}) };
export const saveSettings = () => write(SETTINGS_KEY, settings);

export function loadGame(): SavedGame | null {
  const save = read<SavedGame>(SAVE_KEY);
  return save && save.v === 1 && save.state && !save.state.over ? save : null;
}
export const saveGame = (save: SavedGame) => write(SAVE_KEY, save);
export function clearSave(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    // Nothing to clear.
  }
}

export const loadSetup = () => read<Setup>(SETUP_KEY);
export const saveSetup = (setup: Setup) => write(SETUP_KEY, setup);
