import { MERC, Match, Order, RoundReport, Snapshot, orderTimeMinutes, snapshot } from '../../api';
import { audio } from '../audio';
import { BoardView } from '../boardView';
import { h, wait } from '../dom';
import { nodeLabel, t } from '../i18n';
import { closeAllModals, modal, toast } from '../modal';
import { SavedGame, Setup, Speed, clearSave, saveGame, settings } from '../settings';
import { AiSeats } from './aiSeats';
import { GameClock } from './clock';
import { openPauseMenu, showEliminatedDialog, showGameOverDialog } from './dialogs';
import { GameNames } from './names';
import { ArmyCards } from './panels/armyCards';
import { GameLog } from './panels/gameLog';
import { RoundHeader } from './panels/header';
import { OrderPanel } from './panels/orderPanel';
import { NodeTooltip } from './panels/tooltip';
import { PlanningController } from './planning';
import { PlaybackHost, RoundPlayback } from './playback';
import { Popover } from './popover';

export interface AppApi {
  showMenu(): void;
  startGame(setup: Setup): void;
  openOptions(onClose?: () => void): void;
  openRules(onClose?: () => void): void;
}

type Phase = 'plan' | 'play' | 'over';

/** Playback speed factor of each speed setting. */
const PLAYBACK_SPEED: Record<Speed, number> = { 1: 1, 2: 2.2, 3: 5 };
/** A spectator only watches: rounds go by faster. */
const SPECTATOR_SPEEDUP = 1.6;
const SAVED_LOG_LINES = 80;

/**
 * The game in the browser. It hosts the Match: the human writes orders (PlanningController),
 * the bots think meanwhile (AiSeats), then the screen plays the round and animates it
 * (RoundPlayback). Everything else is drawn by the panels.
 */
export class GameScreen {
  readonly el: HTMLElement;
  private readonly match: Match;
  private readonly me: number;
  private readonly names: GameNames;
  private readonly clock: GameClock;
  private readonly ai: AiSeats;
  private readonly board: BoardView;
  private readonly planning: PlanningController;
  private readonly playback: RoundPlayback;
  private readonly header = new RoundHeader();
  private readonly cards: ArmyCards;
  private readonly orderPanel = new OrderPanel();
  private readonly log: GameLog;
  private readonly tooltip: NodeTooltip;

  private phase: Phase = 'plan';
  private phaseLabel = '';
  private spectating = false;
  /** False once the screen is closed: pending work must stop. */
  private alive = true;
  /** Round and referee being shown; the engine state is already one round ahead during playback. */
  private shownRound = 1;
  private shownReferee = 0;

  private readonly hintEl = h('div.hint');
  private readonly bannerEl = h('div.banner');
  private readonly popoverEl = h('div.popover');
  private readonly flyLayer = h('div.fly-layer');
  private readonly boardWrap = h('div.board-wrap');
  private bannerTimer = 0;

