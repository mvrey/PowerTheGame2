import { GamePackage } from '../platform/core/bots';
import { konquestPackage } from './konquest/module';
import { powerPackage } from './power/module';

// The games the platform can run. A new edition of the jam adds its game here (and its viewer
// to viewers.ts); nothing else in the platform changes. See Docs/Platform.md, "Adding a game".

export const GAMES: readonly GamePackage[] = [powerPackage, konquestPackage];

export function gamePackage(id: string): GamePackage {
  const found = GAMES.find((p) => p.game.id === id);
  if (!found) throw new Error(`Unknown game "${id}". Games: ${GAMES.map((p) => p.game.id).join(', ')}`);
  return found;
}
