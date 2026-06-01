import { describe, expect, it } from 'vitest'
import { detectTailscale, type ShellExec } from '../../src/remote/tailscale'

const RUNNING_FIXTURE = JSON.stringify({
  BackendState: 'Running',
  Self: {
    TailscaleIPs: ['100.64.1.2', 'fd7a:115c:a1e0::1'],
    DNSName: 'my-mac.tailnet-abc.ts.net.',
    Online: true,
  },
})

describe('detectTailscale', () => {
  it('returns state=running with ip + hostname when Tailscale is connected', async () => {
    const exec: ShellExec = async () => ({ stdout: RUNNING_FIXTURE, stderr: '' })
    const result = await detectTailscale(exec)
    expect(result).toEqual({
      state: 'running',
      ip: '100.64.1.2',
      hostname: 'my-mac.tailnet-abc.ts.net',
    })
  })

  it('returns state=not-installed when the tailscale command fails', async () => {
    const exec: ShellExec = async () => { throw new Error('command not found: tailscale') }
    const result = await detectTailscale(exec)
    expect(result).toEqual({ state: 'not-installed' })
  })

  it('returns state=not-connected with backendState when Tailscale is stopped', async () => {
    const stopped = JSON.stringify({ BackendState: 'Stopped', Self: null })
    const exec: ShellExec = async () => ({ stdout: stopped, stderr: '' })
    const result = await detectTailscale(exec)
    expect(result).toEqual({ state: 'not-connected', backendState: 'Stopped' })
  })

  it('returns state=not-connected when BackendState is NeedsLogin', async () => {
    const needsLogin = JSON.stringify({ BackendState: 'NeedsLogin', Self: null })
    const exec: ShellExec = async () => ({ stdout: needsLogin, stderr: '' })
    const result = await detectTailscale(exec)
    expect(result).toEqual({ state: 'not-connected', backendState: 'NeedsLogin' })
  })

  it('returns empty hostname when DNSName is empty (MagicDNS disabled)', async () => {
    const noDns = JSON.stringify({
      BackendState: 'Running',
      Self: { TailscaleIPs: ['100.64.1.2'], DNSName: '', Online: true },
    })
    const exec: ShellExec = async () => ({ stdout: noDns, stderr: '' })
    const result = await detectTailscale(exec)
    expect(result).toEqual({ state: 'running', ip: '100.64.1.2', hostname: '' })
  })
})
