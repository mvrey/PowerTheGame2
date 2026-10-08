import { fill, h, wait } from '../../../../platform/web/dom';
import { closeAllModals, modal, toast } from '../../../../platform/web/modal';
import {
  Bot,
  FleetOrder,
  GameState,
  Match,
  NEUTRAL,
  Rng,
  checkOrders,
  decide,
  planetsOf,
  publicState,
  randomSeed,
  seatRng,
  shipsOf,
  timeSlicer,
} from '../../api';
import { DEFAULT_BOT_ID, DEFAULT_BOT_LEVEL, bots } from '../../bots';
import { colorOf } from '../colors';
import { GalaxyView, NOBODY, SPECTATOR, Viewpoint, flightTurns, seesShips, seesStats } from '../galaxyView';
import { errorText, t } from '../i18n';
import { SavedGame, SeatConfig, Setup, clearSave, saveGame, settings } from '../settings';
import { Message, turnHeading, turnMessages } from './messages';
import { standingsTable } from './standings';

export interface GameApi {
  showMenu(): void;
  startGame(setup: Setup): void;
  openOptions(onClose?: () => void): void;
  openRules(onClose?: () => void): void;
}

/** Bots give the page the thread back after thinking this long, so it stays responsive. */
const THINK_SLICE_MS = 9;
/** Length of a turn's animation at normal speed, in ms. */
const TURN_MS = 1400;
/** Turns played at most when the rest of a game is finished without animation. */
const MAX_INSTANT_TURNS = 1000;
const MAX_LOG = 300;

type Phase = 'handover' | 'planning' | 'waiting' | 'playing' | 'over';

/** A game of Konquest in the browser: humans at this computer (hot seat) against the AIs. */
export class GameScreen {
  readonly el: HTMLElement;
  private readonly match: Match;
  private readonly names: string[];
  private readonly bots: (Bot | null)[];
  private readonly rngs: Rng[];
  private readonly abort = new AbortController();
  private readonly galaxy: GalaxyView;
  private standing: FleetOrder[][];
  private log: Message[];

  private phase: Phase = 'planning';
  /** The human giving orders now. */
  private current = -1;
  /** Humans still to give their orders this turn. */
  private queue: number[] = [];
  private orders: FleetOrder[] = [];
  private selected: number | null = null;
  private hovered: number | null = null;
  private ships = 0;
  private repeat = false;
  private thinking: Promise<void> = Promise.resolve();
  private skipping = false;
  private finishing = false;
  /** When finishing without a turn limit: the turn the game is called at. */
  private finishBy = Infinity;

  private readonly headEl = h('div.kq-head');
  private readonly composerEl = h('div.kq-composer');
  private readonly ordersEl = h('div.kq-orders');
  private readonly fleetsEl = h('div.kq-fleets-list');
  private readonly logEl = h('div.kq-log');
  private readonly tipEl = h('div.kq-tip');
  private readonly overlayEl = h('div.kq-overlay');

  constructor(
    private readonly app: GameApi,
    private readonly setup: Setup,
    saved?: SavedGame,
  ) {
    this.match = saved
      ? new Match(saved.state)
      : Match.create({
          players: setup.players.length,
          seed: setup.seed,
          galaxy: setup.galaxy === 'custom' ? undefined : setup.galaxy,
          width: setup.width,
          height: setup.height,
          neutrals: setup.neutrals,
          random: !setup.fair,
          rules: setup.rules,
        });
    this.names = setup.players.map((s, i) => s.name || `${t('setup.players')} ${i + 1}`);
    this.bots = setup.players.map((s) => (s.kind === 'ai' ? createBot(s) : null));
    const seed = randomSeed();
    this.rngs = setup.players.map((_, i) => seatRng(seed, i));
    this.standing = saved?.standing ?? setup.players.map(() => []);
    this.log = saved?.log ?? [];

    this.galaxy = new GalaxyView({
      click: (planet) => this.clickPlanet(planet),
      hover: (planet, event) => this.hover(planet, event),
    });
    this.el = h(
      'div.kq-game',
      null,
      h('header.kq-bar', null, this.headEl, this.toolbar()),
      h('main.kq-main', null, this.galaxy.root, this.tipEl, this.overlayEl),
      h('aside.kq-side', null, this.composerEl, this.ordersEl, this.fleetsEl, h('h3', null, t('game.log')), this.logEl),
    );
    window.addEventListener('keydown', this.onKey);
    this.renderLog();
    void this.startTurn();
  }

