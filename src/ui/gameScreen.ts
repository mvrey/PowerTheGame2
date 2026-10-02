import { generalById } from '../ai/generals';
import { makeRng, planSteps } from '../ai/planner';
import { HQ, NODES, NUM_ARMIES, REACH, RESERVE, useMap } from '../engine/board';
import {
  cloneState, livingArmies, mayCommand, newGame, ordersLeft, playerStrength, seatOrder, snapshot, withinBudget,
} from '../engine/game';
import { resolveRound } from '../engine/resolve';
import { applyOrder, checkOrder, cheapestMissileSpend, spendValue } from '../engine/rules';
import {
  GROUP1, GameState, MERC, MISSILE_COST, ORDERS_PER_ARMY, Order, OrderError, PIECES, PIECE_TYPES, PieceType,
  RoundEvent, Snapshot,
} from '../engine/types';
import { TAUNTS, audio } from './audio';
import { Arrow, BoardView, Mark } from './boardView';
import { clear, h, wait } from './dom';
import { ARMY_COLORS, IconName, chip } from './icons';
import { Key, armyName, errorText, nodeLabel, nodeName, pieceName, t } from './i18n';
import { ModalHandle, closeAllModals, modal, toast } from './modal';
import { Setup, clearSave, saveGame, SavedGame, settings } from './settings';

export interface AppApi {
  showMenu(): void;
  startGame(setup: Setup): void;
  openOptions(onClose?: () => void): void;
  openRules(onClose?: () => void): void;
}

const GAME_LIMIT_MS = 2 * 60 * 60 * 1000;
const SPEEDS = [1, 2.2, 5];

interface Selection { army: number; type: PieceType; from: number }

function fmtClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}

export class GameScreen {
  readonly el: HTMLElement;
  private state: GameState;
  private me: number;
  private board: BoardView;

  // Planning
  private orders: Order[] = [];
  private draft: GameState;
  private sel: Selection | null = null;
  private targeting: { army: number; from: number } | null = null;
  private aiPlans: (Order[] | null)[] = [];
  private aiDone: Promise<void> = Promise.resolve();

  // Flow
  private phase: 'plan' | 'play' | 'over' = 'plan';
  private phaseLabel = '';
  private spectating = false;
  private paused = 0;
  private skip = false;
  private alive = true;
  private elapsedMs = 0;
  private orderMsLeft = Infinity;
  private lastTick = 0;
  private timer = 0;
  private lastRoundAnnounced = false;
  /** Round and referee being shown; the engine state is already one round ahead during playback. */
  private shownRound = 1;
  private shownReferee = 0;

  // Playback
  private cur: Snapshot;
  private activePlayer = -1;
  private played: { order: Order; error: OrderError | null; merged?: boolean }[] = [];
  private log: string[] = [];

  // DOM
  private cardsEl = h('div.cards');
  private reserveEls: HTMLElement[] = [];
  private cardEls: HTMLElement[] = [];
  private headerEl = h('div.round-head');
  private sheetEl = h('div.sheet');
  private actionsEl = h('div.sheet-actions');
  private logEl = h('div.log');
  private hintEl = h('div.hint');
  private bannerEl = h('div.banner');
  private popEl = h('div.popover');
  private tipEl = h('div.tooltip');
  private flyEl = h('div.fly-layer');
  private boardWrap = h('div.board-wrap');

  constructor(private app: AppApi, private setup: Setup, saved?: SavedGame) {
    this.state = saved ? saved.state : newGame(setup);
    useMap(this.state.map);
    this.elapsedMs = saved?.elapsedMs ?? 0;
    this.log = saved?.log ?? [];
    this.me = this.state.players.findIndex((p) => p.kind === 'human');
    this.draft = cloneState(this.state);
    this.cur = snapshot(this.state);

    this.board = new BoardView({
      click: (node) => this.onNode(node),
      hover: (node, ev) => this.onHover(node, ev),
      label: nodeLabel,
    });
    this.boardWrap.append(this.board.root, this.bannerEl, this.popEl);
    this.boardWrap.style.setProperty('--ratio', String(this.board.ratio));
    this.el = h('div.game', null,
      h('aside.left', null, this.cardsEl),
      h('main.center', null, this.boardWrap),
      h('aside.right', null, this.headerEl, this.hintEl, this.sheetEl, this.actionsEl, h('h3.log-title', null, t('game.log')), this.logEl),
      this.flyEl, this.tipEl,
    );
    this.el.addEventListener('contextmenu', (e) => {
      if (this.sel || this.targeting || this.popEl.childElementCount) {
        e.preventDefault();
        this.cancelSelection();
      }
    });
    window.addEventListener('keydown', this.onKey);
    this.timer = window.setInterval(() => this.tick(), 250);
    audio.setMood('game');
    if (!saved) audio.sfx('strtgame');
    if (!this.state.players[this.me].alive) this.spectating = true;
    queueMicrotask(() => this.startRound());
  }

  destroy(): void {
    this.alive = false;
    clearInterval(this.timer);
    window.removeEventListener('keydown', this.onKey);
  }

  // ------------------------------------------------------------------ names

  private playerName(player: number): string {
    if (player === MERC) return t('game.mercs');
    const p = this.state.players[player];
    return p.kind === 'human' ? t('common.you') : p.name;
  }
  /** Name used as the subject of a sentence: the human is referred to by colour. */
  private subject(player: number): string {
    if (player === MERC || this.state.players[player].kind !== 'human') return this.playerName(player);
    return `${this.state.players[player].armies.map(armyName).join(' + ')} (${t('common.you').toLowerCase()})`;
  }
  private ownerName(army: number): string {
    return this.playerName(this.state.armies[army].controller);
  }
  private armyTitle(army: number): string {
    const owner = this.ownerName(army);
    return `${armyName(army)} (${this.state.armies[army].controller === this.me ? owner.toLowerCase() : owner})`;
  }
  private orderText(o: Order): string {
    switch (o.k) {
      case 'move': return t('order.move', pieceName(o.type), nodeName(o.from), nodeName(o.to));
      case 'buy': return t('order.buy', pieceName(o.type), PIECES[o.type].power);
      case 'up': return t('order.up', pieceName(o.type), pieceName(PIECES[o.type].up!), nodeName(o.at));
      case 'mk': return t('order.mk', nodeName(o.at));
      case 'launch': return t('order.launch', o.target === RESERVE ? t('node.reserveOf', armyName(o.targetArmy)) : nodeName(o.target));
    }
  }
  private orderIcon(o: Order): IconName {
    return o.k === 'move' || o.k === 'buy' ? o.type : o.k === 'up' ? PIECES[o.type].up! : 'M';
  }

