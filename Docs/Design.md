# Project Brief: Autonomous Bot Coding Tournament

## 1. Project Overview

I want to create a public programming competition, potentially hosted as an itch.io jam, where participants write autonomous bots that compete against one another in a game simulation.

The tournament will be streamed on YouTube, and the winner will receive a €50 prize. This is meant as a a periodically competition where each time a new game is provided and participants must code their bots for a different game each time.

The organizer provides the game engine, rules, a documented API, and a sandboxed execution environment. Participants implement their bots in different programming languages, submit them, and compete in automated matches.

The project should combine:
- Programming and algorithmic strategy.
- Autonomous agents and opponent modeling.
- A fair, reproducible tournament system.
- Strong isolation and security for untrusted code.
- A spectator-friendly presentation suitable for live streaming.

The initial goal is to design a technically sound, achievable MVP rather than build an elaborate game immediately.

## 2. Game Design Goals

The specific game has not yet been selected. The goal is to find a game that makes autonomous bot programming strategically interesting while remaining practical to implement and operate.

Current preferences:
- Deep strategic possibilities.
- Intermediate implementation complexity.
- Both 1v1 and free-for-all formats are worth considering.
- The organizer provides the game engine.
- Participants focus on bot behavior, not building the game itself.
- Bots compete autonomously in simulations.
- Matches can be visualized for a YouTube tournament broadcast.
- Consider perfectVSimperfect information, game determinism, game symmetry and game balance. It must be definitely balanced for all involved bots.
- The game must resist being "solved" in practice. The concern is not theoretical solvability — chess is theoretically solvable but far beyond current computing power, and that is acceptable. The concern is a game where one bot can reach near-optimal play, because every such bot then plays identically, matches between them become draws or coin flips, and the tournament stops measuring skill. A suitable game must therefore satisfy three conditions:
  - **Intractable search.** The state space and branching factor must be large enough that no bot can exhaustively evaluate its options within the per-turn time limit.
  - **No importable solution.** There must be no existing engine, library, or published strong algorithm that a participant can adapt directly. This strongly favours an original game over a well-known one: if nobody has written a bot for it before, everyone must build their strategy from scratch, which is precisely what the competition is meant to measure.
  - **No dominant generic algorithm.** At this scale the realistic risk is not that someone solves the game, but that an off-the-shelf approach such as Monte Carlo tree search or alpha-beta with a rough evaluation function beats every handwritten strategy, reducing the contest to whoever tuned that one algorithm best. Short turn budgets, wide branching, long match horizons, simultaneous moves, and hidden information all work against this. Verify it empirically: build a baseline search bot during Phase 1 and confirm the candidate game does not collapse to it before committing to the game.

Potential game concepts previously considered include:

- **Territorial strategy:** Expand across a map, gather resources, control territory, and defeat opponents.
- **Space strategy:** Manage fleets, control planets or orbital locations, and balance expansion with combat.
- **Autonomous colony simulation:** Allocate workers, explore, gather resources, and develop strategies against other colonies.
- **Fortification and siege:** Build defenses, produce units, and attack enemy structures.
- **Economic strategy:** Trade, manage infrastructure, control routes, and compete over limited resources.

These are candidates, not fixed requirements. Evaluate them alongside other suitable ideas.

### Game selection criteria

Assess candidate games in terms of:
- Strategic depth and meaningful decisions.
- How much skill can be expressed through bot programming.
- Ease of learning for participants.
- Complexity of the engine and API.
- Runtime and computational cost.
- Suitability for multiple programming languages.
- Ability to explain match outcomes to spectators.
- Potential for interesting emergent behavior.
- Fairness and reproducibility.
- Ease of testing and sandboxing.

Altought it is a plus, avoid choosing a game merely because its rules are simple. The competition needs enough meaningful strategic variation for different bot designs to produce distinguishable results.

## 3. Tournament Format

Current preferences:
- **Match formats:** Primarily 1v1, with free-for-all as another possibility.
- **Game execution:** Automated simulations.
- **Participant languages:** Ideally any language that can be supported safely.
- **Execution:** Bots run autonomously without human input during matches.
- **Engine:** Provided by the organizer.
- **Visualization:** Live or recorded matches streamed on YouTube.
- **Prize:** €50 for the winner.
- **Platform:** itch.io is a possible home for the event.

The competition should have clear rules for:
- Submission format and deadlines.
- Supported runtimes and language versions.
- Match duration and computational limits.
- Scoring, ties, and tournament tiebreakers.
- Crashes, timeouts, invalid outputs, and disqualifications.
- Whether bot source code is public or private.
- Whether bots can be updated after submission.
- Reproducibility and appeals.
- Prize eligibility and distribution.

