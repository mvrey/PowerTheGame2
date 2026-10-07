import { InProcessBot } from './bots';
import { BotConnection, Received } from './referee';

/**
 * A connection to a trusted bot running in this process. Messages are copied through JSON both
 * ways, so the bot sees exactly what a process would, and shares no object with the referee.
 * A bot that throws counts as crashed. Deadlines are measured, but a bot that never yields cannot be
 * interrupted: only the organizer's own bots run this way.
 */
export function connectInProcess(bot: InProcessBot): BotConnection {
  const inbox: Received[] = [];
  let waiter: ((received: Received) => void) | null = null;
  let gone: string | null = null;
  let errors = '';

  const deliver = (received: Received) => {
    if (waiter) {
      const wake = waiter;
      waiter = null;
      wake(received);
    } else inbox.push(received);
  };

  return {
    send(message) {
      if (gone) return;
      const copy = JSON.parse(JSON.stringify(message));
      Promise.resolve()
        .then(() => bot.receive(copy))
        .then(
          (reply) => {
            if (reply && !gone) deliver({ kind: 'message', value: JSON.parse(JSON.stringify(reply)) });
          },
          (error: unknown) => {
            if (gone) return;
            errors += (error instanceof Error ? (error.stack ?? error.message) : String(error)) + '\n';
            gone = 'threw an exception';
            deliver({ kind: 'closed', reason: gone });
          },
        );
    },

    receive(timeoutMs) {
      if (inbox.length) return Promise.resolve(inbox.shift()!);
      if (gone) return Promise.resolve({ kind: 'closed', reason: gone });
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          waiter = null;
          resolve({ kind: 'timeout' });
        }, timeoutMs);
        waiter = (received) => {
          clearTimeout(timer);
          resolve(received);
        };
      });
    },

    async close() {
      const exit = gone ?? 'stopped';
      gone ??= 'stopped';
      bot.stop?.();
      return { exit, stderr: errors };
    },
  };
}
