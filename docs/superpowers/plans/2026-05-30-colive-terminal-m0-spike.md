# Co-Live Terminal — M0 De-Risking Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settle the four unknowns that gate the Co-Live Terminal build — so the M1 plan is grounded in evidence, not guesses.

**Architecture:** This is the M0 phase of `docs/superpowers/specs/2026-05-30-colive-terminal-design.md`. It is *investigative* (decisions + recorded 🧪 findings) plus one small reusable artifact: a two-client co-live test harness. No production code ships here. Every finding lands in `research/2026-05-30-colive-m0-spike/` and promotes/corrects `knowledge/terminal-mode/`.

**Tech Stack:** Node 25 (global `fetch`, native SSE-over-fetch reading), the genuine `@evenrealities/even-terminal@0.7.9` already installed at `/opt/homebrew/lib/node_modules/@evenrealities/even-terminal`, real G2 + R1 + Even app for hardware-in-the-loop tests, `gh`/`npm` for source investigation.

**Outputs (definition of done for M0):**
- `research/2026-05-30-colive-m0-spike/findings.md` — all four results, cited, confidence-tagged.
- `research/2026-05-30-colive-m0-spike/parity-inventory.md` — seeded native-feature inventory with the "Blocked" bucket populated.
- `spikes/colive-harness/` — the reusable two-client co-live harness.
- A **go/no-go + any M1 architecture adjustments** appended to the spec's change log.

---

## Conventions for this plan

- A throwaway project dir is used for any test that issues real (billed) Claude turns, so we never touch the live repo session. Prompts are trivial (`respond with only the word OK`) to keep cost ~cents.
- Bridge launch (reused across tasks), **run from a scratch cwd**, fixed token, verbose:
  ```bash
  mkdir -p /tmp/colive-spike && cd /tmp/colive-spike
  PORT=3457 BRIDGE_TOKEN=spiketoken123 PROJECT_DIR=/tmp/colive-spike VERBOSE=1 \
    even-terminal > /tmp/colive-spike/bridge.log 2>&1 &
  ```
  (Port **3457** to avoid colliding with anything; stop with `lsof -ti tcp:3457 | xargs kill`.)
- "Record" = append a dated, confidence-tagged entry to `research/2026-05-30-colive-m0-spike/findings.md`.

---

## Task 1: Source availability & fork strategy

**Files:**
- Create: `research/2026-05-30-colive-m0-spike/findings.md`

- [ ] **Step 1: Query npm metadata for the repo + license**

Run:
```bash
npm view @evenrealities/even-terminal repository.url homepage license version
```
Expected: prints a repository URL (or nothing), homepage, license, and `0.7.9`.

- [ ] **Step 2: Check whether the source repo is public + forkable**

Run (substitute the repo slug from Step 1 if present; also probe the likely org):
```bash
gh repo view evenrealities/even-terminal 2>&1 | head -20 || echo "not found under that slug"
gh search repos even-terminal --owner evenrealities 2>&1 | head
```
Expected: either a public repo (→ fork it) or "not found" (→ work from the shipped build).

- [ ] **Step 3: Inspect the shipped build for fork-from-dist viability**

Run:
```bash
PKG=/opt/homebrew/lib/node_modules/@evenrealities/even-terminal
ls "$PKG/dist" "$PKG"/dist/*.map 2>/dev/null
head -5 "$PKG/dist/index.js"
grep -c . "$PKG/dist/claude/session.js"
```
Expected: confirms `dist/` is readable compiled ESM (we already know it is), whether sourcemaps exist, and rough size.

- [ ] **Step 4: Record the decision**

Write to `findings.md` a "Source & fork strategy" section answering: public repo? license? → **decision**: (a) fork the repo, (b) maintain a patched copy of the shipped `dist` with our additions layered on, or (c) reimplement the thin server/session layer in our own TS using `@anthropic-ai/claude-agent-sdk` directly. Note the implication for M1 (a/b = fast; c = more work but fully owned).

- [ ] **Step 5: Commit**

```bash
cd /Users/thomasneal/Documents/random_claude_stuff/even_realities
git add research/2026-05-30-colive-m0-spike/findings.md
git commit -m "spike(m0): source availability + fork strategy decision"
```

