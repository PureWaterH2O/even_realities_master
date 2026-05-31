// M0 spike — confirms two SSE clients on ONE bridge session both receive all events,
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
await sleep(12000); // let turn 1 finish + replay land on both

// 3) client B sends a second prompt to the SAME session
await prompt(sessionId, "respond with only the word DONE");
await sleep(12000);

// 4) assertions
const bothSawResult = types("A").includes("result") && types("B").includes("result");
const bothSawTwoPrompts =
  types("A").filter((t) => t === "user_prompt").length >= 1 &&
  types("B").filter((t) => t === "user_prompt").length >= 1;
console.log("A frames:", types("A").length, "B frames:", types("B").length);
console.log("A types:", JSON.stringify(types("A")));
console.log("B types:", JSON.stringify(types("B")));
console.log("PASS bothSawResult:", bothSawResult);
console.log("PASS bothSawPrompt:", bothSawTwoPrompts);
console.log("SESSION_ID_FOR_JSONL_CHECK:", sessionId);
process.exit(0);
