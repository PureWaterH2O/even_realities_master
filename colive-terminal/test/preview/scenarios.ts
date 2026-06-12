/**
 * Curated event scenarios that exercise every desk render path. Hand-authored
 * here; real recorded sessions can be dropped in later as JSONL and replayed the
 * same way. Each scenario is a flat list of CoLiveEvents in stream order.
 */
import type { CoLiveEvent } from '../../src/core/events'

const toolStart = (name: string, toolId: string): CoLiveEvent => ({ type: 'tool_start', name, toolId })
const toolEnd = (
  name: string,
  toolId: string,
  summary: string,
  input: unknown,
  output: unknown,
): CoLiveEvent => ({ type: 'tool_end', name, toolId, summary, detail: { input, output } })

const taskCreate = (toolId: string, subject: string, id: string): CoLiveEvent[] => [
  toolStart('TaskCreate', toolId),
  toolEnd('TaskCreate', toolId, '', { subject }, { id }),
]
const taskUpdate = (toolId: string, taskId: string, status: string): CoLiveEvent[] => [
  toolStart('TaskUpdate', toolId),
  toolEnd('TaskUpdate', toolId, '', { taskId, status }, {}),
]

const MARKDOWN_ANSWER = [
  '## Task complete',
  '',
  '**All three steps** finished. Quick summary:',
  '',
  '- Created `/tmp/m31todo.txt`',
  '- Appended one line',
  '- Read it back and confirmed',
  '',
  '| Step | Action  | Status |',
  '|------|---------|--------|',
  '| 1    | create  | done   |',
  '| 2    | append  | done   |',
  '| 3    | confirm | done   |',
  '',
  '```ts',
  'function summarize(lines: string[]): string {',
  '  return lines.filter((l) => l.trim().length > 0).join("\\n")',
  '}',
  '```',
].join('\n')

const RESULT: CoLiveEvent = {
  type: 'result',
  success: true,
  text: MARKDOWN_ANSWER,
  sessionId: 's-preview',
  costUsd: 0.01,
  provider: 'claude',
  turns: 1,
  durationMs: 4200,
  inputTokens: 1960,
  outputTokens: 506,
}

// A realistic turn ends with a running_stats (so the status line shows tokens)
// and the Core's terminal `status: idle` — emitted right after `result`, so the
// desk returns to "[idle · N tokens]" exactly as it does on real hardware.
const STATS: CoLiveEvent = { type: 'running_stats', durationMs: 4200, inputTokens: 1960, outputTokens: 506 }
const IDLE: CoLiveEvent = { type: 'status', state: 'idle' }
/** The tail every completed turn shares: stats heartbeat → result → idle. */
const endTurn = (text: string): CoLiveEvent[] => [STATS, { ...RESULT, text }, IDLE]

/** Full cockpit run: thinking → tasks → tools (with a diff) → markdown answer. */
export const cockpit: CoLiveEvent[] = [
  { type: 'user_prompt', text: 'Plan and run a 3-step task with your todo list, then summarize in markdown.' },
  { type: 'status', state: 'busy' },
  { type: 'thinking_delta', text: 'Let me plan this out. I will create three tasks, then ' },
  { type: 'thinking_delta', text: 'work through them one at a time, marking each in-progress then done.' },
  { type: 'text_delta', text: "I'll create three tasks, then work through them one at a time." },
  ...taskCreate('c1', 'Create /tmp/m31todo.txt', '1'),
  ...taskCreate('c2', 'Append a line to /tmp/m31todo.txt', '2'),
  ...taskCreate('c3', 'Read back and confirm contents', '3'),
  ...taskUpdate('u1', '1', 'in_progress'),
  toolStart('Bash', 'b1'),
  toolEnd('Bash', 'b1', 'Bash completed', { command: 'touch /tmp/m31todo.txt', description: 'Create the file' }, { stdout: '', stderr: '', interrupted: false }),
  ...taskUpdate('u2', '1', 'completed'),
  ...taskUpdate('u3', '2', 'in_progress'),
  toolStart('Edit', 'e1'),
  toolEnd('Edit', 'e1', 'Edit completed', { file_path: '/tmp/m31todo.txt', old_string: 'placeholder', new_string: 'hello from m3.1' }, { ok: true }),
  ...taskUpdate('u4', '2', 'completed'),
  ...taskUpdate('u5', '3', 'in_progress'),
  toolStart('Read', 'r1'),
  toolEnd('Read', 'r1', 'Read completed', { file_path: '/tmp/m31todo.txt' }, 'hello from m3.1'),
  ...taskUpdate('u6', '3', 'completed'),
  { type: 'text_delta', text: MARKDOWN_ANSWER },
  ...endTurn(MARKDOWN_ANSWER),
]

