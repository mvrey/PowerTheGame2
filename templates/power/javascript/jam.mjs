// The bot-jam protocol for JavaScript bots (Node, ES modules). No dependencies; copy this file
// next to your bot.
//
// The referee writes one JSON message per line to your standard input and reads your answers,
// one JSON message per line, from your standard output. Write your own logs to standard error
// (use `log`): anything else on standard output breaks the protocol.
//
//   import { run } from './jam.mjs';
//
//   run({
//     onHello(hello) { this.info = hello.info; },     // optional: the game's facts
//     onTurn(observation, turn) { return { ... }; },  // your action for this turn (may be async)
//     onEnd(result) {},                               // optional: the match is over
//   });
//
// See Docs/Protocol.md for the messages and your game's documentation for observations and actions.

import { createInterface } from 'node:readline';

export const PROTOCOL = 1;

/** Prints to standard error, which the organizer keeps (up to a limit) for debugging. */
export function log(...parts) {
  console.error(...parts);
}

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

/**
 * Answers the referee until the match ends. An exception in your bot is logged and costs you that
 * turn (no action), but the bot keeps playing.
 */
export async function run(bot, name) {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    if (message.type === 'hello') {
      if (message.protocol !== PROTOCOL) log(`jam.mjs speaks protocol ${PROTOCOL}, the referee ${message.protocol}`);
      try {
        await bot.onHello?.(message);
      } catch (error) {
        log(error);
      }
      send(name ? { type: 'ready', name } : { type: 'ready' });
    } else if (message.type === 'turn') {
      let action = null;
      try {
        action = (await bot.onTurn(message.observation, message.turn)) ?? null;
      } catch (error) {
        log(error);
      }
      send({ type: 'action', turn: message.turn, action });
    } else if (message.type === 'end') {
      try {
        await bot.onEnd?.(message.result);
      } catch (error) {
        log(error);
      }
      break;
    }
  }
  lines.close();
}
