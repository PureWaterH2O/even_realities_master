import { describe, it, expect } from 'vitest'
import { interpretInput, formatBashPrompt } from '../../src/desk/slash'
import type { InterpretedInput } from '../../src/desk/slash'

/**
 * Task 3.2 — slash interceptor. Pure, client-side, no I/O. The single most
 * important invariant: nothing beginning with "/" is ever returned as a PROMPT
 * (slash commands hang the SDK; the client must never POST them).
 */

describe('interpretInput — slash commands', () => {
  it('/clear -> new_session command', () => {
    const r = interpretInput('/clear')
    expect(r.kind).toBe('command')
    if (r.kind !== 'command') throw new Error('expected command')
    expect(r.command).toBe('new_session')
  })

  it('/compact -> note command (M3 not-implemented message, posts nothing)', () => {
    const r = interpretInput('/compact')
    expect(r.kind).toBe('command')
    if (r.kind !== 'command' || r.command !== 'note') {
      throw new Error('expected note command')
    }
    expect(r.message.toLowerCase()).toContain('m3')
    expect(r.message.toLowerCase()).toContain('not')
  })

  it('/context -> view command (context)', () => {
    const r = interpretInput('/context')
    expect(r.kind).toBe('command')
    if (r.kind !== 'command' || r.command !== 'view') {
      throw new Error('expected view command')
    }
    expect(r.view).toBe('context')
  })

  it('/usage -> view command (usage)', () => {
    const r = interpretInput('/usage')
    expect(r.kind).toBe('command')
    if (r.kind !== 'command' || r.command !== 'view') {
      throw new Error('expected view command')
    }
    expect(r.view).toBe('usage')
  })

  it('/select -> mouse_mode command (select)', () => {
    const r = interpretInput('/select')
    expect(r.kind).toBe('command')
    if (r.kind !== 'command' || r.command !== 'mouse_mode') {
      throw new Error('expected mouse_mode command')
    }
    expect(r.mode).toBe('select')
  })

  it('/scroll -> mouse_mode command (scroll)', () => {
    const r = interpretInput('/scroll')
    expect(r.kind).toBe('command')
    if (r.kind !== 'command' || r.command !== 'mouse_mode') {
      throw new Error('expected mouse_mode command')
    }
    expect(r.mode).toBe('scroll')
  })

  it('/help -> help command listing the available slash commands', () => {
    const r = interpretInput('/help')
    expect(r.kind).toBe('command')
    if (r.kind !== 'command' || r.command !== 'help') {
      throw new Error('expected help command')
    }
    // The help text should mention every supported command.
    for (const name of ['/clear', '/compact', '/context', '/usage', '/select', '/scroll', '/help']) {
      expect(r.message).toContain(name)
    }
  })
})

describe('interpretInput — unknown slash', () => {
  it('/foo -> hint (NOT a prompt), names the unknown token and points to /help', () => {
    const r = interpretInput('/foo')
    expect(r.kind).toBe('hint')
    if (r.kind !== 'hint') throw new Error('expected hint')
    expect(r.message).toContain('/foo')
    expect(r.message).toContain('/help')
  })
})

describe('interpretInput — prompts', () => {
  it('"hello world" -> prompt carrying the text', () => {
    const r = interpretInput('hello world')
    expect(r.kind).toBe('prompt')
    if (r.kind !== 'prompt') throw new Error('expected prompt')
    expect(r.text).toBe('hello world')
  })

  it('text containing a slash mid-string is a normal prompt', () => {
    const r = interpretInput('what is 10/2')
    expect(r.kind).toBe('prompt')
    if (r.kind !== 'prompt') throw new Error('expected prompt')
    expect(r.text).toBe('what is 10/2')
  })
})

