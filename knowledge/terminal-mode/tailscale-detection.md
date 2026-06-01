---
title: Tailscale CLI detection (Co-Live remote access)
domain: terminal-mode
last_updated: 2026-06-01
overall_confidence: 🧪
---

# Tailscale CLI detection (Co-Live remote access)

> Confidence legend: 🧪 self-verified · ✅ verified · 🟡 community-claim · 🔴 unverified · ❌ disproven

## Summary

Co-Live Terminal M2 detects the Mac's Tailscale state by shelling out to
`tailscale status --json` (see `colive-terminal/src/remote/tailscale.ts`,
`detectTailscale`). On 2026-06-01 we probed the real Tailscale CLI **1.98.3**
(installed via `brew install tailscale`, run as a userspace daemon — no login,
no tailnet) to confirm the exit-code/JSON behavior the detector relies on. The
key result: the CLI's `--json` output **exits 0 with parseable JSON even when
logged out**, so an installed-but-disconnected Tailscale is correctly classified
as `not-connected` — *provided the daemon is running*.

## Facts

- 🧪 **Daemon running, logged out (`NeedsLogin`): `tailscale status --json` exits 0** with full JSON (`BackendState:"NeedsLogin"`, `TailscaleIPs:null`, `Self.DNSName:""`). `detectTailscale` → `{state:'not-connected', backendState:'NeedsLogin'}`. _Source: local probe 2026-06-01, tailscale 1.98.3, userspace `tailscaled --tun=userspace-networking`._
- 🧪 **Daemon NOT running: `tailscale status --json` exits 1** ("failed to connect to local Tailscale service; is Tailscale running?"). `detectTailscale`'s bare `catch` maps this to `not-installed` — **imprecise**: a CLI that is installed but whose daemon hasn't been started reads as "not installed." _Source: same probe._
- 🧪 **Plain `tailscale status` (no `--json`) exits 1 when logged out** ("Logged out."), but the `--json` variant exits 0. The detector uses `--json`, which is the forgiving one. _Source: same probe._
- 🧪 **Genuinely-absent binary → ENOENT → `not-installed`** (correct). Confirmed by running `colive setup` with `tailscale` off `PATH`. _Source: 2026-06-01 `colive setup` CLI drive._
- ✅ **Realistic deployment is safe:** the Tailscale **macOS GUI app** runs the daemon continuously once installed, so the real "installed but disconnected" state is `NeedsLogin`/`Stopped` *with the daemon up* → exit 0 → correctly `not-connected`. The exit-1 (daemon-down) misclassification is mainly the brew-CLI-without-`brew services start tailscale` path. _Source: probe + Tailscale macOS behavior._
- 🟡 **`BackendState:"Stopped"` (daemon up, toggled off) is assumed to also exit 0 with JSON** (same CLI code path as `NeedsLogin`); our unit fixtures assume this but it was not directly observed on 2026-06-01. _Source: inferred from the NeedsLogin probe._

## Why it matters

The M2-build audit (PROGRESS.md, 2026-06-01) flagged as the **highest-risk bug**:
"if `tailscale status --json` exits non-zero when stopped/needs-login (likely),
the wizard tells users to install software they already have." This probe
**partially disproves that**: the `--json` path exits 0 for `NeedsLogin`, so the
`not-connected` branch *is* reachable and correct whenever the daemon runs. The
residual risk is narrower than feared — only **daemon-not-running** is
misreported as `not-installed`.

## Open questions

- Direct confirmation of the `Stopped` exit code (log in, then `tailscale down`, re-probe).
- Should `detectTailscale` distinguish "daemon not running" (`status --json` exit 1, "failed to connect…") from genuine ENOENT, surfacing a `not-running` hint instead of `not-installed`? (Small hardening; would add a union variant rippling into `setup.ts`/`runServe`.)
- Full hardware loop (glasses scan Tailscale QR; walk-away/cellular continuity) — still unrun as of 2026-06-01.

## Change log

- 2026-06-01: created from a local Tailscale-CLI probe (v1.98.3). Promotes the disconnected-detection question from 🔴 speculation ("likely exits non-zero") to 🧪: `--json` exits 0 for `NeedsLogin`; only daemon-down (exit 1) is misclassified as `not-installed`.
