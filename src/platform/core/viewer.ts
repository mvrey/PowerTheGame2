import { AnyGame } from './game';
import { Replay } from './replay';

// The contract between the spectator viewer (src/viewer) and a game's renderer. The viewer owns
// the page, the timeline and the tournament screens; the renderer only draws positions and
// animates turns, from the replay (which it plays through its game module, like the verifier).

export interface ReplayRenderer {
  /** Sets up for a replay inside `container`. */
  mount(container: HTMLElement, replay: Replay): void;
  /** Shows the position after `turn` turns (0: the start), without animation. */
  show(turn: number): void;
  /** Animates turn `turn` (1-based) from the position before it. Resolves once it is shown. */
  play(turn: number, speed: number): Promise<void>;
  /** Cuts the current animation short. */
  skip(): void;
  /** By seat: a colour and a few words about the seat ("Green + Blue"). */
  seats(): { color: string; detail: string }[];
  /** One line about the position after `turn` turns, e.g. "Round 12 · material 120 – 95". */
  status(turn: number): string;
  destroy(): void;
}

export interface ViewerPlugin {
  game: AnyGame;
  create(): ReplayRenderer;
  /** The viewer's language ("en", "es"...), for games that speak several. */
  setLanguage?(lang: string): void;
  setSound?(on: boolean): void;
}
