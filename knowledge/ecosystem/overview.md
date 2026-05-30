---
title: Ecosystem
domain: ecosystem
last_updated: 2026-05-30
overall_confidence: ✅
---

# Ecosystem

> Confidence legend: 🧪 self-verified · ✅ verified · 🟡 community-claim · 🔴 unverified · ❌ disproven
> Source ids `[sN]` resolve in `../../research/2026-05-30-initial-survey/sources.md`.

## Summary

The G2/R1 ecosystem is **young but growing fast** (most activity Feb–May 2026), anchored by (1) the official **Even Hub** app platform (launched **3 Apr 2026**, OTA plugin gallery) and (2) a vigorous community/RE scene on GitHub + Discord (100+ G2 repos). Companion software split into a new **"Even Realities"** app (v2.2.2, G2 + R1) and a legacy **"Even G1 App"**. **Terminal Mode** is the flagship recent feature. Maturity is early: installed base undisclosed, no public revenue-share model, open-source companion apps (Gadgetbridge) still support only G1.

## Official platform & apps

- ✅ **Even Hub launched 3 Apr 2026**, distributed OTA via a plugin gallery tab in the companion app (Productivity / Lifestyle / Entertainment). G2-only. _[s73][s131][s72]_
- 🟡 **Launch metrics contested:** the repeated "~50 apps / 2,000+ developers" figures trace to a **single Even Realities press release**; Next Reality reports no stated launch app count, named partners, or revenue/approval criteria were public at launch. "2,000+" = SDK/dev-community access size, not shipped apps. Downgraded to single-source PR. _[s73][s131][s72][s79]_
- ✅ **Named launch apps** (per AndroidGuys): SubwayLens, a Tesla integration, Display Plus (Spotify), Epub Reader, Stillness (breathing), Chess (R1-controlled), ER Market (stocks). Several map to community repos → launch apps appear largely community-supplied. _[s73][s131]_
- ✅ **Two official companion apps:** new "Even Realities" (iOS id6747017725, G2 + R1) and a dedicated legacy "Even G1 App". New-app features: Conversate, Teleprompt, Health, Even AI ("Hey Even"), Translate, Navigate, Dashboard, Notification, QuickList. _[s179][s180]_
- ✅ **iOS app v2.2.2** (~May 19 2026), 456.9 MB, **3.9/5 from 115 ratings**, iOS 16+, also macOS 13+ (M1+) and visionOS 1.0+. Small but real user base. _[s180]_
- ✅ **007 First Light tie-in** (IO Interactive + Amazon MGM) announced May 13 2026 — G2 as an in-game gadget via post-launch update. High-profile marketing leveraging the camera-free "discreet" positioning. _[s187]_

## Community

- ✅ **Top maintainers:** **nickustinov** (even-g2-notes reference + ~8 reference apps) and **fabioglimb** (even-toolkit) are the **only two officially endorsed** (listed on the docs community page); **i-soxi** (even-g2-protocol BLE RE, most-starred community repo at 142★) and **kalanihelekunihi** (openCFW firmware RE) are influential but not endorsed. _[s12][s22][s19][s42]_
- ✅ **Star metrics (May 30 2026):** EvenDemoApp 467★ (G1-era, stalled Jun 2025) · i-soxi/even-g2-protocol 142★ (stalled 2026-01-20) · nickustinov/even-g2-notes 92★ · BxNxM/even-dev 69★ (simulator dev env) · fabioglimb/even-toolkit 61★ · even-realities/everything-evenhub 39★. Top community repos out-star most official org repos. _[s41][s42][s22][s25][s19]_
- ✅ **100+ G2 community repos** (GitHub search cap): games (flappy, pong, snake, chess), utilities (epub reader, weather, Tesla), AI-agent bridges (claude-code-g2, OpenClaw, Hermes, glint), Home Assistant, local-LLM, flashcards. Most <15★ — enthusiastic hobbyist scene. _[s181][s182][s183]_
- 🟡 **Discords:** official **developer** Discord `discord.gg/Y4jHMCU4sv` (primary live support, cited across official repos), a broader official user-community Discord, and an independent **RE Discord** `discord.gg/arDkX3pr` (linked from i-soxi). _[s12][s50][s42]_
- 🟡 **"Add Agent" / OpenAI-compatible integration:** third-party AI agents (Hermes, OpenClaw) can surface responses on the glasses via the Even App's Add-Agent flow. _[s184][s116]_

## Maturity & gaps

- ✅ **Gadgetbridge (open-source companion) supports only G1** (G1A/G1B "partially supported"), **not G2/R1** — independent users still need the official app for G2. _[s81]_
- ✅ **Hobbyist write-ups are unreliable on hardware specs:** the OpenClaw blog cites a 576×136 display that matches neither the real G2 (640×350) nor G1 (640×200) nor the SDK canvas (576×288). Treat hobbyist specs skeptically. _[s116][s185][s85]_

## Limitations

- Launch metrics are single-source PR; installed base / unit sales undisclosed and unmeasurable externally.
- No public revenue-share model, pilot-gating criteria, or gallery-ops process documented (only the technical submission checklist).
- Discord membership/channel structure not independently re-verified this pass.
- 640×350 display spec rests on secondary sources (the first-party specs page returned HTTP 403).
- Star counts / repo census are point-in-time (May 30 2026); ">100 repos" is GitHub's search cap.

## Open questions

- Actual verified count of live Even Hub apps and active (shipping) developers?
- Any revenue-share/monetization model and pilot-gating criteria?
- G2 installed base / unit-sales volume?
- Will Gadgetbridge ever add G2/R1, or is the protocol/pairing too closed?
- What does the 007 tie-in actually expose in-game?
- Is i-soxi/even-g2-protocol abandoned (last push 2026-01-20)? If so, is openCFW the de-facto authoritative BLE reference now?

## Change log

- 2026-05-30: created from initial multi-agent survey (run `wf_302a9f4e-3e2`). Launch metrics downgraded to single-source after adversarial check against Next Reality.
