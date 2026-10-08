import { h } from '../../../../platform/web/dom';
import { PublicState, planetsOf, productionOf, shipsOf } from '../../api';
import { colorOf } from '../colors';
import { t } from '../i18n';

/**
 * The players, best first: the winner, then those still in (by planets, then ships), then the
 * eliminated. As KDE's score dialog, with the counts of the game so far.
 */
export function standingsTable(state: PublicState, names: readonly string[]): HTMLElement {
  const rows = state.players
    .map((p) => ({
      p,
      planets: planetsOf(state, p.id),
      ships: shipsOf(state, p.id),
      production: productionOf(state, p.id),
    }))
    .sort(
      (a, b) =>
        Number(b.p.id === state.winner) - Number(a.p.id === state.winner) ||
        Number(b.p.alive) - Number(a.p.alive) ||
        b.planets - a.planets ||
        b.ships - a.ships,
    );
  const num = (n: number) => h('td', null, String(n));
  return h(
    'div.kq-stats-wrap',
    null,
    h(
      'table.stats',
      null,
      h(
        'tr',
        null,
        ...[
          'stats.player',
          'stats.planets',
          'stats.ships',
          'stats.production',
          'stats.shipsBuilt',
          'stats.planetsConquered',
          'stats.fleetsLaunched',
          'stats.fleetsDestroyed',
          'stats.shipsDestroyed',
        ].map((key) => h('th', null, t(key as Parameters<typeof t>[0]))),
      ),
      ...rows.map(({ p, planets, ships, production }) =>
        h(
          'tr',
          { class: `${p.id === state.winner ? 'winner' : ''} ${p.alive ? '' : 'out'}` },
          h('td', null, h('span.swatch', { style: `--fill:${colorOf(p.id)}` }), ' ', names[p.id]),
          num(planets),
          num(ships),
          num(production),
          num(p.stats.shipsBuilt),
          num(p.stats.planetsConquered),
          num(p.stats.fleetsLaunched),
          num(p.stats.enemyFleetsDestroyed),
          num(p.stats.enemyShipsDestroyed),
        ),
      ),
    ),
  );
}