  destroy(): void {
    this.abort.abort();
    this.skipping = true;
    window.removeEventListener('keydown', this.onKey);
    this.el.remove();
  }

  // ------------------------------------------------------------------ turn flow

  private get state(): GameState {
    return this.match.state as GameState;
  }

  private humansAlive(): number[] {
    return this.setup.players.flatMap((s, i) => (s.kind === 'human' && this.state.players[i].alive ? [i] : []));
  }

  private async startTurn(): Promise<void> {
    if (this.state.over) return this.gameOver();
    this.thinkAll();
    this.queue = this.humansAlive();
    if (!this.queue.length) return this.watchTurn();
    this.nextHuman();
  }

  /** The AIs think while the humans do, in slices, each on the position at the start of the turn. */
  private thinkAll(): void {
    const signal = this.abort.signal;
    const checkpoint = timeSlicer(THINK_SLICE_MS, () => wait(0), signal);
    this.thinking = (async () => {
      for (const p of this.state.players) {
        const bot = this.bots[p.id];
        if (!bot || !p.alive) continue;
        try {
          await decide(bot, this.match, p.id, { rng: this.rngs[p.id], checkpoint, signal }, (problem) =>
            console.warn(`Bot ${this.setup.players[p.id].bot} (seat ${p.id}):`, problem),
          );
        } catch {
          return; // Aborted: the game was closed.
        }
      }
    })();
  }

  private nextHuman(): void {
    this.current = this.queue.shift()!;
    this.orders = [];
    this.selected = null;
    // Several humans share the screen: each gets it to themselves.
    if (this.humansAlive().length > 1) {
      this.phase = 'handover';
      this.galaxy.render(publicState(this.state), this.viewpoint(NOBODY));
      this.showOverlay(
        h(
          'div.kq-handover',
          { style: `--c:${colorOf(this.current)}` },
          h('h2', null, t('game.handOver', this.names[this.current])),
          h('p.muted', null, t('game.handOver.text')),
          h('button.btn.primary.big', { onclick: () => this.plan() }, t('game.ready')),
        ),
      );
    } else this.plan();
    this.renderAll();
  }

  private plan(): void {
    this.phase = 'planning';
    this.showOverlay(null);
    this.renderAll();
  }

  private async endTurn(): Promise<void> {
    if (this.phase !== 'planning') return;
    const sheet = [...this.orders];
    // Standing orders go out after the others, as far as the ships left allow (KDE skips the rest).
    const left = checkOrders(this.state, this.current, sheet).orders;
    for (const o of this.standing[this.current]) {
      if (checkOrders(this.state, this.current, [...left, o]).problems.length === 0) left.push(o);
    }
    this.match.submit(this.current, left);
    this.selected = null;
    if (this.queue.length) return this.nextHuman();
    this.current = -1;
    await this.resolveTurn();
  }

  private async watchTurn(): Promise<void> {
    this.current = -1;
    this.phase = 'waiting';
    this.renderAll();
    await this.resolveTurn();
  }

