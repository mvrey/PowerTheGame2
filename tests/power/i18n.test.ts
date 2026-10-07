import { afterAll, describe, expect, it, vi } from 'vitest';
import { ARMY_IDS, BOT_LEVELS, MAPS, MODES, ORDER_ERRORS, PIECE_TYPES } from '../../src/games/power/api';
import {
  Lang,
  armyName,
  errorText,
  levelName,
  mapName,
  mapText,
  modeName,
  pieceName,
  setLang,
  speedName,
} from '../../src/games/power/play/i18n';
import { SPEEDS } from '../../src/games/power/play/settings';

// Texts are looked up with keys built from game data (map ids, error codes...). Adding a map or
// an order error without its texts compiles fine, so this is where it gets caught.

vi.stubGlobal('document', { documentElement: {} });
afterAll(() => vi.unstubAllGlobals());

describe.each(['es', 'en'] as Lang[])('texts in %s', (lang) => {
  const missing = (cases: [string, string][]) => cases.filter(([key, text]) => text === key).map(([key]) => key);

  it('exist for every value of the game data', () => {
    setLang(lang);
    expect(
      missing([
        ...MAPS.flatMap((m): [string, string][] => [
          [`map.${m.id}`, mapName(m.id)],
          [`map.${m.id}.text`, mapText(m.id)],
        ]),
        ...ARMY_IDS.map((a): [string, string] => [`army.${a}`, armyName(a)]),
        ...[...PIECE_TYPES, 'P' as const].map((p): [string, string] => [`piece.${p}`, pieceName(p)]),
        ...ORDER_ERRORS.map((e): [string, string] => [`err.${e}`, errorText(e)]),
        ...BOT_LEVELS.map((l): [string, string] => [`level.${l}`, levelName(l)]),
        ...SPEEDS.map((s): [string, string] => [`opt.speed.${s}`, speedName(s)]),
        ...MODES.map((m): [string, string] => [`setup.players.${m}`, modeName(m)]),
      ]),
    ).toEqual([]);
  });
});
