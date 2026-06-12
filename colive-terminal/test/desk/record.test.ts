import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { recordingClient, fileEventSink, loadEvents } from '../../src/desk/record'
import type { HubClient, SubscriptionHandle } from '../../src/desk/client'
import type { CoLiveEvent } from '../../src/core/events'

/** Minimal fake HubClient that lets the test push events to the subscriber. */
function fakeClient(): HubClient & { emit(e: CoLiveEvent): void; lastInterrupt?: string } {
  let onEvent: ((e: CoLiveEvent) => void) | undefined
  const c: HubClient & { emit(e: CoLiveEvent): void; lastInterrupt?: string } = {
    emit(e) { onEvent?.(e) },
    subscribe(_sid, cb) {
      onEvent = cb
      const h = (() => {}) as SubscriptionHandle & (() => void)
      h.close = h
      return h
    },
    async sendPrompt(a) { return { sessionId: a.sessionId } },
    async respondPermission() {},
    async respondQuestion() {},
    async interrupt(sid) { c.lastInterrupt = sid },
    async fetchTranscript() { return [] },
    async setControl() {},
    async getInfo() { return { model: 'claude-opus-4-8' } },
    async fetchModels() { return [] },
  }
  return c
}

const tmp: string[] = []
afterEach(() => { for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true }) })
function tmpFile(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'colive-rec-'))
  tmp.push(dir)
  return join(dir, name)
}

describe('recordingClient', () => {
  it('tees every received event to the sink AND forwards it to the subscriber', () => {
    const base = fakeClient()
    const recorded: CoLiveEvent[] = []
    const seen: CoLiveEvent[] = []
    const client = recordingClient(base, (e) => recorded.push(e))
    client.subscribe('s1', (e) => seen.push(e))

    base.emit({ type: 'text_delta', text: 'hi' })
    base.emit({ type: 'result', success: true, text: 'hi', sessionId: 's1', costUsd: 0, provider: 'claude', turns: 1, durationMs: 1, inputTokens: 1, outputTokens: 1 })

    expect(recorded).toHaveLength(2)
    expect(seen).toEqual(recorded) // subscriber still sees exactly the same stream
  })

  it('a throwing sink never breaks the subscriber (recording is best-effort)', () => {
    const base = fakeClient()
    const seen: CoLiveEvent[] = []
    const client = recordingClient(base, () => { throw new Error('disk full') })
    client.subscribe('s1', (e) => seen.push(e))
    expect(() => base.emit({ type: 'text_delta', text: 'x' })).not.toThrow()
    expect(seen).toHaveLength(1)
  })

  it('passes other methods through to the wrapped client', async () => {
    const base = fakeClient()
    const client = recordingClient(base, () => {})
    await client.interrupt('s9')
    expect(base.lastInterrupt).toBe('s9')
  })
})

describe('fileEventSink + loadEvents roundtrip', () => {
  it('writes JSONL that loads back to the same events', () => {
    const path = tmpFile('rec.jsonl')
    const sink = fileEventSink(path)
    const events: CoLiveEvent[] = [
      { type: 'user_prompt', text: 'hello' },
      { type: 'tool_start', name: 'Read', toolId: 't1' },
      { type: 'tool_end', name: 'Read', toolId: 't1', summary: 'Read completed', detail: { input: { file_path: '/a' }, output: 'x' } },
    ]
    events.forEach(sink)
    expect(readFileSync(path, 'utf8').trimEnd().split('\n')).toHaveLength(3)
    expect(loadEvents(path)).toEqual(events)
  })

  it('loadEvents ignores blank lines', () => {
    const path = tmpFile('rec.jsonl')
    fileEventSink(path)({ type: 'text_delta', text: 'a' })
    // a trailing blank line (e.g. from an interrupted session) must not throw
    fileEventSink(path)
    expect(loadEvents(path)).toEqual([{ type: 'text_delta', text: 'a' }])
  })
})
