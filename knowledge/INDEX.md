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
- **Tailscale detection (Co-Live M2):** 🧪 [`terminal-mode/tailscale-detection.md`](terminal-mode/tailscale-detection.md) — `tailscale status --json` exits **0 with JSON when logged out** (daemon up) → `not-connected` detected correctly; only **daemon-not-running** (exit 1) is misclassified as `not-installed`. Probed on tailscale 1.98.3, 2026-06-01.

## Cross-cutting

- Limitations & open questions: [`limitations.md`](limitations.md)

## How to add knowledge

1. Run/append a research sweep into `../research/YYYY-MM-DD-<topic>/`.
2. Distill trustworthy facts into the relevant `<domain>/` doc using `_TEMPLATE.md`.
3. Tag each fact's confidence and link its source.
4. Update this table and append to `../PROGRESS.md`.
