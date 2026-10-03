import { BotRegistry, definitionsIn } from './registry';

// Every file named *.bot.ts under src/bots is picked up automatically: write one, and the bot
// shows up in the game's menus, in the arena and on the server. See BOTS.md.
const modules = import.meta.glob<Record<string, unknown>>('./**/*.bot.ts', { eager: true });

export const bots = new BotRegistry(Object.values(modules).flatMap(definitionsIn));

export { BotRegistry, definitionsIn } from './registry';