const MARKDOWN_DOC = [
  '## Heading two',
  '',
  'A paragraph with **bold**, *italic*, and `inline code` plus a [link](https://x).',
  '',
  '### Heading three',
  '',
  '- First bullet',
  '- Second bullet with a bit more text that should wrap cleanly at the edge',
  '  - Nested bullet one',
  '  - Nested bullet two',
  '- Third bullet',
  '',
  '1. First step',
  '2. Second step',
  '3. Third step',
  '',
  '> A blockquote line, for emphasis.',
  '',
  '| Lang | Speed | Notes |',
  '|------|-------|-------|',
  '| Rust | fast  | safe  |',
  '| Go   | fast  | simple|',
  '',
  '```ts',
  'export const add = (a: number, b: number): number => a + b',
  '```',
].join('\n')

/** Markdown-only answer to iterate on rendering of every block type. */
export const markdownDoc: CoLiveEvent[] = [
  { type: 'user_prompt', text: 'Show me every markdown element rendered.' },
  { type: 'text_delta', text: MARKDOWN_DOC },
  ...endTurn(MARKDOWN_DOC),
]

/** Mid-stream snapshot: thinking still open, one task in-progress, one pending —
 *  so the live palette (open thinking, orange ■ active, □ pending) is visible,
 *  not just the all-completed end state. */
export const inProgress: CoLiveEvent[] = [
  { type: 'user_prompt', text: 'Refactor the parser and add tests.' },
  { type: 'status', state: 'busy' },
  ...taskCreate('c1', 'Refactor the tokenizer', '1'),
  ...taskCreate('c2', 'Add parser tests', '2'),
  ...taskCreate('c3', 'Update the changelog', '3'),
  ...taskUpdate('u1', '1', 'completed'),
  ...taskUpdate('u2', '2', 'in_progress'),
  toolStart('Edit', 'e1'),
  toolEnd('Edit', 'e1', 'Edit completed', { file_path: 'src/parser/tokenizer.ts', old_string: 'const x = 1', new_string: 'const x = 2' }, { ok: true }),
  { type: 'thinking_delta', text: 'Now I should add a test that covers the new token type ' },
  { type: 'thinking_delta', text: 'and a regression for the empty-input edge case.' },
]

/** A2 — a multi-line Edit so the inline +/- diff is substantial. */
export const diffEdit: CoLiveEvent[] = [
  { type: 'user_prompt', text: 'Make the greeting take a name.' },
  toolStart('Edit', 'e1'),
  toolEnd(
    'Edit',
    'e1',
    'Edit completed',
    {
      file_path: 'src/greet.ts',
      old_string: 'export function greet() {\n  return "hello"\n}',
      new_string: 'export function greet(name: string) {\n  return `hello, ${name}`\n}',
    },
    { ok: true },
  ),
]

/** A6 — thinking streams, then an answer (thinking collapses), then result. */
export const thinking: CoLiveEvent[] = [
  { type: 'user_prompt', text: 'Solve the 12-ball balance puzzle; show your reasoning first.' },
  { type: 'status', state: 'busy' },
  { type: 'thinking_delta', text: 'Split the 12 balls into three groups of four. ' },
  { type: 'thinking_delta', text: 'Weigh group A against group B.\nIf they balance, the odd ball is in C; otherwise it is on the heavier/lighter pan.\nEach weighing trisects the remaining candidates, so 3 weighings cover 12.' },
  { type: 'text_delta', text: '## Strategy\n\nWeigh **4 vs 4**, then narrow to the odd ball — and whether it is heavy or light — within **3 weighings**.' },
  ...endTurn('## Strategy\n\nWeigh **4 vs 4**, then narrow to the odd ball — and whether it is heavy or light — within **3 weighings**.'),
]

