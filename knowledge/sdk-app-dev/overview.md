---
title: App / SDK Development
domain: sdk-app-dev
last_updated: 2026-05-30
overall_confidence: ✅
---

# App / SDK Development (Even Hub)

> Confidence legend: 🧪 self-verified · ✅ verified · 🟡 community-claim · 🔴 unverified · ❌ disproven
> Source ids `[sN]` resolve in `../../research/2026-05-30-initial-survey/sources.md`.

## Summary

G2 apps ("plugins") are **web apps (HTML/CSS/TS) that run inside the Even Realities phone app's WebView** (Chromium on Android, WKWebView on iOS). The phone is a **BLE proxy**; the glasses only render UI containers and emit input events — **no app code runs on the glasses**. The one first-party dev dependency is **`@evenrealities/even_hub_sdk`** (v0.0.10), plus **`@evenrealities/evenhub-simulator`** (0.7.x) and **`@evenrealities/evenhub-cli`** (0.1.x). The SDK injects a typed `EvenAppBridge` into the WebView (via `waitForEvenAppBridge`) with a **container-based render model**. Apps package into **`.ehpk`** via the CLI, undergo **manual review**, and distribute OTA through the **Even Hub store** (launched 3 Apr 2026). Distinguish this G2 web-SDK stack from the older **G1-era raw dual-BLE protocol** (EvenDemoApp).

## Architecture & toolchain

- ✅ **3-tier model:** Even Hub Cloud (distribution) → Phone (Flutter app hosting your plugin in a WebView) → G2 glasses (render + emit events over BLE). Outbound: `bridge.callEvenApp(method, params)`; inbound: `window._listenEvenAppMessage(...)` → your callback. _[s2][s1][s68]_
- ✅ **Packages & versions (mid-Apr 2026):** `even_hub_sdk` 0.0.10 (2026-04-10), `evenhub-simulator` 0.7.2/0.7.3, `evenhub-cli` 0.1.12/0.1.13. **Node 20 LTS or 22+** (Node 18 unsupported). SDK is MIT, zero runtime deps, ESM+CJS, ships `dist/index.d.ts`. _[s64][s38][s23][s9]_
- Any web tech works (official templates are **Vite + TS**; community uses React, Kotlin Multiplatform). No native-on-glasses code.

## Render model (container-based)

- ✅ **Lifecycle methods** (all async on the bridge): `createStartUpPageContainer` (once; result 0 success/1 invalid/2 oversize/3 OOM), `rebuildPageContainer` (full redraw, brief flicker), `textContainerUpgrade` (faster, flicker-free in-place), `updateImageRawData` (**sequential only — never concurrent**), `shutDownPageContainer(0|1)` (0 = immediate, 1 = exit-confirm dialog). Must `createStartUpPageContainer` before `audioControl`/`imuControl`. _[s6][s123][s65]_
- ✅ **Up to 12 containers/page: max 4 image + max 8 text/list.** Exactly one container must set `isEventCapture:1`. Coords/size 0–576 × 0–288; later containers draw on top (no z-index). _[s5][s23][s123][s126][s69]_
- ✅ **Display surface: 576×288 px/eye, 4-bit greyscale (16 green shades), single LVGL firmware font, no font-size API.** ~400–500 chars fill a full-screen text container. Unsupported glyphs are silently skipped. _[s5][s123][s69]_
- ✅ **Content limits:** text 1000 chars on create / 2000 on upgrade (paginated via contentOffset/Length); list 1–20 items × 64 chars; image data pushed via `updateImageRawData` (number[]/base64/Uint8Array/ArrayBuffer → 4-bit grey). _[s5][s69][s123]_
- ✅ **Authoritative image bounds = 20–288 × 20–144 px** per the shipping SDK v0.0.10 type defs (`范围 20~288` / `20~144`; stable since v0.0.8). ❌ The widely-copied **"20–200 × 20–100 / max 200×100" is disproven** as the authoritative spec — it traces to a community Zenn blog that reported its own demo size; the simulator (0.7.3) explicitly does **not** enforce hardware image-size limits, so validate against type defs / device, not the simulator. _[s127][s23][s191][s128][s69]_

## Device APIs

- ✅ **Audio:** `audioControl(isOpen)` → PCM in `event.audioEvent.audioPcm` (Uint8Array), **16 kHz s16le mono**; needs `g2-microphone` permission. (Simulator emits 100ms/3200-byte chunks — a simulator artifact, not a hardware spec.) _[s3][s125][s69][s196]_
- ✅ **IMU:** `imuControl(isOpen, ImuReportPace)` where pace P100–P1000 = **ms between reports, NOT Hz** (docs warn these are "protocol pacing codes"). Data `{x,y,z}` floats via `sysEvent.imuData` when `eventType === IMU_DATA_REPORT(8)`. _[s3][s195][s134]_
- ✅ **`getDeviceInfo()`** → model (`DeviceModel` g1/g2/ring1), sn, battery 0–100, isWearing/isCharging/isInCase; `onDeviceStatusChanged(cb)` for live updates. `getUserInfo()` → {uid, name, avatar, country}. _[s3][s125]_
- ✅ **String KV store:** `setLocalStorage(k,v)`/`getLocalStorage(k)` persists across reboot (unlike browser localStorage/IndexedDB, which is unreliable in the WebView). No `removeLocalStorage` (write empty string). No documented quota; the "50,000 chars/key" figure is a chunking convention, not a limit. _[s3][s195][s194]_

