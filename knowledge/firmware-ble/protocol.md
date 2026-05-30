---
title: BLE / Firmware / Protocol
domain: firmware-ble
last_updated: 2026-05-30
overall_confidence: 🟡
---

# BLE / Firmware / Protocol

> Confidence legend: 🧪 self-verified · ✅ verified · 🟡 community-claim · 🔴 unverified · ❌ disproven
> Source ids `[sN]` resolve in `../../research/2026-05-30-initial-survey/sources.md`.

> ⚠️ **Provenance caveat:** Even Realities publishes **no** low-level BLE spec. Almost everything here comes from **two community reverse-engineering projects** — **i-soxi/even-g2-protocol** (black-box: live iOS BLE captures) and **kalanihelekunihi/evenRealities-openCFW** (white-box: firmware decompilation, handler symbols). Where they conflict, **kalani's firmware-symbol evidence generally arbitrates** (it analyzed 5 firmware builds and resolves names from binary symbols, vs i-soxi's behavior-inferred names). Treat single-project-only claims as provisional.

## Summary

The G2 and G1 use fundamentally different BLE architectures. **G1** exposes two independent **Nordic UART (NUS)** radios (one per arm) with a flat 1-byte-opcode protocol. **G2** exposes a **custom GATT service** (base UUID `00002760-08c2-11e1-9073-0e8ac72eXXXX`) with three channel pairs and a **framed transport**: 8-byte header (magic `0xAA`) + protobuf payload + 2-byte CRC-16/CCITT. Features are addressed by **2-byte service IDs**. Sessions begin with a 3- or 7-packet auth/time-sync handshake and a Type-14 heartbeat. The **R1 ring** is a physically separate **Nordic nRF5x** device with its own GATT service and standard Nordic DFU. G2 firmware updates use a custom **"EVENOTA"** ECDSA-P256-signed multi-image protocol (NOT Nordic DFU for the glasses).

## G2 transport (most solidly attested — both projects agree)

- 🟡 **Custom GATT, base UUID `00002760-08c2-11e1-9073-0e8ac72e{xxxx}`** with three TX/RX pairs: **Control** write `5401` / notify `5402`; **Display** TX `6401` / notify `6402`; **File/OTA** TX `7401` / notify `7402`. Service declarations at `x450`. MTU → 512 (247 effective). _[s43][s136][s170]_
  - **Conflict:** i-soxi calls `6402` a *display-write* characteristic; kalani (live capture, 2026-03-02) says `6402` is a **notify** carrying an encrypted ~18.8 Hz head-angle sensor stream, and display **writes go to `6401`**. Prefer kalani (6401=write, 6402=notify). _[s43][s136][s170]_
- 🟡 **8-byte frame:** `[0]=0xAA` · `[1]=type` (`0x21` cmd phone→glasses / `0x12` resp) · `[2]=seq` · `[3]=len` (payload+2) · `[4]=pkt_total` · `[5]=pkt_serial` · `[6-7]=service ID` · payload (protobuf) · **2-byte CRC-16/CCITT** (init `0xFFFF`, poly `0x1021`, over **payload only**, little-endian). Fragmentation: seq constant, pkt_serial increments. _[s44][s135][s137]_
- 🟡 **Session setup:** 7-packet "full" (capability mode 1) or 3-packet "fast" (mode 2) handshake on auth services `0x80-00` (AuthControl) / `0x80-20` (AuthData) / `0x80-01` (AuthResponse) / `0x80-02` (transport ACK), ending in a time-sync packet. **No cryptographic challenge/keys observed at the link layer.** Kept alive by **Type-14 (`0x0E`) heartbeat** on `0x80-20` (~3–5s; only type 14 elicits an echo). _[s138][s139][s135][s44]_

## Service-ID map (2-byte IDs in header bytes 6–7)

