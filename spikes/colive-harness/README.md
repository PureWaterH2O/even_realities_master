# colive-harness (M0 spike)

Confirms the core Co-Live Terminal assumption against the stock `even-terminal` bridge:
**two clients on one session co-live without collision.**

## What it proves
- Two independent SSE clients subscribed to the same `sessionId` both receive **all** events.
- A prompt from a *second* client lands on the **same** session (serialized via the bridge).
- Only **one** transcript id is created (no fork) — verified by checking `~/.claude/projects/`.

## Run
```bash
# 1) start a scratch bridge
mkdir -p /tmp/colive-spike && cd /tmp/colive-spike
PORT=3457 BRIDGE_TOKEN=spiketoken123 PROJECT_DIR=/tmp/colive-spike VERBOSE=1 \
  even-terminal > /tmp/colive-spike/bridge.log 2>&1 &

# 2) run the harness
cd <repo>/spikes/colive-harness
BRIDGE=http://127.0.0.1:3457 TOKEN=spiketoken123 node colive.mjs
```
Expected: both clients show `result`, frame counts > 0, and a single transcript id at
`~/.claude/projects/-tmp-colive-spike/<sessionId>.jsonl`.

> Issues two trivial (billed) Claude turns (~cents). Uses a scratch cwd so it never
> touches the real repo's sessions.
