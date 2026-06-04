/**
 * The desk Core's streaming-input feed: a single-consumer, pushable async
 * iterable of SDKUserMessage. It is the `prompt` argument to the one persistent
 * query() per session — run() pushes a message; the SDK pulls them as turns.
 *
 * Single-consumer by contract (only ClaudeSession's consumer loop iterates it).
 */
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'

/** Build the SDK text user-message shape (sdk.d.ts SDKUserMessage). */
export function textUserMessage(text: string): SDKUserMessage {
  return {
    type: 'user',
    message: { role: 'user', content: text },
    parent_tool_use_id: null,
  }
}

export class PromptInbox implements AsyncIterable<SDKUserMessage> {
  private buffer: SDKUserMessage[] = []
  private pendingNext: ((r: IteratorResult<SDKUserMessage>) => void) | undefined
  private closed = false

  /** Hand a message to the consumer (or buffer it until the consumer asks). */
  push(msg: SDKUserMessage): void {
    if (this.closed) return
    if (this.pendingNext !== undefined) {
      const resolve = this.pendingNext
      this.pendingNext = undefined
      resolve({ value: msg, done: false })
    } else {
      this.buffer.push(msg)
    }
  }

  /** End iteration; a pending next() resolves done, future pushes are ignored. */
  close(): void {
    this.closed = true
    if (this.pendingNext !== undefined) {
      const resolve = this.pendingNext
      this.pendingNext = undefined
      resolve({ value: undefined, done: true })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () =>
        new Promise<IteratorResult<SDKUserMessage>>((resolve) => {
          if (this.buffer.length > 0) {
            resolve({ value: this.buffer.shift()!, done: false })
          } else if (this.closed) {
            resolve({ value: undefined, done: true })
          } else {
            this.pendingNext = resolve
          }
        }),
    }
  }
}