---

## Task 2: Two-client co-live harness (buildable — confirms no collision)

**Files:**
- Create: `spikes/colive-harness/package.json`
- Create: `spikes/colive-harness/colive.mjs`
- Create: `spikes/colive-harness/README.md`

- [ ] **Step 1: Write the harness package.json**

Create `spikes/colive-harness/package.json`:
```json
{
  "name": "colive-harness",
  "private": true,
  "type": "module",
  "version": "0.0.0",
  "description": "M0 spike: confirm two clients on one bridge session co-live without collision"
}
```

- [ ] **Step 2: Write the harness script**

Create `spikes/colive-harness/colive.mjs`:
```javascript
// Confirms: two SSE clients on ONE bridge session both receive all events,
// prompts from either client serialize, and only ONE transcript id is created.
// Usage: BRIDGE=http://127.0.0.1:3457 TOKEN=spiketoken123 node colive.mjs
const BRIDGE = process.env.BRIDGE ?? "http://127.0.0.1:3457";
const TOKEN = process.env.TOKEN ?? "spiketoken123";
const q = (p) => `${BRIDGE}${p}${p.includes("?") ? "&" : "?"}token=${TOKEN}`;

const events = { A: [], B: [] };

async function subscribe(name, sessionId) {
  const res = await fetch(q(`/api/events?sessionId=${sessionId}&needReplay=true`), {
    headers: { Accept: "text/event-stream" },
  });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) !== -1) {
        const frame = buf.slice(0, i); buf = buf.slice(i + 2);
        const line = frame.split("\n").find((l) => l.startsWith("data:"));
        if (line) { try { events[name].push(JSON.parse(line.slice(5).trim())); } catch {} }
      }
    }
  })();
  return reader;
}

async function prompt(sessionId, text) {
  const res = await fetch(q(`/api/prompt`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, sessionId, provider: "claude" }),
  });
  return res.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const types = (name) => events[name].map((e) => e.type);

// 1) client A starts a session (no sessionId) with a trivial prompt
const first = await prompt(undefined, "respond with only the word OK");
const sessionId = first.sessionId;
console.log("session:", sessionId);

// 2) BOTH clients subscribe to that one session
await subscribe("A", sessionId);
await subscribe("B", sessionId);
await sleep(8000); // let turn 1 finish + replay land on both

// 3) client B sends a second prompt to the SAME session
await prompt(sessionId, "respond with only the word DONE");
await sleep(8000);

// 4) assertions
const bothSawResult = types("A").includes("result") && types("B").includes("result");
const bothSawTwoPrompts =
  types("A").filter((t) => t === "user_prompt").length >= 1 &&
  types("B").filter((t) => t === "user_prompt").length >= 1;
console.log("A frames:", types("A").length, "B frames:", types("B").length);
console.log("PASS bothSawResult:", bothSawResult);
console.log("PASS bothSawSecondPrompt(B-origin visible to A):", bothSawTwoPrompts);
console.log("SESSION_ID_FOR_JSONL_CHECK:", sessionId);
process.exit(0);
```

- [ ] **Step 3: Start the bridge from a scratch cwd**

Run:
```bash
mkdir -p /tmp/colive-spike && cd /tmp/colive-spike
PORT=3457 BRIDGE_TOKEN=spiketoken123 PROJECT_DIR=/tmp/colive-spike VERBOSE=1 \
  even-terminal > /tmp/colive-spike/bridge.log 2>&1 &
sleep 4 && lsof -nP -iTCP:3457 -sTCP:LISTEN >/dev/null && echo "bridge up" || echo "bridge DOWN"
```
Expected: `bridge up`.

- [ ] **Step 4: Run the harness**

Run:
```bash
cd /Users/thomasneal/Documents/random_claude_stuff/even_realities/spikes/colive-harness
BRIDGE=http://127.0.0.1:3457 TOKEN=spiketoken123 node colive.mjs
```
Expected: prints a session id, frame counts > 0 for both A and B, and `PASS bothSawResult: true`. (If either is false → broadcast/serialization needs work; record it.)

- [ ] **Step 5: Confirm single transcript (no fork/collision)**