/** A tall transcript to exercise scrolling: 40 raw lines (kept open so they stay
 *  one-per-row; a `result` would collapse them into a single markdown paragraph). */
export const tall: CoLiveEvent[] = [
  { type: 'user_prompt', text: 'Count to forty, one number per line.' },
  { type: 'status', state: 'busy' },
  { type: 'text_delta', text: Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n') },
]

/* ------------------------------------------------------------------ */
/* M3.5 aesthetic-pass scenarios                                       */
/* One event sequence per reference scenario that isn't already        */
/* covered by the cockpit/markdownDoc/inProgress/tall/thinking/diffEdit */
/* set above. The keystroke-driven reference states (slash menu,       */
/* pickers, interrupt) need no event array — the aesthetic preview     */
/* test drives those with capture()/key() directly.                    */
/* ------------------------------------------------------------------ */

/** 01 — Idle: no events at all — just the app chrome (prompt + status line). */
export const idle: CoLiveEvent[] = []

/** 02 — Simple Q&A: one user prompt + one short assistant response. */
export const simpleQA: CoLiveEvent[] = [
  { type: 'user_prompt', text: 'Say hello' },
  { type: 'status', state: 'busy' },
  { type: 'text_delta', text: 'Hello! What can I help you with today?' },
  ...endTurn('Hello! What can I help you with today?'),
]

/** 03 — Streaming: a text_delta in progress (no result yet — still streaming). */
export const streaming: CoLiveEvent[] = [
  { type: 'user_prompt', text: 'Count from 1 to 20' },
  { type: 'status', state: 'busy' },
  { type: 'text_delta', text: '1\n2\n3\n4\n5\n6\n7\n8\n9\n10' },
]

/**
 * 03b — Streaming CLOSED: the same line-per-line response after the turn completes.
 * D-030 regression guard — once closed, markdown rendering must keep one number per
 * line (breaks:true) instead of collapsing them into a single paragraph.
 */
export const streamingClosed: CoLiveEvent[] = [
  { type: 'user_prompt', text: 'Count from 1 to 10' },
  { type: 'status', state: 'busy' },
  { type: 'text_delta', text: '1\n2\n3\n4\n5\n6\n7\n8\n9\n10' },
  ...endTurn('1\n2\n3\n4\n5\n6\n7\n8\n9\n10'),
]

/** 05 — Tool Read: a completed Read tool call. */
export const toolRead: CoLiveEvent[] = [
  { type: 'user_prompt', text: 'Read the file CLAUDE.md' },
  { type: 'status', state: 'busy' },
  toolStart('Read', 'r1'),
  toolEnd('Read', 'r1', 'Read completed', { file_path: 'CLAUDE.md' }, '# CLAUDE.md\n\nProject instructions...'),
  { type: 'text_delta', text: "I've read the file. Here's what it contains..." },
  ...endTurn("I've read the file. Here's what it contains..."),
]

/** 06 — Tool Bash: a completed Bash tool call with output. */
export const toolBash: CoLiveEvent[] = [
  { type: 'user_prompt', text: 'Run ls -la in the current directory' },
  { type: 'status', state: 'busy' },
  toolStart('Bash', 'b1'),
  toolEnd('Bash', 'b1', 'Bash completed', { command: 'ls -la', description: 'List files' }, { stdout: 'total 32\ndrwxr-xr-x  5 user  staff  160 Jun  6 12:00 .\n-rw-r--r--  1 user  staff  245 Jun  6 11:00 CLAUDE.md\n-rw-r--r--  1 user  staff  1024 Jun  6 10:00 package.json', stderr: '', interrupted: false }),
  { type: 'text_delta', text: 'Here are the files in the current directory.' },
  ...endTurn('Here are the files in the current directory.'),
]

/** 09 — Permission prompt: a tool requiring permission (rendered as inline prompt). */
export const permission: CoLiveEvent[] = [
  { type: 'user_prompt', text: 'Delete the file /tmp/m35-test.txt' },
  { type: 'status', state: 'busy' },
  { type: 'text_delta', text: "I'll delete that file for you." },
  toolStart('Bash', 'b1'),
  {
    // Matches the real broker (src/core/permissions.ts): detail = the command
    // string (DETAIL_KEYS cascade), description = the human summary, options =
    // Yes / allowAlways-from-suggestion / No (D-033, mirroring the native ref
    // 09-permission.png which shows the 3-option prompt).
    type: 'permission_request',
    toolName: 'Bash',
    toolUseId: 'b1',
    description: 'Delete the test file',
    detail: 'rm /tmp/m35-test.txt',
    options: [
      { key: 'allow', text: 'Yes' },
      { key: 'allowAlways', text: 'Yes, and always allow access to tmp/ from this project' },
      { key: 'deny', text: 'No' },
    ],
    suggestions: [
      { type: 'addDirectories', directories: ['tmp/'], destination: 'projectSettings' },
    ],
  } as CoLiveEvent,
]

/** 13 — Error diagnostic: a failed tool result. */
export const errorDiag: CoLiveEvent[] = [
  { type: 'user_prompt', text: 'Read /tmp/no-such-file-12345.txt' },
  { type: 'status', state: 'busy' },
  toolStart('Read', 'r1'),
  toolEnd('Read', 'r1', 'Read failed', { file_path: '/tmp/no-such-file-12345.txt' }, { error: 'ENOENT: no such file or directory' }),
  { type: 'text_delta', text: "The file doesn't exist." },
  ...endTurn("The file doesn't exist."),
]

/** 14 — Status line while busy: running_stats mid-turn (no result yet). */
export const statusBusy: CoLiveEvent[] = [
  { type: 'user_prompt', text: 'Explain the theory of relativity in detail' },
  { type: 'status', state: 'busy' },
  { type: 'thinking_delta', text: 'Let me organize my thoughts about relativity...' },
  { type: 'running_stats', durationMs: 3200, inputTokens: 850, outputTokens: 120 },
  { type: 'text_delta', text: "## Special Relativity\n\nEinstein's theory of special relativity..." },
]

/** 16 — Question prompt: Claude asks the user a question with multiple-choice options. */
export const question: CoLiveEvent[] = [
  { type: 'user_prompt', text: 'Ask me about my preferences' },
  { type: 'status', state: 'busy' },
  { type: 'text_delta', text: "I'd like to understand your preferences better." },
  toolStart('AskUserQuestion', 'q1'),
  {
    type: 'user_question',
    question: 'Which programming language do you prefer?',
    toolUseId: 'q1',
    options: ['TypeScript', 'Python', 'Rust'],
  } as CoLiveEvent,
]

/** 17 — Background Bash: a tool_start with no tool_end yet (still running). */
export const backgroundCmd: CoLiveEvent[] = [
  { type: 'user_prompt', text: 'Run sleep 5 && echo done in the background' },
  { type: 'status', state: 'busy' },
  { type: 'text_delta', text: "I'll run that command in the background." },
  toolStart('Bash', 'bg1'),
]

/** 18 — Subagent: an Agent tool invocation. */
export const subagent: CoLiveEvent[] = [
  { type: 'user_prompt', text: 'Spawn a subagent to answer: what is 2+2?' },
  { type: 'status', state: 'busy' },
  toolStart('Agent', 'a1'),
  toolEnd('Agent', 'a1', 'Agent completed', { prompt: 'What is 2+2?', description: 'Math question' }, { result: '4' }),
  { type: 'text_delta', text: 'The subagent reports: 2+2 = 4.' },
  ...endTurn('The subagent reports: 2+2 = 4.'),
]

/** 20 — Cost summary: a completed turn with cost/token data visible. */
export const costSummary: CoLiveEvent[] = [
  { type: 'user_prompt', text: 'Summarize this project' },
  { type: 'status', state: 'busy' },
  { type: 'text_delta', text: 'This project builds a Co-Live Terminal for Even Realities G2 smart glasses.' },
  {
    type: 'result',
    success: true,
    text: 'This project builds a Co-Live Terminal for Even Realities G2 smart glasses.',
    sessionId: 's-preview',
    costUsd: 0.0342,
    provider: 'claude',
    turns: 5,
    durationMs: 8700,
    inputTokens: 12480,
    outputTokens: 2106,
  } as CoLiveEvent,
  { type: 'running_stats', durationMs: 8700, inputTokens: 12480, outputTokens: 2106 },
  { type: 'status', state: 'idle' },
]
