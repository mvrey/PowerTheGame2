# Participant guide

You write a program that plays the edition's game by itself. Bots meet in a tournament
(`Docs/Tournament.md`), and the best matches are streamed. Each edition has its game: **Power**
(edition 1, `Docs/Games/Power.md`) or **Konquest** (edition 2, `Docs/Games/Konquest.md`). Read
your edition's game first. For Konquest, add `--game konquest` to every `jam` command below.

## 1. Set up

You need Node.js 22 or later (it runs the referee on your machine), plus Python 3.12 if you write
your bot in Python.

```
git clone <this repository>
npm install
npm run jam -- new python bots/mybot        # or: new javascript bots/mybot   (+ --game konquest)
```

`bots/mybot` now holds a working bot: `bot.json` (its name, language and entry file), `main.py`
(or `main.mjs`), and the helper files `jam.py` + `power.py` or `konquest.py` (or `.mjs`). Rename the bot in
`bot.json` (1–32 letters, digits, spaces, `. _ -`).

## 2. Write it

Your bot reads the referee's messages on standard input and answers on standard output
(`Docs/Protocol.md`). The helpers do that for you: write `on_turn(observation, turn)` and return
your orders.

**Never print to standard output**: it is the protocol channel, and any stray line ruins that
turn. Log to standard error instead (`jam.log(...)` / `log(...)`).

You can use the standard library only, with no network and no files outside your folder (which is
read-only; `/tmp` is writable but small and wiped). Answer each turn within **2 s**; you get
**10 s** to start. You may keep memory between the turns of a match, but nothing survives from one
match to the next. You never learn who your opponent is.

## 3. Test it

```
npm run jam -- check bots/mybot                                  # plays it from both seats against Rookie
npm run jam -- match --bot bots/mybot --bot builtin:okoye:2 --variant ring
npm run jam -- match --bot bots/mybot --bot bots/mybot           # against itself
npm run jam -- games                                             # maps, formats and built-in opponents
```

`check` tells you about timeouts, refused orders (with their codes) and the end of your stderr.
`match` saves a replay. Watch it:

```
npm run build                     # once: builds the viewer
npm run jam -- serve .            # then open http://127.0.0.1:8080/?replay=data/replay.json
```

To try a whole tournament with your bot and the built-in ones, copy `examples/tournament.json`,
put your folder in `bots`, and run `npm run jam -- tournament my-tournament.json`.

Your machine runs bots without the sandbox (`--runner local`). The official matches run each bot
in its own locked-down container (`Docs/Sandbox.md`). Behaving well locally (no stdout noise, stay
within time, standard library only) is all it takes to behave the same there.

## 4. Submit

Zip your bot folder, with `bot.json` at the root of the zip or inside a single top folder. At
most 200 files and 5 MiB. Upload it on the jam page before the deadline. You may resubmit until
then: the last upload counts. The organizer unpacks it with `jam unpack`, which checks it exactly
as `jam check` does, so run `check` before you upload.

## 5. Fair play

Anything a bot does inside the game is fair, including modelling what its opponent does.
Attacking the sandbox, the referee or other bots is not, and leads to disqualification.