Run (use the printed `SESSION_ID_FOR_JSONL_CHECK`):
```bash
SID=<paste>; ls -1 "$HOME/.claude/projects/-tmp-colive-spike/${SID}.jsonl" && \
  echo "single transcript id confirmed" || echo "MISSING/forked"
ls -1 "$HOME/.claude/projects/-tmp-colive-spike/"*.jsonl | wc -l
```
Expected: the one file exists; total jsonl count for the scratch project equals the number of distinct sessions we started (1 if only this run) — i.e., **no fork** from the second client's prompt.

- [ ] **Step 6: Write README + record result**

Create `spikes/colive-harness/README.md` (how to run, what it proves), and append a "Co-live confirmation" 🧪 section to `findings.md` with the PASS/FAIL + frame counts + the single-transcript result.

- [ ] **Step 7: Commit**

```bash
cd /Users/thomasneal/Documents/random_claude_stuff/even_realities
git add spikes/colive-harness research/2026-05-30-colive-m0-spike/findings.md
git commit -m "spike(m0): two-client co-live harness + result"
```

---

## Task 3: iOS backgrounding / SSE longevity (hardware-in-the-loop, manual)

> This is a **manual** test — it needs the user's phone + glasses and cannot be automated. The agent prepares,
> instruments, and records; the user performs the physical steps.

**Files:**
- Modify: `research/2026-05-30-colive-m0-spike/findings.md`

- [ ] **Step 1: Bring up an observable bridge in the real repo cwd**

Run:
```bash
cd /Users/thomasneal/Documents/random_claude_stuff/even_realities
PORT=3456 BRIDGE_TOKEN=spiketoken123 VERBOSE=1 even-terminal > .remember/tmp/bridge.log 2>&1 &
sleep 4 && cat .remember/tmp/bridge.log | tail -5
```
Expected: banner + QR + LAN URL. (Relay the URL/QR to the user to connect the glasses.)

- [ ] **Step 2: Define + run the test protocol with the user**

Ask the user to: connect the glasses → start a bridge-driven session → **lock the phone and pocket it** → after ~60–120 s, the agent issues a follow-up that produces output (e.g., POST `/api/prompt` to that session). Record from `bridge.log`: did the SSE client stay connected (no `[sse] Client disconnected`)? Did `:heartbeat` keep flowing? Ask the user: did the HUD update on glance after the pocket period, or was it frozen/disconnected?

- [ ] **Step 3: Test the reconnect path**

Have the user unlock/foreground the Even app; check `bridge.log` for a fresh `[sse] Client connected` + whether `needReplay=true` replays missed frames. Record whether re-foregrounding cleanly catches up.

- [ ] **Step 4: Record result + posture**

Append an "iOS backgrounding" 🧪 section: connected-while-locked? / heartbeat survival / reconnect-and-replay behavior. State the **posture for M1**: (a) live-while-pocketed works → full run scenario supported; (b) suspends but reconnects+replays on glance → "glance-to-wake" UX; (c) worse → note and flag a follow-up investigation (notification paths). Stop the bridge: `lsof -ti tcp:3456 | xargs kill`.

- [ ] **Step 5: Commit**

```bash
git add research/2026-05-30-colive-m0-spike/findings.md
git commit -m "spike(m0): iOS backgrounding / SSE longevity result"
```

---

## Task 4: Parity-blocker hunt (seed the inventory)

**Files:**
- Create: `research/2026-05-30-colive-m0-spike/parity-inventory.md`

- [ ] **Step 1: Enumerate native Claude Code TUI features**