  constructor(
    private readonly app: AppApi,
    private readonly setup: Setup,
    saved?: SavedGame,
  ) {
    this.match = saved ? Match.restore(saved.state) : Match.create(setup);
    this.me = setup.players.findIndex((p) => p.kind === 'human');
    this.names = new GameNames(this.match, this.me);
    this.ai = new AiSeats(this.match, setup.players);
    this.log = new GameLog(saved?.log ?? []);
    this.clock = new GameClock({
      elapsedMs: saved?.elapsedMs ?? 0,
      gameLimit: setup.gameLimit,
      isRunning: () => this.canGiveOrders,
      onTick: () => this.renderHeader(),
      onLastRound: () => this.showBanner(t('banner.last'), 1800),
      onTimeUp: () => {
        toast(t('game.timeUp'));
        void this.submit(true);
      },
    });
    this.board = new BoardView(this.match.board, {
      click: (node) => this.planning.onNode(node),
      hover: (node, event) => this.onHover(node, event),
      label: nodeLabel,
    });
    this.planning = new PlanningController({
      match: this.match,
      me: this.me,
      board: this.board,
      names: this.names,
      popover: new Popover(this.popoverEl, this.boardWrap),
      isPlanning: () => this.phase === 'plan',
      canGiveOrders: () => this.canGiveOrders,
      changed: () => this.renderAll(),
      pause: () => this.clock.pause(),
      resume: () => this.clock.resume(),
    });
    this.cards = new ArmyCards(this.planning);
    this.tooltip = new NodeTooltip(this.names);
    this.playback = new RoundPlayback(this.playbackHost(), snapshot(this.match.state));

    this.boardWrap.append(this.board.root, this.bannerEl, this.popoverEl);
    this.boardWrap.style.setProperty('--ratio', String(this.board.ratio));
    this.el = h(
      'div.game',
      null,
      h('aside.left', null, this.cards.el),
      h('main.center', null, this.boardWrap),
      h(
        'aside.right',
        null,
        this.header.el,
        this.hintEl,
        this.orderPanel.sheetEl,
        this.orderPanel.actionsEl,
        this.log.titleEl,
        this.log.el,
      ),
      this.flyLayer,
      this.tooltip.el,
    );
    this.el.addEventListener('contextmenu', (e) => {
      if (!this.planning.hasSelection) return;
      e.preventDefault();
      this.planning.cancelSelection();
    });
    window.addEventListener('keydown', this.onKey);
    this.clock.start();
    audio.setMood('game');
    if (!saved) audio.sfx('strtgame');
    if (!this.humanAlive) this.spectating = true;
    queueMicrotask(() => this.startRound());
  }

  destroy(): void {
    this.alive = false;
    this.ai.stop();
    this.clock.stop();
    window.removeEventListener('keydown', this.onKey);
  }

  // ------------------------------------------------------------------- flow

  private get humanAlive(): boolean {
    return this.match.state.players[this.me].alive;
  }

  private get canGiveOrders(): boolean {
    return this.phase === 'plan' && !this.spectating;
  }

  private startRound(): void {
    if (!this.alive) return;
    const state = this.match.state;
    this.phase = 'plan';
    this.phaseLabel = t('game.phase.plan');
    this.planning.reset();
    this.shownRound = state.round;
    this.shownReferee = state.referee;
    this.clock.startOrderTimer(this.setup.orderTimer ? orderTimeMinutes(state.mode) * 60 * 1000 : Infinity);
    const heading = t('log.round', state.round);
    if (this.log.last !== heading) this.log.push(heading);
    else this.log.render();
    this.persist();
    this.ai.startThinking(() => {
      if (this.alive && this.phase === 'plan') this.renderCards();
    });
    this.renderAll();
    this.showBanner(this.clock.isLastRound ? t('banner.last') : t('banner.round', state.round), 1100);
    if (state.round > 1) audio.sfx('new_rnd');
    if (this.spectating) void this.submit(true);
    else if (location.hash.includes('autoplay')) void this.autoplay();
  }

  /** Debug aid (#autoplay in the URL): the balanced general plays the human seat. */
  private async autoplay(): Promise<void> {
    const round = this.match.state.round;
    const stillPlanning = () => this.alive && this.phase === 'plan' && this.match.state.round === round;
    await this.ai.done;
    await wait(300);
    if (!stillPlanning()) return;
    try {
      const orders = await this.ai.standIn(this.me);
      if (!stillPlanning()) return;
      for (const o of orders) this.planning.tryAdd(o);
      void this.submit(true);
    } catch {
      // Aborted: the screen was closed.
    }
  }

  private persist(): void {
    saveGame({
      v: 3,
      setup: this.setup,
      state: this.match.exportState(),
      elapsedMs: this.clock.elapsedMs,
      log: this.log.recent(SAVED_LOG_LINES),
    });
  }

