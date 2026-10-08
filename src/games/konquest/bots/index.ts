import { Bot, BotRegistry, definitionsIn } from '../api';

// Every file named *.bot.ts under this folder is picked up automatically: write one, and the bot
// shows up in the game's menus and as a jam built-in (builtin:<id>). See Docs/Games/Konquest.md.
const modules = import.meta.glob<Record<string, unknown>>('./**/*.bot.ts', { eager: true });

export const bots = new BotRegistry<Bot>(Object.values(modules).flatMap((m) => definitionsIn<Bot>(m)));

/** KDE's offensive default AI: the default opponent, and the stand-in for a bot that is no longer installed. */
export const DEFAULT_BOT_ID = 'kde';
export const DEFAULT_BOT_LEVEL = 2;
