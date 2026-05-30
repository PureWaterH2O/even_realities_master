---
title: Co-Live Terminal — design spec
project: colive-terminal  (provisional name)
date: 2026-05-30
status: draft (awaiting user review)
owner: Thomas
grounding: knowledge/terminal-mode/overview.md · research/2026-05-30-terminal-mode-live-probe/findings.md · knowledge/limitations.md
---

# Co-Live Terminal — design spec

## 1. The goal (in the user's words)

> "I'm working on a project in Claude Code at my desk. I kick off a long task and go cook dinner / go for a
> run. I put on my G2 + R1 and can see when the task finishes, a question is asked, or a permission is needed —
> directly on the glasses. I respond from the glasses (not just yes/no — I want to brainstorm, explore, ask
> questions). When I return to my desk I see the **full conversation** and pick up **without ever missing a
> beat.** Critically this must work even when my Mac and glasses are **not on the same Wi-Fi** (out for a run)."

The desk side will become the user's **primary workspace** in place of the stock `claude` TUI, so the desk
client must reach **full feature parity with native Claude Code** (its definition of done), with headroom to add
quality-of-life improvements the native terminal lacks once parity holds.

## 2. Why this is feasible (grounded in the 2026-05-30 live hardware probe — all 🧪)

We ran the genuine `@evenrealities/even-terminal@0.7.9` bridge against the real G2 + R1 + Even app and watched the
wire. Established firsthand:

- The bridge is **already a single-owner, multi-client server**: sessions are keyed by id, concurrent prompts to
  one session are **serialized** (`busy` → `enqueue`), and every output event is **broadcast to all SSE clients**
  of that session. → multi-client-on-one-session already works *when all clients go through the one bridge*.
- **One session = one writer.** Replying to a session `resume`s it and **appends in place** (same id). Two
  *independent* owners on one transcript collide — which is exactly why the desk side must be a **client of the
  bridge**, not a second independent `claude` process.
- The full **live SSE event vocabulary** is known (`user_prompt`, `status`, `tool_start/tool_end`, `text_delta`,
  `running_stats`, `result`, `permission_request/result`, `notification`, `task_progress`, `user_question`).
- **Ring + dictation work** (single tap = allow, verified; dictation is raw speech-to-text → natural language
  beats exact syntax). The Agent SDK session loads the **full slash-commands / skills / subagents / plugins /
  MCP** set (seen in `init`), so the *capabilities* for parity are largely present.
- **Off-Wi-Fi is a built-in config flag**, not engineering: `EVEN_HOST_MODE=tailscale` puts the Tailscale IP in
  the connection QR. The glasses talk BLE to the phone; only **phone → Mac** crosses the network.

## 3. Goals / Non-goals

**Goals (v1)**
- One **live Claude Code session** that a **desk client** and the **glasses** attach to as co-equal, live clients.
- **Free-form, bidirectional** input from either side (type at desk; dictate/ring from glasses), plus permissions
  and questions answerable from the glasses.
- **Seamless handoff**: leave the desk, interact on glasses, return — full transcript present and live, no lost beat.
- **Works off-Wi-Fi** (phone on cellular, Mac at home) via Tailscale.
- **Model unpinned/configurable** (kills the `claude-opus-4-6` pin; defaults to latest).
- Desk client reaches **full native-parity** (definition of done; reached incrementally — see §7 sequencing).

**Non-goals (v1)**
- The **Codex** provider (the fork retains it but we target Claude Code parity only).
- A **custom Hub glasses app** (we reuse the *unmodified* Even app via its protocol; custom app is a future fork
  if the app constrains us).
- QOL features *beyond* native (explicitly deferred to post-parity; the architecture leaves room).
- Multi-user / hosted/cloud service. This is single-user, self-hosted.

## 4. Architecture (approved)

