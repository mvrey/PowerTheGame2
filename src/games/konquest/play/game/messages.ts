import { NEUTRAL, PublicState, TurnEvent } from '../../api';
import { t } from '../i18n';

export interface Message {
  text: string;
  /** The seat the message is about, for its colour; NEUTRAL for none. */
  seat: number;
  /** A turn's heading rather than news. */
  heading?: boolean;
}

/** The heading of a turn's messages. */
export const turnHeading = (turn: number): Message => ({ text: t('log.turn', turn), seat: NEUTRAL, heading: true });

/**
 * KDE's game messages for a turn: planets that fell or held, reinforcements (only for the seats
 * in `reinforcementsFor`, as KDE tells only human players), eliminations and the end.
 */
export function turnMessages(
  before: PublicState,
  events: readonly TurnEvent[],
  names: readonly string[],
  reinforcementsFor: (seat: number) => boolean,
): Message[] {
  const planet = (id: number) => before.planets[id].name;
  const out: Message[] = [];
  for (const e of events) {
    switch (e.kind) {
      case 'battle':
        out.push({
          text: t(e.conquered ? 'log.fallen' : 'log.held', names[e.attacker], planet(e.planet)),
          // A planet that held is the defender's news, unless nobody holds it.
          seat: e.conquered || e.defender === NEUTRAL ? e.attacker : e.defender,
        });
        break;
      case 'reinforce':
        if (reinforcementsFor(e.owner))
          out.push({ text: t('log.reinforce', e.ships, planet(e.planet)), seat: e.owner });
        break;
      case 'out':
        out.push({ text: t('log.out', names[e.player]), seat: e.player });
        break;
      case 'end':
        out.push(
          e.reason === 'conquest'
            ? { text: t('log.won', names[e.winner!]), seat: e.winner! }
            : { text: t(e.reason === 'turn-limit' ? 'log.limit' : 'log.draw'), seat: NEUTRAL },
        );
        break;
    }
  }
  return out;
}