  // ------------------------------------------------------------------- flow

  private get humanAlive(): boolean {
    return this.state.players[this.me].alive;
  }
  private get maxOrders(): number {
    return livingArmies(this.state, this.me).length * ORDERS_PER_ARMY;
  }
  private get orderClockMs(): number {
    return (this.state.mode === 2 ? 6 : 3) * 60 * 1000;
  }

  private startRound(): void {
    if (!this.alive) return;
    this.phase = 'plan';
    this.phaseLabel = t('game.phase.plan');
    this.orders = [];
    this.draft = cloneState(this.state);
    this.cur = snapshot(this.state);
    this.sel = null;
    this.targeting = null;
    this.activePlayer = -1;
    this.played = [];
    this.shownRound = this.state.round;
    this.shownReferee = this.state.referee;
    this.orderMsLeft = this.setup.orderTimer ? this.orderClockMs : Infinity;
    this.lastTick = performance.now();
    const heading = t('log.round', this.state.round);
    if (this.log[this.log.length - 1] !== heading) this.pushLog(heading);
    else this.renderLog();
    this.persist();
    this.startAi();
    this.renderAll();
    this.showBanner(this.isLastRound ? t('banner.last') : t('banner.round', this.state.round), 1100);
    if (this.state.round > 1) audio.sfx('new_rnd');
    if (this.spectating) void this.submit(true);
    else if (location.hash.includes('autoplay')) void this.autoplay();
  }

  /** Debug aid (#autoplay in the URL): an AI captain plays the human seat. */
  private async autoplay(): Promise<void> {
    const round = this.state.round;
    await this.aiDone;
    await wait(300);
    if (!this.alive || this.phase !== 'plan' || this.state.round !== round) return;
    const steps = planSteps(this.state, this.me, { level: 2, style: generalById('okoye').style, rng: makeRng(Date.now() >>> 0) });
    let r = steps.next();
    while (!r.done) r = steps.next();
    for (const o of r.value) this.tryAdd(o);
    void this.submit(true);
  }

  private get isLastRound(): boolean {
    return this.setup.gameLimit && this.elapsedMs >= GAME_LIMIT_MS;
  }

  private persist(): void {
    saveGame({ v: 2, setup: this.setup, state: this.state, elapsedMs: this.elapsedMs, log: this.log.slice(-80) });
  }

  private startAi(): void {
    const base = cloneState(this.state);
    const round = this.state.round;
    this.aiPlans = this.state.players.map(() => null);
    const rng = makeRng((Date.now() ^ (round * 7919)) >>> 0);
    this.aiDone = (async () => {
      for (const p of base.players) {
        if (p.kind !== 'ai' || !p.alive) continue;
        const steps = planSteps(base, p.id, {
          level: (p.level ?? 2) as 1 | 2 | 3,
          style: generalById(p.general).style,
          rng,
        });
        for (;;) {
          const started = performance.now();
          let result = steps.next();
          while (!result.done && performance.now() - started < 9) result = steps.next();
          if (result.done) {
            this.aiPlans[p.id] = result.value;
            break;
          }
          await wait(0);
          if (!this.alive) return;
        }
        if (this.alive && this.state.round === round && this.phase === 'plan') this.renderCards();
      }
    })();
  }

  private tick(): void {
    const now = performance.now();
    const dt = now - this.lastTick;
    this.lastTick = now;
    if (this.phase !== 'plan' || this.paused || this.spectating || document.hidden) return;
    this.elapsedMs += dt;
    this.orderMsLeft -= dt;
    if (this.isLastRound && !this.lastRoundAnnounced) {
      this.lastRoundAnnounced = true;
      this.showBanner(t('banner.last'), 1800);
    }
    this.renderHeader();
    if (this.orderMsLeft <= 0) {
      toast(t('game.timeUp'));
      void this.submit(true);
    }
  }

  private pause(): void {
    this.paused++;
  }
  private resume(): void {
    this.paused = Math.max(0, this.paused - 1);
    this.lastTick = performance.now();
  }

  private async submit(auto = false): Promise<void> {
    if (this.phase !== 'plan') return;
    if (!auto && !this.orders.length && this.humanAlive && this.hasAnyLegalOrder()) {
      this.pause();
      modal(t('game.submit'), [h('p', null, t('game.noneWarning'))], [
        { label: t('common.cancel') },
        { label: t('common.confirm'), primary: true, action: () => { void this.submit(true); } },
      ], { onClose: () => this.resume() });
      return;
    }
    this.phase = 'play';
    this.phaseLabel = t('game.phase.exec');
    this.cancelSelection();
    closeAllModals();
    this.paused = 0;
    this.skip = false;
    this.cur = snapshot(this.state);
    this.board.setArrows([]);
    this.renderAll();
    if (this.aiPlans.some((plan, i) => !plan && this.state.players[i].kind === 'ai' && this.state.players[i].alive))
      this.setHint(t('game.waitingAi'));
    await this.aiDone;
    if (!this.alive) return;

    const all = this.state.players.map((p) => (p.id === this.me ? (this.humanAlive ? this.orders : []) : this.aiPlans[p.id] ?? []));
    const before = snapshot(this.state);
    const events = resolveRound(this.state, all, { record: true, lastRound: this.isLastRound });
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__round = { before, all, events };
    if (this.state.over) clearSave();
    await this.playback(before, events);
    if (!this.alive) return;

    if (this.state.over) {
      this.phase = 'over';
      this.renderAll();
      this.showGameOver();
    } else if (!this.humanAlive && !this.spectating) {
      this.renderAll();
      this.showEliminated();
    } else {
      this.startRound();
    }
  }

