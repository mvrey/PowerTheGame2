import { MERC, PIECE_TYPES, PieceType, RESERVE, ReadonlyGameState, RoundEvent, Snapshot, boardOf } from '../../api';
import { TAUNTS, audio } from '../audio';
import { BoardView } from '../boardView';
import { wait } from '../dom';
import { IconName, chip } from '../icons';
import { armyName, pieceName, t } from '../i18n';
import { GameNames } from './names';
import { ArmyCards } from './panels/armyCards';
import { GameLog } from './panels/gameLog';
import { PlayedOrder } from './panels/orderPanel';

type Point = { x: number; y: number };
type EventOf<K extends RoundEvent['kind']> = Extract<RoundEvent, { kind: K }>;
type Handlers = { [K in RoundEvent['kind']]: (event: EventOf<K>) => Promise<void> | void };

/** Flying chips at most per battle or bounce: more would only clutter the screen. */
const MAX_FLYING = 8;
/** A battle worth this much makes the losing general complain. */
const PAINFUL_LOSS = 10;

export interface PlaybackHost {
  readonly board: BoardView;
  readonly boardWrap: HTMLElement;
  readonly flyLayer: HTMLElement;
  readonly cards: ArmyCards;
  readonly log: GameLog;
  readonly names: GameNames;
  readonly me: number;
  /** The live game state (already past the round being shown). */
  state(): ReadonlyGameState;
  /** The screen is still open. */
  isAlive(): boolean;
  isPaused(): boolean;
  setPhase(label: string): void;
  showBanner(text: string, ms: number): void;
  /** Draws a frame of the round on the board and the army cards. */
  showFrame(view: Snapshot): void;
  /** Redraws the order list (the player being played and their orders). */
  showOrders(): void;
}

/** Animates a round that has already been played: one event at a time, as it happened. */
export class RoundPlayback {
  /** The frame on screen. */
  frame: Snapshot;
  /** Player whose orders are being played, or -1. */
  activePlayer = -1;
  /** Their orders so far. */
  played: PlayedOrder[] = [];
  /** Set to rush through the rest of the round. */
  skipping = false;
  private speed = 1;
  private incomeSounded = false;

  constructor(
    private readonly host: PlaybackHost,
    frame: Snapshot,
  ) {
    this.frame = frame;
  }

  async play(before: Snapshot, events: RoundEvent[], speed: number): Promise<void> {
    this.speed = speed;
    this.incomeSounded = false;
    this.showFrame(before);
    for (const event of events) {
      if (this.stopped) break;
      // TypeScript cannot pair each event with its own handler through the lookup.
      await (this.handlers[event.kind] as (event: RoundEvent) => Promise<void> | void)(event);
      if (event.snap && !this.skipping) this.showFrame(event.snap);
      while (this.host.isPaused() && this.host.isAlive() && !this.skipping) await wait(120);
    }
    audio.stop('megafly');
    this.activePlayer = -1;
    this.played = [];
  }

