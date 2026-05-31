import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, symlinkSync, writeFileSync, utimesSync, realpathSync, mkdirSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import type { SDKSessionInfo, SessionMessage } from '@anthropic-ai/claude-agent-sdk'
import {
  realpathCwd,
  encodeProjectDir,
  sessionJsonlPath,
  sessionStatusFromJsonl,
  sessionStatusFromJsonlString,
  listSessions,
  getTranscript,
} from '../../src/core/store'

// ---- sessionStatusFromJsonlString (pure classifier) ----

describe('sessionStatusFromJsonlString', () => {
  const FRESH = Date.now()
  const STALE = Date.now() - 200_000 // > 120s old

  it('classifies a session ending in a last-prompt marker as idle', () => {
    const jsonl = [
      '{"type":"user","message":{"role":"user","content":"hi"}}',
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"hello"}]}}',
      '{"type":"last-prompt","lastPrompt":"hi","leafUuid":"u1","sessionId":"s1"}',
    ].join('\n')
    expect(sessionStatusFromJsonlString(jsonl, FRESH)).toBe('idle')
  })

  it('classifies a session ending in a permission-mode marker as idle', () => {
    const jsonl = '{"type":"permission-mode","permissionMode":"default","sessionId":"s1"}'
    expect(sessionStatusFromJsonlString(jsonl, FRESH)).toBe('idle')
  })

  it('classifies a session ending in a result marker as idle', () => {
    const jsonl = '{"type":"result","subtype":"success","result":"done"}'
    expect(sessionStatusFromJsonlString(jsonl, FRESH)).toBe('idle')
  })

  it('classifies a session ending in an interrupt marker as idle', () => {
    const jsonl = '{"type":"interrupt","sessionId":"s1"}'
    expect(sessionStatusFromJsonlString(jsonl, FRESH)).toBe('idle')
  })

  it('classifies a session ending in a system stop_hook_summary as idle', () => {
    const jsonl = '{"type":"system","subtype":"stop_hook_summary","sessionId":"s1"}'
    expect(sessionStatusFromJsonlString(jsonl, FRESH)).toBe('idle')
  })

  it('classifies a session ending in ai-title as idle even when fresh', () => {
    // 🧪 The SDK writes ai-title (auto-title) right after last-prompt at turn end;
    // a fresh-mtime transcript ending here is idle, not a live turn.
    const aiTitle = [
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"hi"}]}}',
      '{"type":"last-prompt","lastPrompt":"hi","sessionId":"s1"}',
      '{"type":"ai-title","title":"A title","sessionId":"s1"}',
    ].join('\n')
    expect(sessionStatusFromJsonlString(aiTitle, FRESH)).toBe('idle')
  })

  it('classifies a session ending mid-assistant with a FRESH mtime as busy', () => {
    const jsonl = [
      '{"type":"user","message":{"role":"user","content":"go"}}',
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"work"}]}}',
    ].join('\n')
    expect(sessionStatusFromJsonlString(jsonl, FRESH)).toBe('busy')
  })

  it('classifies a session ending mid-assistant with a STALE mtime as idle', () => {
    const jsonl = [
      '{"type":"user","message":{"role":"user","content":"go"}}',
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"work"}]}}',
    ].join('\n')
    expect(sessionStatusFromJsonlString(jsonl, STALE)).toBe('idle')
  })

  it('does NOT treat a non-terminal system subtype as idle (busy when fresh)', () => {
    const jsonl = '{"type":"system","subtype":"init","sessionId":"s1"}'
    expect(sessionStatusFromJsonlString(jsonl, FRESH)).toBe('busy')
  })

  it('does NOT treat queue-operation / attachment / summary as terminal', () => {
    for (const t of ['queue-operation', 'attachment', 'summary', 'user', 'assistant']) {
      const jsonl = `{"type":"${t}"}`
      expect(sessionStatusFromJsonlString(jsonl, FRESH)).toBe('busy')
      expect(sessionStatusFromJsonlString(jsonl, STALE)).toBe('idle')
    }
  })

  it('ignores trailing blank lines and uses the LAST non-empty line', () => {
    const jsonl = '{"type":"last-prompt","sessionId":"s1"}\n\n  \n'
    expect(sessionStatusFromJsonlString(jsonl, FRESH)).toBe('idle')
  })

  it('treats an unparseable last line as non-terminal (mtime-driven)', () => {
    const jsonl = 'not json at all'
    expect(sessionStatusFromJsonlString(jsonl, FRESH)).toBe('busy')
    expect(sessionStatusFromJsonlString(jsonl, STALE)).toBe('idle')
  })

  it('treats an empty/whitespace transcript as idle', () => {
    expect(sessionStatusFromJsonlString('', FRESH)).toBe('idle')
    expect(sessionStatusFromJsonlString('   \n  \n', FRESH)).toBe('idle')
  })
})