Before launch, verify the current platform requirements for hosting a programming competition and the applicable rules for running a prize contest and broadcasting it on YouTube.

## 4. Proposed Technical Architecture

Separate the system into independent components.

### A. Tournament Manager

Responsibilities:
- Registration and submission metadata.
- Scheduling matches and rounds.
- Managing tournament state.
- Calculating standings and tiebreakers.
- Applying disqualification rules.

### B. Game Engine and Referee

Responsibilities:
- Implement the official game rules.
- Construct the state visible to each bot.
- Validate actions.
- Resolve turns and calculate scores.
- Produce authoritative match events.

The engine must be trusted code. It must never execute participant code inside its own process.

### C. Bot Runner

Responsibilities:
- Launch participant programs in isolated environments.
- Send each bot its observation.
- Collect and validate responses.
- Enforce time, CPU, memory, process, and output limits.
- Terminate or recycle processes.
- Report failures to the tournament manager.

### D. Match and Replay Store

Record enough information to reconstruct each match:
- Match, round, and participant identifiers.
- Bot versions.
- Inputs and outputs.
- Actions and scores.
- Timeouts, errors, and resource-limit violations.
- Engine and protocol versions.
- Relevant randomness or seeds, with a policy that does not leak future information to bots.

The replay system should be able to reproduce outcomes and support disputes.

### E. Spectator Viewer

Responsibilities:
- Display match progress and actions.
- Show scores, match history, and tournament standings.
- Animate events and explain outcomes.
- Provide a stream-friendly interface.

The viewer must consume authoritative events from the engine. It should not calculate official outcomes or control bot execution.

## 5. Bot API and Execution Protocol

Prefer a language-independent protocol based on JSON over standard input/output (`stdin`/`stdout`).

An illustrative observation might look like:

    {
      "protocol": 1,
      "match_id": "m-1042",
      "turn": 17,
      "observation": {},
      "my_score": 2,
      "opponent_score": 1
    }

An illustrative response might look like:

    {
      "action": {}
    }

These fields are placeholders. The final schema must depend on the selected game.

The API should define:
- Legal actions and their parameters.
- How observations are serialized.
- What information is visible to each bot.
- Whether the bot receives the complete public history.
- Whether private persistent memory is allowed.
- How the bot learns the result of its action.
- Error handling and protocol versioning.
- Maximum input and output sizes.
- Response deadlines.
- Deterministic versus random execution expectations.

### Process lifecycle options

**Option A: Start a process for every turn**
- Simple lifecycle and strong reset behavior.
- Requires reconstructing strategy from supplied observations and history.
- Adds process startup overhead.

**Option B: Keep a process alive for the entire match**
- Allows internal state and adaptive strategies.
- Reduces startup overhead.
- Requires more careful management of process state and protocol failures.

A reasonable initial design is to keep a bot alive during one match and restart it for the next match. The bot must not receive information that the rules define as hidden.

Another viable option is a fresh process each turn, with sufficient state supplied in the observation. Benchmark both before deciding.

## 6. Security Requirements

Assume participant submissions are untrusted code, even if most participants are well-intentioned.

### Threats to address

- Infinite loops and excessive CPU use.
- Excessive memory consumption.
- Fork bombs and excessive process creation.
- Attempts to read host files or other participants' data.
- Attempts to access credentials or environment secrets.
- Network access and communication between bots.
- Malformed output and oversized responses.
- Attempts to exploit the referee, runner, or viewer.
- Dependency-installation scripts or malicious build steps.
- Exploitation of the host kernel or runtime.

### Minimum protections

- Run bots as unprivileged users.
- Disable network access by default.
- Do not expose host credentials or secrets.
- Use minimal, read-only filesystems where possible.
- Apply CPU, memory, process, storage, and wall-clock limits.
- Validate all input and output.
- Isolate each bot from other bots and trusted services.
- Compile participant source in a separate, restricted build environment.
- Keep the tournament manager and referee outside the bot sandbox.
- Use disposable workers or reset execution environments between matches.
- Log resource use, errors, and termination reasons.

Docker alone should not be treated as a complete security boundary for hostile code. Evaluate hardened containers, gVisor, or microVM-based isolation such as Firecracker, depending on the hosting environment and operational budget.

No isolation method eliminates every risk. Test the full execution pipeline before accepting public submissions.

### Adversarial test cases

Build test bots that:
- Never return.
- Return malformed data.
- Return illegal actions.
- Emit enormous amounts of output.
- Attempt to consume excessive memory.
- Try to access the network.
- Attempt to read files outside their allowed filesystem.
- Spawn many processes.
- Crash at different stages of execution.

These should result in controlled failures rather than a tournament-wide outage.

## 7. Fairness and Anti-Cheating

The referee should collect all required actions for a simultaneous-action turn before resolving the turn. For sequential-action games, information exposure and action order must follow the official rules.