Run (capture the ground-truth feature surface this machine's `claude` exposes):
```bash
claude --version
ls "$HOME/.claude/projects/-tmp-colive-spike/"*.jsonl >/dev/null 2>&1
grep -o '"slash_commands":\[[^]]*\]' /tmp/colive-spike/bridge.log | head -1
grep -o '"skills":\[[^]]*\]' /tmp/colive-spike/bridge.log | head -1
```
Expected: the slash-command + skills lists captured during Task 2's bridge run (these are the SDK-reachable capabilities). If empty, re-run a trivial prompt through the bridge and re-grep the `init` line.

- [ ] **Step 2: Build the inventory table**

Create `research/2026-05-30-colive-m0-spike/parity-inventory.md` with a row per native feature, each classified **Reuse / Rebuild / Blocked**. Seed it from the spec's §6 table and the captured `slash_commands`/`skills`/`agents`/`plugins`/`mcp_servers` lists. Cover at minimum: streaming output rendering, tool-call rendering, permission prompts, AskUserQuestion, slash commands, `@`-file mentions, plan mode (`ExitPlanMode`), auto-accept/permission modes, TodoWrite/task progress, subagents, MCP, image paste, `/compact`, `/clear`, history/resume, interrupt (Esc), vim mode, status line.

- [ ] **Step 3: Probe the uncertain ones for SDK-reachability**

For each feature you marked "Blocked?" (uncertain), test reachability through the bridge with a trivial prompt that should trigger it (e.g., send `"/compact"` as prompt text; send a prompt that asks a question to confirm `user_question` fires; send a prompt referencing `@somefile`). Record for each: reachable via the prompt stream? UI-only? needs reimplementation? Move it to a definite bucket.

- [ ] **Step 4: Record the blocker list**

In `parity-inventory.md`, finalize the **Blocked** bucket (features genuinely not SDK-reachable) with a one-line mitigation each (workaround / reimplement / documented gap). This is the input to M3.

- [ ] **Step 5: Commit**

```bash
git add research/2026-05-30-colive-m0-spike/parity-inventory.md
git commit -m "spike(m0): seed desk-client parity inventory + blocker list"
```

---

## Task 5: Synthesize M0 → go/no-go + M1 adjustments

**Files:**
- Modify: `research/2026-05-30-colive-m0-spike/findings.md`
- Modify: `docs/superpowers/specs/2026-05-30-colive-terminal-design.md` (change log only)
- Modify: `knowledge/terminal-mode/overview.md` and/or `knowledge/limitations.md` (promote/correct as warranted)
- Modify: `PROGRESS.md`

- [ ] **Step 1: Write the synthesis**

Append a "M0 synthesis" section to `findings.md`: the four results, the **go/no-go**, and any **architecture adjustments** for M1 (e.g., fork strategy from Task 1; whether streaming-input mode is needed sooner; the backgrounding posture; the desk-client parity blockers to design around).

- [ ] **Step 2: Distill into the knowledge base**

Promote any newly-proven 🧪 facts into `knowledge/terminal-mode/overview.md` and update `knowledge/limitations.md`. Add the spec change-log entry pointing to the M0 results.

- [ ] **Step 3: Update PROGRESS + clean up**

Append a dated PROGRESS bullet summarizing M0. Stop any running bridge (`lsof -ti tcp:3456,3457 | xargs kill 2>/dev/null`) and remove the scratch project if desired (`rm -rf /tmp/colive-spike`; its `~/.claude/projects/-tmp-colive-spike` transcripts are disposable).

- [ ] **Step 4: Commit**

```bash
git add -A research/ knowledge/ docs/ PROGRESS.md
git commit -m "spike(m0): synthesis, go/no-go, and KB distillation"
git push origin main
```

- [ ] **Step 5: Hand back for the M1 plan**

State the go/no-go and, if go, that the next step is writing the **M1 implementation plan** (the forked single-owner bridge + thin desk client + the end-to-end loop), informed by these results — plus a likely **desk-client sub-spec** for the full-parity work (M3).

---

## Self-review

- **Spec coverage (M0 only):** Task 1 ↔ spec §8.1 (source availability); Task 2 ↔ §8.2 (co-live confirmation); Task 3 ↔ §8.3 (iOS backgrounding); Task 4 ↔ §8.4 (parity-blocker hunt); Task 5 ↔ §7 M0 exit (go/no-go + M1 inputs). No M0 requirement left unmapped. (M1–M4 are intentionally out of scope for this plan.)
- **Placeholders:** none — every step has exact commands/paths/code; the only `<paste>` is an explicit runtime value (a captured session id) with instructions.
- **Type consistency:** harness uses one event shape (`{type,...}`) and one `sessionId` throughout; bridge env vars (`PORT`/`BRIDGE_TOKEN`/`PROJECT_DIR`/`VERBOSE`) match the verified `dist/index.js` names.
