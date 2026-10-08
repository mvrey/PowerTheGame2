# Organizer guide

How to run an edition, from announcement to stream. The commands are run in the repository
(`npm install` once), on Linux for the official run.

## 1. Before announcing

- [ ] Freeze the game version (`src/games/<game>/module`, `version`) and the platform version.
- [ ] Run `npm run research` and publish the balance and baseline results (`Docs/Games/<game>.md`).
- [ ] Prepare the tournament host (`Docs/Sandbox.md`, "Setting up the tournament host") and make
      sure `sh sandbox/docker/check.sh` passes **on that host**.
- [ ] Publish the rules (`Docs/Tournament.md`) with every "proposed" item decided, the
      tournament seed (or a commitment to it, e.g. its hash), the deadlines, and the participant guide.
- [ ] **Open questions to settle with up-to-date authoritative sources (not code):**
  - itch.io: the current terms for hosting a jam, and for running one with a cash prize.
  - Prize contest rules where you live (skill-based contest, eligibility, age, tax on the €50,
    payment method, excluded countries).
  - YouTube: streaming rules, and whether the game's original assets (sounds, music) may be broadcast.
    The board game "Power" is a third-party trademark: check whether you may use its name and
    likeness for a public event. Konquest is KDE's (GPL-2.0-or-later): its rules and AIs are
    ported here with credit; check how to name and credit it, and that the repository's licence
    fits the GPL if you publish the ported AIs.
  - Privacy: what you publish about participants (names, code), and their consent.
  - Hosting: the VPS provider's terms on running untrusted code, and the cost of the run.

## 2. Collecting submissions

```
npm run jam -- unpack downloads/alice.zip submissions/alice      # one folder per participant
npm run jam -- check submissions/alice                           # informative: they should have run it
```
`unpack` refuses unsafe archives (path traversal, links, bombs, oversized). The folder name
becomes the bot's id in the tournament. Keep the zips.

## 3. Running the tournament

Write a tournament file (start from `examples/tournament.json`, or `examples/konquest-tournament.json`
for Konquest):

```json
{
  "id": "jam-01",
  "title": "Bot Jam #1: Power",
  "game": "power",
  "seed": 20261004,
  "bots": ["submissions/*", "builtin:okoye:2"],
  "format": {
    "duel": { "variants": ["classic", "ring"], "maxTurns": 60 },
    "ffa": { "variants": ["classic"], "maxTurns": 60 },
    "playoff": { "variants": ["classic", "continent"], "maxTurns": 60 }
  },
  "limits": { "turnMs": 2000, "startupMs": 10000 },
  "runner": { "type": "docker", "runtime": "runsc" },
  "concurrency": 2
}
```
- `submissions/*` takes every bot folder in there. Built-in bots can fill the field or serve as
  a "house" benchmark (decide whether they can win prizes: probably not).
- Everything else has defaults (`src/platform/core/tournament/config.ts`) and is checked
  before anything runs.

```
npm run jam -- tournament jam-01.json            # writes tournaments/jam-01/
npm run jam -- status tournaments/jam-01
npm run jam -- verify tournaments/jam-01         # plays every replay again through the engine
```
The run can be interrupted and restarted: played matches are kept. A restart with different bots,
code or settings is refused, so that the published results always match one configuration.
`results.json` records each bot's failures per match, which helps with disputes and disqualification decisions.

Budget: a group of 4 plays 6 pairs × maps × 2 seats + 4 free-for-alls (28 matches with two
maps). A 60-round match of fast bots takes about a minute in the sandbox.

## 4. Streaming

```
npm run build                                   # builds the viewer
npm run jam -- serve tournaments/jam-01         # read-only, on 127.0.0.1:8080
```
- `http://127.0.0.1:8080/?tournament=data/live.json`: tables, bracket and results. Click any
  result to watch it, with a timeline (space, ←, →).
- **For OBS** (browser source, 1920×1080):
  `...?tournament=data/live.json&broadcast=1&speed=4`. It plays the highlights (free-for-alls,
  playoff, exhibition) one after another, each followed by its result, with the tables in between.
  Add `&show=all` for every match, `&from=now` during a live run to show only new results,
  `&sound=1` for the game's sound effects, `&lang=es` for Spanish.
- The viewer only reads what the tournament publishes, and verifies every replay before showing
  it (badge "✓ verified"). It cannot influence a match.

## 5. After the final

Publish the standings, the replays (`tournaments/jam-01/replays`), the bots' version hashes
(`tournament.json`), and the code if the authors agree. Anyone can check the results with
`jam verify`.

## 6. The next edition

A new game is a new folder in `src/games/` plus one line in `src/games/index.ts` and one in
`src/games/viewers.ts`. The referee, the sandbox, the tournament and the viewer are reused as they are.
See `ARCHITECTURE.md`, "Adding a game".
