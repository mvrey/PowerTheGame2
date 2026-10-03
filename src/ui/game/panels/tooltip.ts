import { ARMY_IDS, PIECES, PIECE_TYPES, Snapshot } from '../../../api';
import { clear, h } from '../../dom';
import { ARMY_COLORS, chip } from '../../icons';
import { t } from '../../i18n';

/** Gap between the pointer and the tooltip, and between the tooltip and the window edge. */
const POINTER_GAP = { x: 16, y: 18 };
const EDGE_GAP = 8;

/** What stands on a board space, shown next to the pointer. */
export class NodeTooltip {
  readonly el = h('div.tooltip');

  constructor(private readonly names: { place(node: number): string; ownerName(army: number): string }) {}

  show(node: number, view: Snapshot, event: MouseEvent): void {
    clear(this.el);
    this.el.append(h('b', null, this.names.place(node)));
    let anyone = false;
    for (const army of ARMY_IDS) {
      const here = view.pieces.filter((p) => p.army === army && p.loc === node);
      if (!here.length) continue;
      anyone = true;
      const row = h('div.tip-row', null, h('span.swatch', { style: `background:${ARMY_COLORS[army].fill}` }));
      let power = 0;
      for (const type of PIECE_TYPES) {
        const n = here.filter((p) => p.type === type).length;
        if (!n) continue;
        power += n * PIECES[type].power;
        row.append(chip(type, army, n));
      }
      row.append(h('span.tip-power', null, `${this.names.ownerName(army)} · ${t('game.powerAt', power)}`));
      this.el.append(row);
    }
    if (!anyone) this.el.append(h('div.muted', null, t('game.emptyNode')));
    this.el.classList.add('open');
    this.el.style.left =
      Math.min(window.innerWidth - this.el.offsetWidth - EDGE_GAP, event.clientX + POINTER_GAP.x) + 'px';
    this.el.style.top =
      Math.min(window.innerHeight - this.el.offsetHeight - EDGE_GAP, event.clientY + POINTER_GAP.y) + 'px';
  }

  hide(): void {
    this.el.classList.remove('open');
  }
}