  private hasAnyLegalOrder(): boolean {
    const s = this.state;
    return s.pieces.some((p) => mayCommand(s, this.me, p.army) && s.armies[p.army].alive && PIECES[p.type].cls)
      || livingArmies(s, this.me).some((a) => s.armies[a].power >= 2);
  }

  // --------------------------------------------------------------- planning

  private rebuildDraft(): void {
    const kept: Order[] = [];
    this.draft = cloneState(this.state);
    for (const o of this.orders) {
      if (!withinBudget(this.state, this.me, kept, o) || checkOrder(this.draft, this.me, o)) continue;
      applyOrder(this.draft, o);
      kept.push(o);
    }
    const dropped = this.orders.length - kept.length;
    this.orders = kept;
    if (dropped > 0) toast(t('game.dropped', dropped));
  }

  private tryAdd(order: Order): boolean {
    if (this.phase !== 'plan') return false;
    const error: OrderError | null = withinBudget(this.state, this.me, this.orders, order)
      ? checkOrder(this.draft, this.me, order) : 'budget';
    if (error) {
      toast(errorText(error));
      audio.sfx('dope', { volume: 0.6 });
      return false;
    }
    applyOrder(this.draft, order);
    this.orders.push(order);
    this.sel = null;
    this.targeting = null;
    this.closePopover();
    this.renderAll();
    return true;
  }

  private removeOrder(index: number): void {
    this.orders.splice(index, 1);
    this.rebuildDraft();
    this.cancelSelection();
  }

  private cancelSelection(): void {
    this.sel = null;
    this.targeting = null;
    this.closePopover();
    if (this.phase === 'plan') this.renderAll();
  }

  private left(army: number): number {
    return ordersLeft(this.state, this.me, this.orders, army);
  }

  private movableCount(army: number, type: PieceType, loc: number): number {
    if (!PIECES[type].cls) return 0;
    return this.draft.pieces.filter((p) => p.army === army && p.type === type && p.loc === loc && !p.moved && !p.fresh).length;
  }
  private countAt(army: number, type: PieceType, loc: number): number {
    return this.draft.pieces.filter((p) => p.army === army && p.type === type && p.loc === loc).length;
  }

  private onNode(node: number): void {
    if (this.phase !== 'plan' || this.spectating) return;
    if (this.targeting) {
      this.tryAdd({ k: 'launch', army: this.targeting.army, from: this.targeting.from, target: node, targetArmy: -1 });
      return;
    }
    if (this.sel) {
      const sel = this.sel;
      if (sel.from !== RESERVE && REACH[PIECES[sel.type].cls!][sel.from].includes(node)) {
        this.tryAdd({ k: 'move', army: sel.army, type: sel.type, from: sel.from, to: node });
        return;
      }
      this.sel = null;
      if (node === sel.from) {
        this.renderAll();
        return;
      }
    }
    this.openNode(node);
  }

  /** Lists what can be ordered on a board space; a single possible move is selected right away. */
  private openNode(node: number): void {
    this.closePopover();
    const rows: HTMLElement[] = [];
    const moves: Selection[] = [];
    let others = 0;
    let present = false;
    for (let a = 0; a < NUM_ARMIES; a++) {
      if (!this.draft.armies[a].alive || !mayCommand(this.draft, this.me, a)) continue;
      const here = PIECE_TYPES.filter((type) => this.countAt(a, type, node) > 0);
      if (!here.length) continue;
      present = true;
      if (this.left(a) <= 0) continue;
      const items: HTMLElement[] = [];
      for (const type of here) {
        const n = this.movableCount(a, type, node);
        if (n > 0) {
          moves.push({ army: a, type, from: node });
          items.push(chip(type, a, n, { title: pieceName(type), onclick: () => this.select({ army: a, type, from: node }) }));
        }
        if (type === 'M') {
          others++;
          items.push(h('button.btn.small', { onclick: () => this.startTargeting(a, node) }, chip('M', a), ' ', t('game.launch')));
        }
        if (PIECES[type].group === 1 && this.countAt(a, type, node) >= 3) {
          others++;
          items.push(h('button.btn.small', { onclick: () => this.tryAdd({ k: 'up', army: a, type, at: node }) },
            t('game.tradeUp', pieceName(PIECES[type].up!))));
        }
      }
      if (cheapestMissileSpend(this.draft, a, node)) {
        others++;
        items.push(h('button.btn.small', { onclick: () => this.openMissileDialog(a, node) }, t('game.makeMissile')));
      }
      if (items.length) rows.push(h('div.pop-row', null, h('span.pop-army', { style: `color:${ARMY_COLORS[a].fill}` }, armyName(a)), ...items));
    }
    if (!rows.length) {
      if (present) toast(this.orders.length >= this.maxOrders ? errorText('budget') : t('hint.cantMove'));
      this.renderAll();
      return;
    }
    if (moves.length === 1 && others === 0) {
      this.select(moves[0]);
      return;
    }
    this.renderAll();
    const wrap = this.boardWrap.getBoundingClientRect();
    const pt = this.board.clientPoint(node);
    this.popEl.append(h('div.pop-title', null, nodeName(node)), ...rows);
    this.popEl.classList.add('open');
    const x = Math.min(Math.max(pt.x - wrap.left, 110), wrap.width - 110);
    const below = pt.y - wrap.top < wrap.height * 0.6;
    this.popEl.style.left = x + 'px';
    this.popEl.style.top = below ? pt.y - wrap.top + 26 + 'px' : '';
    this.popEl.style.bottom = below ? '' : wrap.height - (pt.y - wrap.top) + 26 + 'px';
  }

