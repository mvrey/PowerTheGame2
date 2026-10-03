import { MERC, Match, Order, PIECES, RESERVE } from '../../api';
import { IconName } from '../icons';
import { armyName, nodeName, pieceName, t } from '../i18n';

/** How the game screen names places, players, armies and orders. The human is "you". */
export class GameNames {
  constructor(
    private readonly match: Match,
    private readonly me: number,
  ) {}

  place(node: number): string {
    return nodeName(node < 0 ? undefined : this.match.board.nodes[node]);
  }

  playerName(player: number): string {
    if (player === MERC) return t('game.mercs');
    return player === this.me ? t('common.you') : this.match.state.players[player].name;
  }

  /** Name used as the subject of a sentence: the human is referred to by colour. */
  subject(player: number): string {
    if (player !== this.me) return this.playerName(player);
    return `${this.match.state.players[player].armies.map(armyName).join(' + ')} (${t('common.you').toLowerCase()})`;
  }

  ownerName(army: number): string {
    return this.playerName(this.match.state.armies[army].controller);
  }

  armyTitle(army: number): string {
    const owner = this.ownerName(army);
    return `${armyName(army)} (${this.match.state.armies[army].controller === this.me ? owner.toLowerCase() : owner})`;
  }

  orderText(o: Order): string {
    switch (o.kind) {
      case 'move':
        return t('order.move', pieceName(o.type), this.place(o.from), this.place(o.to));
      case 'buy':
        return t('order.buy', pieceName(o.type), PIECES[o.type].power);
      case 'tradeUp':
        return t('order.tradeUp', pieceName(o.type), pieceName(PIECES[o.type].up!), this.place(o.at));
      case 'makeMissile':
        return t('order.makeMissile', this.place(o.at));
      case 'launch':
        return t(
          'order.launch',
          o.target === RESERVE ? t('node.reserveOf', armyName(o.targetArmy)) : this.place(o.target),
        );
    }
  }
}

/** The piece an order is about: what moves, is bought or comes out of it. */
export function orderIcon(o: Order): IconName {
  switch (o.kind) {
    case 'move':
    case 'buy':
      return o.type;
    case 'tradeUp':
      return PIECES[o.type].up!;
    case 'makeMissile':
    case 'launch':
      return 'M';
  }
}
