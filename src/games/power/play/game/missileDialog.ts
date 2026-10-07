import {
  MISSILE_COST,
  Order,
  PIECES,
  PIECE_TYPES,
  PieceType,
  RESERVE,
  ReadonlyGameState,
  cheapestMissileSpend,
  spendValue,
} from '../../api';
import { h } from '../dom';
import { chip } from '../icons';
import { pieceName, t } from '../i18n';
import { modal } from '../modal';

/** A piece type, or Power units ('P', Reserve only). */
type Ingredient = PieceType | 'P';

export interface MissileDialogOptions {
  /** The board as the orders so far leave it. */
  draft: ReadonlyGameState;
  army: number;
  /** Where the missile is built: a node, or RESERVE. */
  loc: number;
  placeName: string;
  onConfirm(order: Order): void;
  onClose(): void;
}

/**
 * Lets the player choose what to spend on a megamissile, starting from the cheapest recipe.
 * Returns false when there is not enough there to build one.
 */
export function openMissileDialog({ draft, army, loc, placeName, onConfirm, onClose }: MissileDialogOptions): boolean {
  const recipe = cheapestMissileSpend(draft, army, loc);
  if (!recipe) return false;
  const available = availableIngredients(draft, army, loc);
  const chosen = new Map<Ingredient, number>();
  for (const key of available.keys()) chosen.set(key, key === 'P' ? recipe.power : (recipe.spend[key] ?? 0));

  const totalEl = h('div.missile-total');
  const refresh = () => {
    const value = [...chosen].reduce((sum, [key, n]) => sum + n * worth(key), 0);
    totalEl.textContent =
      t('missile.total', value) + (value > MISSILE_COST ? ' ' + t('missile.waste', value - MISSILE_COST) : '');
    totalEl.classList.toggle('bad', value < MISSILE_COST);
    confirm.disabled = value < MISSILE_COST;
  };
  const rows = [...available].map(([key, max]) => {
    const count = h('span.stepper-n', null, String(chosen.get(key)));
    const step = (by: number) => {
      const next = Math.min(max, Math.max(0, chosen.get(key)! + by));
      chosen.set(key, next);
      count.textContent = String(next);
      refresh();
    };
    // Power comes in many units: step it by ten.
    const stride = key === 'P' ? 10 : 1;
    return h(
      'div.stepper',
      null,
      chip(key, army),
      h('span.stepper-name', null, `${pieceName(key)} (${worth(key)})`),
      h('button.btn.small', { onclick: () => step(-stride) }, '−'),
      count,
      h('span.stepper-max', null, '/ ' + max),
      h('button.btn.small', { onclick: () => step(stride) }, '+'),
    );
  });

  const dialog = modal(
    t('missile.title', placeName),
    [h('p', null, t('missile.text')), ...rows, totalEl],
    [
      { label: t('common.cancel') },
      {
        label: t('common.confirm'),
        primary: true,
        action: () => {
          const spend: Partial<Record<PieceType, number>> = {};
          for (const [key, n] of chosen) if (key !== 'P' && n > 0) spend[key] = n;
          const power = chosen.get('P') ?? 0;
          if (spendValue(spend, power) < MISSILE_COST) return false;
          onConfirm({ kind: 'makeMissile', army, at: loc, spend, power });
        },
      },
    ],
    { onClose },
  );
  const confirm = dialog.el.querySelector('button.primary') as HTMLButtonElement;
  refresh();
  return true;
}

const worth = (key: Ingredient) => (key === 'P' ? 1 : PIECES[key].power);

/** How many of each piece (and Power unit) the army has at `loc`. */
function availableIngredients(draft: ReadonlyGameState, army: number, loc: number): Map<Ingredient, number> {
  const available = new Map<Ingredient, number>();
  for (const type of PIECE_TYPES) {
    if (type === 'M') continue;
    const n = draft.pieces.filter((p) => p.army === army && p.type === type && p.loc === loc).length;
    if (n) available.set(type, n);
  }
  const power = draft.armies[army].power;
  if (loc === RESERVE && power > 0) available.set('P', power);
  return available;
}