// ---- sessionStatusFromJsonl (file-path variant, uses real mtime) ----

describe('sessionStatusFromJsonl (file)', () => {
  let dir: string
  beforeAll(() => {
    dir = mkdtempSync(join(realpathSync(tmpdir()), 'store-fixture-'))
  })
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('a fixture ending in stop_hook_summary => idle (regardless of mtime)', () => {
    const f = join(dir, 'idle.jsonl')
    writeFileSync(
      f,
      [
        '{"type":"user","message":{"role":"user","content":"hi"}}',
        '{"type":"system","subtype":"stop_hook_summary","sessionId":"s1"}',
      ].join('\n'),
    )
    // even with a fresh mtime, the terminal marker forces idle
    expect(sessionStatusFromJsonl(f)).toBe('idle')
  })

  it('a fixture ending mid-assistant with a FRESH mtime => busy', () => {
    const f = join(dir, 'busy.jsonl')
    writeFileSync(
      f,
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"x"}]}}',
    )
    const now = Date.now() / 1000
    utimesSync(f, now, now)
    expect(sessionStatusFromJsonl(f)).toBe('busy')
  })

  it('a fixture ending mid-assistant with a STALE mtime => idle', () => {
    const f = join(dir, 'stale.jsonl')
    writeFileSync(
      f,
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"x"}]}}',
    )
    const old = (Date.now() - 300_000) / 1000
    utimesSync(f, old, old)
    expect(sessionStatusFromJsonl(f)).toBe('idle')
  })

  it('a missing file => idle (no crash)', () => {
    expect(sessionStatusFromJsonl(join(dir, 'does-not-exist.jsonl'))).toBe('idle')
  })
})

// ---- realpathCwd ----

describe('realpathCwd', () => {
  let base: string
  let target: string
  let link: string
  beforeAll(() => {
    base = mkdtempSync(join(realpathSync(tmpdir()), 'store-rp-'))
    target = join(base, 'real-target')
    link = join(base, 'link-to-target')
    mkdirpViaWrite(target)
    symlinkSync(target, link)
  })
  afterAll(() => {
    rmSync(base, { recursive: true, force: true })
  })

  it('resolves a symlinked cwd to its realpath-encoded form', () => {
    expect(realpathCwd(link)).toBe(realpathSync(link))
    expect(realpathCwd(link)).toBe(target)
  })

  it('is a no-op for an already-real path', () => {
    expect(realpathCwd(target)).toBe(target)
  })
})

// helper: create a directory by relying on fs.mkdirSync (recursive)
function mkdirpViaWrite(p: string) {
  mkdirSync(p, { recursive: true })
}

// ---- encodeProjectDir / sessionJsonlPath (Claude Code projects-path encoding) ----

describe('encodeProjectDir', () => {
  it('replaces every non-alphanumeric char with a hyphen (matches Claude Code)', () => {
    // 🧪 M0 ground truth
    expect(encodeProjectDir('/private/tmp/colive-spike')).toBe('-private-tmp-colive-spike')
    expect(
      encodeProjectDir('/Users/x/Documents/random_claude_stuff/even_realities'),
    ).toBe('-Users-x-Documents-random-claude-stuff-even-realities')
  })

  it('leaves alphanumerics untouched and maps "/", "_", "." to "-"', () => {
    expect(encodeProjectDir('/a/b_c.d')).toBe('-a-b-c-d')
  })
})

