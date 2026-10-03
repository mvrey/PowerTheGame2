import { clear, h } from '../../dom';
import { t } from '../../i18n';

/** Lines kept in memory; saves keep fewer (see GameScreen.persist). */
const KEPT_LINES = 200;
const SHOWN_LINES = 60;

/** The running account of the game under the order sheet. Round headings start with "—". */
export class GameLog {
  readonly titleEl = h('h3.log-title', null, t('game.log'));
  readonly el = h('div.log');

  constructor(private lines: string[] = []) {}

  get last(): string | undefined {
    return this.lines[this.lines.length - 1];
  }

  /** The most recent lines, for saving. */
  recent(count: number): string[] {
    return this.lines.slice(-count);
  }

  push(line: string): void {
    this.lines.push(line);
    if (this.lines.length > KEPT_LINES) this.lines.splice(0, this.lines.length - KEPT_LINES);
    this.render();
  }

  render(): void {
    clear(this.el);
    for (const line of this.lines.slice(-SHOWN_LINES))
      this.el.append(h('div', { class: line.startsWith('—') ? 'sep' : '' }, line));
    this.el.scrollTop = this.el.scrollHeight;
  }

  /** After a language change. */
  relabel(): void {
    this.titleEl.textContent = t('game.log');
    this.render();
  }
}
