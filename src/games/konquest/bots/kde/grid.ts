import { Planet } from '../../api';

/** Planets in the order KDE's Map::planets() lists them (row by row), which its AIs loop over. */
export const inGridOrder = <P extends Pick<Planet, 'x' | 'y'>>(planets: readonly P[]): P[] =>
  [...planets].sort((a, b) => a.y - b.y || a.x - b.x);