```
            ┌──────────────────────── Session Core (single owner) ───────────────────────┐
            │  Owns the live Claude Agent SDK session · sole writer to ~/.claude/*.jsonl   │
            │  Accepts user input from ANY client · broadcasts ALL output to ALL clients   │
            └───────────────▲───────────────────────────────────────────▲─────────────────┘
                            │ protocol (HTTP + SSE, Even-app-compatible)  │
              ┌─────────────┴─────────────┐                  ┌────────────┴─────────────┐
              │  Desk client (NET-NEW)    │                  │  Glasses client (REUSE)  │
              │  full-parity terminal UI  │                  │  unmodified Even app     │
              │  scrollback · input · @/  │                  │  HUD · ring · dictation  │
              │  slash · permissions UI   │                  │  (BLE → phone → bridge)  │
              └───────────────────────────┘                  └──────────────────────────┘
        localhost / Tailscale (off-Wi-Fi)                    BLE always-on to phone; phone→Mac over net
```

**Components**
1. **Session Core** — the single owner. Holds one Agent SDK session per active conversation; sole writer; serializes
   input; broadcasts output. (Built on `even-terminal`'s existing session wrapper + Client Hub.)
2. **Client Hub** — Express + per-session SSE (500-msg replay buffer, `needReplay`), bearer auth, the
   **Even-app-compatible protocol**. Glasses are a first-class client with zero app changes.
3. **Glasses client** — the unmodified Even app.
4. **Desk client** — *net-new* terminal app; just another bridge client; the user's primary workspace.
5. **Transport** — localhost for desk; **Tailscale** host mode for off-Wi-Fi; bearer token (hardened — see §9).

**Data flow (one line):** input from *either* side → Session Core's single input path → Agent SDK → output events
streamed → **broadcast to desk *and* glasses simultaneously** → both render live. One session, two live heads, no collision.

## 5. Key design decisions

- **Single owner = the bridge.** The desk client never owns a `claude` process; it always goes through the bridge.
  This is what makes co-live safe (the probe proved independent owners collide).
- **Fork `even-terminal` as the base.** Reuse the Agent SDK session wrapper, SSE Client Hub, glasses protocol,
  session-store integration, and Tailscale/expose host modes — all proven on real hardware.
- **v1 concurrency model = the existing per-turn `resume` + `busy`/`enqueue` + broadcast.** Streaming-input mode
  (one long-lived `query()` taking an open message stream, enabling mid-turn steering) is a **possible later upgrade**,
  not required for v1.
- **Model configurable** (env/config; default latest). **`permissionMode` configurable**; default mirrors native
  Claude Code behavior so parity holds. **Hook-leak handled** — the Core controls `settingSources`/hook exposure so
  our capture-reminder Stop hook never spills onto the HUD.
- **Desk client = Node/TypeScript** to share the bridge's protocol types and stack (specific TUI library chosen in
  the implementation plan).
- **Possible decomposition:** the desk client (full-parity) is large and semi-independent; it may get its **own
  sub-spec** under this umbrella. Flagged for the planning step.

## 6. The desk client — full native parity

Because the user will live here, **v1's definition of done is zero feature regression vs the native `claude` TUI.**
The substrate is the Agent SDK (via the bridge), not the closed TUI, so every native feature is classified into one
of three buckets, tracked in a **feature-parity inventory** (a living artifact completed during the parity work):

| Bucket | Meaning | Examples (seed) |
|---|---|---|
| **Reuse (free via SDK)** | Capability already present in the SDK session | slash commands, skills, subagents, plugins, MCP, hooks, permission modes, `ExitPlanMode`, `TodoWrite`, `Task*` (all seen in `init`) |
| **Rebuild (client UI work)** | TUI affordance we re-implement on the event stream | input editor, slash + `@`-file autocomplete, scrollback/paging, diff/syntax rendering, image paste, Esc-interrupt, mode toggles (plan/auto-accept), status line, `/compact`, `/clear`, vim mode |
| **Blocked (TUI-only?)** | May not be SDK-exposed — must be found early | identified by the **parity-blocker spike** (§8); each blocker gets a decision: workaround, reimplement, or documented gap |