describe('sessionJsonlPath', () => {
  it('builds <home>/.claude/projects/<encoded-realpath-dir>/<id>.jsonl', () => {
    const realDir = realpathSync(tmpdir())
    expect(sessionJsonlPath('abc-123', realDir)).toBe(
      join(homedir(), '.claude', 'projects', encodeProjectDir(realDir), 'abc-123.jsonl'),
    )
  })
})

// ---- listSessions (normalization; SDK call injected) ----

describe('listSessions (normalization)', () => {
  it('normalizes SDK session info and realpaths the dir before lookup', async () => {
    const calls: Array<{ dir?: string; limit?: number }> = []
    const fakeSdkList = async (opts?: {
      dir?: string
      limit?: number
    }): Promise<SDKSessionInfo[]> => {
      calls.push({ dir: opts?.dir, limit: opts?.limit })
      return [
        {
          sessionId: 'sess-1',
          summary: 'A summary',
          lastModified: 1717000000000,
          cwd: '/some/cwd',
        },
        {
          sessionId: 'sess-2',
          summary: 'fallback summary',
          customTitle: 'Custom Title',
          lastModified: 1717000111111,
        },
      ]
    }
    // status resolver injected so we don't touch the real filesystem
    const fakeStatus = (id: string) => (id === 'sess-1' ? 'busy' : 'idle')

    const out = await listSessions(
      { dir: '/tmp', limit: 5 },
      { sdkListSessions: fakeSdkList, statusOf: fakeStatus },
    )

    // dir was realpath-resolved before being passed to the SDK
    expect(calls[0].dir).toBe(realpathSync('/tmp'))
    expect(calls[0].limit).toBe(5)

    expect(out).toEqual([
      {
        id: 'sess-1',
        title: 'A summary',
        timestamp: 1717000000000,
        cwd: '/some/cwd',
        provider: 'claude',
        status: 'busy',
      },
      {
        id: 'sess-2',
        title: 'Custom Title', // customTitle preferred over summary
        timestamp: 1717000111111,
        cwd: undefined,
        provider: 'claude',
        status: 'idle',
      },
    ])
  })
})

// ---- getTranscript (normalization; SDK call injected, NO 10-message cap) ----

describe('getTranscript (normalization)', () => {
  it('returns the full normalized transcript with no limit cap', async () => {
    const calls: Array<{ dir?: string; limit?: number }> = []
    const fakeGet = async (
      _id: string,
      opts?: { dir?: string; limit?: number },
    ): Promise<SessionMessage[]> => {
      calls.push({ dir: opts?.dir, limit: opts?.limit })
      return [
        { type: 'user', uuid: 'u1', session_id: 's', parent_tool_use_id: null, message: { role: 'user', content: 'hello' } },
        {
          type: 'assistant',
          uuid: 'a1',
          session_id: 's',
          parent_tool_use_id: null,
          message: { role: 'assistant', content: [{ type: 'text', text: 'hi ' }, { type: 'text', text: 'there' }] },
        },
      ]
    }

    const out = await getTranscript('s', { dir: '/tmp' }, { sdkGetSessionMessages: fakeGet })

    // dir realpath'd
    expect(calls[0].dir).toBe(realpathSync('/tmp'))
    // NO 10-message cap: limit must NOT be set to 10 (or any cap)
    expect(calls[0].limit).toBeUndefined()

    expect(out).toEqual([
      { role: 'user', text: 'hello' },
      { role: 'assistant', text: 'hi there' },
    ])
  })

  it('extracts text from string content and from content blocks', async () => {
    const fakeGet = async (): Promise<SessionMessage[]> => [
      { type: 'user', uuid: 'u', session_id: 's', parent_tool_use_id: null, message: { content: 'plain string' } },
      {
        type: 'assistant',
        uuid: 'a',
        session_id: 's',
        parent_tool_use_id: null,
        message: { content: [{ type: 'text', text: 'block text' }, { type: 'tool_use', name: 'Read' }] },
      },
    ]
    const out = await getTranscript('s', {}, { sdkGetSessionMessages: fakeGet })
    expect(out).toEqual([
      { role: 'user', text: 'plain string' },
      { role: 'assistant', text: 'block text' },
    ])
  })
})
