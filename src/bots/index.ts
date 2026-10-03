import { BotRegistry, definitionsIn } from './registry';

// Every file named *.bot.ts under src/bots is picked up automatically: write one, and the bot
// shows up in the game's menus, in the arena and on the server. See BOTS.md.
const modules = import.meta.glob<Record<string, unknown>>('./**/*.bot.ts', { eager: true });

export const bots = new BotRegistry(Object.values(modules).flatMap(definitionsIn));

/** The balanced general: the default opponent, and the stand-in for a bot that is no longer installed. */
export const DEFAULT_BOT_ID = 'okoye';

export { BotRegistry, definitionsIn } from './registry';
