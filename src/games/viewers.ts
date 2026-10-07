import { ViewerPlugin } from '../platform/core/viewer';
import { powerViewer } from './power/viewer/renderer';

// The renderers of the spectator viewer, one per game (see index.ts for the games themselves).

export const VIEWERS: readonly ViewerPlugin[] = [powerViewer];

export const viewerFor = (gameId: string): ViewerPlugin | undefined => VIEWERS.find((v) => v.game.id === gameId);