  private readonly handlers: Handlers = {
    turn: async (ev) => {
      this.activePlayer = ev.player;
      this.played = [];
      this.host.setPhase(t('game.phase.exec'));
      this.showFrame(this.frame);
      this.host.showOrders();
      await this.pause(380);
    },

    order: async (ev) => {
      const o = ev.order;
      this.played.push({ order: o, error: ev.error });
      this.host.showOrders();
      if (ev.error) {
        if (ev.error === 'cancelled') this.host.log.push(t('log.cancelled', this.host.names.orderText(o)));
        await this.pause(420);
      } else if (o.kind === 'move' && !ev.merged) {
        this.showFrame(without(this.frame, o.army, o.type, o.from));
        await this.fly(o.type, o.army, this.point(o.from, o.army), this.point(o.to, o.army), 430);
      } else if (o.kind === 'launch') {
        this.host.log.push(t('log.launch', this.host.names.armyTitle(o.army)));
        audio.sfx('megafly', { maxMs: 2600 });
        if (!this.isMine(o.army)) audio.voice(TAUNTS.missile, true);
        const from = this.point(o.from, o.army);
        this.showFrame(without(this.frame, o.army, 'M', o.from));
        await this.fly('M', o.army, from, { x: from.x + 60, y: from.y - 420 }, 900, true);
      } else if (o.kind === 'tradeUp' || o.kind === 'makeMissile') {
        if (o.at !== RESERVE) this.host.board.effect(o.at, 'trade', 600);
        await this.pause(260);
      } else {
        await this.pause(200);
      }
    },

    penalty: async (ev) => {
      this.host.log.push(t('log.penalty', this.host.names.subject(ev.player)));
      await this.pause(500);
    },

    strike: async (ev) => {
      this.conflict();
      const to = this.point(ev.target, ev.targetArmy);
      await this.fly('M', ev.army, { x: to.x - 90, y: to.y - 520 }, to, 700);
      audio.stop('megafly');
      audio.sfx('megaexpl');
      if (ev.target !== RESERVE) this.host.board.effect(ev.target, 'boom', 1100);
      else this.bubble(ev.targetArmy, '💥');
      this.host.boardWrap.classList.add('shake');
      setTimeout(() => this.host.boardWrap.classList.remove('shake'), 600);
      const where =
        ev.target === RESERVE ? t('node.reserveOf', armyName(ev.targetArmy)) : this.host.names.place(ev.target);
      this.host.log.push(t('log.strike', where, ev.power));
      if (ev.snap) this.showFrame(ev.snap);
      await this.pause(1000);
    },

    bounce: async (ev) => {
      this.conflict();
      this.host.board.effect(ev.node, 'bounce', 600);
      this.host.board.floatText(ev.node, t('fx.tie'));
      this.host.log.push(t('log.bounce', this.host.names.place(ev.node)));
      await this.pause(380);
      this.showFrame(ev.moves.reduce((view, m) => without(view, m.army, m.type, ev.node), this.frame));
      const from = this.host.board.clientPoint(ev.node);
      await Promise.all(
        ev.moves.slice(0, MAX_FLYING).map((m) => this.fly(m.type, m.army, from, this.point(m.to, m.army), 420)),
      );
    },

    standoff: async (ev) => {
      this.host.board.floatText(ev.node, t('fx.standoff'));
      this.host.log.push(t('log.standoff', this.host.names.place(ev.node)));
      await this.pause(450);
    },

    battle: async (ev) => {
      this.conflict();
      const powers = [...ev.powers]
        .sort((a, b) => b.power - a.power)
        .map((s) => s.power)
        .join(' › ');
      this.host.board.effect(ev.node, 'battle', 800);
      this.host.board.floatText(ev.node, powers, '#ffe066', 1300);
      audio.sfx('battle', { maxMs: 1100, volume: 0.8 });
      await this.pause(700);
      const taker = ev.captured[0]?.to ?? 0;
      const from = this.host.board.clientPoint(ev.node);
      this.showFrame(ev.captured.reduce((view, c) => without(view, c.army, c.type, ev.node), this.frame));
      await Promise.all(
        ev.captured
          .slice(0, MAX_FLYING)
          .map((c, i) =>
            wait((i * 70) / this.speed).then(() => this.fly(c.type, c.army, from, this.point(RESERVE, taker), 520)),
          ),
      );
      const loot = PIECE_TYPES.map((type) => [type, ev.captured.filter((c) => c.type === type).length] as const)
        .filter(([, n]) => n)
        .map(([type, n]) => `${n}× ${pieceName(type)}`)
        .join(', ');
      this.host.log.push(
        t('log.battle', this.host.names.subject(ev.winner), this.host.names.place(ev.node), powers, loot),
      );
      const iLost = ev.captured.some((c) => this.isMine(c.army));
      if (iLost && ev.winner !== this.host.me && ev.winner !== MERC) audio.voice(TAUNTS.win);
      else if (ev.winner === this.host.me && ev.value >= PAINFUL_LOSS) audio.voice(TAUNTS.lose);
    },

    income: async (ev) => {
      this.activePlayer = -1;
      this.host.setPhase(t('game.phase.income'));
      if (!this.incomeSounded) {
        this.incomeSounded = true;
        audio.sfx('clctblts');
      }
      this.host.log.push(t('log.income', this.host.names.armyTitle(ev.army), ev.amount));
      if (ev.snap) this.showFrame(ev.snap);
      this.bubble(ev.army, '+' + ev.amount);
      await this.pause(320);
    },

    flag: async (ev) => {
      const captor = this.host.names.armyTitle(ev.captor);
      this.host.log.push(t('log.flag', captor, armyName(ev.victim)));
      this.host.showBanner(t('banner.flag', captor, armyName(ev.victim)), 2200);
      audio.sfx('flg_cap');
      this.host.board.effect(boardOf(this.host.state()).hq[ev.victim], 'battle', 900);
      if (!this.isMine(ev.captor)) audio.voice(TAUNTS.kill, true);
      if (ev.snap) this.showFrame(ev.snap);
      await this.pause(1900);
    },

    out: (ev) => {
      this.host.log.push(t('log.out', this.host.names.subject(ev.player)));
    },

    end: () => {},
  };