  private async resolveTurn(): Promise<void> {
    this.phase = 'waiting';
    this.renderAll();
    await this.thinking;
    if (this.abort.signal.aborted) return;
    const before = publicState(this.state);
    const limit = this.setup.turnLimit;
    const report = this.match.resolve({
      lastTurn: (limit > 0 && before.turn >= limit) || before.turn >= this.finishBy,
    });
    const after = publicState(this.state);

    this.phase = 'playing';
    this.renderAll();
    this.skipping = this.finishing;
    const humans = this.humansAlive();
    const viewer = humans.length === 1 ? humans[0] : humans.length ? NOBODY : SPECTATOR;
    this.galaxy.render(before, this.viewpoint(viewer));
    await this.galaxy.animate(before, report.events, after, this.turnMs(), () => this.skipping);
    if (this.abort.signal.aborted) return;

    const news = turnMessages(before, report.events, this.names, (s) => this.setup.players[s].kind === 'human');
    if (news.length) [turnHeading(report.turn), ...news].forEach((m) => this.pushLog(m));
    this.dropLostStanding();
    if (
      report.events.some((e) => e.kind === 'out' && this.setup.players[e.player].kind === 'human') &&
      !this.state.over
    )
      toast(t('over.out'));
    this.save();
    if (!this.humansAlive().length && !this.state.over && !this.finishing) await wait(this.turnMs() / 3);
    void this.startTurn();
  }

  private turnMs(): number {
    return this.finishing || settings.speed === 3 ? 0 : TURN_MS / settings.speed;
  }

  /** KDE deletes a planet's standing orders when it is conquered. */
  private dropLostStanding(): void {
    this.standing = this.standing.map((orders, seat) =>
      orders.filter((o) => {
        const kept = this.state.planets[o.from].owner === seat;
        if (!kept) this.pushLog({ text: t('log.standingDropped', this.state.planets[o.from].name), seat });
        return kept;
      }),
    );
  }

  /** Plays the rest without animation (the humans are out), called at a turn limit if it drags on. */
  private finish(): void {
    this.finishing = true;
    this.skipping = true;
    this.finishBy = this.state.turn + MAX_INSTANT_TURNS;
  }

  private gameOver(): void {
    this.phase = 'over';
    clearSave();
    this.renderAll();
    const state = publicState(this.state);
    const humans = this.setup.players.flatMap((s, i) => (s.kind === 'human' ? [i] : []));
    const won = state.winner !== null && humans.includes(state.winner);
    const lost = humans.length > 0 && !won && humans.length === 1;
    const leader = [...state.players].sort(
      (a, b) => planetsOf(state, b.id) - planetsOf(state, a.id) || shipsOf(state, b.id) - shipsOf(state, a.id),
    )[0];
    const summary =
      state.endReason === 'conquest'
        ? t('over.winner', this.names[state.winner!], state.turn - 1)
        : state.endReason === 'turn-limit'
          ? t('over.limit', this.names[leader.id])
          : t('over.draw');
    const box = modal(
      won ? t('over.won') : lost ? t('over.lost') : t('over.end'),
      [h('p.over-reason', null, summary), standingsTable(state, this.names)],
      [
        { label: t('over.menu'), action: () => this.app.showMenu() },
        {
          label: t('over.again'),
          primary: true,
          action: () => this.app.startGame({ ...this.setup, seed: randomSeed() }),
        },
      ],
      { wide: true, dismissable: false },
    );
    box.el.classList.add(won ? 'victory' : lost ? 'defeat' : 'neutral');
  }

  private save(): void {
    if (this.state.over) return;
    saveGame({ v: 1, setup: this.setup, state: this.match.exportState(), standing: this.standing, log: this.log });
  }

  // ---------------------------------------------------------------- interaction

  private readonly onKey = (e: KeyboardEvent) => {
    if (document.querySelector('.backdrop') || (e.target as HTMLElement).tagName === 'INPUT') return;
    if (e.key === 'Escape') this.select(null);
    else if (e.key === 'Enter' && this.phase === 'planning') void this.endTurn();
    else if ((e.key === 'Backspace' || (e.key === 'z' && e.ctrlKey)) && this.orders.length) this.removeOrder(-1);
    else if (e.key === ' ' && this.phase === 'playing') this.skipping = true;
    else return;
    e.preventDefault();
  };