- 🟡 **Agreed by both projects (firmware-anchored in kalani):** `0x06-20` Teleprompter · `0x0B-20` Conversate (STT display) · `0x08-20` Navigation · `0x09-00` Device Info · `0x0E-20` Display Config · `0xC4-00`/`0xC5-00` File-transfer cmd/data. _[s45][s47][s140]_
- 🟡 **Contested (kalani's firmware-symbol name preferred):** `0x07-20` = **EvenAI** (shared with Dashboard, disambiguated by protobuf command-type) — i-soxi called it "Dashboard"; `0x01-20` = Dashboard (kalani only); `0x0C-20` = **Quicklist+Health** (i-soxi "Tasks"); `0x20-20` = **ModuleConfigure+SyncInfo** (i-soxi "Commit"); `0x81-20` = **BoxDetect/case relay** (i-soxi "Display Trigger"). kalani-only: `0x02-20` Notification, `0x05-20` Translate, `0x91-20` Ring Relay, `0xE0-20` EvenHub. _[s45][s140][s167]_
- ✅ **`0x11-20` "Conversate (alt)" is invalid** — kalani live-probe (2026-02-27): no responses, no dispatch entry. Conversate's real ID is `0x0B-20`. _[s45][s140]_
- 🟡 **Unresolved:** `0x90-??` (14-byte stub, no strings) and `0x0A-20` (SessionInit — registered in iOS code, zero traffic). _[s140][s168]_

## Feature protocols (single-project, partial)

- 🟡 **Teleprompter (`0x06-20`):** 10-line UTF-8 pages (~25 chars/line), strict send order (auth → DisplayConfig → init → pages 0–9 → mid-stream marker → pages 10–11 → `0x80-00` type-14 sync → rest); display params include line_height=230, viewport_height=1294, scroll_mode 0 manual / 1 AI auto-scroll. A working bleak/asyncio Python client implements this. _[s46][s135][s47]_
- 🟡 **Notifications:** pushed as a small JSON file over `0xC4`/`0xC5` using **CRC-32C** (Castagnoli, poly `0x1EDC6F41`); 93-byte FILE_CHECK header; payload `android_notification {msg_id,title,subtitle,message,time_s}`. i-soxi flags this "partial". _[s141][s42]_

## Firmware & OTA

- 🟡 **G2 OTA = custom "EVENOTA"** multi-image over `0x7401`/`0x7402`: START → INFORMATION → FILE (chunked) → RESULT_CHECK → NOTIFY(reboot). Multi-image targets main SoC (`s200_firmware_ota` ~3.19 MB), the BLE radio (`firmware_ble_em9305.bin` ~211,948 B), audio codec, touch, bootloader, case MCU. **ECDSA P-256 signed**, key in bootloader. Cloud API `https://api2.evenreal.co/v2/g/check_firmware`. Analyzed build **v2.0.7.16 (2026-02-13)**; kalani analyzed 5 builds (2.0.1.14 → 2.0.7.16). OTA probing is brick-risk. _[s142][s143][s147][s169]_
- ✅ (first-party) End-user firmware update flow: Even App → My Devices → Glasses Info → Firmware Version → Update (battery >50%). No changelog/protocol detail published. _[s99]_

## R1 ring (separate Nordic device)

- 🟡 **Physically separate**, FCC ID 2BFKR-R01. Own GATT service base `BAE80001-4F05-4503-8E65-3AF1F7329D1F` (TX `BAE80012`, RX `BAE80013`). Nordic nRF5x SoC (S140 layout → nRF52840-class, **exact part unconfirmed**), SoftDevice + MCUboot. Firmware via **Nordic FE59 Buttonless Secure DFU + MCUmgr/SMP** (driven by the Android app), **separate from EVENOTA**. Ring sends `[0xFF][gesture][param]` frames; phone decodes and relays to G2. _[s145][s146][s140]_
- ❌ **Disproven:** the bundled nRF52840/SoftDevice-S140/Nordic DFU is **NOT a G2 auxiliary update path** — it belongs entirely to the **R1 ring** (or its own domain). The G2 BLE host is **Ambiq Cordio, not Nordic SoftDevice**, and the G2 plays **no role** in ring firmware updates. _[s145][s146][s142]_

## Dual-eye architecture (G2)

- ✅ **(first-party)** Left/right display sync moved **off** wireless onto a **0.1 mm Dual-Sided Communication FPC** running through the frame; G1's third (inter-arm) wireless link is gone — "what used to require three wireless channels now requires two." BLE handles only external comms. _[s76][s175]_
- 🟡 **Two independently-addressed BLE peripherals** advertise as `Even G2_32_L_XXXXXX` and `Even G2_32_R_XXXXXX` (community BTSnoop capture); the phone drives both arms directly (no peripheral-to-peripheral relay). G1 behavior (send left, await ACK, then right; images parallel) is the inherited baseline. _[s43][s173][s42][s13]_
- 🟡 **(first-party)** BT 5.4 **PAwR** "keeps G2 and R1 connected efficiently" — framed for multi-device coexistence, **not** as the L/R display-sync mechanism (that's the FPC). How PAwR interacts with the two GATT links is unresolved. _[s76]_

## Hardware BOM (firmware-derived — see `../hardware/specs.md`)

The chip-level BOM (Apollo510-class SoC + EM9305 radio, etc.) rests on the single openCFW project and is firmware-string-derived, not teardown-confirmed. **SoC SKU is unresolved:** the only binary string is `build_path_ap510` (no "b"), and a discrete EM9305 is *inconsistent* with an Apollo510**B** (integrated BLE) — pointing to a plain Apollo510 + external EM9305. Details and caveats in the hardware doc. _[s143][s142][s162]_

## Limitations

- No vendor-confirmed BLE spec exists; all protocol detail is community RE.
- Project disagreements on several service IDs remain; kalani-only IDs are provisional.
- Cryptographic link-layer auth was not observed (security beyond ECDSA-signed OTA is uncharacterized).
- Notification flow (`0xC4`/`0xC5`) is only partially mapped.
- Firmware analyzed centers on v2.0.7.16; other builds may differ.

## Open questions

- Exact main SoC SKU (Apollo510 + discrete EM9305 vs Apollo510B integrated)? Can an FCC teardown/X-ray confirm it (block diagrams are confidential)?
- Exact R1 Nordic SoC + SoftDevice version?
- How are the L/R peripherals paired/addressed and how does PAwR interact with the two GATT links?
- Which kalani-only service IDs are real; correct meaning of `0x07-20`?
- Any cryptographic pairing beyond the plaintext capability + time-sync handshake?
- Full EVENOTA package structure and per-target sub-image format; the case-MCU (STM32L0xx?) update path?
- Complete notification protocol over `0xC4`/`0xC5`?

## Change log

- 2026-05-30: created from initial multi-agent survey (run `wf_302a9f4e-3e2`). Service-ID conflicts arbitrated via kalani firmware symbols; nRF/G2 DFU misattribution corrected to the R1 ring.
