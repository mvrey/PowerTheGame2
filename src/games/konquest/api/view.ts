import { cloneState } from '../engine/rules';
import { GameState, ReadonlyGameState } from '../engine/types';

/**
 * The game as players see it: everything but the dice of the battles. Konquest's KDE options
 * that hide things (blind map, neutral ship counts) are left to the browser game's screen; bots
 * see every planet and every fleet.
 */
export type PublicState = Omit<GameState, 'dice' | 'nextFleetId'>;

/** Everything a player needs to decide a turn. Plain JSON data, for bots anywhere. */
export interface PlayerView {
  /** Your seat (the index into `state.players`). */
  me: number;
  /** The turn being planned. */
  turn: number;
  /** Your own copy of the game: change it freely. */
  state: PublicState;
}

export function publicState(state: ReadonlyGameState): PublicState {
  const { dice: _dice, nextFleetId: _next, ...rest } = cloneState(state);
  return rest;
}

export const createView = (state: ReadonlyGameState | PublicState, me: number): PlayerView => ({
  me,
  turn: state.turn,
  state: publicState(state as ReadonlyGameState),
});
