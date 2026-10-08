import { Bot, BotRegistry, definitionsIn } from '../api';

// Every file named *.bot.ts under src/bots is picked up automatically: write one, and the bot
// shows up in the game's menus and as a jam built-in (builtin:<id>). See Docs/Games/Power.md.
const modules = import.meta.glob<Record<string, unknown>>('./**/*.bot.ts', { eager: true });

export const bots = new BotRegistry<Bot>(Object.values(modules).flatMap((m) => definitionsIn<Bot>(m)));

/** The balanced general: the default opponent, and the stand-in for a bot that is no longer installed. */
export const DEFAULT_BOT_ID = 'okoye';

export { BotRegistry, definitionsIn } from '../api';