  /** Ships still at a planet of the current human once this turn's orders are out. */
  private left(planet: number): number {
    return this.state.planets[planet].ships - this.orders.reduce((n, o) => n + (o.from === planet ? o.ships : 0), 0);
  }

  private clickPlanet(planet: number | null): void {
    if (this.phase !== 'planning') return;
    if (planet === null) return this.select(null);
    const p = this.state.planets[planet];
    if (this.selected === null || this.selected === planet) {
      if (p.owner === this.current) this.select(this.selected === planet ? null : planet);
      return;
    }
    // A destination: send the fleet as composed.
    const order = { from: this.selected, to: planet, ships: this.ships };
    const problem = checkOrders(this.state, this.current, [...this.orders, order]).problems.find(
      (x) => x.index === this.orders.length,
    );
    if (problem) {
      toast(errorText(problem.error));
      return;
    }
    if (this.repeat) this.standing[this.current] = [...this.standing[this.current], order];
    else this.orders.push(order);
    // Ready for another fleet from the same planet, if anything is left there.
    this.select(this.left(this.selected) > 0 && !this.repeat ? this.selected : null);
  }

  private select(planet: number | null): void {
    this.selected = planet;
    this.ships = planet === null ? 0 : this.left(planet);
    this.repeat = false;
    this.renderAll();
  }

  private removeOrder(index: number): void {
    this.orders.splice(index < 0 ? this.orders.length - 1 : index, 1);
    if (this.selected !== null) this.ships = Math.min(Math.max(1, this.ships), this.left(this.selected));
    this.renderAll();
  }

  private removeStanding(index: number): void {
    this.standing[this.current].splice(index, 1);
    this.save();
    this.renderAll();
  }

  private hover(planet: number | null, event: PointerEvent | null): void {
    if (planet !== this.hovered) {
      this.hovered = planet;
      this.galaxy.mark(this.marks());
    }
    if (planet === null || !event) {
      this.tipEl.classList.remove('open');
      return;
    }
    this.tipEl.replaceChildren(...this.planetInfo(planet));
    const box = this.tipEl.parentElement!.getBoundingClientRect();
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    this.tipEl.style.left = `${Math.min(x + 16, box.width - 200)}px`;
    this.tipEl.style.top = `${Math.min(y + 16, box.height - 150)}px`;
    this.tipEl.classList.add('open');
  }

  private planetInfo(id: number): Node[] {
    const p = this.state.planets[id];
    const point = this.viewpoint(this.current >= 0 ? this.current : SPECTATOR);
    const row = (label: string, value: string) => h('div.kq-row', null, h('span', null, label), h('b', null, value));
    const out: Node[] = [
      h('div.kq-tip-title', { style: `--c:${colorOf(p.owner)}` }, t('planet.title', p.name)),
      row(t('planet.owner'), p.owner === NEUTRAL ? t('planet.neutral') : this.names[p.owner]),
      row(t('planet.ships'), seesShips(p, point) ? String(p.ships) : t('game.unknown')),
    ];
    if (seesStats(p, point))
      out.push(row(t('planet.production'), String(p.production)), row(t('planet.kill'), p.kill.toFixed(3)));
    if (this.selected !== null && this.selected !== id) {
      const turns = flightTurns(this.state, this.selected, id);
      out.push(row(t('planet.distance'), turns === 1 ? t('planet.turn') : t('planet.turns', turns)));
    }
    return out;
  }

  // ------------------------------------------------------------------ drawing

  private viewpoint(viewer: number): Viewpoint {
    return { viewer, display: this.setup.display };
  }

  private marks() {
    const planning = this.phase === 'planning';
    return {
      selected: planning ? this.selected : null,
      hovered: this.hovered,
      orders: planning ? this.orders : [],
      standing: planning ? this.standing[this.current] : [],
    };
  }