  private get stopped(): boolean {
    return this.skipping || !this.host.isAlive();
  }

  /** Puts a frame on screen. */
  showFrame(view: Snapshot): void {
    this.frame = view;
    this.host.showFrame(view);
  }

  /** Battles, bounces and missiles: no player's orders are being played any more. */
  private conflict(): void {
    this.activePlayer = -1;
    this.host.setPhase(t('game.phase.conflict'));
  }

  private isMine(army: number): boolean {
    return this.host.state().armies[army].controller === this.host.me;
  }

  /** Waits `ms` at normal speed, or not at all when skipping. */
  private pause(ms: number): Promise<void> {
    return this.stopped ? Promise.resolve() : wait(ms / this.speed);
  }

  private bubble(army: number, text: string): void {
    if (!this.skipping) this.host.cards.bubble(army, text);
  }

  /** Screen point of a board space, or of an army's Reserve card. */
  private point(loc: number, army: number): Point {
    return loc === RESERVE ? this.host.cards.reservePoint(army) : this.host.board.clientPoint(loc);
  }

  /** Slides a chip across the screen between two points in `ms` (at normal speed). */
  private async fly(type: IconName, army: number, from: Point, to: Point, ms: number, fade = false): Promise<void> {
    if (this.stopped) return;
    const el = chip(type, army);
    el.classList.add('flying');
    const size = Math.max(0.8, this.host.board.scale * 1.25);
    el.style.left = from.x + 'px';
    el.style.top = from.y + 'px';
    this.host.flyLayer.append(el);
    const start = `translate(-50%,-50%) scale(${size})`;
    const end = `translate(calc(-50% + ${to.x - from.x}px), calc(-50% + ${to.y - from.y}px)) scale(${size})`;
    try {
      await el.animate(
        [
          { transform: start, opacity: 1 },
          { transform: end, opacity: fade ? 0 : 1 },
        ],
        { duration: Math.max(60, ms / this.speed), easing: 'cubic-bezier(.3,.1,.3,1)', fill: 'forwards' },
      ).finished;
    } catch {
      // Animation cancelled: nothing to clean up beyond removing the chip.
    }
    el.remove();
  }
}

/** The frame without `n` pieces of a kind at a location: they are on their way somewhere else. */
function without(view: Snapshot, army: number, type: PieceType, loc: number, n = 1): Snapshot {
  let left = n;
  return {
    ...view,
    pieces: view.pieces.filter((p) => !(left > 0 && p.army === army && p.type === type && p.loc === loc && left-- > 0)),
  };
}
