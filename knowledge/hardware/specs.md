---
title: Hardware & Specs (G2 glasses + R1 ring)
domain: hardware
last_updated: 2026-05-30
overall_confidence: ✅ (headline specs) / 🟡 (internal BOM)
---

# Hardware & Specs

> Confidence legend: 🧪 self-verified · ✅ verified · 🟡 community-claim · 🔴 unverified · ❌ disproven
> Source ids `[sN]` resolve in `../../research/2026-05-30-initial-survey/sources.md`.

## Summary

The **Even Realities G2** (launched **Nov 12 2025, $599**) is monochrome-green **micro-LED** display glasses with **no camera and no speaker**. Headline specs are verified across multiple sources; the **internal chip BOM is community-only** (one firmware-RE repo) and should be treated as unconfirmed. The **R1 ring** ($249) is a capacitive-touch controller for the G2 and a PPG/accelerometer/thermometer health tracker.

## G2 glasses — verified headline specs

- ✅ **Display:** monochrome green **micro-LED**, **640×350 px/eye** physical panel, **27.5° FOV**, **1,200 nits**, **60 Hz**. Projectors couple into waveguide/refractive lenses. _[s85][s176][s71]_
- ✅ **Panel vs canvas (NOT a contradiction):** the **developer-addressable canvas is 576×288 px/eye at 4-bit (16-level) greyscale** — software-addressable surface, smaller than the 640×350 physical panel. (A legacy 576×136 1-bit BMP path exists from the G1-era opcode `0x15`; the OpenClaw blog's "576×136" figure for G2 is wrong — see `../ecosystem/overview.md`.) _[s1][s22][s19]_
- ✅ **Build:** ~**36 g**; magnesium-alloy front frame + titanium temples; lenses ~30% thinner than G1; **prescription −12 to +12 diopters**. _[s84][s71][s134]_
- ✅ **Audio in:** **4-microphone array** (16 kHz mono PCM, LC3 encoded), up from G1's 2 mics. **No camera, no speaker** ("glasses-first" design). _[s134][s1][s71]_
- ✅ **IMU:** adds a **geomagnetic sensor (compass)** over G1; exposed to apps at 100/500/1000 ms report rates. _[s134][s3]_
- ✅ **Battery:** ~**2 days** glasses runtime; **case holds 7 full recharges** via pogo-pin magnetic contacts, USB-C, ~2.5× faster than G1's wireless charging. Exact mAh not published. _[s84][s134][s85]_
- ✅ **Connectivity:** **Bluetooth 5.4** (with PAwR), ~9 dB higher TX power, ~3× range (~28 m), 0.1 mm Dual-Sided Communication FPC physically linking the two eyes (kills L/R wireless desync). _[s76][s22][s1]_

## R1 ring — verified specs

- ✅ **$249** (€269; free for G1→G2 upgraders). Capacitive touchpad (tap/scroll/long-press) controlling the G2. _[s66][s57]_
- ✅ **Health sensors:** optical HR, SpO2, HRV, skin-temperature, accelerometer (steps/calories/distance), sleep staging. _[s66]_
- ✅ **Durability/battery:** **IP68 to 50 m / 30 min**, **~4-day battery**, ~90 min charge, **sizes 6–15**, zirconia ceramic + medical-grade stainless steel. Weight/dimensions/mAh not published. _[s66][s57][s176]_

## G1 → G2 deltas (verified)

BT 5.2 → 5.4; 2 → 4 mics; added compass; 0.1 mm FPC for inter-eye sync (was wireless); ~9 dB more TX power, ~3× range; pogo-pin magnetic charging (was wireless); 640×200 → 640×350 panel; ~25° → 27.5° FOV; ~1,000 → 1,200 nits. _[s76][s134][s71]_

## Internal BOM — 🟡 COMMUNITY / UNCONFIRMED (single source: openCFW)

> The entire chip-level BOM derives from **one** low-profile firmware-RE repo (`kalanihelekunihi/evenRealities-openCFW`), is **firmware-string-derived** (driver filenames, build paths, memory maps) — **not** a teardown, die photos, or schematics. No independent or first-party corroboration. Even's blog names only "a new processor" + "Bluetooth 5.4". Treat as unconfirmed.

- 🟡 **Main SoC:** Ambiq **Apollo510-class** (Cortex-M55). **SKU unresolved** — only binary string is `build_path_ap510` (no "b").
- 🟡 **BLE radio:** EM Micro **EM9305** (BT 5.4) over HCI/Cordio.
- 🟡 **Other:** **JBD** micro-LED panel (best-supported non-SoC item — stable `path_jbd_driver` string across all 5 firmware builds), TDK InvenSense **ICM-45608** IMU, TI **OPT3007** ALS, Cypress/Infineon **CY8C4046** touch, PDM MEMS mic, Nationalchip **GX8002B** codec, TI **BQ25180**/**BQ27427** + Nordic **nPM1300** power chain, Macronix **MX25U25643G** 32 MB QSPI NOR (LittleFS). Case MCU **STM32L0xx** (the one item openCFW explicitly rates "confirmed via RE"). _[s77][s143][s142][s161]_
- 🔴 **Red flags in the BOM:** (1) a discrete EM9305 is **redundant** with an Apollo510**B** (which has an *integrated* BLE 5.4 radio) — evidence actually points to a **plain Apollo510 + external EM9305**; (2) claimed "512 KB SRAM" matches only the Apollo510B's Data-TCM subset (Ambiq lists 3.75 MB); (3) Macronix flash + GX8002 model are inferred, not string-confirmed. _[s162][s150][s161][s164]_
- ❌ **Disproven misread:** the G2 main SoC is **not** a Nordic nRF52840 — that part (with SoftDevice S140) belongs to the **R1 ring's** auxiliary DFU path, not the G2 runtime. _[s142][s77]_

## FCC filings

- ✅ Grantee **2BFKR** (Even Realities Ltd., Shenzhen): G2 = **2BFKR-G2** (filed 2025-11-23), ring = **2BFKR-R1/R01**, charger 2BFKR-R1C, G1 = 2BFKR-G1. G2 radio: 2402–2480 MHz @ ~0.000724 W (single BLE radio); R1 is composite **BLE + 13.56 MHz NFC**. _[s156][s153][s157]_
- ✅ **The chip-revealing exhibits are confidential:** G2/R1 Block Diagram, Schematics, Operational Description are metadata-only (R1 short-term confidentiality release **2026-07-20**). Public internal photos can't be OCR'd via available tooling. So FCC neither confirms nor refutes the BOM. _[s153][s157][s159]_
- ✅ **No independent teardown / X-ray / CT / de-lid** of the G2 or R1 exists (iFixit, YouTube, Reddit, HN) as of May 2026. _[s75][s165]_

## Limitations

- Entire internal BOM (G2 + R1) is single-source community RE, firmware-derived, with an internal architectural inconsistency (EM9305 vs Apollo510B integrated radio) and an SRAM-figure imprecision.
- Confidential FCC exhibits + no teardown mean no first-party chip-level confirmation is currently possible.
- Unpublished figures: G2/case/R1 battery mAh; R1 weight & dimensions.
- 🟡 Minor unresolved conflict: IP67 vs IP65 on different official G2 pages.

## Open questions

- True main SoC once FCC photos/diagrams become public (2026-07-20+) or a teardown lands: Apollo510 + external EM9305, or Apollo510B integrated? Is "510b" correct?
- Is the EM9305 a genuinely separate radio or the 510B's integrated-radio firmware?
- Exact R1 Nordic SoC part number?
- Can any second RE effort/teardown corroborate the peripheral BOM?
- Actual battery capacities (G2, case, R1)? IP67 vs IP65? R1 weight/dimensions?

## Change log

- 2026-05-30: created from initial multi-agent survey (run `wf_302a9f4e-3e2`). Headline specs verified across multiple sources; internal BOM flagged single-source with adversarial caveats; nRF52840 main-SoC misread corrected.
