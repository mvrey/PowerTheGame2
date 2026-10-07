# Tournament rules (World Cup format)

The format is the platform's, and it is the same for every game. The numbers below are the defaults;
`tournament.json` can change them. Items marked **proposed** are policy decisions the organizer
must confirm and publish before the jam opens.

## 1. Group stage

- **Draw.** Bots are drawn into groups of 4 (or 3, so that nobody is left over) at random from
  the published tournament seed. With 5 entrants or fewer there is a single group.
- **Duels.** Every pair in a group plays on every map of the duel pool **twice, once from each
  seat**. Seat swapping cancels any advantage of colour or of acting first.
  Win **3**, draw **1**, loss **0**.
- **Free-for-all set.** If the game has a free-for-all for the group's size (Power: 3 and 4
  players), the whole group plays it once per seat rotation: every bot plays every seat once,
  against the same opponents. **One point per opponent finished ahead of** (4 players: 3/2/1/0).
  The rotation evens out positional luck, and "kingmaking" can only cost a bot what it costs everyone.
  The duels carry most of the points (24 duels against 4 free-for-alls in a group of 4).
- **Table order:** points; then head-to-head duel points between the bots still tied; then
  duel material difference; then free-for-all points; then duel wins; then a lottery drawn from the
  tournament seed (deterministic, and published in advance with the seed).

## 2. Playoff

- The **top 2** of each group go through. Seeding: all group winners first, then all runners-up,
  ranked across groups by points per match. The bracket fills to a power of two with **byes for
  the top seeds**, and avoids two bots of the same group meeting in the first round when it can.
- Every tie is a **series**: each playoff map twice, seats swapped, scored 3/1/0. A level series
  is decided by aggregate material, then by up to two sudden-death pairs (seats swapped), then by
  the seeded lottery.
- A **final** and a **third-place match**. The semifinalists also play an **unscored
  free-for-all exhibition** for the stream.

## 3. Matches

- Each match lasts at most `maxTurns` turns (Power: 60 rounds). The game then decides the winner
  by its own rule (Power: the most material, then the most flags).
- **Time:** `startupMs` 10 s to get ready, `turnMs` 2 s per turn. Identical for everyone, on
  identical sandboxes (1 CPU, 256 MiB).
- **Failures** (timeouts, invalid output, crashes) cost the turn, never the match: see the table
  in `Docs/Protocol.md`. All of them are recorded.

## 4. Fairness and reproducibility

- Bots are anonymous inside the game: they cannot tell who they are playing, so
  **opponent-specific hardcoding is impossible**. Learning from an opponent's behaviour during a
  match is allowed and is part of the game.
- No state is kept between matches: the process is restarted, its folder is read-only, and its
  scratch space is wiped.
- Every match writes a replay: the setup and seeds, the exact code version (a content hash) of
  each bot, every raw answer, the timings, the failures and the events. `npm run jam -- verify`
  plays any replay again through the engine and checks it gives the same result. The whole
  tournament is a function of its seed and its results, so it can be audited and resumed.

## 5. Policy (proposed, to be confirmed by the organizer)

| Topic | Proposal |
|---|---|
| Languages | Python 3.12 and JavaScript (Node 22, ES modules), standard library only. |
| Submission | One zip per participant with `bot.json` at its root (or in a single top folder), at most 200 files and 5 MiB. |
| Updates | Unlimited until the deadline. The last submission counts; none after it. |
| Source code | Private during the jam, published after the final with the authors' consent (the replays name each version by its hash). |
| Disqualification | Deliberate attempts to break the sandbox or the referee, or plagiarism. A bot that fails most of its turns is not disqualified: it simply loses. |
| Appeals | Within 48 h of the results, by match id. The replay is verified again in public. |
| Prize | €50 to the champion. Eligibility, payment and tax rules must be checked for the hosting platform and the organizer's country (see Docs/Organizer.md). |
