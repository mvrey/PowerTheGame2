# Bot protocol (version 1)

Every bot, in any language, talks to the referee the same way: **one JSON object per line** on
its standard input (from the referee) and its standard output (to the referee). Standard error
is yours for logs. The organizer keeps the first 64 KiB of it per match, for debugging.

The SDKs (`sdk/python/jam.py`, `sdk/javascript/jam.mjs`) implement this page. You only need it
to write the loop yourself or in another language.

## Lifecycle

One process per match. It is started before the match, and stopped after `end`, or after a
short grace period once its input is closed. Nothing survives between matches.

```
referee                                   bot
   │  {"type":"hello", ...}            →    │   once, before the first turn
   │                                   ←    │  {"type":"ready"}            within limits.startupMs
   │  {"type":"turn","turn":1, ...}    →    │
   │                                   ←    │  {"type":"action","turn":1,"action":{...}}   within limits.turnMs
   │  ... one turn message per turn while the match goes on ...
   │  {"type":"end", ...}              →    │   then stdin closes: exit
```

In simultaneous games (like Power) every seat gets the same turn at the same time, and the
referee waits for all answers (or deadlines) before playing the turn.

## Messages from the referee

### `hello`
```json
{
  "type": "hello",
  "protocol": 1,
  "game": { "id": "power", "version": "2.0.0" },
  "match": { "id": "jam-01-A-D07", "format": "duel", "variant": "ring", "maxTurns": 60,
             "seat": 0, "players": 2, "seed": 3141592653 },
  "limits": { "startupMs": 10000, "turnMs": 2000, "maxMessageBytes": 1048576 },
  "info": { "...": "facts about the match, defined by the game" }
}
```
- `seat` is you. Seats are anonymous: you are never told who your opponents are.
- `seed` is yours to use for randomness, so that your own play can be replayed. It differs
  every match, and it reveals nothing secret.
- `info` depends on the game: see `Docs/Games/<game>.md`.

### `turn`
```json
{ "type": "turn", "turn": 17, "deadlineMs": 2000, "observation": { "...": "defined by the game" } }
```
The observation holds what you may see now, including the public result of the previous turn
and the problems found in your previous answer.

### `end`
```json
{ "type": "end", "seat": 0, "result": { "placements": [{ "rank": 1, "score": 212 }, { "rank": 2, "score": 0 }], "reason": "conquest" } }
```
`placements` is by seat; rank 1 is best, and equal ranks are a draw.

## Messages from the bot

| Message | When |
|---|---|
| `{"type":"ready"}` (optionally `"name"`) | Answer to `hello`. |
| `{"type":"action","turn":N,"action":{...}}` | Answer to turn N. The `action` is defined by the game. |

## Rules and failures

| What happens | Consequence |
|---|---|
| No `ready` within `startupMs`, or something else first | The bot plays the whole match without answers. |
| No answer within `turnMs` | `timeout`: no action that turn (the game's "no action"). |
| Three timeouts in a row | The bot is stopped and plays the rest of the match without answers. |
| A line that is not JSON, or not a valid message | `invalid`: no action that turn. **Printing debug text to stdout causes this.** |
| An answer for an earlier turn (it arrived late) | Ignored; the referee keeps waiting for the current turn. |
| An action the game finds partly illegal | The legal parts are kept, the rest is refused and reported in the next observation. Not a failure. |
| A line longer than `maxMessageBytes`, or a flood of messages | The bot is stopped (`crashed`). |
| The process exits or crashes | `crashed`, then no answers for the rest of the match. |

A failing bot never stops the match: the game simply treats its seat as giving no action. Every
failure is recorded in the replay.

## Versioning

`protocol` goes up with any breaking change to the messages above. The game's observations and
actions are versioned by the game (`game.version`). Both versions are recorded in every replay.
