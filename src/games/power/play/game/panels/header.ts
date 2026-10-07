import { clear, h } from '../../dom';
import { mapName, t } from '../../i18n';
import { formatClock } from '../clock';

/** The order timer turns red in its last half minute. */
const URGENT_MS = 30000;

export interface HeaderModel {
  round: number;
  phase: string;
  /** Time left to write orders, when the order timer applies now. */
  orderMsLeft: number | null;
  /** The game limit, when it is on. */
  gameLimit: { lastRound: boolean; msLeft: number } | null;
  mapId: string;
  refereeName: string;
  onMenu(): void;
}

/** Round, phase, clocks and the menu button above the order sheet. */
export class RoundHeader {
  readonly el = h('div.round-head');

  render(m: HeaderModel): void {
    clear(this.el);
    const orderClock =
      m.orderMsLeft === null
        ? null
        : h(
            'div.clock',
            { class: m.orderMsLeft < URGENT_MS ? 'urgent' : '', title: t('game.phase.plan') },
            formatClock(m.orderMsLeft),
          );
    const gameClock =
      m.gameLimit === null
        ? null
        : h(
            'div.game-clock',
            { class: m.gameLimit.lastRound ? 'urgent' : '' },
            m.gameLimit.lastRound ? t('game.lastRound') : '⏱ ' + formatClock(m.gameLimit.msLeft),
          );
    this.el.append(
      h(
        'div.round-row',
        null,
        h('div', null, h('div.round-n', null, t('game.round', m.round)), h('div.phase', null, m.phase)),
        orderClock,
        h('button.btn.small', { onclick: m.onMenu, title: 'Esc' }, '☰ ' + t('game.menu')),
      ),
      h('div.round-sub', null, h('span', null, `${mapName(m.mapId)} · ${t('game.referee', m.refereeName)}`), gameClock),
    );
  }
}