  private renderAll(): void {
    // The planet under the pointer may have changed hands.
    if (this.hovered !== null && this.tipEl.classList.contains('open'))
      this.tipEl.replaceChildren(...this.planetInfo(this.hovered));
    if (this.phase === 'planning')
      this.galaxy.render(publicState(this.state), this.viewpoint(this.current), this.marks());
    else if (this.phase === 'waiting' || this.phase === 'over') {
      const humans = this.humansAlive();
      this.galaxy.render(publicState(this.state), this.viewpoint(humans.length === 1 ? humans[0] : SPECTATOR));
    }
    this.renderHead();
    this.renderComposer();
    this.renderOrders();
    this.renderFleets();
  }

  private renderHead(): void {
    const limit = this.setup.turnLimit;
    // Once over, the turn counter has moved past the last turn played.
    const turn = Math.min(this.state.over ? this.state.turn - 1 : this.state.turn, limit || Infinity);
    const who =
      this.current >= 0
        ? h('span.kq-who', { style: `--c:${colorOf(this.current)}` }, t('game.playerTurn', this.names[this.current]))
        : h('span.kq-who.muted', null, this.humansAlive().length ? '' : t('game.watching'));
    this.headEl.replaceChildren(
      h('b.kq-logo', null, 'KONQUEST'),
      h('span.kq-turn', null, limit ? t('game.turnOf', turn, limit) : t('game.turn', turn)),
      who,
    );
  }

  private toolbar(): HTMLElement {
    return h(
      'nav.kq-tools',
      null,
      h('button.btn.small', { onclick: () => this.showStandings() }, t('game.standings')),
      h('button.btn.small', { onclick: () => this.app.openRules() }, t('menu.rules')),
      h('button.btn.small', { onclick: () => this.app.openOptions() }, t('menu.options')),
      h('button.btn.small', { onclick: () => this.quit() }, t('game.menu')),
    );
  }

  private renderComposer(): void {
    const parts: (Node | null)[] = [];
    if (this.phase === 'planning' && this.selected !== null) {
      const p = this.state.planets[this.selected];
      const max = this.left(this.selected);
      const number = h('input.kq-num', {
        type: 'number',
        min: '1',
        max: String(max),
        value: String(this.ships),
        oninput: () => {
          this.ships = Math.max(0, Math.min(max, Math.floor(Number(number.value) || 0)));
          range.value = String(this.ships);
        },
      });
      const range = h('input.kq-range', {
        type: 'range',
        min: '1',
        max: String(Math.max(1, max)),
        value: String(this.ships),
        oninput: () => {
          this.ships = Number(range.value);
          number.value = range.value;
        },
      });
      const set = (n: number) => () => {
        this.ships = n;
        number.value = range.value = String(n);
      };
      parts.push(
        h('div.kq-from', { style: `--c:${colorOf(p.owner)}` }, t('game.from', p.name)),
        h(
          'div.kq-ships-row',
          null,
          h('label', null, t('game.ships')),
          number,
          h('button.btn.small', { onclick: set(Math.max(1, Math.floor(max / 2))) }, t('game.half')),
          h('button.btn.small', { onclick: set(max) }, t('game.all')),
        ),
        range,
        h(
          'label.kq-check',
          null,
          h('input', {
            type: 'checkbox',
            checked: this.repeat,
            onchange: (e: Event) => (this.repeat = (e.target as HTMLInputElement).checked),
          }),
          ' ',
          t('game.standing'),
        ),
        h('p.muted', null, t('game.pickTarget')),
      );
    } else if (this.phase === 'planning') parts.push(h('p.muted', null, t('game.select')));
    else if (this.phase === 'waiting') parts.push(h('p.muted.kq-pulse', null, t('game.waiting')));

    const canFinish = this.phase !== 'over' && !this.humansAlive().length && !this.finishing;
    fill(
      this.composerEl,
      ...parts,
      this.phase === 'planning'
        ? h('button.btn.primary.wide.kq-end', { onclick: () => void this.endTurn() }, t('game.endTurn'))
        : null,
      canFinish
        ? h(
            'button.btn.wide',
            {
              onclick: () => {
                this.finish();
                this.renderAll();
              },
            },
            t('game.finish'),
          )
        : null,
    );
  }

