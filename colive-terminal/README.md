# Co-Live Terminal

A single-owner, protocol-compatible **Session Core + Client Hub + thin desk client** that lets the
unmodified **Even Realities G2** glasses app *and* a new terminal client attach to **one** live Claude
Code session as co-equal clients — proving the loop: **kick off a task at the desk → monitor/respond on
the glasses → return to the desk**, all on one continuous transcript.

Built on [`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk).
It is a clean re-implementation (not a fork) of the closed-source `even-terminal` bridge, with the
additions co-live needs: a single writer that serializes multi-client input and broadcasts normalized
events, plus a desk TUI client.

> Status: **M1 loop built and hardware-validated** (real G2 + R1). 216 automated tests, typecheck clean.
> See `../projects/colive-terminal/` for the full build log and 🧪 findings.

## Architecture

```
                ┌──────────────────────────── colive serve ───────────────────────────┐
  Even app  ───►│  Client Hub (Express HTTP + SSE)                                       │
  (glasses)     │    auth · /api/events (SSE) · /api/prompt · /api/permission-response … │
                │                         │ fan-out ▲ broadcast                          │
  desk client ─►│  Session Core           ▼         │                                    │
  (this TUI)    │    SessionManager → ClaudeSession(query()) → PermissionBroker          │
                │    sole writer to ~/.claude/projects/*.jsonl                           │
                └───────────────────────────────────────────────────────────────────────┘
```

- **`src/core/`** — the Session Core. `sessionManager.ts` owns each live `query()` (sole writer to the
  transcript), serializes input, and fans out normalized events; `session.ts` drives one turn and maps
  the SDK stream to the event vocabulary; `permissions.ts` is the permission/question broker + slash
  guard; `store.ts` reads the session store; `config.ts` resolves model/permissionMode/host/token;
  `events.ts` is the event union.
- **`src/hub/`** — the Even-app-compatible HTTP+SSE layer. `sse.ts` (per-session ring buffer + replay +
  heartbeat), `routes.ts` (every endpoint + bearer auth), `server.ts` (`createApp` / `startServer` + QR).
- **`src/desk/`** — the thin desk client. `client.ts` (HTTP/SSE client of the Hub via
  `eventsource-parser`), `slash.ts` (pure client-side slash interceptor), `app.tsx` (ink TUI).
- **`src/index.ts`** — the CLI: `colive serve` and `colive desk`.

## Requirements

- Node ≥ 22 (uses global `fetch` / `ReadableStream` / `AbortController`).
- `npm install` once. The desk TUI renders with `ink` + `react`.

## Usage

Run via `tsx` (no build step needed). The first positional is the subcommand.

### `colive serve` — the Hub (host machine)

```bash
# from colive-terminal/
BRIDGE_TOKEN=<your-token> npx tsx src/index.ts serve --host 0.0.0.0 --port 3456
```

Flags: `--model`, `--permission-mode <default|acceptEdits|…>`, `--host`, `--port`, `--project-dir`
(env equivalents: `MODEL`, `PERMISSION_MODE`, `HOST`, `PORT`, `BRIDGE_TOKEN`, `PROJECT_DIR`). It prints a
connect **QR** (`http://<host>:<port>?token=<token>&defaultProvider=claude` — the format the Even app
expects) plus the raw host/port/token for manual entry. `--host 0.0.0.0` exposes it to the phone running
the Even app; the default `127.0.0.1` is localhost-only. Set `COLIVE_LOG_REQUESTS=1` for wire logging.

Connect the glasses by scanning that QR in the Even app (same flow as the stock bridge).

### `colive desk` — the terminal client (same or another machine)

```bash
# from colive-terminal/
npx tsx src/index.ts desk --host <hub-host> --port 3456 --token <your-token>
```

Flags: `--host`, `--port`, `--token` (required — the desk attaches to a running Hub and must present its
token), `--session <id>` (attach to an existing session; omit to start fresh). Env equivalents:
`HOST`, `PORT`, `BRIDGE_TOKEN`.

In the TUI: type a prompt and Enter to send; **Esc** interrupts the current turn; **Ctrl+C** exits. When
a tool needs approval, an inline prompt appears (number keys choose) — and it dismisses automatically
when answered from *either* the desk or the glasses ring. Client-side slash commands: `/clear` (new
session), `/context`, `/usage`, `/help`, `/compact` (noted as an M3 feature); a slash command is never
sent to the model.

### permissionMode

Default is `default` (every tool — including reads — prompts). `--permission-mode acceptEdits` auto-
approves edits/reads so only riskier ops (e.g. Bash) reach the ring — fewer taps on the glasses.

## Development

```bash
npm test            # vitest run — full suite (216 tests)
npm run typecheck   # tsc --noEmit
npm run dev -- serve --host 0.0.0.0   # `dev` runs src/index.ts via tsx
```

Tests use injected fakes (a fake SDK `query`, a stub Hub, a fake `HubClient`) so they never call a real
model or open a real long-lived connection. `test/e2e.test.ts` boots the real Core+Hub in-process over
real HTTP+SSE and drives it with the real desk client to prove the co-live loop end-to-end.

## Scope

M1 is the working end-to-end loop, not full native parity (deferred to M3). Out of scope for M1:
Tailscale remote + long-idle reconnect (M2), the Codex provider, and a custom glasses app.
