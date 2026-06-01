# Co-Live Terminal M2 — Tailscale Remote Access

**Date:** 2026-05-31
**Status:** Approved
**Depends on:** M1 (complete, merged to `main` as `a6412d0`)

## Problem

M1's co-live loop (desk + glasses sharing one Claude Code session) only works on
the local network. The glasses become useless when you leave your LAN — the Even
app can't reach the Hub. The goal is to make the glasses work from anywhere
without any manual reconnection when you leave home.

## Core Insight

Instead of solving "reconnect when you leave LAN range," avoid the problem
entirely: always connect through Tailscale, even when you're sitting at home.
The Tailscale WireGuard tunnel transparently re-routes as the phone moves between
networks (home WiFi → cellular → coffee shop WiFi). The Hub's IP never changes
from the app's perspective, so there's no disconnect to recover from.

## Success Criteria

Start a session at the desk via `colive serve`, interact from the glasses over
Tailscale, walk away from your home network, and continue interacting from the
glasses without any manual reconnection step.

## Architecture

Two additions to the existing colive-terminal:

1. **`colive setup`** — one-time interactive wizard that walks through Tailscale
   installation, verifies Mac + iPhone are on the tailnet, and saves the
   Tailscale identity to a config file.

2. **`colive serve` changes** — reads the config, verifies Tailscale is live,
   binds to all interfaces, and generates the QR with the Tailscale-routable URL.

No new services or protocols. The Hub is the same HTTP+SSE server from M1 — it
just listens on a different interface. The Even app doesn't know or care that
it's talking over Tailscale.

## Config File

`~/.config/colive/remote.json`:

```json
{
  "tailscaleHostname": "thomas-macbook.tailnet-name.ts.net",
  "tailscaleIp": "100.x.y.z",
  "prefer": "hostname"
}
```

Written by `colive setup`, read by `colive serve`. The `prefer` field controls
whether the QR encodes the MagicDNS hostname (stable, human-readable) or the
Tailscale IP (works even if MagicDNS is disabled). Default is `"hostname"` if
MagicDNS is available; `colive setup` falls back to `"ip"` if the detected
`DNSName` is empty.

## Setup Wizard (`colive setup`)

An interactive CLI flow, run once. Idempotent — re-running re-detects and
overwrites the config.

### Steps

1. **Check Tailscale on Mac.** Run `tailscale status` to detect installation and
   connection state.
   - Not installed → print install instructions (`brew install tailscale` or link
     to the Mac app). Wait for the user to install, then re-check.
   - Installed but not connected → tell them to run `tailscale up` or open the
     menu bar app. Re-check.

2. **Capture Mac identity.** Parse `tailscale status --json` to extract the
   Mac's Tailscale IP (`TailscaleIPs[0]`) and MagicDNS hostname (`DNSName`).
   Store both.

3. **Guide iPhone setup.** Print step-by-step instructions:
   - Install Tailscale from the App Store.
   - Sign in with the same account/tailnet.
   - Verify it shows "Connected."
   - Best-effort connectivity check: start a temporary HTTP listener on the
     Mac's Tailscale IP (port 3456, the default Hub port) and ask the user to
     open `http://<tailscale-address>:3456` in Safari on their phone. If the
     phone gets a response, the tailnet is working. Shut down the listener
     after success or user skip. Skip this step if the Hub is already running
     on that port.

4. **Write config.** Save `~/.config/colive/remote.json` with hostname, IP, and
   preference. Create the directory if it doesn't exist.

5. **Print summary.** "You're set up. Run `colive serve` and your glasses will
   be reachable from anywhere."

### Not in scope

Installing Tailscale for the user. It's a system-level app (Mac) and VPN profile
(iOS). The wizard detects, guides, and verifies — it doesn't automate OS-level
installation.

## `colive serve` Changes

### Boot Logic (in order)

1. **`--host` override check.** If the user passed `--host`, use that and skip
   config/Tailscale detection entirely. This is the escape hatch.

2. **Read config.** Look for `~/.config/colive/remote.json`. If missing and no
   `--host`, fail with: "No remote config found. Run `colive setup` first, or
   pass `--host <ip>` manually."

3. **Verify Tailscale is live.** Quick `tailscale status` check. If disconnected,
   fail with: "Tailscale is not connected — run `tailscale up` or open the menu
   bar app."

4. **Bind to `0.0.0.0`.** Listen on all interfaces so the Hub is reachable via
   Tailscale (for the glasses) AND localhost (for `colive desk` on the same
   machine). The security boundary is Tailscale (only tailnet devices reach the
   Tailscale IP) plus the bearer token (HTTP layer).

5. **QR uses the Tailscale address.** `buildQrPayload` uses the MagicDNS
   hostname or Tailscale IP from config (per the `prefer` field) instead of the
   LAN IP. This is the key change: the phone/glasses connect through Tailscale
   from the start.

6. **Banner output.** Startup banner shows:
   - The Tailscale URL (what the QR encodes, for the glasses).
   - `localhost:PORT` (for `colive desk` running on the same machine).

## Testing

### Unit Tests

- **Config reader** — reads/validates `remote.json`; handles missing file,
  malformed JSON, missing fields. Respects `--host` override precedence.
- **Tailscale detector** — parses `tailscale status --json` output; extracts IP +
  MagicDNS hostname; handles "not installed" (command not found) and "not
  connected" states. Tested against captured fixture JSON from a real Tailscale
  install.
- **QR payload** — `buildQrPayload` uses the Tailscale address when config is
  present; uses the passed host when it isn't.

### Integration Tests

- **Setup wizard flow** — mock the `tailscale` CLI calls (inject a fake
  executor). Happy path: detected → identity captured → config written →
  summary printed. Sad paths: not installed, not connected, config dir doesn't
  exist.

### Hardware Acceptance (manual)

1. Install Tailscale on Mac + iPhone.
2. Run `colive setup`, verify detection + config written.
3. Run `colive serve`, scan QR from the glasses.
4. Verify glasses work on the same LAN (through Tailscale, not direct).
5. Disconnect from home WiFi on the phone (leaving only Tailscale/cellular),
   verify glasses still work.
6. **The big moment:** start a session at the desk, leave, dictate a follow-up
   from the glasses remotely. Verify response streams to the HUD.

## Deferred (not M2)

- **LAN fallback mode** — connect without Tailscale for quick local-only use.
  Tracked as a future item, not a priority.
- **Reconnect/replay-resume** — SSE drop recovery. The always-Tailscale approach
  largely sidesteps this, but a true network blip could still drop the SSE
  connection. Track for M3.
- **iOS Tailscale VPN backgrounding under extended idle** — observed during
  hardware acceptance. If it's a problem, it becomes M3 work.
- **Non-Mac host support** — `colive setup` assumes macOS. Linux/Windows
  detection would be a separate effort.

## Files Touched (expected)

All within `colive-terminal/`:

- `src/remote/config.ts` — read/write/validate `remote.json`
- `src/remote/tailscale.ts` — detect Tailscale, parse status, extract identity
- `src/remote/setup.ts` — the interactive wizard flow
- `src/index.ts` — wire `colive setup` command + modify `colive serve` boot
- `src/hub/server.ts` — `buildQrPayload` and bind-host changes
- `test/remote/` — unit + integration tests
- `docs/remote-setup.md` — fallback written guide (if the wizard isn't enough)
