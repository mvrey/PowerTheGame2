import { describe, expect, it } from 'vitest';
import { GAMES } from '../src/games';
import { VIEWERS } from '../src/games/viewers';

// What every game registers with the platform must hold together: a duel format for the World Cup,
// built-in bots for `jam check` and `npm run research`, default variants it has, and a viewer.

describe.each(GAMES.map((pkg) => [pkg.game.id, pkg] as const))('the %s package', (_id, pkg) => {
  const builtins = new Set(pkg.builtins.map((b) => b.id));

  it('names built-in bots that exist', () => {
    expect(builtins.has(pkg.defaults.sparring)).toBe(true);
    for (const id of [...pkg.research.balance, ...pkg.research.versus.flat()]) expect(builtins, id).toContain(id);
  });

  it('has a duel, its default variants, and a viewer', () => {
    expect(pkg.game.formats.some((f) => f.players === 2)).toBe(true);
    for (const v of pkg.defaults.variants) expect(pkg.game.variants).toContain(v);
    expect(VIEWERS.some((v) => v.game === pkg.game)).toBe(true);
  });
});
