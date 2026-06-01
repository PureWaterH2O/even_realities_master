import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readRemoteConfig, writeRemoteConfig, resolveRemoteHost, type RemoteConfig } from '../../src/remote/config'

describe('readRemoteConfig', () => {
  let dir: string

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  it('returns null when the config file does not exist', async () => {
    dir = await mkdtemp(join(tmpdir(), 'colive-cfg-'))
    const result = await readRemoteConfig(dir)
    expect(result).toBeNull()
  })

  it('throws on malformed config (missing prefer field)', async () => {
    dir = await mkdtemp(join(tmpdir(), 'colive-cfg-'))
    const path = join(dir, 'remote.json')
    const { writeFile: wf } = await import('node:fs/promises')
    await wf(path, JSON.stringify({ tailscaleHostname: 'x', tailscaleIp: 'y' }))
    await expect(readRemoteConfig(dir)).rejects.toThrow('missing or malformed')
  })

  it('round-trips: write then read returns the same config', async () => {
    dir = await mkdtemp(join(tmpdir(), 'colive-cfg-'))
    const config: RemoteConfig = {
      tailscaleHostname: 'my-mac.tailnet.ts.net',
      tailscaleIp: '100.64.1.2',
      prefer: 'hostname',
    }
    await writeRemoteConfig(config, dir)
    const result = await readRemoteConfig(dir)
    expect(result).toEqual(config)
  })

  it('throws a clear error on a file that is not valid JSON', async () => {
    dir = await mkdtemp(join(tmpdir(), 'colive-cfg-'))
    const { writeFile: wf } = await import('node:fs/promises')
    await wf(join(dir, 'remote.json'), 'this is { not json')
    await expect(readRemoteConfig(dir)).rejects.toThrow(/Invalid remote config/)
  })

  it('throws when tailscaleIp is empty', async () => {
    dir = await mkdtemp(join(tmpdir(), 'colive-cfg-'))
    const { writeFile: wf } = await import('node:fs/promises')
    await wf(join(dir, 'remote.json'), JSON.stringify({ tailscaleHostname: 'x', tailscaleIp: '', prefer: 'ip' }))
    await expect(readRemoteConfig(dir)).rejects.toThrow(/missing or malformed/)
  })
})

describe('resolveRemoteHost', () => {
  it('returns the hostname when prefer=hostname and hostname is non-empty', () => {
    const config: RemoteConfig = {
      tailscaleHostname: 'my-mac.tailnet.ts.net',
      tailscaleIp: '100.64.1.2',
      prefer: 'hostname',
    }
    expect(resolveRemoteHost(config)).toBe('my-mac.tailnet.ts.net')
  })

  it('falls back to IP when prefer=hostname but hostname is empty', () => {
    const config: RemoteConfig = {
      tailscaleHostname: '',
      tailscaleIp: '100.64.1.2',
      prefer: 'hostname',
    }
    expect(resolveRemoteHost(config)).toBe('100.64.1.2')
  })

  it('returns the IP when prefer=ip', () => {
    const config: RemoteConfig = {
      tailscaleHostname: 'my-mac.tailnet.ts.net',
      tailscaleIp: '100.64.1.2',
      prefer: 'ip',
    }
    expect(resolveRemoteHost(config)).toBe('100.64.1.2')
  })
})
