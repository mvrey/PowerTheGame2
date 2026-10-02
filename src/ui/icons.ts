import { PieceType } from '../engine/types';
import { h } from './dom';

export interface ArmyColors { fill: string; dark: string; ink: string }

/** Army colours in seat order: green, blue, yellow, red. */
export const ARMY_COLORS: ArmyColors[] = [
  { fill: '#2f9e44', dark: '#1b6b2b', ink: '#ffffff' },
  { fill: '#2f6fe0', dark: '#1c469a', ink: '#ffffff' },
  { fill: '#f2c21a', dark: '#a67c00', ink: '#2b2100' },
  { fill: '#e03131', dark: '#8f1a1a', ink: '#ffffff' },
];

export type IconName = PieceType | 'P' | 'FLAG';

// Silhouettes drawn in a 32x22 box, filled with currentColor.
const soldier = (x: number, s = 1) =>
  `<g transform="translate(${x} ${22 - 22 * s}) scale(${s})">` +
  '<circle cx="0" cy="5.4" r="3"/><path d="M-4.2 5.6A4.2 4.2 0 0 1 4.2 5.6Z"/>' +
  '<path d="M-5 22-3.6 11.2Q0 9 3.6 11.2L5 22Z"/><path d="M-7.5 17.5 6.5 7.5 7.4 8.8-6.6 18.8Z"/></g>';

const ICONS: Record<IconName, string> = {
  S: soldier(16),
  R: soldier(7, 0.82) + soldier(25, 0.82) + soldier(16),
  T: '<rect x="5" y="14" width="22" height="6" rx="3"/><path d="M7 14.5 9.5 10h13l2.5 4.5Z"/>' +
    '<rect x="12" y="6" width="8" height="4.6" rx="1.4"/><rect x="19.5" y="7.4" width="9.5" height="1.7"/>',
  H: '<rect x="2" y="14" width="27" height="7.5" rx="3.7"/><path d="M4 14.5 7 9h17l3 5.5Z"/>' +
    '<rect x="9" y="3.5" width="12" height="6" rx="1.6"/><rect x="20.5" y="5.2" width="9" height="2.4"/>' +
    '<rect x="28.6" y="4.2" width="2.6" height="4.4" rx=".6"/><rect x="12.5" y="1.2" width="4" height="2.6" rx=".8"/>',
  F: '<path d="M2 11 21 9.3 30 11 21 12.7Z"/><path d="M12 11 17.5 2.5h3L19.5 11 20.5 19.5h-3Z"/>' +
    '<path d="M3 11 4.6 6.4h2.6L8.4 11 7.2 15.6H4.6Z"/>',
  B: '<path d="M1 11 23 8.2 31 11 23 13.8Z"/><path d="M9.5 11 13 .6h5.5L19.5 11 18.5 21.4H13Z"/>' +
    '<path d="M1.6 11 3 4.8h3.6L8 11 6.6 17.2H3Z"/>' +
    '<rect x="18.5" y="3.2" width="4.5" height="2.2" rx="1"/><rect x="18.5" y="16.6" width="4.5" height="2.2" rx="1"/>',
  D: '<path d="M3 14.5h26.5L26 20H6.5Z"/><rect x="11" y="10.4" width="8.5" height="4.4"/>' +
    '<rect x="14.4" y="4.5" width="1.4" height="6.2"/><rect x="20.5" y="12" width="6" height="1.4"/>' +
    '<rect x="12.6" y="7" width="5" height="1.2"/>',
  C: '<path d="M.8 14.5h30.6L27 21H5Z"/><rect x="8.5" y="9.6" width="14" height="5.2"/>' +
    '<rect x="11.5" y="5.8" width="6.5" height="4"/><rect x="19" y="6.2" width="2.4" height="3.6"/>' +
    '<rect x="14.2" y="1" width="1.3" height="5"/><rect x="23" y="11.8" width="7" height="1.6"/>' +
    '<rect x="2" y="11.8" width="7" height="1.6"/>',
  M: '<path d="M7 7.6h15q7 3.4 0 6.8H7Z"/><path d="M7 7.6 3.2 2.6h5.4l2.6 5Z"/>' +
    '<path d="M7 14.4 3.2 19.4h5.4l2.6-5Z"/><path d="M6 9.4.6 11 6 12.6Z" opacity=".7"/>' +
    '<rect x="17" y="7.6" width="1.6" height="6.8" opacity=".45"/>',
  P: '<path d="M18.5 1 8 12.4h6.6L11.5 21 24 9.2h-6.8Z"/>',
  FLAG: '<rect x="8" y="1.5" width="1.8" height="20"/><path d="M10 2.5q5-2 9 0t7 .6v9q-3 1.4-7-.6t-9 0Z"/>',
};

/** Hidden sprite sheet; icons are then drawn with <use href="#ic-X">. */
export function installIcons(): void {
  const sprite = h('div', {
    style: 'position:absolute;width:0;height:0;overflow:hidden',
    html: '<svg xmlns="http://www.w3.org/2000/svg">' +
      Object.entries(ICONS).map(([name, body]) => `<symbol id="ic-${name}" viewBox="0 0 32 22">${body}</symbol>`).join('') +
      '</svg>',
  });
  document.body.prepend(sprite);
}

export const isBig = (type: IconName) => type === 'R' || type === 'H' || type === 'B' || type === 'C' || type === 'M';

/** HTML chip for a piece (or Power unit / flag) in an army's colours. */
export function chip(type: IconName, army: number, count = 1, opts: { title?: string; onclick?: (e: MouseEvent) => void; disabled?: boolean } = {}): HTMLElement {
  const colors = ARMY_COLORS[army];
  const el = h(opts.onclick ? 'button.chip' : 'span.chip', {
    class: (isBig(type) ? 'big ' : '') + (type === 'P' ? 'power ' : ''),
    style: `--fill:${colors.fill};--dark:${colors.dark};--ink:${colors.ink}`,
    title: opts.title,
    onclick: opts.onclick,
    disabled: opts.disabled,
    html: `<svg viewBox="0 0 32 22" aria-hidden="true"><use href="#ic-${type}"/></svg>`,
  });
  if (count !== 1) el.append(h('b', null, '×' + count));
  return el;
}
