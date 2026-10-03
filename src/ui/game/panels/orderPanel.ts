import { Order, OrderError } from '../../../api';
import { clear, h } from '../../dom';
import { chip } from '../../icons';
import { errorText, t } from '../../i18n';
import { settings } from '../../settings';
import { orderIcon } from '../names';

/** An order as it was carried out during playback. */
export interface PlayedOrder {
  order: Order;
  error: OrderError | null;
}

export interface PlanningSheet {
  orders: readonly Order[];
  max: number;
  describe(order: Order): string;
  onRemove(index: number): void;
  onUndo(): void;
  onClear(): void;
  onSubmit(): void;
}

export interface PlaybackSheet {
  /** Heading for the orders being played, or null between players. */
  title: string | null;
  played: readonly PlayedOrder[];
  describe(order: Order): string;
  /** Offer to skip the rest of the animation. */
  onSkip: (() => void) | null;
}

/** The order list on the right and the buttons under it. */
export class OrderPanel {
  readonly sheetEl = h('div.sheet');
  readonly actionsEl = h('div.sheet-actions');

  /** The human's orders while planning: one slot per order allowed. */
  showPlanning(m: PlanningSheet): void {
    this.clear();
    this.sheetEl.append(
      h('h3', null, t('game.orders'), h('span.count', null, t('game.ordersLeft', m.orders.length, m.max))),
    );
    const list = h('ol.orders');
    m.orders.forEach((o, i) => {
      list.append(
        h(
          'li',
          null,
          chip(orderIcon(o), o.army),
          h('span.order-text', null, m.describe(o)),
          h('button.x', { title: t('game.undo'), onclick: () => m.onRemove(i) }, '✕'),
        ),
      );
    });
    for (let i = m.orders.length; i < m.max; i++) list.append(h('li.empty', null, h('span.slot', null, '·')));
    this.sheetEl.append(list);
    if (!m.orders.length && settings.hints) this.sheetEl.append(h('p.muted', null, t('game.noOrders')));
    this.actionsEl.append(
      h('button.btn', { disabled: !m.orders.length, onclick: m.onUndo }, t('game.undo')),
      h('button.btn', { disabled: !m.orders.length, onclick: m.onClear }, t('game.clearAll')),
      h('button.btn.primary.wide', { onclick: m.onSubmit }, t('game.submit')),
    );
  }

  /** The orders of the player being played, ticked or crossed as they are carried out. */
  showPlayback(m: PlaybackSheet): void {
    this.clear();
    if (m.title !== null) {
      this.sheetEl.append(h('h3', null, m.title));
      const list = h('ol.orders');
      for (const row of m.played) {
        list.append(
          h(
            'li',
            { class: row.error ? 'failed' : 'done' },
            chip(orderIcon(row.order), row.order.army),
            h('span.order-text', null, m.describe(row.order) + (row.error ? ` — ${errorText(row.error)}` : '')),
            h('span.mark', null, row.error ? '✗' : '✓'),
          ),
        );
      }
      this.sheetEl.append(list);
    }
    if (m.onSkip) this.actionsEl.append(h('button.btn.wide', { onclick: m.onSkip }, '⏭ ' + t('game.skip')));
  }

  private clear(): void {
    clear(this.sheetEl);
    clear(this.actionsEl);
  }
}
