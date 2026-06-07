/**
 * D-035 — the todos/tasks panel is PINNED outside the scrollable transcript.
 *
 * Native keeps the task list as a persistent widget near the foot of the
 * transcript area; ours used to render it as the last transcript block, so it
 * scrolled away with the content. The distinguishing behaviour: after scrolling
 * the transcript to the very top, the todos panel must STILL be visible — proof
 * it lives outside the viewport, not at the tail of it.
 */
import { describe, expect, it } from 'vitest'
import { capture, emit, snap, key, KEYS } from './replay'
import type { CoLiveEvent } from '../../src/core/events'

const toolStart = (name: string, toolId: string): CoLiveEvent => ({ type: 'tool_start', name, toolId })
const toolEnd = (name: string, toolId: string, input: unknown, output: unknown): CoLiveEvent => ({
  type: 'tool_end',
  name,
  toolId,
  summary: '',
  detail: { input, output },
})
const taskCreate = (toolId: string, subject: string, id: string): CoLiveEvent[] => [
  toolStart('TaskCreate', toolId),
  toolEnd('TaskCreate', toolId, { subject }, { id }),
]

// A transcript tall enough to overflow the viewport (zero-padded labels so no
// line is a prefix of another), plus a todos panel with two recognizable tasks.
const events: CoLiveEvent[] = [
  { type: 'user_prompt', text: 'Do a big refactor.' },
  { type: 'text_delta', text: Array.from({ length: 40 }, (_, i) => `transcript line ${String(i + 1).padStart(2, '0')}`).join('\n') },
  ...taskCreate('c1', 'Refactor the tokenizer', '1'),
  ...taskCreate('c2', 'Add parser tests', '2'),
]

describe('D-035 — todos panel is pinned outside the scrollable viewport', () => {
  it('stays visible after the transcript is scrolled to the top', async () => {
    const frames = await capture([
      ...events.map(emit),
      snap('bottom'),
      key(KEYS.pageUp), key(KEYS.pageUp), key(KEYS.pageUp), key(KEYS.pageUp), key(KEYS.pageUp),
      snap('scrolled-up'),
    ])
    const bottom = frames[0]!.plain
    const scrolledUp = frames[1]!.plain

    // Pinned to the bottom initially, alongside the tail of the transcript.
    expect(bottom).toContain('transcript line 40')
    expect(bottom).toContain('Refactor the tokenizer')

    // After paging up, the TOP of the transcript is in view (we really scrolled),
    // the tail is gone — but the todos panel is STILL visible: it is pinned
    // OUTSIDE the scrollable viewport, not the last block of the transcript.
    expect(scrolledUp).toContain('transcript line 01')
    expect(scrolledUp).not.toContain('transcript line 40')
    expect(scrolledUp).toContain('Refactor the tokenizer')
    expect(scrolledUp).toContain('Add parser tests')
  })
})
