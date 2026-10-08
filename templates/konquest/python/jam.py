"""The bot-jam protocol for Python bots. Standard library only; copy this file next to your bot.

The referee writes one JSON message per line to your standard input and reads your answers, one
JSON message per line, from your standard output. Print your own logs to standard error (use
`jam.log`): anything else on standard output breaks the protocol.

    import jam

    class MyBot:
        def on_hello(self, hello):           # optional: once, before the first turn
            self.info = hello["info"]        # the game's facts (the board, the rules...)

        def on_turn(self, observation, turn):
            return {...}                     # your action for this turn

        def on_end(self, result):            # optional: the match is over
            pass

    jam.run(MyBot())

See Docs/Protocol.md for the messages and your game's documentation for observations and actions.
"""

import json
import sys
import traceback

PROTOCOL = 1


def log(*parts):
    """Prints to standard error, which the organizer keeps (up to a limit) for debugging."""
    print(*parts, file=sys.stderr, flush=True)


def _send(message):
    sys.stdout.write(json.dumps(message, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def run(bot, name=None):
    """Answers the referee until the match ends. An exception in your bot is logged and costs
    you that turn (no action), but the bot keeps playing."""
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        message = json.loads(line)
        kind = message.get("type")
        if kind == "hello":
            if message.get("protocol") != PROTOCOL:
                log(f"jam.py speaks protocol {PROTOCOL}, the referee {message.get('protocol')}")
            hook = getattr(bot, "on_hello", None)
            if hook:
                try:
                    hook(message)
                except Exception:
                    traceback.print_exc(file=sys.stderr)
            _send({"type": "ready", "name": name} if name else {"type": "ready"})
        elif kind == "turn":
            try:
                action = bot.on_turn(message["observation"], message["turn"])
            except Exception:
                traceback.print_exc(file=sys.stderr)
                action = None
            _send({"type": "action", "turn": message["turn"], "action": action})
        elif kind == "end":
            hook = getattr(bot, "on_end", None)
            if hook:
                try:
                    hook(message["result"])
                except Exception:
                    traceback.print_exc(file=sys.stderr)
            return
