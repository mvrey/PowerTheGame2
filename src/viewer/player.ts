import { Replay } from '../platform/core/replay';
import { verifyReplay } from '../platform/core/verify';
import { ReplayRenderer, ViewerPlugin } from '../platform/core/viewer';
import { h } from '../platform/web/dom';

export interface PlayerOptions {
  /** Playback speed factor (1 is the game's own pace). */
  speed: number;
  autoplay: boolean;
  /** Stream layout: no controls, a bigger header. */
  broadcast?: boolean;
  /** Called once the last turn has been shown while playing. */
  onFinished?: () => void;
}

const SPEEDS = [1, 2, 4, 8];
const ordinal = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;

/**
 * A replay on screen: who plays, a verification badge, the game's renderer, and a timeline.
 * The replay is verified again here, so a viewer can tell a genuine record from an edited one.
 */
export class ReplayPlayer {
  readonly el: HTMLElement;
  private readonly renderer: ReplayRenderer;
  private readonly turns: number;
  private turn = 0;
  private playing = false;
  private speed: number;
  private readonly slider: HTMLInputElement;
  private readonly turnLabel = h('span.turn-label');
  private readonly statusEl = h('div.status');
  private readonly playButton: HTMLButtonElement;
  private readonly seatsEl: HTMLElement;

  constructor(
    private readonly replay: Replay,
    plugin: ViewerPlugin,
    private readonly options: PlayerOptions,
  ) {
    this.turns = replay.turns.length;
    this.speed = options.speed;
    this.renderer = plugin.create();
    const verdict = verifyReplay(plugin.game, replay);
    const badge = verdict.ok
      ? h('span.badge.ok', { title: 'Played again through the engine: identical' }, '✓ verified')
      : h('span.badge.bad', { title: verdict.problems.join('\n') }, '✗ does not verify');

    this.seatsEl = h('div.seats');
    this.slider = h('input.timeline', {
      type: 'range',
      min: '0',
      max: String(this.turns),
      value: '0',
      oninput: () => this.seek(Number(this.slider.value)),
    });
    this.playButton = h('button.ctl', { onclick: () => this.toggle(), title: 'Play / pause (space)' }, '▶');
    const controls = h(
      'footer.controls',
      null,
      h('button.ctl', { onclick: () => this.seek(0), title: 'Start' }, '⏮'),
      h('button.ctl', { onclick: () => this.seek(Math.max(0, this.turn - 1)), title: 'Previous turn' }, '◀'),
      this.playButton,
      h('button.ctl', { onclick: () => this.seek(Math.min(this.turns, this.turn + 1)), title: 'Next turn' }, '▶|'),
      h('button.ctl', { onclick: () => this.seek(this.turns), title: 'End' }, '⏭'),
      this.slider,
      this.turnLabel,
      h(
        'select.speed',
        { onchange: (e: Event) => (this.speed = Number((e.target as HTMLSelectElement).value)), title: 'Speed' },
        ...SPEEDS.map((s) => h('option', { value: String(s), selected: s === this.speed }, `${s}×`)),
      ),
    );
    const stage = h('div.stage');
    this.el = h(
      'section.player',
      { class: options.broadcast ? 'broadcast' : '' },
      h(
        'header.player-head',
        null,
        h('div.match-title', null, replay.match.label ?? replay.match.id, ' ', badge),
        this.seatsEl,
        this.statusEl,
      ),
      stage,
      options.broadcast ? null : controls,
    );
    this.renderer.mount(stage, replay);
    this.update();
    if (options.autoplay) void this.play();
  }

  /** Space toggles, arrows step: for the controls a caster uses most. */
  key(e: KeyboardEvent): void {
    if (e.key === ' ') this.toggle();
    else if (e.key === 'ArrowRight') this.seek(Math.min(this.turns, this.turn + 1));
    else if (e.key === 'ArrowLeft') this.seek(Math.max(0, this.turn - 1));
    else return;
    e.preventDefault();
  }

  destroy(): void {
    this.playing = false;
    this.renderer.destroy();
    this.el.remove();
  }

  private toggle(): void {
    if (this.playing) this.pause();
    else void this.play();
  }

  private async play(): Promise<void> {
    if (this.turn >= this.turns) this.seek(0);
    this.playing = true;
    this.update();
    while (this.playing && this.turn < this.turns) {
      await this.renderer.play(this.turn + 1, this.speed);
      if (!this.playing) return;
      this.turn++;
      this.update();
    }
    if (this.playing) {
      this.playing = false;
      this.update();
      this.options.onFinished?.();
    }
  }

  private pause(): void {
    this.playing = false;
    this.renderer.skip();
    this.update();
  }

  private seek(turn: number): void {
    this.playing = false;
    this.renderer.skip();
    this.turn = turn;
    this.renderer.show(turn);
    this.update();
  }

  private update(): void {
    const finished = this.turn === this.turns;
    this.slider.value = String(this.turn);
    this.turnLabel.textContent = `${this.turn} / ${this.turns}`;
    this.playButton.textContent = this.playing ? '⏸' : '▶';
    this.statusEl.textContent =
      this.renderer.status(this.turn) + (finished ? ` · ended by ${this.replay.result.reason}` : '');
    const seats = this.renderer.seats();
    this.seatsEl.replaceChildren(
      ...this.replay.bots.map((bot, seat) => {
        const rank = this.replay.result.placements[seat].rank;
        return h(
          'span.seat',
          { style: `--seat:${seats[seat].color}`, class: finished && rank === 1 ? 'winner' : '' },
          h('span.swatch'),
          h('b', null, bot.name),
          h('small', null, seats[seat].detail),
          finished ? h('span.rank', null, rank === 1 ? '🏆 1st' : ordinal(rank)) : null,
        );
      }),
    );
  }
}
