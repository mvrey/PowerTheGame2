import {
  ARMY_IDS,
  Match,
  Order,
  OrderSheet,
  PIECES,
  PIECE_TYPES,
  PieceType,
  RESERVE,
  ReadonlyGameState,
  cheapestMissileSpend,
  legalOrders,
  mayCommand,
} from '../../api';
import { audio } from '../audio';
import { Arrow, BoardView, Mark } from '../boardView';
import { h } from '../dom';
import { ARMY_COLORS, chip } from '../icons';
import { armyName, errorText, pieceName, t } from '../i18n';
import { toast } from '../modal';
import { openMissileDialog } from './missileDialog';
import { GameNames } from './names';
import { Popover } from './popover';

/** A piece picked on the board, waiting for its destination. */
interface Selection {
  army: number;
  type: PieceType;
  from: number;
}

/** A megamissile waiting for its target. */
interface Targeting {
  army: number;
  from: number;
}

export interface PlanningDeps {
  match: Match;
  me: number;
  board: BoardView;
  names: GameNames;
  popover: Popover;
  /** The round is being planned (the human may be spectating). */
  isPlanning(): boolean;
  /** The human may give orders now. */
  canGiveOrders(): boolean;
  /** The orders or the selection changed: redraw. */
  changed(): void;
  /** Stops the clocks while a dialog is open. */
  pause(): void;
  resume(): void;
}

/** The human's orders for the round, and the clicks that build them. */
export class PlanningController {
  private sheet: OrderSheet;
  private selection: Selection | null = null;
  private targeting: Targeting | null = null;

  constructor(private readonly deps: PlanningDeps) {
    this.sheet = new OrderSheet(deps.match.state, deps.me);
  }

  /** A blank sheet for a new round. */
  reset(): void {
    this.sheet = new OrderSheet(this.deps.match.state, this.deps.me);
    this.selection = null;
    this.targeting = null;
  }

  get orders(): readonly Order[] {
    return this.sheet.orders;
  }

  get maxOrders(): number {
    return this.sheet.max;
  }

  /** The board as the orders so far would leave it. */
  get draft(): ReadonlyGameState {
    return this.sheet.preview;
  }

  /** Whether any order at all could be added, so that an empty sheet deserves a warning. */
  get anyOrderPossible(): boolean {
    return legalOrders(this.sheet).length > 0;
  }

  get isTargeting(): boolean {
    return this.targeting !== null;
  }

  /** The army whose megamissile is waiting for a target, if any. */
  get targetingArmy(): number | null {
    return this.targeting?.army ?? null;
  }

  /** Something is selected or a menu is open: Escape cancels it. */
  get hasSelection(): boolean {
    return !!this.selection || !!this.targeting || this.deps.popover.isOpen;
  }

  ordersLeft(army: number): number {
    return this.sheet.left(army);
  }

  canMakeMissile(army: number, loc: number): boolean {
    return !!cheapestMissileSpend(this.draft, army, loc);
  }

  /** Adds an order, or explains why it cannot be given. */
  tryAdd(order: Order): boolean {
    if (!this.deps.isPlanning()) return false;
    const error = this.sheet.check(order);
    if (error) {
      toast(errorText(error));
      audio.sfx('dope', { volume: 0.6 });
      return false;
    }
    this.sheet.add(order);
    this.selection = null;
    this.targeting = null;
    this.deps.popover.close();
    this.deps.changed();
    return true;
  }

  removeOrder(index: number): void {
    const dropped = this.sheet.removeAt(index);
    if (dropped > 0) toast(t('game.dropped', dropped));
    this.cancelSelection();
  }

  undoLast(): void {
    if (this.orders.length) this.removeOrder(this.orders.length - 1);
  }

  clearOrders(): void {
    this.sheet.clear();
    this.cancelSelection();
  }

  cancelSelection(): void {
    this.selection = null;
    this.targeting = null;
    this.deps.popover.close();
    if (this.deps.isPlanning()) this.deps.changed();
  }

  /** Sends a piece from the Reserve to its HQ. */
  deploy(army: number, type: PieceType): void {
    this.tryAdd({ kind: 'move', army, type, from: RESERVE, to: this.deps.match.board.hq[army] });
  }

  /** Fires the megamissile waiting for a target at an army's Reserve. */
  aimAtReserve(targetArmy: number): void {
    if (!this.targeting) return;
    this.tryAdd({ kind: 'launch', army: this.targeting.army, from: this.targeting.from, target: RESERVE, targetArmy });
  }

  /** A click on a board space: a destination, a target, or a space to give orders from. */
  onNode(node: number): void {
    if (!this.deps.canGiveOrders()) return;
    if (this.targeting) {
      this.tryAdd({
        kind: 'launch',
        army: this.targeting.army,
        from: this.targeting.from,
        target: node,
        targetArmy: -1,
      });
      return;
    }
    const selection = this.selection;
    if (selection) {
      if (selection.from !== RESERVE && this.reach(selection).includes(node)) {
        this.tryAdd({ kind: 'move', army: selection.army, type: selection.type, from: selection.from, to: node });
        return;
      }
      this.selection = null;
      if (node === selection.from) {
        this.deps.changed();
        return;
      }
    }
    this.openNode(node);
  }