## Input events

- ✅ **`OsEventTypeList`:** CLICK=0, SCROLL_TOP=1, SCROLL_BOTTOM=2, DOUBLE_CLICK=3, FOREGROUND_ENTER=4, FOREGROUND_EXIT=5, ABNORMAL_EXIT=6, SYSTEM_EXIT=7, IMU_DATA_REPORT=8. Routing: text-swipe → `textEvent`; list-select → `listEvent`; clicks + system/IMU → `sysEvent`. **Quirk:** CLICK=0 can normalize to `undefined`, so handlers keyed on literal `0` may not fire. _[s4][s124][s122][s190]_
- ✅ **R1 ring and the two temple touchpads share the SAME event types**, distinguished only by `EventSourceType` (`TOUCH_EVENT_FROM_RING = 2`; glasses L/R = 3/1). _[s122][s123][s4][s69][s19]_
- ❌ **Disproven:** there are **no** dedicated `RING_CLOCKWISE/COUNTER_CLOCKWISE/CLICK` event types — those exist only in the unofficial `brianmatzelle` template. Ring input arrives as standard SCROLL/CLICK/DOUBLE_CLICK with `eventSource=2`. _[s122][s23][s4][s69]_

## Networking, manifest, packaging & review

- ✅ **Outbound HTTP gated twice:** an `app.json` `permissions.network.whitelist` (array of full **HTTPS** origins, no wildcards, no count/format validation — it's a plain `array(string())`) **plus** normal browser CORS (remote must send `Access-Control-Allow-Origin`). _[s2][s24][s129]_
- ✅ **Permission enum (fixed 6):** `g2-microphone`, `phone-microphone`, `album`, `location`, `network`, `camera`; each needs a 1–300-char `desc`. Unused permissions are flagged at review. _[s24][s129]_
- ✅ **`app.json` schema** (from `evenhub-cli` Zod): `package_id` reverse-domain `^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$`, `edition` = `"202601"`, `name` ≤20 chars (must NOT contain "Even"), `version` 3-part semver, `min_app_version`/`min_sdk_version` (floor "0.0.10"), `entrypoint`, `supported_languages` ∈ {en,de,fr,es,it,zh,ja,ko}. _[s24][s129]_
- ✅ **CLI has 4 commands only:** `init`, `login`, `pack <json> <project>` (→ `out.ehpk`; `--check` hits `/api/v1/apps/check` for package-id availability), `qr`. **No `submit`/`publish`** — uploading the `.ehpk` is done via the Even Hub **web portal**. _[s24][s9][s1]_
- ✅ **Every app gets manual review** against a published checklist (tested phone-LOCKED + app-backgrounded). Categories: manifest validity, monochrome/greyscale store assets, privacy policy covering each permission, no first-run black screen, **root-page double-tap must call `shutDownPageContainer(1)`**, lifecycle handling of events 4–7, content safety (no medical/financial/emergency, no NSFW). **No review-turnaround SLA is published** (the "10 business days" figure is for Pilot Program *application* review). _[s129][s67]_
- ✅ **Distribution:** OTA via the Even Hub store (launched 3 Apr 2026). Dev access is gated behind the **Even Hub Pilot Program** (apply at evenhub.evenrealities.com/application). _[s9][s67][s130]_

## BLE-proxy performance (first-party guidance)

- ✅ **Serialize ALL bridge calls** — render, audio, IMU, storage share one BLE link; concurrent calls can crash the connection. Wrap calls in a timeout (a flaky hop can hang ~30s). **Image frames cost ~0.5–2s each** (no compression/delta). Debounce `setLocalStorage` writes. _[s199]_

## Limitations

- SDK is **pre-1.0 (0.0.x)** — APIs/limits may change between minor versions; versions/store metrics are point-in-time (mid-Apr 2026).
- Fine details (image bounds, font behavior, CLICK=0 normalization) rest largely on one third-party tester (bigdra/Zenn) + simulator; some re-confirmed against type defs.
- No device-measured BLE audio/IMU throughput, backpressure, or dropped-chunk data exists; the simulator's cadence is not a hardware spec.
- No documented `setLocalStorage` quota/eviction or per-plugin storage sandboxing (only the network allowlist is an enforced per-app boundary).

## Open questions

- Authoritative image max on current firmware (type defs say 20–288×20–144; Display guide/bigdra say 20–200×20–100) — does it vary by firmware?
- Recommended idiom to detect a single click given CLICK=0 → undefined?
- Real-hardware sustained audio/IMU throughput and backpressure behavior?
- `setLocalStorage` quotas/eviction and per-plugin isolation?
- Exact `.ehpk` review turnaround and real rejection reasons (no first-hand reports found publicly)?
- How do the G1 raw dual-BLE protocol and the G2 Even Hub web SDK differ for a dev targeting both?

## Change log

- 2026-05-30: created from initial multi-agent survey (run `wf_302a9f4e-3e2`). Several facts re-verified against the published SDK/CLI tarballs and type defs.