  private closePopover(): void {
    clear(this.popEl);
    this.popEl.classList.remove('open');
  }

  private select(sel: Selection): void {
    this.closePopover();
    this.targeting = null;
    this.sel = sel;
    this.renderAll();
  }

  private startTargeting(army: number, from: number): void {
    if (this.left(army) <= 0) {
      toast(errorText('budget'));
      return;
    }
    this.closePopover();
    this.sel = null;
    this.targeting = { army, from };
    this.renderAll();
  }

  private openMissileDialog(army: number, loc: number): void {
    this.closePopover();
    const recipe = cheapestMissileSpend(this.draft, army, loc);
    if (!recipe) return;
    const have = new Map<PieceType | 'P', number>();
    for (const type of PIECE_TYPES) {
      const n = type === 'M' ? 0 : this.countAt(army, type, loc);
      if (n) have.set(type, n);
    }
    if (loc === RESERVE && this.draft.armies[army].power > 0) have.set('P', this.draft.armies[army].power);
    const chosen = new Map<PieceType | 'P', number>();
    for (const key of have.keys()) chosen.set(key, key === 'P' ? recipe.power : recipe.spend[key] ?? 0);

    const totalEl = h('div.missile-total');
    const total = () => [...chosen].reduce((sum, [key, n]) => sum + n * (key === 'P' ? 1 : PIECES[key].power), 0);
    const refresh = () => {
      const value = total();
      totalEl.textContent = t('missile.total', value) + (value > MISSILE_COST ? ' ' + t('missile.waste', value - MISSILE_COST) : '');
      totalEl.classList.toggle('bad', value < MISSILE_COST);
      confirm.disabled = value < MISSILE_COST;
    };
    const rows = [...have].map(([key, max]) => {
      const count = h('span.stepper-n', null, String(chosen.get(key)));
      const step = (by: number) => {
        const next = Math.min(max, Math.max(0, chosen.get(key)! + by));
        chosen.set(key, next);
        count.textContent = String(next);
        refresh();
      };
      const big = key === 'P' ? 10 : 1;
      return h('div.stepper', null,
        chip(key, army), h('span.stepper-name', null, `${pieceName(key)} (${key === 'P' ? 1 : PIECES[key].power})`),
        h('button.btn.small', { onclick: () => step(-big) }, '−'), count, h('span.stepper-max', null, '/ ' + max),
        h('button.btn.small', { onclick: () => step(big) }, '+'));
    });
    this.pause();
    const dialog = modal(t('missile.title', nodeName(loc)), [h('p', null, t('missile.text')), ...rows, totalEl], [
      { label: t('common.cancel') },
      {
        label: t('common.confirm'), primary: true, action: () => {
          const spend: Partial<Record<PieceType, number>> = {};
          for (const [key, n] of chosen) if (key !== 'P' && n > 0) spend[key] = n;
          if (spendValue(spend, chosen.get('P') ?? 0) < MISSILE_COST) return false;
          this.tryAdd({ k: 'mk', army, at: loc, spend, power: chosen.get('P') ?? 0 });
        },
      },
    ], { onClose: () => this.resume() });
    const confirm = dialog.el.querySelector('button.primary') as HTMLButtonElement;
    refresh();
  }

  private onKey = (e: KeyboardEvent): void => {
    if (document.querySelector('.backdrop')) return;
    if (e.key === 'Escape') {
      if (this.sel || this.targeting || this.popEl.childElementCount) this.cancelSelection();
      else if (this.phase !== 'over') this.openPause();
    } else if (this.phase === 'play' && (e.key === ' ' || e.key === 'Enter')) {
      e.preventDefault();
      this.skip = true;
    } else if (this.phase === 'plan' && !this.spectating) {
      if (e.key === 'Enter') {
        e.preventDefault();
        void this.submit();
      } else if (e.key === 'Backspace' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z')) {
        e.preventDefault();
        if (this.orders.length) this.removeOrder(this.orders.length - 1);
      }
    }
  };

  // -------------------------------------------------------------- rendering

  private get view(): Snapshot {
    return this.phase === 'plan' ? snapshot(this.draft) : this.cur;
  }

  private renderAll(): void {
    const view = this.view;
    this.board.render(view);
    this.renderMarks();
    this.renderCards(view);
    this.renderHeader();
    this.renderSheet();
    this.renderHint();
  }

  private renderMarks(): void {
    const marks = new Map<number, Mark>();
    const arrows: Arrow[] = [];
    if (this.phase === 'plan') {
      for (const o of this.orders) {
        if (o.k === 'move' && o.from !== RESERVE) arrows.push({ from: o.from, to: o.to, army: o.army, kind: 'move' });
        if (o.k === 'launch' && o.target !== RESERVE)
          arrows.push({ from: o.from === RESERVE ? HQ[o.army] : o.from, to: o.target, army: o.army, kind: 'launch' });
      }
      if (this.sel && this.sel.from !== RESERVE) {
        marks.set(this.sel.from, 'source');
        for (const to of REACH[PIECES[this.sel.type].cls!][this.sel.from]) marks.set(to, 'dest');
      }
      if (this.targeting) {
        NODES.forEach((n) => marks.set(n.idx, 'target'));
        if (this.targeting.from !== RESERVE) marks.set(this.targeting.from, 'source');
      }
    }
    this.board.setMarks(marks);
    this.board.setArrows(arrows);
    this.boardWrap.classList.toggle('targeting', !!this.targeting);
  }

  private setHint(text: string): void {
    this.hintEl.textContent = text;
    this.hintEl.classList.toggle('open', !!text && settings.hints);
  }

  private renderHint(): void {
    if (this.phase === 'over' || this.spectating) return this.setHint('');
    if (this.phase === 'play') return this.setHint('');
    if (this.targeting) return this.setHint(t('hint.target'));
    if (this.sel) return this.setHint(t('hint.dest', pieceName(this.sel.type), nodeName(this.sel.from)));
    if (this.orders.length >= this.maxOrders) return this.setHint(t('hint.full'));
    this.setHint(this.state.mode === 3 ? t('hint.idleMerc') : t('hint.idle'));
  }

