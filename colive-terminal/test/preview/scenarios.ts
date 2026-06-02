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
 *  so the live palette (open thinking, yellow ▶ active, dim ☐ pending) is visible,
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