  startTargeting(army: number, from: number): void {
    if (this.ordersLeft(army) <= 0) {
      toast(errorText('budget'));
      return;
    }
    this.deps.popover.close();
    this.selection = null;
    this.targeting = { army, from };
    this.deps.changed();
  }

  /** The megamissile dialog for `army` at `loc`; the clocks stop while it is open. */
  openMissileDialog(army: number, loc: number): void {
    this.deps.popover.close();
    this.deps.pause();
    const opened = openMissileDialog({
      draft: this.draft,
      army,
      loc,
      placeName: this.deps.names.place(loc),
      onConfirm: (order) => this.tryAdd(order),
      onClose: () => this.deps.resume(),
    });
    if (!opened) this.deps.resume();
  }

  /** Highlights and arrows for the board: the orders so far and the current selection. */
  marks(): { marks: Map<number, Mark>; arrows: Arrow[] } {
    const { hq, nodes } = this.deps.match.board;
    const marks = new Map<number, Mark>();
    const arrows: Arrow[] = [];
    for (const o of this.orders) {
      if (o.kind === 'move' && o.from !== RESERVE) arrows.push({ from: o.from, to: o.to, army: o.army, kind: 'move' });
      if (o.kind === 'launch' && o.target !== RESERVE)
        arrows.push({ from: o.from === RESERVE ? hq[o.army] : o.from, to: o.target, army: o.army, kind: 'launch' });
    }
    if (this.selection && this.selection.from !== RESERVE) {
      marks.set(this.selection.from, 'source');
      for (const to of this.reach(this.selection)) marks.set(to, 'dest');
    }
    if (this.targeting) {
      nodes.forEach((n) => marks.set(n.idx, 'target'));
      if (this.targeting.from !== RESERVE) marks.set(this.targeting.from, 'source');
    }
    return { marks, arrows };
  }

  /** What to tell the human to do next. */
  hint(): string {
    if (this.targeting) return t('hint.target');
    if (this.selection)
      return t('hint.dest', pieceName(this.selection.type), this.deps.names.place(this.selection.from));
    if (this.orders.length >= this.maxOrders) return t('hint.full');
    return this.deps.match.state.mode === 3 ? t('hint.idleMerc') : t('hint.idle');
  }

  private select(selection: Selection): void {
    this.deps.popover.close();
    this.targeting = null;
    this.selection = selection;
    this.deps.changed();
  }

  /** Lists what can be ordered on a board space; a single possible move is selected right away. */
  private openNode(node: number): void {
    this.deps.popover.close();
    const rows: HTMLElement[] = [];
    const moves: Selection[] = [];
    let otherActions = 0;
    let anyPiece = false;
    for (const a of ARMY_IDS) {
      if (!this.draft.armies[a].alive || !mayCommand(this.draft, this.deps.me, a)) continue;
      const here = PIECE_TYPES.filter((type) => this.countAt(a, type, node) > 0);
      if (!here.length) continue;
      anyPiece = true;
      if (this.ordersLeft(a) <= 0) continue;
      const items: HTMLElement[] = [];
      for (const type of here) {
        const n = this.movableCount(a, type, node);
        if (n > 0) {
          moves.push({ army: a, type, from: node });
          items.push(
            chip(type, a, n, { title: pieceName(type), onclick: () => this.select({ army: a, type, from: node }) }),
          );
        }
        if (type === 'M') {
          otherActions++;
          items.push(
            h('button.btn.small', { onclick: () => this.startTargeting(a, node) }, chip('M', a), ' ', t('game.launch')),
          );
        }
        if (PIECES[type].group === 1 && this.countAt(a, type, node) >= 3) {
          otherActions++;
          items.push(
            h(
              'button.btn.small',
              { onclick: () => this.tryAdd({ kind: 'tradeUp', army: a, type, at: node }) },
              t('game.tradeUp', pieceName(PIECES[type].up!)),
            ),
          );
        }
      }
      if (this.canMakeMissile(a, node)) {
        otherActions++;
        items.push(h('button.btn.small', { onclick: () => this.openMissileDialog(a, node) }, t('game.makeMissile')));
      }
      if (items.length)
        rows.push(
          h('div.pop-row', null, h('span.pop-army', { style: `color:${ARMY_COLORS[a].fill}` }, armyName(a)), ...items),
        );
    }
    if (!rows.length) {
      if (anyPiece) toast(this.orders.length >= this.maxOrders ? errorText('budget') : t('hint.cantMove'));
      this.deps.changed();
      return;
    }
    if (moves.length === 1 && otherActions === 0) {
      this.select(moves[0]);
      return;
    }
    this.deps.changed();
    this.deps.popover.open(this.deps.names.place(node), rows, this.deps.board.clientPoint(node));
  }

  /** Where the selected piece may move. */
  private reach({ type, from }: Selection): number[] {
    return this.deps.match.board.reach[PIECES[type].cls!][from];
  }

  private countAt(army: number, type: PieceType, loc: number): number {
    return this.draft.pieces.filter((p) => p.army === army && p.type === type && p.loc === loc).length;
  }

  private movableCount(army: number, type: PieceType, loc: number): number {
    if (!PIECES[type].cls) return 0;
    return this.draft.pieces.filter((p) => p.army === army && p.type === type && p.loc === loc && !p.moved && !p.fresh)
      .length;
  }
}