  private renderHeader(): void {
    clear(this.headerEl);
    const orderClock = this.phase === 'plan' && this.setup.orderTimer && !this.spectating
      ? h('div.clock', { class: this.orderMsLeft < 30000 ? 'urgent' : '', title: t('game.phase.plan') }, fmtClock(this.orderMsLeft))
      : null;
    const gameClock = this.setup.gameLimit
      ? h('div.game-clock', { class: this.isLastRound ? 'urgent' : '' },
        this.isLastRound ? t('game.lastRound') : '⏱ ' + fmtClock(GAME_LIMIT_MS - this.elapsedMs))
      : null;
    this.headerEl.append(
      h('div.round-row', null,
        h('div', null, h('div.round-n', null, t('game.round', this.shownRound)), h('div.phase', null, this.phaseLabel)),
        orderClock,
        h('button.btn.small', { onclick: () => this.openPause(), title: 'Esc' }, '☰ ' + t('game.menu'))),
      h('div.round-sub', null,
        h('span', null, `${t(('map.' + this.state.map) as Key)} · ${t('game.referee', this.playerName(this.shownReferee))}`), gameClock),
    );
  }

  private strengthOf(view: Snapshot, army: number): number {
    let total = view.power[army];
    for (const p of view.pieces) if (p.army === army) total += PIECES[p.type].power;
    return total;
  }

  private renderCards(view: Snapshot = this.view): void {
    clear(this.cardsEl);
    this.reserveEls = [];
    this.cardEls = [];
    const planning = this.phase === 'plan' && !this.spectating;
    for (let a = 0; a < NUM_ARMIES; a++) {
      const army = this.state.armies[a];
      const alive = view.alive[a];
      const controller = army.controller;
      const mine = controller === this.me;
      const commandable = planning && alive && mayCommand(this.state, this.me, a);
      const colors = ARMY_COLORS[a];

      let status = '';
      if (!alive) status = t('game.eliminated');
      else if (controller !== MERC && this.state.players[controller].kind === 'ai' && this.phase === 'plan')
        status = this.aiPlans[controller] ? t('game.ready') : t('game.thinking');

      const counts = new Map<PieceType, number>();
      for (const p of view.pieces) if (p.army === a && p.loc === RESERVE) counts.set(p.type, (counts.get(p.type) ?? 0) + 1);
      const reserve = h('div.reserve');
      for (const type of PIECE_TYPES) {
        const n = counts.get(type);
        if (!n) continue;
        if (!commandable) {
          reserve.append(chip(type, a, n, { title: pieceName(type) }));
        } else if (type === 'M') {
          reserve.append(chip(type, a, n, { title: t('game.launch'), onclick: () => this.startTargeting(a, RESERVE) }));
        } else {
          reserve.append(chip(type, a, n, {
            title: `${pieceName(type)} · ${t('game.deploy')}`,
            onclick: () => this.tryAdd({ k: 'move', army: a, type, from: RESERVE, to: HQ[a] }),
          }));
        }
      }
      if (!reserve.childElementCount) reserve.append(h('span.muted', null, alive ? t('game.reserveEmpty') : '—'));

      const actions = h('div.card-actions');
      if (commandable) {
        const power = view.power[a];
        actions.append(h('span.muted', null, t('game.buy') + ':'));
        for (const type of GROUP1) {
          const cost = PIECES[type].power;
          const b = chip(type, a, 1, {
            title: t('order.buy', pieceName(type), cost),
            disabled: power < cost || this.left(a) <= 0,
            onclick: () => this.tryAdd({ k: 'buy', army: a, type }),
          });
          b.append(h('i', null, String(cost)));
          actions.append(b);
        }
        for (const type of GROUP1) {
          if ((counts.get(type) ?? 0) >= 3)
            actions.append(h('button.btn.small', { onclick: () => this.tryAdd({ k: 'up', army: a, type, at: RESERVE }) },
              t('game.tradeUp', pieceName(PIECES[type].up!))));
        }
        if (cheapestMissileSpend(this.draft, a, RESERVE))
          actions.append(h('button.btn.small', { onclick: () => this.openMissileDialog(a, RESERVE) }, t('game.makeMissile')));
      }
      if (planning && this.targeting && alive && a !== this.targeting.army) {
        const tg = this.targeting;
        actions.append(h('button.btn.small.danger', {
          onclick: () => this.tryAdd({ k: 'launch', army: tg.army, from: tg.from, target: RESERVE, targetArmy: a }),
        }, '🎯 ' + t('game.targetReserve')));
      }

      const flags = h('span.flags', { title: t('game.flags') },
        ...view.flags[a].map((f) => h('span.flag', { style: `color:${ARMY_COLORS[f].fill}`, html: '<svg viewBox="0 0 32 22"><use href="#ic-FLAG"/></svg>' })));
      const referee = controller !== MERC && this.shownReferee === controller && alive
        ? h('span.referee', { title: t('game.refereeMark') }, '⚖') : null;
      const card = h('section.card', {
        class: [alive ? '' : 'dead', mine ? 'mine' : '', controller === MERC ? 'merc' : '',
          this.activePlayer !== -1 && controller === this.activePlayer ? 'active' : ''].join(' '),
        style: `--fill:${colors.fill};--dark:${colors.dark}`,
      },
        h('header', null,
          h('span.swatch'), h('span.card-name', null, armyName(a)), h('span.card-owner', null, this.ownerName(a)),
          referee, status ? h('span.status', null, status) : null),
        h('div.card-stats', null,
          h('span.stat', { title: t('game.power') }, chip('P', a), h('b', null, String(view.power[a]))),
          h('span.stat', { title: t('game.strength') }, 'Σ ', h('b', null, String(this.strengthOf(view, a)))),
          flags),
        reserve,
        actions.childElementCount ? actions : null,
      );
      this.reserveEls[a] = reserve;
      this.cardEls[a] = card;
      this.cardsEl.append(card);
    }
  }

