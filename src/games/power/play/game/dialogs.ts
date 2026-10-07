import { ReadonlyGameState, playerStrength, seatOrder } from '../../api';
import { h } from '../dom';
import { ARMY_COLORS } from '../icons';
import { t } from '../i18n';
import { modal } from '../modal';
import { formatClock } from './clock';

export interface PauseMenuOptions {
  /** Pause and resume nest: the menu and each dialog it opens hold their own pause. */
  pause(): void;
  resume(): void;
  /** The game screen is still open. */
  isOpen(): boolean;
  openOptions(onClose: () => void): void;
  openRules(onClose: () => void): void;
  /** The options may have changed the language. */
  onOptionsClosed(): void;
  onQuit(): void;
}

/** The in-game menu. Options and rules replace it and bring it back when closed, so it picks up a language change. */
export function openPauseMenu(o: PauseMenuOptions): void {
  if (document.querySelector('.backdrop')) return;
  o.pause();
  const thenReturn = (open: (onClose: () => void) => void) => () => {
    o.pause();
    open(() => {
      o.resume();
      if (o.isOpen()) openPauseMenu(o);
    });
  };
  const handle = modal(
    t('pause.title'),
    [],
    [
      { label: t('pause.resume'), primary: true },
      {
        label: t('menu.options'),
        action: thenReturn((done) =>
          o.openOptions(() => {
            o.onOptionsClosed();
            done();
          }),
        ),
      },
      { label: t('pause.rules'), action: thenReturn((done) => o.openRules(done)) },
      {
        label: t('pause.quit'),
        action: () => {
          handle.close();
          o.onQuit();
          return false;
        },
      },
    ],
    { onClose: () => o.resume() },
  );
  handle.el.classList.add('stack');
}

/** The human is out: watch the bots play on, or skip to the result. */
export function showEliminatedDialog(onWatch: () => void, onEnd: () => void): void {
  modal(
    t('dead.title'),
    [h('p', null, t('dead.text'))],
    [
      { label: t('dead.watch'), action: onWatch },
      { label: t('dead.end'), primary: true, action: onEnd },
    ],
    { dismissable: false },
  );
}

export interface GameOverOptions {
  state: ReadonlyGameState;
  me: number;
  elapsedMs: number;
  playerName(player: number): string;
  subject(player: number): string;
  onMenu(): void;
  onRematch(): void;
}

const STAT_COLUMNS = [
  'over.player',
  'over.strength',
  'over.captured',
  'over.lost',
  'over.battles',
  'over.flagsTaken',
  'over.missiles',
  'over.income',
] as const;

/** The result and every player's statistics. */
export function showGameOverDialog(o: GameOverOptions): void {
  const s = o.state;
  const won = s.winners.includes(o.me);
  const title = !s.winners.length
    ? t('over.nobody')
    : won
      ? s.winners.length > 1
        ? t('over.draw')
        : t('over.win')
      : t('over.lose');
  const names = s.winners.map((p) => o.subject(p)).join(', ');
  const reason = !s.winners.length ? '' : s.endReason === 'time' ? t('over.byTime', names) : t('over.byFlags', names);
  const table = h(
    'table.stats',
    null,
    h('thead', null, h('tr', null, ...STAT_COLUMNS.map((c) => h('th', null, t(c))))),
    h(
      'tbody',
      null,
      ...allSeats(s).map((p) => {
        const stats = s.players[p].stats;
        const army = s.players[p].armies[0];
        return h(
          'tr',
          { class: s.winners.includes(p) ? 'winner' : '' },
          h('td', null, h('span.swatch', { style: `background:${ARMY_COLORS[army].fill}` }), ' ', o.playerName(p)),
          ...[
            playerStrength(s, p),
            stats.captured,
            stats.lost,
            stats.battlesWon,
            stats.flags,
            stats.missiles,
            stats.income,
          ].map((v) => h('td', null, String(v))),
        );
      }),
    ),
  );
  modal(
    title,
    [h('p.over-reason', null, reason), h('p.muted', null, t('over.rounds', s.round, formatClock(o.elapsedMs))), table],
    [
      { label: t('over.menu'), action: o.onMenu },
      { label: t('over.again'), primary: true, action: o.onRematch },
    ],
    { wide: true, dismissable: false },
  ).el.classList.add(won ? 'victory' : 'defeat');
}

/** All players in seat order, dead or alive. */
function allSeats(state: ReadonlyGameState): number[] {
  const living = seatOrder(state);
  return state.players
    .map((p) => p.id)
    .sort((a, b) => state.players[a].armies[0] - state.players[b].armies[0] || living.indexOf(a) - living.indexOf(b));
}