  /** Hands in the human's orders, waits for the bots, plays the round and shows it. */
  private async submit(auto = false): Promise<void> {
    if (this.phase !== 'plan') return;
    if (!auto && !this.planning.orders.length && this.humanAlive && this.planning.anyOrderPossible) {
      this.confirmNoOrders();
      return;
    }
    this.phase = 'play';
    this.phaseLabel = t('game.phase.exec');
    this.planning.cancelSelection();
    closeAllModals();
    this.clock.clearPauses();
    this.playback.skipping = false;
    this.playback.frame = snapshot(this.match.state);
    this.renderAll();
    if (this.ai.anyThinking) this.setHint(t('game.waitingAi'));
    if (this.humanAlive) {
      const result = this.match.submit(this.me, this.planning.orders);
      if (!result.accepted) console.error('Orders refused', result);
    }
    await this.ai.done;
    if (!this.alive) return;

    const report = this.match.resolveRound({ snapshots: true, lastRound: this.clock.isLastRound });
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__round = report;
    if (this.match.state.over) clearSave();
    await this.playRound(report);
    if (!this.alive) return;

    if (this.match.state.over) {
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

  /** Giving no orders costs a Power: make sure it is on purpose. */
  private confirmNoOrders(): void {
    this.clock.pause();
    modal(
      t('game.submit'),
      [h('p', null, t('game.noneWarning'))],
      [
        { label: t('common.cancel') },
        {
          label: t('common.confirm'),
          primary: true,
          action: () => {
            void this.submit(true);
          },
        },
      ],
      { onClose: () => this.clock.resume() },
    );
  }

  private async playRound(report: RoundReport): Promise<void> {
    const speed = PLAYBACK_SPEED[settings.speed] * (this.spectating ? SPECTATOR_SPEEDUP : 1);
    this.renderSheet();
    this.setHint('');
    await this.playback.play(report.before, report.events, speed);
    this.playback.showFrame(snapshot(this.match.state));
    this.renderSheet();
    this.renderHeader();
  }

  private onKey = (e: KeyboardEvent): void => {
    if (document.querySelector('.backdrop')) return;
    if (e.key === 'Escape') {
      if (this.planning.hasSelection) this.planning.cancelSelection();
      else if (this.phase !== 'over') this.openPause();
    } else if (this.phase === 'play' && (e.key === ' ' || e.key === 'Enter')) {
      e.preventDefault();
      this.playback.skipping = true;
    } else if (this.canGiveOrders) {
      if (e.key === 'Enter') {
        e.preventDefault();
        void this.submit();
      } else if (e.key === 'Backspace' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z')) {
        e.preventDefault();
        this.planning.undoLast();
      }
    }
  };

  // -------------------------------------------------------------- rendering

  /** What the board shows: the draft of the human's orders while planning, the playback frame otherwise. */
  private get view(): Snapshot {
    return this.phase === 'plan' ? snapshot(this.planning.draft) : this.playback.frame;
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
    const planning = this.phase === 'plan';
    const { marks, arrows } = planning ? this.planning.marks() : { marks: new Map(), arrows: [] };
    this.board.setMarks(marks);
    this.board.setArrows(arrows);
    this.boardWrap.classList.toggle('targeting', planning && this.planning.isTargeting);
  }

  private renderCards(view: Snapshot = this.view): void {
    this.cards.render({
      view,
      state: this.match.state,
      me: this.me,
      canGiveOrders: this.canGiveOrders,
      activePlayer: this.playback.activePlayer,
      referee: this.shownReferee,
      statusOf: (controller) => this.aiStatus(controller),
      ownerName: (army) => this.names.ownerName(army),
    });
  }

  /** "Thinking" or "Ready" next to an AI player's armies while the round is planned. */
  private aiStatus(controller: number): string {
    if (controller === MERC || !this.ai.isAi(controller) || this.phase !== 'plan') return '';
    return this.match.hasSubmitted(controller) ? t('game.ready') : t('game.thinking');
  }

  private renderHeader(): void {
    this.header.render({
      round: this.shownRound,
      phase: this.phaseLabel,
      orderMsLeft: this.canGiveOrders && this.setup.orderTimer ? this.clock.orderMsLeft : null,
      gameLimit: this.setup.gameLimit ? { lastRound: this.clock.isLastRound, msLeft: this.clock.gameMsLeft } : null,
      mapId: this.match.state.map,
      refereeName: this.names.playerName(this.shownReferee),
      onMenu: () => this.openPause(),
    });
  }

  private renderSheet(): void {
    const describe = (o: Order) => this.names.orderText(o);
    if (this.canGiveOrders) {
      this.orderPanel.showPlanning({
        orders: this.planning.orders,
        max: this.planning.maxOrders,
        describe,
        onRemove: (index) => this.planning.removeOrder(index),
        onUndo: () => this.planning.undoLast(),
        onClear: () => this.planning.clearOrders(),
        onSubmit: () => void this.submit(),
      });
      return;
    }
    const active = this.playback.activePlayer;
    this.orderPanel.showPlayback({
      title:
        active === -1
          ? null
          : active === this.me
            ? t('game.ordersYours')
            : t('game.ordersOf', this.names.playerName(active)),
      played: this.playback.played,
      describe,
      onSkip:
        this.phase === 'play'
          ? () => {
              this.playback.skipping = true;
            }
          : null,
    });
  }

  private renderHint(): void {
    this.setHint(this.canGiveOrders ? this.planning.hint() : '');
  }

  private setHint(text: string): void {
    this.hintEl.textContent = text;
    this.hintEl.classList.toggle('open', !!text && settings.hints);
  }

  private setPhase(label: string): void {
    if (this.phaseLabel === label) return;
    this.phaseLabel = label;
    this.renderHeader();
  }

  private showBanner(text: string, ms: number): void {
    this.bannerEl.textContent = text;
    this.bannerEl.classList.add('open');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.bannerEl.classList.remove('open'), ms);
  }

  private onHover(node: number | null, event?: MouseEvent): void {
    if (node === null || !event) this.tooltip.hide();
    else this.tooltip.show(node, this.view, event);
  }

  private playbackHost(): PlaybackHost {
    return {
      board: this.board,
      boardWrap: this.boardWrap,
      flyLayer: this.flyLayer,
      cards: this.cards,
      log: this.log,
      names: this.names,
      me: this.me,
      state: () => this.match.state,
      isAlive: () => this.alive,
      isPaused: () => this.clock.paused,
      setPhase: (label) => this.setPhase(label),
      showBanner: (text, ms) => this.showBanner(text, ms),
      showFrame: (view) => {
        this.board.render(view);
        this.renderCards(view);
      },
      showOrders: () => this.renderSheet(),
    };
  }

  // ----------------------------------------------------------------- dialogs

  private openPause(): void {
    openPauseMenu({
      pause: () => this.clock.pause(),
      resume: () => this.clock.resume(),
      isOpen: () => this.alive,
      openOptions: (onClose) => this.app.openOptions(onClose),
      openRules: (onClose) => this.app.openRules(onClose),
      onOptionsClosed: () => {
        this.board.relabel();
        this.renderAll();
        this.log.relabel();
      },
      onQuit: () => {
        if (!this.match.state.over) this.persist();
        this.app.showMenu();
      },
    });
  }

  private showEliminated(): void {
    audio.setMood('lose');
    showEliminatedDialog(
      () => {
        this.spectating = true;
        audio.setMood('game');
        this.startRound();
      },
      () => void this.finishInstantly(),
    );
  }

  /** Plays the rest of the game without animation and shows the result. */
  private async finishInstantly(): Promise<void> {
    await this.ai.finishGame();
    if (!this.alive) return;
    clearSave();
    this.phase = 'over';
    this.playback.frame = snapshot(this.match.state);
    this.renderAll();
    this.showGameOver();
  }

  private showGameOver(): void {
    const won = this.match.state.winners.includes(this.me);
    audio.setMood(won ? 'win' : 'lose');
    if (!won) audio.voice('pwr_crpt', true);
    showGameOverDialog({
      state: this.match.state,
      me: this.me,
      elapsedMs: this.clock.elapsedMs,
      playerName: (p) => this.names.playerName(p),
      subject: (p) => this.names.subject(p),
      onMenu: () => this.app.showMenu(),
      onRematch: () => this.app.startGame(this.setup),
    });
  }
}
