import { RESERVE } from '../engine/board';
import { teamOf } from '../engine/game';
import { PIECES, ReadonlyGameState, ReadonlyPiece } from '../engine/types';

// Small read-only helpers that most bots end up writing. See also the engine queries re-exported
// from index.ts (armyStrength, livingArmies, teamOf...).

/** Pieces standing on a node (or in an army's Reserve, with node = RESERVE and `army`). */
export function piecesAt(state: ReadonlyGameState, node: number, army?: number): ReadonlyPiece[] {
  return state.pieces.filter((p) => p.loc === node && (node !== RESERVE || p.army === army));
}

/** Combat power on a node by team (controlling player, or MERC for mercenaries). */
export function powerByTeam(state: ReadonlyGameState, node: number): Map<number, number> {
  const out = new Map<number, number>();
  for (const p of state.pieces) {
    if (p.loc !== node || node === RESERVE) continue;
    const team = teamOf(state, p.army);
    out.set(team, (out.get(team) ?? 0) + PIECES[p.type].power);
  }
  return out;
}

/** Combat power of one player's pieces on a node. */
export function powerOf(state: ReadonlyGameState, node: number, player: number): number {
  return powerByTeam(state, node).get(player) ?? 0;
}

/** The strongest power any other team has on a node. */
export function enemyPowerAt(state: ReadonlyGameState, node: number, player: number): number {
  let best = 0;
  for (const [team, power] of powerByTeam(state, node)) if (team !== player && power > best) best = power;
  return best;
}