describe('interpretInput — whitespace tolerance', () => {
  it('"  /help  " (surrounding whitespace) still maps to help', () => {
    const r = interpretInput('  /help  ')
    expect(r.kind).toBe('command')
    if (r.kind !== 'command') throw new Error('expected command')
    expect(r.command).toBe('help')
  })

  it('a slash command with trailing args is recognized by its first token', () => {
    const r = interpretInput('/clear some extra args')
    expect(r.kind).toBe('command')
    if (r.kind !== 'command') throw new Error('expected command')
    expect(r.command).toBe('new_session')
  })

  it('"/help extra" recognized by first token', () => {
    const r = interpretInput('/help me please')
    expect(r.kind).toBe('command')
    if (r.kind !== 'command') throw new Error('expected command')
    expect(r.command).toBe('help')
  })

  it('a trimmed prompt drops surrounding whitespace', () => {
    const r = interpretInput('  hello  ')
    expect(r.kind).toBe('prompt')
    if (r.kind !== 'prompt') throw new Error('expected prompt')
    expect(r.text).toBe('hello')
  })

  it('empty input -> prompt with empty text (no slash, nothing to post — app decides)', () => {
    const r = interpretInput('   ')
    expect(r.kind).toBe('prompt')
    if (r.kind !== 'prompt') throw new Error('expected prompt')
    expect(r.text).toBe('')
  })

  it('a lone "/" after trimming -> prompt (not a command, not a hint)', () => {
    const r = interpretInput('  /  ')
    expect(r.kind).toBe('prompt')
    if (r.kind !== 'prompt') throw new Error('expected prompt')
    expect(r.text).toBe('')
  })
})

describe('interpretInput — the load-bearing invariant', () => {
  it('NO input beginning with "/" is ever returned as a prompt', () => {
    const slashInputs = [
      '/clear',
      '/compact',
      '/context',
      '/usage',
      '/select',
      '/scroll',
      '/help',
      '/foo',
      '/bar baz',
      '/CLEAR', // case handling (see case test below)
      '/unknown-thing with args',
      '/123',
      '/clear\textra',
    ]
    for (const raw of slashInputs) {
      const r = interpretInput(raw)
      expect(r.kind, `"${raw}" must not be a prompt`).not.toBe('prompt')
    }
  })

  it('exhaustive InterpretedInput kinds are covered by the union', () => {
    // Type-level: every result is assignable to InterpretedInput.
    const samples: InterpretedInput[] = [
      interpretInput('/clear'),
      interpretInput('/foo'),
      interpretInput('hi'),
    ]
    expect(samples).toHaveLength(3)
  })
})

describe('interpretInput — case insensitivity of the command token', () => {
  it('uppercase /HELP is recognized as help (commands are case-insensitive)', () => {
    const r = interpretInput('/HELP')
    expect(r.kind).toBe('command')
    if (r.kind !== 'command') throw new Error('expected command')
    expect(r.command).toBe('help')
  })

  it('unknown uppercase /FOO is a hint, still never a prompt', () => {
    const r = interpretInput('/FOO')
    expect(r.kind).toBe('hint')
  })
})

describe('!bash', () => {
  it('formatBashPrompt wraps the command in a run-and-show instruction', () => {
    const t = formatBashPrompt('npm test')
    expect(t).toContain('Run this shell command')
    expect(t).toContain('npm test')
  })
  it('a "!"-line is a bash result carrying the command + transformed text', () => {
    const r = interpretInput('!git status')
    expect(r.kind).toBe('bash')
    if (r.kind === 'bash') {
      expect(r.command).toBe('git status')
      expect(r.text).toBe(formatBashPrompt('git status'))
    }
  })
  it('a lone "!" is a no-op prompt (mirrors lone "/")', () => {
    expect(interpretInput('!')).toEqual({ kind: 'prompt', text: '' })
    expect(interpretInput('!   ')).toEqual({ kind: 'prompt', text: '' })
  })
  it('an @-bearing line stays a verbatim prompt (no @ handling at submit)', () => {
    expect(interpretInput('explain @src/app.tsx')).toEqual({ kind: 'prompt', text: 'explain @src/app.tsx' })
  })
})
