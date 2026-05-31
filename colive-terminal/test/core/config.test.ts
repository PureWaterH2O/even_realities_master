import { describe, it, expect } from 'vitest'
import { realpathSync } from 'node:fs'
import { resolveConfig } from '../../src/core/config'

describe('resolveConfig', () => {
  it('returns defaults when env and args are empty', () => {
    const cfg = resolveConfig({}, {})
    expect(cfg.model).toBe('claude-opus-4-8')
    expect(cfg.permissionMode).toBe('default')
    expect(cfg.settingSources).toEqual([])
    expect(cfg.host).toBe('127.0.0.1')
    expect(cfg.port).toBe(3456)
    expect(cfg.projectDir).toBe(realpathSync(process.cwd()))
    // token is generated, non-empty
    expect(typeof cfg.token).toBe('string')
    expect(cfg.token.length).toBeGreaterThan(0)
  })

  it('token is generated and stable within one call', () => {
    const cfg = resolveConfig({}, {})
    expect(cfg.token).toBe(cfg.token)
  })

  it('token differs across separate calls when none is provided', () => {
    const a = resolveConfig({}, {})
    const b = resolveConfig({}, {})
    expect(a.token).not.toBe(b.token)
  })

  it('projectDir is realpath-resolved (symlinks collapsed)', () => {
    // /tmp -> /private/tmp on macOS; realpath collapses it.
    const cfg = resolveConfig({ PROJECT_DIR: '/tmp' }, {})
    expect(cfg.projectDir).toBe(realpathSync('/tmp'))
  })

  it('each field is overridable by env', () => {
    const cfg = resolveConfig(
      {
        MODEL: 'claude-sonnet-4-5',
        PERMISSION_MODE: 'acceptEdits',
        HOST: '0.0.0.0',
        PORT: '8080',
        BRIDGE_TOKEN: 'env-token',
        PROJECT_DIR: realpathSync(process.cwd()),
      },
      {},
    )
    expect(cfg.model).toBe('claude-sonnet-4-5')
    expect(cfg.permissionMode).toBe('acceptEdits')
    expect(cfg.host).toBe('0.0.0.0')
    expect(cfg.port).toBe(8080)
    expect(cfg.token).toBe('env-token')
    expect(cfg.projectDir).toBe(realpathSync(process.cwd()))
  })

  it('PORT env string parses to a number', () => {
    const cfg = resolveConfig({ PORT: '9999' }, {})
    expect(cfg.port).toBe(9999)
    expect(typeof cfg.port).toBe('number')
  })

  it('each field is overridable by args, and args win over env', () => {
    const cfg = resolveConfig(
      {
        MODEL: 'env-model',
        PERMISSION_MODE: 'acceptEdits',
        HOST: 'env-host',
        PORT: '1111',
        BRIDGE_TOKEN: 'env-token',
        PROJECT_DIR: realpathSync(process.cwd()),
      },
      {
        model: 'arg-model',
        permissionMode: 'plan',
        host: 'arg-host',
        port: 2222,
        token: 'arg-token',
        projectDir: realpathSync('/tmp'),
      },
    )
    expect(cfg.model).toBe('arg-model')
    expect(cfg.permissionMode).toBe('plan')
    expect(cfg.host).toBe('arg-host')
    expect(cfg.port).toBe(2222)
    expect(cfg.token).toBe('arg-token')
    expect(cfg.projectDir).toBe(realpathSync('/tmp'))
  })

  it('env permissionMode is honored when valid', () => {
    const cfg = resolveConfig({ PERMISSION_MODE: 'bypassPermissions' }, {})
    expect(cfg.permissionMode).toBe('bypassPermissions')
  })

  it('rejects an invalid permissionMode env value', () => {
    expect(() => resolveConfig({ PERMISSION_MODE: 'nonsense' }, {})).toThrow()
  })
})