**Future state (post-parity, out of v1 scope):** persistent transcript search, pinned context, multi-session
dashboard, better long-output handling, glasses↔desk presence cues — the QOL headroom owning the client unlocks.

## 7. Sequencing (option B — prove the magic first)

- **M0 — De-risking spike** (§8). Settle the three linchpins before heavy build.
- **M1 — End-to-end thin loop.** Forked bridge (single-owner, model unpinned, hook-leak fixed) + a **functional,
  not-yet-full-parity** desk client. **Acceptance:** at the desk client, kick off a task → glasses show live
  progress → dictate a free-form follow-up from glasses → it enters the *same* session → response on HUD → return
  to desk client and the full conversation (incl. glasses turns) is present and live; keep typing. *This is the
  core value, validated.*
- **M2 — Remote + hardening.** Tailscale off-Wi-Fi path; SSE reconnection/replay robustness; security hardening
  (§9); concurrency/interrupt-from-either-side polish.
- **M3 — Parity to "no regression."** Complete the feature-parity inventory; rebuild affordances bucket-by-bucket
  until the desk client fully replaces the native TUI for daily use. **This is the desk client's definition of done.**
- **M4 — QOL (future).** Beyond-native improvements.

## 8. De-risking spike (M0) — three linchpins + the blocker hunt

1. **Source availability.** Is `even-terminal`'s repo public/forkable, or do we extend the shipped build / rebuild
   the thin parts? (Determines fork mechanics.)
2. **Co-live confirmation.** Two clients (a stub desk client + the real glasses) on one session via the bridge —
   confirm input serialization + simultaneous broadcast + no transcript collision on a throwaway session.
3. **iOS backgrounding / SSE longevity.** Does the HUD keep updating with the **phone locked in a pocket** (the
   "out for a run" case)? Pure hardware question. If it fails, capture the failure mode and fall back (e.g.,
   glance-to-wake usage, or investigate notification paths) — see §9 risks.
4. **Parity-blocker hunt.** Probe which native TUI features are *not* reachable via the SDK, seeding the
   "Blocked" bucket so M3 has no surprises.

## 9. Risks, security, open questions

- **iOS backgrounding (highest product risk).** If the Even app suspends its SSE when the phone is locked, the
  away-from-desk live experience degrades. Mitigation: characterize in M0; design the UX around the real behavior;
  the desk handoff still works regardless.
- **Closed Even app.** We depend on the reverse-engineered protocol; an app update could change it. Mitigation: the
  protocol is simple and versioned in our fork; a custom Hub glasses app is the escape hatch.
- **Security.** Stock bridge binds `0.0.0.0`, passes the token in `?token=`, no TLS. v1 hardening: bind localhost by
  default, header-auth for the desk client, document Tailscale for remote (still one shared bearer token — acceptable
  for single-user; note for future).
- **Parity scope creep.** "All native features" is large; the inventory + buckets bound it, and M1 ships value before
  parity is complete.
- **Dictation fidelity.** Raw STT; the UX should favor natural-language intent over exact syntax (already a 🧪 finding).

## 10. Testing strategy

- **Protocol/unit:** the Client Hub + Session Core (input serialization, broadcast fan-out, replay, auth) tested
  against a stub client.
- **Integration (the loop):** automated two-client test (stub desk + stub glasses) asserting one transcript, ordered
  broadcast, and handoff continuity.
- **Hardware-in-the-loop (manual, 🧪):** the real G2 + R1 + Even app for ring/dictation/HUD/backgrounding — these
  can't be automated and become recorded 🧪 findings.

## 11. Success criteria

- **M1:** the core loop in §7 works end-to-end on the LAN.
- **M2:** the same loop works with the Mac and phone on **different networks** (Tailscale), with graceful SSE
  reconnect.
- **M3:** the desk client has **no feature regression** vs native `claude` — the user adopts it as the daily driver.