  private renderOrders(): void {
    if (this.phase !== 'planning' || this.current < 0) {
      fill(this.ordersEl);
      return;
    }
    const line = (o: FleetOrder, remove: () => void) =>
      h(
        'div.kq-order',
        null,
        h(
          'span',
          null,
          t(
            'game.order',
            this.state.planets[o.from].name,
            this.state.planets[o.to].name,
            o.ships,
            t('game.arrives', this.state.turn + flightTurns(this.state, o.from, o.to) - 1),
          ),
        ),
        h('button.x', { onclick: remove, title: '✕' }, '✕'),
      );
    const standing = this.standing[this.current];
    fill(
      this.ordersEl,
      h('h3', null, t('game.orders')),
      ...(this.orders.length
        ? this.orders.map((o, i) => line(o, () => this.removeOrder(i)))
        : [h('p.muted', null, t('game.noOrders'))]),
      standing.length ? h('h3', null, '↻ ', t('game.standingOrders')) : null,
      ...standing.map((o, i) => line(o, () => this.removeStanding(i))),
    );
  }

  private renderFleets(): void {
    const me = this.current;
    // Nothing of a player's shows before they have the screen to themselves.
    if (me < 0 || this.phase === 'handover') return this.fleetsEl.replaceChildren();
    const mine = this.state.fleets.filter((f) => f.owner === me);
    this.fleetsEl.replaceChildren(
      h('h3', null, t('game.fleets')),
      ...(mine.length
        ? mine.map((f) =>
            h(
              'div.kq-order',
              null,
              t(
                'game.order',
                this.state.planets[f.from].name,
                this.state.planets[f.to].name,
                f.ships,
                t('game.arrives', f.arrival),
              ),
            ),
          )
        : [h('p.muted', null, t('game.noFleets'))]),
    );
  }

  private pushLog(message: Message): void {
    this.log.push(message);
    if (this.log.length > MAX_LOG) this.log.splice(0, this.log.length - MAX_LOG);
    this.renderLog();
  }

  private renderLog(): void {
    this.logEl.replaceChildren(
      ...this.log
        .slice(-80)
        .reverse()
        .map((m) =>
          h(
            'div.kq-msg',
            { class: m.heading ? 'turn' : '', style: m.seat === NEUTRAL ? '' : `--c:${colorOf(m.seat)}` },
            m.text,
          ),
        ),
    );
  }

  private showOverlay(content: HTMLElement | null): void {
    this.overlayEl.replaceChildren(...(content ? [content] : []));
    this.overlayEl.classList.toggle('open', content !== null);
  }

  private showStandings(): void {
    // Under a blind map, the standings would tell what the map hides.
    const blind = this.setup.display.blindMap && this.phase !== 'over';
    modal(
      t('stats.title'),
      [blind ? h('p.muted', null, t('setup.blindMap.text')) : standingsTable(publicState(this.state), this.names)],
      [{ label: t('common.close'), primary: true }],
      { wide: true },
    );
  }

  private quit(): void {
    modal(
      t('game.menu'),
      [h('p', null, t('confirm.quit'))],
      [
        { label: t('common.cancel') },
        {
          label: t('confirm.quit.button'),
          primary: true,
          action: () => {
            closeAllModals();
            this.app.showMenu();
          },
        },
      ],
    );
  }
}

function createBot(seat: SeatConfig): Bot {
  const id = bots.has(seat.bot) ? seat.bot! : DEFAULT_BOT_ID;
  return bots.create(id, { level: seat.level ?? DEFAULT_BOT_LEVEL });
}
