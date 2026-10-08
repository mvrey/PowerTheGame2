import { NEUTRAL } from '../api';

// KDE Konquest's player colours (dialogs/newgamedlg.cc), in seat order, and grey for neutrals.
export const PLAYER_COLORS: readonly string[] = [
  '#8282ff',
  '#ffff00',
  '#ff0000',
  '#00ff00',
  '#ffffff',
  '#00ffff',
  '#ff00ff',
  '#eb992e',
  '#6a9d68',
  '#839980',
];
export const NEUTRAL_COLOR = '#9a9a9a';

export const colorOf = (owner: number): string => (owner === NEUTRAL ? NEUTRAL_COLOR : PLAYER_COLORS[owner % 10]);
