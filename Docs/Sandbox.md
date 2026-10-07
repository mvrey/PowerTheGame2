# Sandbox and threat model

Participants' bots are **untrusted code**. The referee, the tournament runner and the viewer are
trusted, and never run participant code in their own process. Each bot runs in its own disposable
container, one per bot per match, and talks to the referee only through its stdin and stdout.

```
 trusted host (Linux VPS, no secrets on it)
 ┌───────────────────────────────────────────────────────────────┐
 │  jam tournament ── referee ── runner ──┬── docker run … (bot A) │  gVisor (runsc) kernel per container
 │        │                              └── docker run … (bot B) │  no network, read-only, 1 CPU, 256 MiB
 │        └── replays/, results.json, live.json  ──► jam serve ──► OBS / browser (read-only, loopback)
 └───────────────────────────────────────────────────────────────┘
```

## Container profile

Built by `dockerRunArgs` (`src/platform/node/runners.ts`, unit-tested):

| Flag | Why |
|---|---|
| `--runtime runsc` | gVisor: the bot's system calls hit a user-space kernel, not the host's. The main defence against kernel exploits. |
| `--network none` | No network at all: no exfiltration, no downloads, no bot-to-bot channel. |
| `--read-only`, bot folder mounted `readonly` at `/bot` | Nothing to modify, no state left for the next match. |
| `--tmpfs /tmp:noexec,nosuid,nodev,size=16m` | The only writable place: small, not executable, gone with the container. |
| `--user 65534:65534`, `--cap-drop ALL`, `--security-opt no-new-privileges` | No root, no capabilities, no setuid escalation. |
| `--memory 256m --memory-swap 256m` | A memory hog is killed by the OOM killer, alone. |
| `--cpus 1` | Every bot gets the same CPU, whatever the others do. |
| `--pids-limit 64`, `--ulimit nofile=64` | No fork bombs, no descriptor exhaustion. |
| `--init`, `--rm`, unique `--name` | Clean signal handling, nothing left behind, `docker kill` by name. |
| no `--env` beyond `PYTHONIOENCODING` | No host variables reach the bot. |
| `--log-driver none` | Output goes only through the referee's limited pipes. |

The runtime images (`sandbox/docker/`) contain the interpreter and its standard library only.
Package managers are removed, and nothing is compiled or installed at run time.

## Threats (Design.md §6) and where they are handled

| Threat | Mitigation | Tested here |
|---|---|---|
| Infinite loop, too much CPU | Turn deadline; 3 timeouts in a row → stopped; `--cpus 1` | ✅ `busy-loop` (local runner) |
| Too much memory | `--memory` without swap | 🐳 `memory-hog` (needs Docker) |
| Fork bomb | `--pids-limit` | 🐳 `fork-bomb` |
| Reading host files or other bots' data | Container filesystem, own read-only mount only | 🐳 `escape` |
| Credentials or secrets | No environment passed; no secrets on the host | 🐳 `escape` (also no secrets in the local runner's environment) |
| Network, bot-to-bot communication | `--network none` | 🐳 `escape` |
| Malformed output | Envelope check, then the game's parser (unknown fields dropped) | ✅ `garbage`, `illegal`, module tests |
| Oversized output | 1 MiB line limit, message flood limit, stderr capped at 64 KiB | ✅ `huge-line`, `flood`, `stderr-flood` |
| Crashes at any moment | Contained; seat plays on with no actions | ✅ `crash-start`, `crash-mid`, `never-ready` |
| Exploiting the referee or runner | Line framing with limits, strict validation, no `eval`, no shell (spawn with argument lists) | ✅ unit tests on framing, manifests, zips |
| Exploiting the viewer | Bot-controlled strings (names) are validated and only ever inserted as text; the server is read-only, loopback, never lists folders | ✅ manifest tests, server checked by hand |
| Malicious submission archive | Strict zip reader: no traversal, links, encryption, zip64 or bombs; file and size limits | ✅ `submission.test.ts` |
| Malicious build steps, dependency scripts | There is no build step: interpreted languages, standard library only | (by design) |
| Host kernel exploits | gVisor; a disposable VPS with nothing else on it | — needs the target host |

✅ = covered by `npm test` on any machine. 🐳 = covered by `tests/platform/adversarial.test.ts`,
which only runs where Docker is available (`sh sandbox/docker/check.sh`). **The 🐳 tests have not
been run yet: Docker was not available on the development machine. Run them on the tournament host
before accepting submissions** (Design.md §6: "test the full execution pipeline").

## Setting up the tournament host

1. A dedicated Linux VPS (2–4 vCPUs is enough for a jam), with no credentials or other services on it.
2. Install Docker and gVisor (follow gVisor's current installation guide), and register the
   runtime in `/etc/docker/daemon.json`:
   ```json
   { "runtimes": { "runsc": { "path": "/usr/bin/runsc" } } }
   ```
   then `sudo systemctl restart docker`, and check: `docker run --rm --runtime=runsc hello-world`.
3. `sh sandbox/docker/build.sh`, then record the image digests it prints in the tournament notes.
4. `sh sandbox/docker/check.sh`: every sandbox test must pass.
5. In `tournament.json`: `"runner": { "type": "docker", "runtime": "runsc" }` and a concurrency of at
   most (vCPUs ÷ 2), so that no bot waits for a CPU.

The user running `jam` needs access to Docker, which is root-equivalent on the host. This is
the reason the host must hold nothing of value.

## The local runner is not a sandbox

`LocalRunner` (`--runner local`, the default of `jam match` and `jam check`) runs bots as plain
processes. It has the same protocol limits and a clean environment, but no isolation. It is for
participants testing their own bot, and for the organizer's trusted built-in bots. Never use it for
submissions.

## Residual risks

- gVisor reduces, but does not remove, the risk of escaping into the host kernel. Keep the host
  disposable and patched.
- Timing side channels between concurrent containers are not addressed. They are irrelevant to
  this game, but note it if a future game hides information.
- Docker on Windows or macOS (in a VM) is not a supported tournament host.
