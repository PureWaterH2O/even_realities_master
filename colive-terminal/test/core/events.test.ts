import { describe, it, expect } from 'vitest'
import type {
  CoLiveEvent,
  UserPromptEvent,
  StatusEvent,
  ToolStartEvent,
  ToolEndEvent,
  TextDeltaEvent,
  RunningStatsEvent,
  ResultEvent,
  PermissionRequestEvent,
  PermissionResultEvent,
  UserQuestionEvent,
  NotificationEvent,
  TaskProgressEvent,
  ErrorEvent,
} from '../../src/core/events'

describe('CoLiveEvent vocabulary', () => {
  it('constructs one value of every variant with the right discriminator', () => {
    const events: CoLiveEvent[] = [
      { type: 'user_prompt', text: 'hi' } satisfies UserPromptEvent,
      { type: 'status', state: 'busy' } satisfies StatusEvent,
      { type: 'tool_start', name: 'Read', toolId: 't1' } satisfies ToolStartEvent,
      {
        type: 'tool_end',
        name: 'Read',
        toolId: 't1',
        summary: 'read a file',
        detail: { input: { path: '/x' }, output: 'contents' },
      } satisfies ToolEndEvent,
      { type: 'text_delta', text: 'hello' } satisfies TextDeltaEvent,
      {
        type: 'running_stats',
        durationMs: 1000,
        inputTokens: 10,
        outputTokens: 20,
      } satisfies RunningStatsEvent,
      {
        type: 'result',
        success: true,
        text: 'done',
        sessionId: 'sess-1',
        costUsd: 0.01,
        provider: 'claude',
        turns: 1,
        durationMs: 1234,
        inputTokens: 10,
        outputTokens: 20,
      } satisfies ResultEvent,
      {
        type: 'permission_request',
        toolName: 'Bash',
        description: 'run ls',
        detail: { cmd: 'ls' },
        toolUseId: 'tu-1',
        options: ['allow', 'deny'],
        suggestions: [],
      } satisfies PermissionRequestEvent,
      {
        type: 'permission_result',
        toolName: 'Bash',
        summary: 'allowed',
        decision: 'allow',
      } satisfies PermissionResultEvent,
      {
        type: 'user_question',
        question: 'pick one',
        toolUseId: 'tu-2',
        options: ['a', 'b'],
      } satisfies UserQuestionEvent,
      {
        type: 'notification',
        title: 'Heads up',
        message: 'something happened',
      } satisfies NotificationEvent,
      {
        type: 'task_progress',
        completed: 2,
        total: 5,
        current: 'step 3',
      } satisfies TaskProgressEvent,
      { type: 'error', message: 'boom' } satisfies ErrorEvent,
    ]

    // every event carries a string discriminator
    for (const e of events) {
      expect(typeof e.type).toBe('string')
    }

    // exhaustive set of discriminators present, no duplicates
    const types = events.map((e) => e.type)
    expect(new Set(types).size).toBe(types.length)
    expect(new Set(types)).toEqual(
      new Set([
        'user_prompt',
        'status',
        'tool_start',
        'tool_end',
        'text_delta',
        'running_stats',
        'result',
        'permission_request',
        'permission_result',
        'user_question',
        'notification',
        'task_progress',
        'error',
      ]),
    )
  })

  it('status state is one of the defined HUD states', () => {
    const states: StatusEvent['state'][] = [
      'busy',
      'think_start',
      'think_end',
      'text_start',
      'text_end',
      'idle',
    ]
    for (const state of states) {
      const ev: StatusEvent = { type: 'status', state }
      expect(ev.state).toBe(state)
    }
  })

  it('result.provider is the literal "claude" for M1', () => {
    const ev: ResultEvent = {
      type: 'result',
      success: false,
      text: '',
      sessionId: 's',
      costUsd: 0,
      provider: 'claude',
      turns: 0,
      durationMs: 0,
      inputTokens: 0,
      outputTokens: 0,
    }
    expect(ev.provider).toBe('claude')
  })

  it('narrows on the discriminator', () => {
    const ev: CoLiveEvent = { type: 'text_delta', text: 'chunk' }
    if (ev.type === 'text_delta') {
      expect(ev.text).toBe('chunk')
    } else {
      throw new Error('discriminator did not narrow')
    }
  })
})
