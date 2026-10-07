import { Replay } from '../../../platform/core/replay';
import { ReplayRenderer, ViewerPlugin } from '../../../platform/core/viewer';
import { replaySteps } from '../../../platform/core/verify';
import { MERC, ReadonlyGameState, Snapshot, getBoard, playerStrength, simulate, snapshot } from '../api';
// The game module only: the built-in bots have no business in the viewer.
import { PowerState, powerGame } from '../module/game';
import { PowerAction } from '../module/schema';
import { BoardView } from '../play/boardView';
import { clear, h } from '../play/dom';
import { GameNames } from '../play/game/names';
import { ArmyCards } from '../play/game/panels/armyCards';
import { GameLog } from '../play/game/panels/gameLog';
import { OrderPanel } from '../play/game/panels/orderPanel';
import { NodeTooltip } from '../play/game/panels/tooltip';
import { RoundPlayback } from '../play/game/playback';
import { ARMY_COLORS, installIcons } from '../play/icons';
import { armyName, nodeLabel, setLang, t } from '../play/i18n';
import { settings } from '../play/settings';
import '../play/style.css';

/** Draws a Power replay with the game's own board, army cards and round animation. */
class PowerReplayRenderer implements ReplayRenderer {
  private replay!: Replay;
  /** The position after each turn; states[0] is the start. */
  private states: PowerState[] = [];
  /** The orders of each turn, as the game accepted them. */
  private actions: PowerAction[][] = [];
  private shown = 0;
  /** Bumped by every jump, so that an animation finishing late does not undo it. */
  private run = 0;
  private board!: BoardView;
  private names!: GameNames;
  private cards = new ArmyCards(null);
  private orders = new OrderPanel();
  private log = new GameLog();
  private playback!: RoundPlayback;
  private tooltip!: NodeTooltip;
  private headEl = h('div.round-head');
  private bannerEl = h('div.banner');
  private bannerTimer = 0;
  private root: HTMLElement | null = null;

  mount(container: HTMLElement, replay: Replay): void {
    installIcons();
    this.replay = replay;
    this.states = [powerGame.setup(replay.match.setup)];
    for (const step of replaySteps(powerGame, replay)) {
      this.actions.push(step.actions);
      this.states.push(step.after);
    }
    const game = () => this.states[this.shown].game;
    this.board = new BoardView(this.boardOf(), {
      click: () => {},
      hover: (node, event) =>
        node === null || !event ? this.tooltip.hide() : this.tooltip.show(node, this.frame(), event),
      label: nodeLabel,
    });
    this.names = new GameNames(
      {
        get state() {
          return game();
        },
        board: this.boardOf(),
      },
      -1,
      replay.bots.map((b) => b.name),
    );
    this.tooltip = new NodeTooltip(this.names);
    const boardWrap = h('div.board-wrap', null, this.board.root, this.bannerEl);
    boardWrap.style.setProperty('--ratio', String(this.board.ratio));
    const flyLayer = h('div.fly-layer');
    this.playback = new RoundPlayback(
      {
        board: this.board,
        boardWrap,
        flyLayer,
        cards: this.cards,
        log: this.log,
        names: this.names,
        me: -1,
        state: game,
        isAlive: () => this.root !== null,
        isPaused: () => false,
        setPhase: (label) => this.renderHead(label),
        showBanner: (text, ms) => this.showBanner(text, ms),
        showFrame: (view) => this.draw(view),
        showOrders: () => this.renderOrders(),
      },
      this.frame(),
    );
    this.root = h(
      'div.game.spectator',
      null,
      h('aside.left', null, this.cards.el),
      h('main.center', null, boardWrap),
      h('aside.right', null, this.headEl, this.orders.sheetEl, this.log.titleEl, this.log.el),
      flyLayer,
      this.tooltip.el,
    );
    container.append(this.root);
    this.show(0);
  }

  show(turn: number): void {
    this.run++;
    this.playback.skipping = true;
    this.shown = turn;
    this.playback.activePlayer = -1;
    this.playback.played = [];
    this.playback.showFrame(this.frame());
    this.renderHead(turn === 0 ? t('game.phase.plan') : '');
    this.renderOrders();
    this.log.push(t('log.round', this.states[turn].game.round));
  }

  async play(turn: number, speed: number): Promise<void> {
    const before = this.states[turn - 1];
    const lastRound = before.game.round >= before.maxRounds;
    // The engine plays the turn again with board snapshots after every event, for the animation.
    const { events } = simulate(
      before.game,
      this.actions[turn - 1].map((a) => a.orders),
      { snapshots: true, lastRound },
    );
    this.shown = turn;
    const run = ++this.run;
    this.playback.skipping = false;
    this.renderHead(t('game.phase.exec'));
    await this.playback.play(snapshot(before.game), events, speed);
    if (this.root && run === this.run) this.show(turn);
  }

  skip(): void {
    this.playback.skipping = true;
  }

  seats(): { color: string; detail: string }[] {
    return this.states[0].game.players.map((p) => ({
      color: ARMY_COLORS[p.armies[0]].fill,
      detail: p.armies.map(armyName).join(' + '),
    }));
  }

  status(turn: number): string {
    const game = this.states[turn].game;
    const material = game.players.map((p) => playerStrength(game, p.id)).join(' · ');
    return `${t('game.round', Math.min(game.round, this.states[turn].maxRounds))} / ${this.states[turn].maxRounds} · Σ ${material}`;
  }

  destroy(): void {
    this.playback.skipping = true;
    this.root?.remove();
    this.root = null;
    clearTimeout(this.bannerTimer);
  }

  private boardOf() {
    return getBoard(this.replay.match.setup.variant);
  }

  private frame(): Snapshot {
    return snapshot(this.states[this.shown].game);
  }

  private draw(view: Snapshot): void {
    this.board.render(view);
    const game = this.states[this.shown].game;
    this.cards.render({
      view,
      state: game,
      me: -1,
      canGiveOrders: false,
      activePlayer: this.playback?.activePlayer ?? -1,
      referee: game.referee,
      statusOf: () => '',
      ownerName: (army) => this.names.ownerName(army),
    });
  }

  private renderHead(phase: string): void {
    const game: ReadonlyGameState = this.states[this.shown].game;
    clear(this.headEl);
    this.headEl.append(
      h(
        'div.round-row',
        null,
        h('div', null, h('div.round-n', null, t('game.round', game.round)), h('div.phase', null, phase)),
      ),
      h('div.round-sub', null, h('span', null, t('game.referee', this.names.playerName(game.referee)))),
    );
  }

  private renderOrders(): void {
    const active = this.playback.activePlayer;
    this.orders.showPlayback({
      title: active === -1 || active === MERC ? null : t('game.ordersOf', this.names.playerName(active)),
      played: this.playback.played,
      describe: (order) => this.names.orderText(order),
      onSkip: null,
    });
  }

  private showBanner(text: string, ms: number): void {
    this.bannerEl.textContent = text;
    this.bannerEl.classList.add('open');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.bannerEl.classList.remove('open'), ms);
  }
}

export const powerViewer: ViewerPlugin = {
  game: powerGame,
  create: () => new PowerReplayRenderer(),
  setLanguage: (lang) => setLang(lang === 'es' ? 'es' : 'en'),
  // Sound effects and voices only: the stream brings its own music.
  setSound(on) {
    settings.music = 0;
    settings.sfx = on ? 0.8 : 0;
    settings.voices = on;
  },
};
