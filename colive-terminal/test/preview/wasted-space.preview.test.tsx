/**
 * Wasted-space fix — short content is TOP-ANCHORED, matching native's inline
 * rendering: content + input chrome sit together at the top and the empty space
 * falls to the BOTTOM (below the input). Previously the chrome was pinned to the
 * very bottom of the screen, so short content left a large gap in the MIDDLE
 * (between the content and the separator).
 */
import { describe, expect, it } from 'vitest'
import { capture, emit, snap } from './replay'
import type { CoLiveEvent } from '../../src/core/events'

const splitLines = (plain: string): string[] => plain.split('\n')
const sepRowOf = (lines: string[]): number => lines.findIndex((l) => /─{10,}/.test(l))

describe('wasted-space — short content is top-anchored (gap at bottom, not middle)', () => {
  it('idle: the input chrome follows the banner immediately (no big mid-screen gap)', async () => {
    const frames = await capture([snap('idle')])
    const lines = splitLines(frames[0]!.plain)
    const featureRow = lines.findIndex((l) => l.includes('Feature of the week'))
    const sepRow = sepRowOf(lines)
    expect(featureRow).toBeGreaterThanOrEqual(0)
    expect(sepRow).toBeGreaterThan(featureRow)
    // Top-anchored: the separator (start of the chrome) sits right after the
    // banner, not ~15 rows below it. A bottom-pinned layout leaves a big gap here.
    expect(sepRow - featureRow).toBeLessThan(5)
  })

  it('short Q&A: the chrome follows the answer immediately', async () => {
    const shortQA: CoLiveEvent[] = [
      { type: 'user_prompt', text: 'Say hello.' },
      { type: 'text_delta', text: 'Hello! How can I help?' },
      {
        type: 'result',
        success: true,
        text: 'Hello! How can I help?',
        sessionId: 's-preview',
        costUsd: 0.001,
        provider: 'claude',
        turns: 1,
        durationMs: 1200,
        inputTokens: 10,
        outputTokens: 6,
      },
    ]
    const frames = await capture([...shortQA.map(emit), snap('short')])
    const lines = splitLines(frames[0]!.plain)
    const answerRow = lines.findIndex((l) => l.includes('Hello! How can I help?'))
    const sepRow = sepRowOf(lines)
    expect(answerRow).toBeGreaterThanOrEqual(0)
    expect(sepRow).toBeGreaterThan(answerRow)
    // The footer (✱ ...for Ns) sits between the answer and the separator; allow a
    // couple of rows for it, but nowhere near the ~15-row bottom-pinned gap.
    expect(sepRow - answerRow).toBeLessThan(5)
  })
})
