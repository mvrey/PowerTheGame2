import { afterAll, describe, expect, it, vi } from 'vitest';
import { BOT_LEVELS, GALAXIES, ORDER_ERRORS } from '../../src/games/konquest/api';
import { bots } from '../../src/games/konquest/bots';
import { Lang, errorText, galaxyName, galaxyText, setLang, speedName, t } from '../../src/games/konquest/play/i18n';
import { SPEEDS } from '../../src/games/konquest/play/settings';

// Texts are looked up with keys built from game data (galaxy ids, error codes...). Adding a galaxy
// or an order error without its texts compiles fine, so this is where it gets caught.

vi.stubGlobal('document', { documentElement: {} });
afterAll(() => vi.unstubAllGlobals());

describe.each(['es', 'en'] as Lang[])('Konquest texts in %s', (lang) => {
  const missing = (cases: [string, string][]) => cases.filter(([key, text]) => text === key).map(([key]) => key);

  it('exist for every value of the game data', () => {
    setLang(lang);
    expect(
      missing([
        ...[...GALAXIES.map((g) => g.id), 'custom'].flatMap((id): [string, string][] => [
          [`galaxy.${id}`, galaxyName(id)],
          [`galaxy.${id}.text`, galaxyText(id)],
        ]),
        ...ORDER_ERRORS.map((e): [string, string] => [`err.${e}`, errorText(e)]),
        ...BOT_LEVELS.map((l): [string, string] => [`level.${l}`, t(`level.${l}`)]),
        ...SPEEDS.map((s): [string, string] => [`opt.speed.${s}`, speedName(s)]),
      ]),
    ).toEqual([]);
  });

  it('every bot with levels of its own names them in this language', () => {
    for (const def of bots.list())
      for (const level of BOT_LEVELS) {
        const name = def.levelNames?.[level];
        if (name && lang === 'es') expect(typeof name === 'object' && name.es, `${def.id}:${level}`).toBeTruthy();
      }
  });
});
