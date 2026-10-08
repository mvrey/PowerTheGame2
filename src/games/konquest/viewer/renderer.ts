import { fill, h } from '../../../platform/web/dom';
import { Replay } from '../../../platform/core/replay';
import { replaySteps } from '../../../platform/core/verify';
import { ReplayRenderer, ViewerPlugin } from '../../../platform/core/viewer';
import { NEUTRAL, PublicState, TurnEvent, planetsOf, productionOf, publicState, shipsOf } from '../api';
// The game module only: the built-in bots have no business in the viewer.
import { konquestGame } from '../module/game';
import { colorOf } from '../play/colors';
import { FULL_VIEW, GalaxyView, SPECTATOR } from '../play/galaxyView';
import { Message, turnHeading, turnMessages } from '../play/game/messages';
import { setLang, t } from '../play/i18n';
import '../play/style.css';

/** Length of a turn's animation at speed 1, in ms. */
const TURN_MS = 1600;

/** Draws a Konquest replay with the game's own galaxy, fleets and messages. */
class KonquestReplayRenderer implements ReplayRenderer {
  /** The position after each turn; states[0] is the start. */
  private states: PublicState[] = [];
  private events: TurnEvent[][] = [];
  private names: string[] = [];
  private galaxy = new GalaxyView();
  private tableEl = h('div.kq-standing');
  private logEl = h('div.kq-log');
  private root: HTMLElement | null = null;
  private skipping = false;
  /** Bumped by every jump, so that an animation finishing late does not undo it. */
  private run = 0;

  mount(container: HTMLElement, replay: Replay): void {
    this.names = replay.bots.map((b) => b.name);
    this.states = [publicState(konquestGame.setup(replay.match.setup).game)];
    for (const step of replaySteps(konquestGame, replay)) {
      this.events.push(step.events);
      this.states.push(publicState(step.after.game));
    }
    this.root = h(
      'div.kq-spectator',
      null,
      h('main.kq-main', null, this.galaxy.root),
      h('aside.kq-side', null, this.tableEl, h('h3', null, t('game.log')), this.logEl),
    );
    container.append(this.root);
    this.show(0);
  }

  show(turn: number): void {
    this.run++;
    this.skipping = true;
    this.galaxy.render(this.states[turn], { viewer: SPECTATOR, display: FULL_VIEW });
    this.renderSide(turn);
  }

  async play(turn: number, speed: number): Promise<void> {
    const run = ++this.run;
    this.skipping = false;
    await this.galaxy.animate(
      this.states[turn - 1],
      this.events[turn - 1],
      this.states[turn],
      TURN_MS / speed,
      () => this.skipping || run !== this.run,
    );
    if (this.root && run === this.run) this.renderSide(turn);
  }

  skip(): void {
    this.skipping = true;
  }

  seats(): { color: string; detail: string }[] {
    const start = this.states[0];
    return start.players.map((p) => ({
      color: colorOf(p.id),
      detail: t('planet.title', start.planets.find((planet) => planet.home === p.id)!.name),
    }));
  }

  status(turn: number): string {
    const state = this.states[turn];
    const planets = state.players.map((p) => planetsOf(state, p.id)).join(' · ');
    return `${t('game.turnOf', Math.max(1, turn), this.states.length - 1)} · ${t('stats.planets').toLowerCase()} ${planets}`;
  }

  destroy(): void {
    this.skipping = true;
    this.root?.remove();
    this.root = null;
  }

  /** The players' standing after `turn` turns, and the messages of the turns up to it. */
  private renderSide(turn: number): void {
    const state = this.states[turn];
    fill(
      this.tableEl,
      h(
        'table.stats',
        null,
        h(
          'tr',
          null,
          h('th', null, t('stats.player')),
          h('th', null, t('stats.planets')),
          h('th', null, t('stats.ships')),
          h('th', null, t('stats.production')),
        ),
        ...state.players.map((p) =>
          h(
            'tr',
            { class: p.alive ? '' : 'out' },
            h('td', null, h('span.swatch', { style: `--fill:${colorOf(p.id)}` }), ' ', this.names[p.id]),
            h('td', null, String(planetsOf(state, p.id))),
            h('td', null, String(shipsOf(state, p.id))),
            h('td', null, String(productionOf(state, p.id))),
          ),
        ),
      ),
    );
    const messages: Message[] = [];
    for (let i = Math.max(0, turn - 12); i < turn; i++) {
      messages.push(turnHeading(i + 1));
      messages.push(...turnMessages(this.states[i], this.events[i], this.names, () => false));
    }
    fill(
      this.logEl,
      ...messages
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
}

export const konquestViewer: ViewerPlugin = {
  game: konquestGame,
  create: () => new KonquestReplayRenderer(),
  setLanguage: (lang) => setLang(lang === 'es' ? 'es' : 'en'),
};