  private renderSheet(): void {
    clear(this.sheetEl);
    clear(this.actionsEl);
    if (this.phase === 'plan' && !this.spectating) {
      this.sheetEl.append(h('h3', null, t('game.orders'), h('span.count', null, t('game.ordersLeft', this.orders.length, this.maxOrders))));
      const list = h('ol.orders');
      this.orders.forEach((o, i) => {
        list.append(h('li', null,
          chip(this.orderIcon(o), o.army), h('span.order-text', null, this.orderText(o)),
          h('button.x', { title: t('game.undo'), onclick: () => this.removeOrder(i) }, '✕')));
      });
      for (let i = this.orders.length; i < this.maxOrders; i++) list.append(h('li.empty', null, h('span.slot', null, '·')));
      this.sheetEl.append(list);
      if (!this.orders.length && settings.hints) this.sheetEl.append(h('p.muted', null, t('game.noOrders')));
      this.actionsEl.append(
        h('button.btn', { disabled: !this.orders.length, onclick: () => this.removeOrder(this.orders.length - 1) }, t('game.undo')),
        h('button.btn', { disabled: !this.orders.length, onclick: () => { this.orders = []; this.rebuildDraft(); this.cancelSelection(); } }, t('game.clearAll')),
        h('button.btn.primary.wide', { onclick: () => void this.submit() }, t('game.submit')),
      );
      return;
    }
    if (this.activePlayer !== -1) {
      this.sheetEl.append(h('h3', null, this.activePlayer === this.me ? t('game.ordersYours') : t('game.ordersOf', this.playerName(this.activePlayer))));
      const list = h('ol.orders');
      for (const row of this.played) {
        list.append(h('li', { class: row.error ? 'failed' : 'done' },
          chip(this.orderIcon(row.order), row.order.army), h('span.order-text', null,
            this.orderText(row.order) + (row.error ? ` — ${errorText(row.error)}` : '')),
          h('span.mark', null, row.error ? '✗' : '✓')));
      }
      this.sheetEl.append(list);
    }
    if (this.phase === 'play') this.actionsEl.append(h('button.btn.wide', { onclick: () => { this.skip = true; } }, '⏭ ' + t('game.skip')));
  }

  private pushLog(line: string): void {
    this.log.push(line);
    if (this.log.length > 200) this.log.splice(0, this.log.length - 200);
    this.renderLog();
  }
  private renderLog(): void {
    clear(this.logEl);
    for (const line of this.log.slice(-60)) this.logEl.append(h('div', { class: line.startsWith('—') ? 'sep' : '' }, line));
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  private onHover(node: number | null, ev?: MouseEvent): void {
    if (node === null || !ev) {
      this.tipEl.classList.remove('open');
      return;
    }
    const view = this.view;
    clear(this.tipEl);
    this.tipEl.append(h('b', null, nodeName(node)));
    let any = false;
    for (let a = 0; a < NUM_ARMIES; a++) {
      const here = view.pieces.filter((p) => p.army === a && p.loc === node);
      if (!here.length) continue;
      any = true;
      const row = h('div.tip-row', null, h('span.swatch', { style: `background:${ARMY_COLORS[a].fill}` }));
      let power = 0;
      for (const type of PIECE_TYPES) {
        const n = here.filter((p) => p.type === type).length;
        if (!n) continue;
        power += n * PIECES[type].power;
        row.append(chip(type, a, n));
      }
      row.append(h('span.tip-power', null, `${this.ownerName(a)} · ${t('game.powerAt', power)}`));
      this.tipEl.append(row);
    }
    if (!any) this.tipEl.append(h('div.muted', null, t('game.emptyNode')));
    this.tipEl.classList.add('open');
    const w = this.tipEl.offsetWidth, hgt = this.tipEl.offsetHeight;
    this.tipEl.style.left = Math.min(window.innerWidth - w - 8, ev.clientX + 16) + 'px';
    this.tipEl.style.top = Math.min(window.innerHeight - hgt - 8, ev.clientY + 18) + 'px';
  }

  private bannerTimer = 0;
  private showBanner(text: string, ms: number): void {
    this.bannerEl.textContent = text;
    this.bannerEl.classList.add('open');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.bannerEl.classList.remove('open'), ms);
  }

  // --------------------------------------------------------------- playback

  private point(loc: number, army: number): { x: number; y: number } {
    if (loc !== RESERVE) return this.board.clientPoint(loc);
    const r = (this.reserveEls[army] ?? this.cardsEl).getBoundingClientRect();
    return { x: r.left + Math.min(r.width / 2, 60), y: r.top + r.height / 2 };
  }

  /** Slides a chip across the screen between two points. */
  private async fly(type: IconName, army: number, from: { x: number; y: number }, to: { x: number; y: number }, ms: number, fade = false): Promise<void> {
    if (this.skip || !this.alive) return;
    const el = chip(type, army);
    el.classList.add('flying');
    const size = Math.max(0.8, this.board.scale * 1.25);
    el.style.left = from.x + 'px';
    el.style.top = from.y + 'px';
    this.flyEl.append(el);
    const start = `translate(-50%,-50%) scale(${size})`;
    const end = `translate(calc(-50% + ${to.x - from.x}px), calc(-50% + ${to.y - from.y}px)) scale(${size})`;
    try {
      await el.animate([{ transform: start, opacity: 1 }, { transform: end, opacity: fade ? 0 : 1 }],
        { duration: Math.max(60, ms), easing: 'cubic-bezier(.3,.1,.3,1)', fill: 'forwards' }).finished;
    } catch {
      // Animation cancelled: nothing to clean up beyond removing the chip.
    }
    el.remove();
  }

  private renderPlay(view: Snapshot): void {
    this.cur = view;
    this.board.render(view);
    this.renderCards(view);
  }

  private without(view: Snapshot, army: number, type: PieceType, loc: number, n = 1): Snapshot {
    let left = n;
    return { ...view, pieces: view.pieces.filter((p) => !(left > 0 && p.army === army && p.type === type && p.loc === loc && left-- > 0)) };
  }

