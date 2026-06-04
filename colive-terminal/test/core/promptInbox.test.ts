import { describe, it, expect } from 'vitest'
import { PromptInbox, textUserMessage } from '../../src/core/promptInbox'

async function take<T>(it: AsyncIterator<T>): Promise<IteratorResult<T>> {
  return it.next()
}

describe('textUserMessage', () => {
  it('builds the SDK text user-message shape', () => {
    expect(textUserMessage('hi')).toEqual({
      type: 'user',
      message: { role: 'user', content: 'hi' },
      parent_tool_use_id: null,
    })
  })
})

describe('PromptInbox', () => {
  it('push-before-next: a buffered message is delivered on next()', async () => {
    const box = new PromptInbox()
    box.push(textUserMessage('a'))
    const it = box[Symbol.asyncIterator]()
    const r = await take(it)
    expect(r.done).toBe(false)
    expect((r.value as any).message.content).toBe('a')
  })

  it('next-before-push: next() awaits, then resolves when push arrives', async () => {
    const box = new PromptInbox()
    const it = box[Symbol.asyncIterator]()
    const pending = take(it)
    box.push(textUserMessage('b'))
    const r = await pending
    expect((r.value as any).message.content).toBe('b')
  })

  it('preserves FIFO order', async () => {
    const box = new PromptInbox()
    box.push(textUserMessage('1'))
    box.push(textUserMessage('2'))
    const it = box[Symbol.asyncIterator]()
    expect(((await take(it)).value as any).message.content).toBe('1')
    expect(((await take(it)).value as any).message.content).toBe('2')
  })

  it('close() ends iteration (done:true), even with a pending next()', async () => {
    const box = new PromptInbox()
    const it = box[Symbol.asyncIterator]()
    const pending = take(it)
    box.close()
    expect((await pending).done).toBe(true)
    box.push(textUserMessage('ignored')) // no throw; no effect after close
  })

  it('close() with a non-empty buffer DRAINS buffered messages, then ends', async () => {
    const box = new PromptInbox()
    box.push(textUserMessage('1'))
    box.push(textUserMessage('2'))
    box.close()
    const it = box[Symbol.asyncIterator]()
    expect(((await take(it)).value as any).message.content).toBe('1')
    expect(((await take(it)).value as any).message.content).toBe('2')
    expect((await take(it)).done).toBe(true)
  })
})
