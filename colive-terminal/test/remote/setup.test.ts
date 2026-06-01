import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runSetup, type WizardIO, type SetupDeps } from '../../src/remote/setup'
import { readRemoteConfig } from '../../src/remote/config'
import type { ShellExec } from '../../src/remote/tailscale'

const RUNNING_JSON = JSON.stringify({
  BackendState: 'Running',
  Self: {
    TailscaleIPs: ['100.64.1.2', 'fd7a:115c:a1e0::1'],
    DNSName: 'my-mac.tailnet-abc.ts.net.',
    Online: true,
  },
})

function fakeIO(): WizardIO & { printed: string[] } {
  const printed: string[] = []
  return {
    printed,
    print: (msg: string) => printed.push(msg),
    prompt: async () => '',
  }
}

describe('runSetup', () => {
  let dir: string

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  it('happy path: detects Tailscale, writes config, prints summary', async () => {
    dir = await mkdtemp(join(tmpdir(), 'colive-setup-'))
    const io = fakeIO()
    const exec: ShellExec = async () => ({ stdout: RUNNING_JSON, stderr: '' })

    const result = await runSetup({ io, exec, configDir: dir, hubPort: 0 })

    expect(result.config.tailscaleIp).toBe('100.64.1.2')
    expect(result.config.tailscaleHostname).toBe('my-mac.tailnet-abc.ts.net')
    expect(result.config.prefer).toBe('hostname')

    const persisted = await readRemoteConfig(dir)
    expect(persisted).toEqual(result.config)

    expect(io.printed.some(line => line.includes('set up'))).toBe(true)
  })

  it('loops on not-installed until Tailscale appears', async () => {
    dir = await mkdtemp(join(tmpdir(), 'colive-setup-'))
    const io = fakeIO()
    let callCount = 0
    const exec: ShellExec = async () => {
      callCount++
      if (callCount === 1) throw new Error('command not found')
      return { stdout: RUNNING_JSON, stderr: '' }
    }

    const result = await runSetup({ io, exec, configDir: dir, hubPort: 0 })

    expect(result.config.tailscaleIp).toBe('100.64.1.2')
    expect(io.printed.some(line => line.includes('not installed'))).toBe(true)
    expect(callCount).toBe(2)
  })

  it('loops on not-connected until Tailscale connects', async () => {
    dir = await mkdtemp(join(tmpdir(), 'colive-setup-'))
    const io = fakeIO()
    let callCount = 0
    const stoppedJson = JSON.stringify({ BackendState: 'Stopped', Self: null })
    const exec: ShellExec = async () => {
      callCount++
      if (callCount === 1) return { stdout: stoppedJson, stderr: '' }
      return { stdout: RUNNING_JSON, stderr: '' }
    }

    const result = await runSetup({ io, exec, configDir: dir, hubPort: 0 })

    expect(result.config.tailscaleIp).toBe('100.64.1.2')
    expect(io.printed.some(line => line.includes('not connected'))).toBe(true)
    expect(callCount).toBe(2)
  })

  it('sets prefer=ip when hostname is empty (no MagicDNS)', async () => {
    dir = await mkdtemp(join(tmpdir(), 'colive-setup-'))
    const io = fakeIO()
    const noDns = JSON.stringify({
      BackendState: 'Running',
      Self: { TailscaleIPs: ['100.64.1.2'], DNSName: '', Online: true },
    })
    const exec: ShellExec = async () => ({ stdout: noDns, stderr: '' })

    const result = await runSetup({ io, exec, configDir: dir, hubPort: 0 })

    expect(result.config.prefer).toBe('ip')
    expect(result.config.tailscaleHostname).toBe('')
  })
})