  private async playback(before: Snapshot, events: RoundEvent[]): Promise<void> {
    const speed = SPEEDS[settings.speed - 1] * (this.spectating ? 1.6 : 1);
    const pause = (ms: number) => (this.skip || !this.alive ? Promise.resolve() : wait(ms / speed));
    const iAm = (army: number) => this.state.armies[army].controller === this.me;
    let incomeSound = false;
    this.renderPlay(before);
    this.renderSheet();
    this.setHint('');

    for (const ev of events) {
      if (this.skip || !this.alive) break;
      switch (ev.t) {
        case 'turn':
          this.activePlayer = ev.player;
          this.played = [];
          this.setPhase(t('game.phase.exec'));
          this.renderCards(this.cur);
          this.renderSheet();
          await pause(380);
          break;

        case 'order': {
          const o = ev.order;
          this.played.push({ order: o, error: ev.error, merged: ev.merged });
          this.renderSheet();
          if (ev.error) {
            if (ev.error === 'cancelled') this.pushLog(t('log.cancelled', this.orderText(o)));
            await pause(420);
            break;
          }
          if (o.k === 'move' && !ev.merged) {
            this.renderPlay(this.without(this.cur, o.army, o.type, o.from));
            await this.fly(o.type, o.army, this.point(o.from, o.army), this.point(o.to, o.army), 430 / speed);
          } else if (o.k === 'launch') {
            this.pushLog(t('log.launch', this.armyTitle(o.army)));
            audio.sfx('megafly', { maxMs: 2600 });
            if (!iAm(o.army)) audio.voice(TAUNTS.missile, true);
            const from = this.point(o.from, o.army);
            this.renderPlay(this.without(this.cur, o.army, 'M', o.from));
            await this.fly('M', o.army, from, { x: from.x + 60, y: from.y - 420 }, 900 / speed, true);
          } else if (o.k === 'up' || o.k === 'mk') {
            if (o.at !== RESERVE) this.board.effect(o.at, 'trade', 600);
            await pause(260);
          } else {
            await pause(200);
          }
          break;
        }

        case 'penalty':
          this.pushLog(t('log.penalty', this.subject(ev.player)));
          await pause(500);
          break;

        case 'strike': {
          this.activePlayer = -1;
          this.setPhase(t('game.phase.conflict'));
          const to = ev.target === RESERVE ? this.point(RESERVE, ev.targetArmy) : this.board.clientPoint(ev.target);
          await this.fly('M', ev.army, { x: to.x - 90, y: to.y - 520 }, to, 700 / speed);
          audio.stop('megafly');
          audio.sfx('megaexpl');
          if (ev.target !== RESERVE) this.board.effect(ev.target, 'boom', 1100);
          else this.bubble(ev.targetArmy, '💥');
          this.boardWrap.classList.add('shake');
          setTimeout(() => this.boardWrap.classList.remove('shake'), 600);
          this.pushLog(t('log.strike',
            ev.target === RESERVE ? t('node.reserveOf', armyName(ev.targetArmy)) : nodeName(ev.target), ev.power));
          if (ev.snap) this.renderPlay(ev.snap);
          await pause(1000);
          break;
        }

        case 'bounce': {
          this.activePlayer = -1;
          this.setPhase(t('game.phase.conflict'));
          this.board.effect(ev.node, 'bounce', 600);
          this.board.floatText(ev.node, t('fx.tie'));
          this.pushLog(t('log.bounce', nodeName(ev.node)));
          await pause(380);
          let view = this.cur;
          for (const m of ev.moves) view = this.without(view, m.army, m.type, ev.node);
          this.renderPlay(view);
          const from = this.board.clientPoint(ev.node);
          await Promise.all(ev.moves.slice(0, 8).map((m) => this.fly(m.type, m.army, from, this.point(m.to, m.army), 420 / speed)));
          break;
        }

        case 'standoff':
          this.board.floatText(ev.node, t('fx.standoff'));
          this.pushLog(t('log.standoff', nodeName(ev.node)));
          await pause(450);
          break;

        case 'battle': {
          this.activePlayer = -1;
          this.setPhase(t('game.phase.conflict'));
          const sorted = [...ev.powers].sort((a, b) => b.power - a.power);
          this.board.effect(ev.node, 'battle', 800);
          this.board.floatText(ev.node, sorted.map((s) => s.power).join(' › '), '#ffe066', 1300);
          audio.sfx('battle', { maxMs: 1100, volume: 0.8 });
          await pause(700);
          const taker = ev.captured[0]?.to ?? 0;
          const from = this.board.clientPoint(ev.node);
          let view = this.cur;
          for (const c of ev.captured) view = this.without(view, c.army, c.type, ev.node);
          this.renderPlay(view);
          await Promise.all(ev.captured.slice(0, 8).map((c, i) =>
            wait((i * 70) / speed).then(() => this.fly(c.type, c.army, from, this.point(RESERVE, taker), 520 / speed))));
          const loot = PIECE_TYPES.map((type) => [type, ev.captured.filter((c) => c.type === type).length] as const)
            .filter(([, n]) => n).map(([type, n]) => `${n}× ${pieceName(type)}`).join(', ');
          this.pushLog(t('log.battle', this.subject(ev.winner), nodeName(ev.node), sorted.map((s) => s.power).join(' › '), loot));
          const iLost = ev.captured.some((c) => iAm(c.army));
          if (iLost && ev.winner !== this.me && ev.winner !== MERC) audio.voice(TAUNTS.win);
          else if (ev.winner === this.me && ev.value >= 10) audio.voice(TAUNTS.lose);
          break;
        }

        case 'income':
          this.activePlayer = -1;
          this.setPhase(t('game.phase.income'));
          if (!incomeSound) {
            incomeSound = true;
            audio.sfx('clctblts');
          }
          this.pushLog(t('log.income', this.armyTitle(ev.army), ev.amount));
          if (ev.snap) this.renderPlay(ev.snap);
          this.bubble(ev.army, '+' + ev.amount);
          await pause(320);
          break;

        case 'flag': {
          const captor = this.armyTitle(ev.captor);
          this.pushLog(t('log.flag', captor, armyName(ev.victim)));
          this.showBanner(t('banner.flag', captor, armyName(ev.victim)), 2200);
          audio.sfx('flg_cap');
          this.board.effect(HQ[ev.victim], 'battle', 900);
          if (!iAm(ev.captor)) audio.voice(TAUNTS.kill, true);
          if (ev.snap) this.renderPlay(ev.snap);
          await pause(1900);
          break;
        }

        case 'out':
          this.pushLog(t('log.out', this.subject(ev.player)));
          break;

        case 'end':
          break;
      }
      if (ev.snap && !this.skip) this.renderPlay(ev.snap);
      while (this.paused && this.alive && !this.skip) await wait(120);
    }
    audio.stop('megafly');
    this.activePlayer = -1;
    this.played = [];
    this.renderPlay(snapshot(this.state));
    this.renderSheet();
    this.renderHeader();
  }

