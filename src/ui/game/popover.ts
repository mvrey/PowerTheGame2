import { clear, h } from '../dom';

/** Half the popover's width: it is kept this far from the sides of the board. */
const HALF_WIDTH = 110;
/** Gap between the popover and the space it points at. */
const OFFSET = 26;

/** The small menu that opens over a board space. */
export class Popover {
  constructor(
    private readonly el: HTMLElement,
    private readonly container: HTMLElement,
  ) {}

  get isOpen(): boolean {
    return this.el.childElementCount > 0;
  }

  /** Opens next to `point` (screen coordinates): below it in the top part of the board, above it lower down. */
  open(title: string, rows: HTMLElement[], point: { x: number; y: number }): void {
    clear(this.el);
    const box = this.container.getBoundingClientRect();
    this.el.append(h('div.pop-title', null, title), ...rows);
    this.el.classList.add('open');
    const x = Math.min(Math.max(point.x - box.left, HALF_WIDTH), box.width - HALF_WIDTH);
    const y = point.y - box.top;
    const below = y < box.height * 0.6;
    this.el.style.left = x + 'px';
    this.el.style.top = below ? y + OFFSET + 'px' : '';
    this.el.style.bottom = below ? '' : box.height - y + OFFSET + 'px';
  }

  close(): void {
    clear(this.el);
    this.el.classList.remove('open');
  }
}
