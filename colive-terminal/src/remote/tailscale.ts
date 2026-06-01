import { exec as nodeExec } from 'node:child_process'
import { promisify } from 'node:util'

export type TailscaleState =
  | { state: 'running'; ip: string; hostname: string }
  | { state: 'not-installed' }
  | { state: 'not-connected'; backendState: string }

export type ShellExec = (cmd: string) => Promise<{ stdout: string; stderr: string }>

const defaultExec: ShellExec = promisify(nodeExec)

export async function detectTailscale(exec: ShellExec = defaultExec): Promise<TailscaleState> {
  let stdout: string
  try {
    const result = await exec('tailscale status --json')
    stdout = result.stdout
  } catch {
    return { state: 'not-installed' }
  }

  let data: any
  try {
    data = JSON.parse(stdout)
  } catch {
    throw new Error('Could not parse `tailscale status --json` output as JSON.')
  }
  const backendState: string = data.BackendState ?? ''

  if (backendState !== 'Running') {
    return { state: 'not-connected', backendState }
  }

  const ip: string = data.Self?.TailscaleIPs?.[0] ?? ''
  const rawHostname: string = data.Self?.DNSName ?? ''
  const hostname = rawHostname.replace(/\.$/, '')

  return { state: 'running', ip, hostname }
}
