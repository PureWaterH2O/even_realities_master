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
  toolEnd('Bash', 'b1', 'create the file', { command: 'touch /tmp/m31todo.txt', description: 'Create the file' }, { stdout: '', stderr: '', interrupted: false }),
  ...taskUpdate('u2', '1', 'completed'),
  ...taskUpdate('u3', '2', 'in_progress'),
  toolStart('Edit', 'e1'),
  toolEnd('Edit', 'e1', 'append a line', { file_path: '/tmp/m31todo.txt', old_string: 'placeholder', new_string: 'hello from m3.1' }, { ok: true }),
  ...taskUpdate('u4', '2', 'completed'),
  ...taskUpdate('u5', '3', 'in_progress'),
  toolStart('Read', 'r1'),
  toolEnd('Read', 'r1', 'read it back', { file_path: '/tmp/m31todo.txt' }, 'hello from m3.1'),
  ...taskUpdate('u6', '3', 'completed'),
  { type: 'text_delta', text: MARKDOWN_ANSWER },
  RESULT,
]

/** A tall transcript to exercise scrolling: 40 raw lines (kept open so they stay
 *  one-per-row; a `result` would collapse them into a single markdown paragraph). */
export const tall: CoLiveEvent[] = [
  { type: 'user_prompt', text: 'Count to forty, one number per line.' },
  { type: 'status', state: 'busy' },
  { type: 'text_delta', text: Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n') },
]
