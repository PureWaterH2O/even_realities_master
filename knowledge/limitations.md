---
title: Cross-cutting Limitations & Open Questions
last_updated: 2026-05-30
---

# Limitations & Open Questions

> Confidence legend: 🧪 self-verified · ✅ verified · 🟡 community-claim · 🔴 unverified · ❌ disproven

Known limits that span domains, and the biggest unknowns we want to resolve. Per-domain detail lives in each `knowledge/<domain>/` doc.

## Known limitations

- **No vendor low-level spec.** Even Realities publishes no BLE/protocol/firmware spec and no chip identities. All protocol/BOM knowledge is community reverse-engineering (i-soxi, kalani/openCFW). _(firmware-ble, hardware)_
- **Tiny monochrome canvas.** 576×288/eye, 4-bit green, single LVGL font, no font-size API; ~400–500 chars fill the screen. Long text is awkward; better consumed as audio. _(terminal-mode, sdk-app-dev, hardware)_
- **No on-glasses compute.** Apps are web apps in the phone WebView; the phone is a BLE proxy; glasses only render + emit input. _(sdk-app-dev)_
- **One shared, slow BLE link.** All bridge calls (render/audio/IMU/storage) share it and must be serialized; image frames cost ~0.5–2 s; a flaky hop can hang ~30 s. _(sdk-app-dev)_
- **No camera, no speaker** on the G2 by design. _(hardware)_
- **Closed companion app + closed store internals.** Even mobile app is closed-source; no published review SLA, revenue-share model, or installed-base figures. Gadgetbridge supports only G1, not G2/R1. _(terminal-mode, sdk-app-dev, ecosystem)_
- **Terminal Mode bridge security is weak by default.** `0.0.0.0` bind, bearer token in plaintext `?token=`/logs/tunnels, no TLS, only temporary pinggy/bore tunnels for remote. _(terminal-mode)_ 🧪 Note: secure off-WiFi remote is a built-in **Tailscale** mode (`EVEN_HOST_MODE=tailscale`), still on the one shared bearer token.
- 🧪 **Terminal Mode can only *observe*, not *control*, a session it didn't start.** A desk-TUI session is listable + status-pollable + readable, but the bridge can't stream it live or route its permission/question prompts to the ring (those live in the TUI process). Marrying "your live desk session" with "ring-answerable + live HUD" is the open engineering problem. _(terminal-mode)_
- 🧪 **Stock bridge auto-approves edits/writes/safe-bash** (`acceptEdits` hard-coded); the ring only sees mutating Bash, KillShell/Config/Mcp/RemoteTrigger, and AskUserQuestion. "Approve every change from the ring" requires a fork. _(terminal-mode)_
- 🧪 **Our own `.claude` hooks execute inside bridge-driven sessions** and leak onto the HUD (capture-reminder Stop hook). _(terminal-mode)_
- 🧪 **Replying to a session from the glasses `resume`s & appends in place** (same id), headless on 4.6 — so glasses + a live desk TUI on the same session = two writers → collision risk. Literal same-live-session needs one coordinating owner. _(terminal-mode)_
- 🧪 **Observed sessions don't live-update on the glasses** (exit→reopen to refresh; only status polls). _(terminal-mode)_
- **Pre-1.0 SDK (0.0.x).** APIs and limits may change between minor versions. _(sdk-app-dev)_

## Top open questions

- **Real on-device behavior of native Terminal Mode** (HUD pagination vs tail-only, gesture mapping, dashboard suppression) — currently grounded only in vendor copy + third-party bridges. _(terminal-mode)_
- **G2 main SoC identity** — Apollo510 + external EM9305 vs Apollo510B integrated? FCC block diagrams are confidential (R1 release 2026-07-20); no teardown exists. _(hardware, firmware-ble)_
- **Contested BLE service IDs** (esp. `0x07-20` Dashboard vs EvenAI) and kalani-only IDs — need a full live BLE sniff or vendor spec. _(firmware-ble)_
- **Authoritative image-container max** (20–288×20–144 type defs vs 20–200×20–100 docs/community) and whether it's firmware-dependent. _(sdk-app-dev)_
- **Real-hardware BLE throughput/backpressure** for audio (16 kHz PCM) and IMU; `setLocalStorage` quotas/eviction. _(sdk-app-dev)_
- **Store reality:** actual live-app/active-dev counts, revenue model, review turnaround, installed base. _(ecosystem, sdk-app-dev)_
- **Will the `even-terminal` Claude model pin (`claude-opus-4-6`) become configurable / updated to 4.7–4.8?** _(terminal-mode)_

## Things WE can verify firsthand (🧪 candidates — we own a G2 + R1)

These open questions are resolvable by our own testing once we start building — promote to 🧪 when proven:
- ✅→🧪 **(2026-05-30, done)** Terminal Mode ring gesture (tap=allow), permission round-trip, SSE event vocabulary, desk-session observability, dictation=raw-STT, model-display gotcha. See `terminal-mode/overview.md`.
- *Still open:* exact on-glasses HUD layout/pagination/char-budget of the **native app** rendering (we saw content, not pixel geometry); dashboard-suppression behavior.
- Real BLE audio/IMU throughput and the authoritative image-container max on current firmware.
- `setLocalStorage` quota/persistence behavior.
- Whether the phone holds two connections to L/R peripherals (BLE central capture).
