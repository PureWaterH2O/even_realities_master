# Knowledge Index

Master map of what we know about the Even Realities G2 glasses and R1 ring.
Curated reference only — raw research lives in `../research/`.

> Confidence legend: 🧪 self-verified · ✅ verified · 🟡 community-claim · 🔴 unverified · ❌ disproven
> A claim is **promoted** (🟡/🔴 → ✅/🧪) or **killed** (→ ❌) as our own dev work generates ground truth.

## Coverage by domain

| Domain | Doc | Status | Top confidence | Notes |
|--------|-----|--------|----------------|-------|
| Terminal mode & usage | [`terminal-mode/overview.md`](terminal-mode/overview.md) | 🟩 solid | 🧪 (bridge + protocol verified on real G2+R1, 2026-05-30) | Priority 1. Bridge/ring/SSE proven firsthand; *native app HUD layout* still vendor copy |
| App / SDK development | [`sdk-app-dev/overview.md`](sdk-app-dev/overview.md) | 🟩 solid | ✅ (verified vs SDK/CLI type defs) | Priority 2. SDK is pre-1.0 (0.0.x) |
| BLE / firmware / protocol | [`firmware-ble/protocol.md`](firmware-ble/protocol.md) | 🟨 partial | 🟡 (community RE; no vendor spec) | Priority 3. kalani arbitrates i-soxi conflicts |
| Hardware & specs | [`hardware/specs.md`](hardware/specs.md) | 🟨 partial | ✅ headline / 🟡 internal BOM | Secondary. BOM single-source, unconfirmed |
| Ecosystem | [`ecosystem/overview.md`](ecosystem/overview.md) | 🟩 solid | ✅ (launch metrics 🟡 contested) | Secondary |

Status key: ⬜ not started · 🟨 partial · 🟩 solid coverage

## Headline facts (one-liners)

- **What it is:** G2 = monochrome-green micro-LED display glasses ($599, launched Nov 12 2025), no camera/no speaker; R1 = capacitive-touch control ring + health tracker ($249).
- **Display:** 640×350/eye physical panel; **576×288/eye, 4-bit greyscale** developer canvas.
- **Apps:** web apps in the phone's WebView; phone is a BLE proxy; glasses only render + emit input. Official SDK `@evenrealities/even_hub_sdk`; package `.ehpk`; OTA via Even Hub store.
- **Terminal Mode:** official feature (app v2.2.0+) to control AI coding agents; host bridge `@evenrealities/even-terminal`; R1 tap = approve, hold = dictate; **hard-codes `claude-opus-4-6`** (now 2 gens behind). 🧪 Live-probed 2026-05-30: bridge **lists/renders your desk-TUI sessions** (observe-only) and runs **bridge-driven** sessions with full live SSE + ring permissions; off-WiFi is a built-in **Tailscale** flag, not engineering.
- **BLE:** G2 = custom GATT (base `0x2760`), 8-byte `0xAA` frames + protobuf + CRC-16/CCITT, 2-byte service IDs; G1 = dual Nordic-UART. All community-RE'd; no vendor spec.
- **ink 7 input internals (paste & mouse):** 🧪 [`terminal-mode/ink7-input-internals.md`](terminal-mode/ink7-input-internals.md) — `usePaste` auto-enables bracketed paste (full string, separate channel from `useInput`); ink does NOT enable mouse but assembles SGR mouse sequences and re-emits them raw on `internal_eventEmitter`'s `'input'` channel (wheel = btn 64/65); verified ink 7.0.5 while probing M3.2A. **Enriched 2026-06-03 (M3.2A build):** Enter `\r`→`key.return` vs Ctrl-J `\n`→`input==='\n'` (the multiline linchpin); the ESC-strip asymmetry (`useInput` strips the leading ESC, the `'input'` emitter keeps it → strip before a `^\[<` parser); and paste+wheel are testable in ink-testing-library.
- **Tailscale detection (Co-Live M2):** 🧪 [`terminal-mode/tailscale-detection.md`](terminal-mode/tailscale-detection.md) — `tailscale status --json` exits **0 with JSON when logged out** (daemon up) → `not-connected` detected correctly; only **daemon-not-running** (exit 1) is misclassified as `not-installed`. Deployed binary = macOS app v1.98.2; full M2 remote loop hardware-validated 2026-06-01.
- **Desk TUI rendering (Co-Live M3 cockpit):** 🧪 [`terminal-mode/desk-rendering.md`](terminal-mode/desk-rendering.md) — tool **errors are color-only** (`rows.ts` paints the dot/name red from the `tool_end` summary; the summary text itself is never drawn) → **invisible after `stripAnsi`**, so plain-frame tests must assert on the tool name/arg, and textual errors are a native-parity candidate for M3.5; `running_stats`/`permission_request`/`user_question` are **not transcript blocks** (status line + inline `PendingPrompt` in `app.tsx`) → must be driven through the live `App` via `capture()`, not `flattenAll()`. Self-verified 2026-06-06 (M3.5 Builder Run 1).
- **Streaming-input SDK shape (Co-Live M3.3a + M3.3b):** 🧪 [`terminal-mode/streaming-input-probe.md`](terminal-mode/streaming-input-probe.md) — live probe (SDK 0.3.158, 2026-06-03) of persistent-`Query` streaming mode: **one `result` per turn ✅**, `stream_event` shapes unchanged ✅, but **`init` arrives per-turn** (not once) — benign (emits no events; `session_id` stable across turns), so the `handleMessage*` mapping stays byte-identical. New `system/status`/`rate_limit_event` types hit existing no-op defaults. `SDKUserMessage` text shape confirmed live. Verdict: M3.3a build proceeds as written. **M3.3b add (2026-06-06):** runtime `setModel`/`setPermissionMode` do **NOT fork `session_id`** (per-turn `init` reflects the new model/mode; one id across 3 turns) — resolved the M3.3b UAT "glasses new session on model switch" as **not-a-bug** (no fork; additive desk-only control).

## Cross-cutting

- Limitations & open questions: [`limitations.md`](limitations.md)

## How to add knowledge

1. Run/append a research sweep into `../research/YYYY-MM-DD-<topic>/`.
2. Distill trustworthy facts into the relevant `<domain>/` doc using `_TEMPLATE.md`.
3. Tag each fact's confidence and link its source.
4. Update this table and append to `../PROGRESS.md`.
