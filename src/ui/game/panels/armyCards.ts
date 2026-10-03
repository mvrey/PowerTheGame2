import {
  ARMY_IDS,
  GROUP1,
  MERC,
  PIECES,
  PIECE_TYPES,
  PieceType,
  RESERVE,
  ReadonlyGameState,
  Snapshot,
  mayCommand,
  piecesPower,
} from '../../../api';
import { clear, h } from '../../dom';
import { ARMY_COLORS, chip } from '../../icons';
import { armyName, pieceName, t } from '../../i18n';
import { PlanningController } from '../planning';

/** How long a "+3" or "💥" bubble stays on a card. */
const BUBBLE_MS = 1200;

export interface CardsModel {
  /** The pieces to show (the draft while planning, the playback frame during a round). */
  view: Snapshot;
  state: ReadonlyGameState;
  me: number;
  /** The human may give orders now. */
  canGiveOrders: boolean;
  /** Player whose orders are being played, or -1. */
  activePlayer: number;
  referee: number;
  /** "Thinking" / "Ready" for an AI controller while planning; empty otherwise. */
  statusOf(controller: number): string;
  ownerName(army: number): string;
}

/** One card per army on the left: owner, Power, strength, flags, Reserve and the Reserve's orders. */
export class ArmyCards {
  readonly el = h('div.cards');
  private reserveEls: HTMLElement[] = [];
  private cardEls: HTMLElement[] = [];

  constructor(private readonly planning: PlanningController) {}

  render(m: CardsModel): void {
    clear(this.el);
    this.reserveEls = [];
    this.cardEls = [];
    for (const army of ARMY_IDS) {
      const reserve = this.reserve(m, army);
      const card = this.card(m, army, reserve);
      this.reserveEls[army] = reserve;
      this.cardEls[army] = card;
      this.el.append(card);
    }
  }

  /** Screen point of an army's Reserve, where captured and bought pieces fly to. */
  reservePoint(army: number): { x: number; y: number } {
    const r = (this.reserveEls[army] ?? this.el).getBoundingClientRect();
    return { x: r.left + Math.min(r.width / 2, 60), y: r.top + r.height / 2 };
  }

  /** A short-lived note on an army's card. */
  bubble(army: number, text: string): void {
    const card = this.cardEls[army];
    if (!card) return;
    const el = h('span.bubble', null, text);
    card.append(el);
    setTimeout(() => el.remove(), BUBBLE_MS);
  }

  private card(m: CardsModel, army: number, reserve: HTMLElement): HTMLElement {
    const { controller } = m.state.armies[army];
    const alive = m.view.alive[army];
    const colors = ARMY_COLORS[army];
    const status = alive ? m.statusOf(controller) : t('game.eliminated');
    const actions = this.actions(m, army);
    const flags = h(
      'span.flags',
      { title: t('game.flags') },
      ...m.view.flags[army].map((f) =>
        h('span.flag', {
          style: `color:${ARMY_COLORS[f].fill}`,
          html: '<svg viewBox="0 0 32 22"><use href="#ic-FLAG"/></svg>',
        }),
      ),
    );
    const referee =
      controller !== MERC && m.referee === controller && alive
        ? h('span.referee', { title: t('game.refereeMark') }, '⚖')
        : null;
    const classes = [
      alive ? '' : 'dead',
      controller === m.me ? 'mine' : '',
      controller === MERC ? 'merc' : '',
      m.activePlayer !== -1 && controller === m.activePlayer ? 'active' : '',
    ];
    return h(
      'section.card',
      { class: classes.join(' '), style: `--fill:${colors.fill};--dark:${colors.dark}` },
      h(
        'header',
        null,
        h('span.swatch'),
        h('span.card-name', null, armyName(army)),
        h('span.card-owner', null, m.ownerName(army)),
        referee,
        status ? h('span.status', null, status) : null,
      ),
      h(
        'div.card-stats',
        null,
        h('span.stat', { title: t('game.power') }, chip('P', army), h('b', null, String(m.view.power[army]))),
        h(
          'span.stat',
          { title: t('game.strength') },
          'Σ ',
          h('b', null, String(m.view.power[army] + piecesPower(m.view.pieces, army))),
        ),
        flags,
      ),
      reserve,
      actions.childElementCount ? actions : null,
    );
  }

  /** The Reserve's pieces; clicking one deploys it (or aims a megamissile) when the army takes orders. */
  private reserve(m: CardsModel, army: number): HTMLElement {
    const commandable = this.commandable(m, army);
    const el = h('div.reserve');
    for (const type of PIECE_TYPES) {
      const n = reserveCount(m.view, army, type);
      if (!n) continue;
      if (!commandable) {
        el.append(chip(type, army, n, { title: pieceName(type) }));
      } else if (type === 'M') {
        el.append(
          chip(type, army, n, { title: t('game.launch'), onclick: () => this.planning.startTargeting(army, RESERVE) }),
        );
      } else {
        el.append(
          chip(type, army, n, {
            title: `${pieceName(type)} · ${t('game.deploy')}`,
            onclick: () => this.planning.deploy(army, type),
          }),
        );
      }
    }
    if (!el.childElementCount) el.append(h('span.muted', null, m.view.alive[army] ? t('game.reserveEmpty') : '—'));
    return el;
  }

  /** Buying, trading up and building a missile in the Reserve; aiming a missile at this army's Reserve. */
  private actions(m: CardsModel, army: number): HTMLElement {
    const el = h('div.card-actions');
    if (this.commandable(m, army)) {
      const power = m.view.power[army];
      el.append(h('span.muted', null, t('game.buy') + ':'));
      for (const type of GROUP1) {
        const cost = PIECES[type].power;
        const button = chip(type, army, 1, {
          title: t('order.buy', pieceName(type), cost),
          disabled: power < cost || this.planning.ordersLeft(army) <= 0,
          onclick: () => this.planning.tryAdd({ kind: 'buy', army, type }),
        });
        button.append(h('i', null, String(cost)));
        el.append(button);
      }
      for (const type of GROUP1) {
        if (reserveCount(m.view, army, type) >= 3)
          el.append(
            h(
              'button.btn.small',
              { onclick: () => this.planning.tryAdd({ kind: 'tradeUp', army, type, at: RESERVE }) },
              t('game.tradeUp', pieceName(PIECES[type].up!)),
            ),
          );
      }
      if (this.planning.canMakeMissile(army, RESERVE))
        el.append(
          h(
            'button.btn.small',
            { onclick: () => this.planning.openMissileDialog(army, RESERVE) },
            t('game.makeMissile'),
          ),
        );
    }
    const aiming = this.planning.targetingArmy;
    if (m.canGiveOrders && aiming !== null && m.view.alive[army] && army !== aiming) {
      el.append(
        h(
          'button.btn.small.danger',
          { onclick: () => this.planning.aimAtReserve(army) },
          '🎯 ' + t('game.targetReserve'),
        ),
      );
    }
    return el;
  }

  private commandable(m: CardsModel, army: number): boolean {
    return m.canGiveOrders && m.view.alive[army] && mayCommand(m.state, m.me, army);
  }
}

function reserveCount(view: Snapshot, army: number, type: PieceType): number {
  return view.pieces.filter((p) => p.army === army && p.type === type && p.loc === RESERVE).length;
}