Other principles:
- Do not share files, memory, processes, or communication channels between bots.
- Give all participants identical resource budgets.
- Define exactly which historical information is visible.
- Do not reveal secret future randomness.
- Reset private bot state between matches unless the rules explicitly permit otherwise.
- Version the engine, protocol, and execution environment.
- Preserve match logs for verification.
- Define how submissions are identified and whether they can change after the deadline.

Consider whether the rules should prohibit hardcoded opponent-specific strategies or allow them. This affects the metagame and should be explicit.

## 8. Language Support and Build System

The goal is to support multiple programming languages through a common execution protocol.

Participants could submit source code and a build configuration, with compilation performed in a restricted build environment. Runtime execution should not require downloading dependencies or accessing the Internet.

For the MVP, we'll start with just python and plain javascript, and expand later in later issues.

Investigate:
- How builds are specified and reproduced.
- How compiler versions are pinned.
- How dependencies are cached and verified.
- How compilation errors are presented to participants.
- Whether prebuilt executables should be accepted at all.
- How executable compatibility is guaranteed between local testing and official matches.

Any supported language must run under the same resource and security constraints.

## 9. Development Roadmap

Build the smallest complete system first.

### Phase 1: Game rules and protocol
- Select the game and define its official rules.
- Write unit tests for its core mechanics.
- Define the bot protocol.
- Create a minimal baseline bot and a sample participant bot.

### Phase 2: Local simulation
- Execute bots against one another.
- Validate actions and resolve outcomes.
- Support complete match histories where appropriate.
- Implement timeouts and controlled failure handling.

### Phase 3: Sandboxing
- Implement isolated execution.
- Enforce resource limits.
- Add restricted build environments.
- Run adversarial tests and verify that failed bots cannot compromise the host.

### Phase 4: Tournament
- Implement match scheduling, standings, scoring, and tiebreakers.
- Add reproducible match logs and replay.
- Test tournament results against known synthetic bots.

### Phase 5: Visualization
- Build a spectator interface.
- Display actions, scores, and historical statistics.
- Add tournament standings and a stream overlay.
- Ensure presentation failures cannot affect match execution.

### Phase 6: Public launch
- Publish the rules, SDK, examples, and local test runner.
- Verify hosting costs and operational requirements.
- Test submission limits and peak execution load.
- Publish prize and disqualification rules.
- Run a small closed beta before the public event.

## 10. Important Open Questions

Do not silently make these decisions. Compare the options and explain their implications.

1. **Game choice:** Which game offers meaningful strategic depth without excessive engine complexity?

2. **Competitive objective:** What exactly should the tournament reward—match wins, tournament points, consistency, or performance across a diverse opponent pool?

3. **Scoring:** How should draws count, how many turns or rounds should each match contain, and how should standings be resolved?

4. **Process lifecycle:** One process per turn or one process per match?

5. **Bot state:** Should bots receive public history, keep private internal memory, or both?

6. **Randomness:** What randomness is available to bots, and how can the engine avoid leaking secret future information?

7. **Language policy:** Which languages and runtimes should the first release support?

8. **Sandbox:** Which isolation technology fits the threat model, budget, host operating system, and expected submission volume?

9. **Hosting:** Where will the tournament run, and what are the limits and costs of executing untrusted code?

10. **Tournament format:** Round robin, Swiss-style rounds, knockout, or a hybrid? Compare fairness, runtime, and spectator appeal without assuming one format is universally best.

11. **Streaming:** Should the live broadcast show real-time matches, curated replays, or both?

12. **Platform and rules:** What current itch.io, YouTube, privacy, and prize-contest requirements apply?

## 11. How I Want the Coding Agent to Work

Act as a senior software architect and pragmatic engineering partner.

Start by evaluating the project assumptions and identifying the decisions that materially affect the architecture. Do not immediately generate a large codebase.

Priorities:
1. Security and isolation of untrusted code.
2. Fair and unambiguous competition rules.
3. A minimal, testable, language-independent API.
4. Reproducible outcomes and auditable match logs.
5. Low operational complexity for a small organizer.
6. A compelling spectator experience.
7. An incremental path from local prototype to public tournament.

For every significant design decision:
- Explain the alternatives.
- Describe the trade-offs.
- Identify security implications.
- Separate MVP requirements from future improvements.

When proposing implementation details, be explicit about assumptions. When researching current platform rules, runtimes, or security tools, use up-to-date authoritative sources rather than inventing requirements.

**First task:** Produce a concise architecture proposal for the MVP, identify the five most consequential unresolved decisions, and recommend a staged implementation plan. Do not start coding until the game rules, bot protocol, sandbox threat model, and tournament scoring are sufficiently defined.