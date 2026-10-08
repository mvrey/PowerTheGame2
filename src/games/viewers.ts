import { ViewerPlugin } from '../platform/core/viewer';
import { konquestViewer } from './konquest/viewer/renderer';
import { powerViewer } from './power/viewer/renderer';

// The renderers of the spectator viewer, one per game (see index.ts for the games themselves).

export const VIEWERS: readonly ViewerPlugin[] = [powerViewer, konquestViewer];

export const viewerFor = (gameId: string): ViewerPlugin | undefined => VIEWERS.find((v) => v.game.id === gameId);