  private setPhase(label: string): void {
    if (this.phaseLabel === label) return;
    this.phaseLabel = label;
    this.renderHeader();
  }

  private bubble(army: number, text: string): void {
    const card = this.cardEls[army];
    if (!card || this.skip) return;
    const el = h('span.bubble', null, text);
    card.append(el);
    setTimeout(() => el.remove(), 1200);
  }

  // ----------------------------------------------------------------- dialogs

  private openPause(): void {
    if (document.querySelector('.backdrop')) return;
    this.pause();
    // Sub-dialogs replace the pause menu and bring it back when closed, so it picks up a language change.
    const sub = (open: (onClose: () => void) => void) => () => {
      this.pause();
      open(() => {
        this.resume();
        if (this.alive) this.openPause();
      });
    };
    const refresh = () => {
      this.board.relabel();
      this.renderAll();
      this.renderLog();
      (this.el.querySelector('.log-title') as HTMLElement).textContent = t('game.log');
    };
    const handle: ModalHandle = modal(t('pause.title'), [], [
      { label: t('pause.resume'), primary: true },
      { label: t('menu.options'), action: sub((done) => this.app.openOptions(() => { refresh(); done(); })) },
      { label: t('pause.rules'), action: sub((done) => this.app.openRules(done)) },
      {
        label: t('pause.quit'), action: () => {
          if (!this.state.over) this.persist();
          handle.close();
          this.app.showMenu();
          return false;
        },
      },
    ], { onClose: () => this.resume() });
    handle.el.classList.add('stack');
  }

  private showEliminated(): void {
    audio.setMood('lose');
    modal(t('dead.title'), [h('p', null, t('dead.text'))], [
      {
        label: t('dead.watch'), action: () => {
          this.spectating = true;
          audio.setMood('game');
          this.startRound();
        },
      },
      {
        label: t('dead.end'), primary: true, action: () => {
          this.finishInstantly();
        },
      },
    ], { dismissable: false });
  }

  /** Plays the rest of the game without animation and shows the result. */
  private finishInstantly(): void {
    const rng = makeRng(Date.now() >>> 0);
    let guard = 0;
    while (!this.state.over && guard++ < 300) {
      const all = this.state.players.map((p) => {
        if (!p.alive || p.kind !== 'ai') return [];
        const steps = planSteps(this.state, p.id, { level: 1, style: generalById(p.general).style, rng });
        let r = steps.next();
        while (!r.done) r = steps.next();
        return r.value;
      });
      resolveRound(this.state, all, { lastRound: guard >= 60 });
    }
    clearSave();
    this.phase = 'over';
    this.cur = snapshot(this.state);
    this.renderAll();
    this.showGameOver();
  }

  private showGameOver(): void {
    const s = this.state;
    const won = s.winners.includes(this.me);
    const draw = s.winners.length > 1;
    const title = !s.winners.length ? t('over.nobody') : won ? (draw ? t('over.draw') : t('over.win')) : t('over.lose');
    audio.setMood(won ? 'win' : 'lose');
    if (!won) audio.voice('pwr_crpt', true);
    const names = s.winners.map((p) => this.subject(p)).join(', ');
    const reason = !s.winners.length ? '' : s.endReason === 'time' ? t('over.byTime', names) : t('over.byFlags', names);
    const cols = ['over.player', 'over.strength', 'over.captured', 'over.lost', 'over.battles', 'over.flagsTaken', 'over.missiles', 'over.income'] as const;
    const table = h('table.stats', null,
      h('thead', null, h('tr', null, ...cols.map((c) => h('th', null, t(c))))),
      h('tbody', null, ...seatAll(s).map((p) => {
        const st = s.players[p].stats;
        const army = s.players[p].armies[0];
        return h('tr', { class: s.winners.includes(p) ? 'winner' : '' },
          h('td', null, h('span.swatch', { style: `background:${ARMY_COLORS[army].fill}` }), ' ', this.playerName(p)),
          ...[playerStrength(s, p), st.captured, st.lost, st.battlesWon, st.flags, st.missiles, st.income].map((v) => h('td', null, String(v))));
      })));
    modal(title, [
      h('p.over-reason', null, reason),
      h('p.muted', null, t('over.rounds', s.round, fmtClock(this.elapsedMs))),
      table,
    ], [
      { label: t('over.menu'), action: () => { this.app.showMenu(); } },
      { label: t('over.again'), primary: true, action: () => { this.app.startGame(this.setup); } },
    ], { wide: true, dismissable: false }).el.classList.add(won ? 'victory' : 'defeat');
  }
}

/** All players in seat order, dead or alive. */
function seatAll(state: GameState): number[] {
  const living = seatOrder(state);
  return state.players.map((p) => p.id).sort((a, b) => state.players[a].armies[0] - state.players[b].armies[0] || living.indexOf(a) - living.indexOf(b));
}
