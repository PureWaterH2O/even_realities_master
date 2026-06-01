import { createInterface } from 'node:readline/promises'
import { detectTailscale, type ShellExec } from './tailscale'
import { writeRemoteConfig, type RemoteConfig } from './config'

export interface WizardIO {
  print(msg: string): void
  prompt(msg: string): Promise<string>
}

export interface SetupDeps {
  io: WizardIO
  exec?: ShellExec
  configDir?: string
  hubPort?: number
}

export interface SetupResult {
  config: RemoteConfig
  configPath: string
}

export async function runSetup(deps: SetupDeps): Promise<SetupResult> {
  const { io, exec, configDir } = deps
  const hubPort = deps.hubPort ?? 3456

  io.print('\n🔧 Co-Live Terminal — Remote Setup\n')

  // Step 1: Detect Tailscale on Mac
  io.print('Checking for Tailscale...')
  let tsState = await detectTailscale(exec)

  while (tsState.state === 'not-installed') {
    io.print('\n❌ Tailscale is not installed on this Mac.')
    io.print('   Install it with one of:')
    io.print('     brew install tailscale')
    io.print('     https://tailscale.com/download/mac')
    io.print('')
    await io.prompt('Press Enter after installing Tailscale...')
    tsState = await detectTailscale(exec)
  }

  while (tsState.state === 'not-connected') {
    io.print(`\n⚠️  Tailscale is installed but not connected (state: ${tsState.backendState}).`)
    io.print('   Connect with:')
    io.print('     tailscale up')
    io.print('   Or open the Tailscale menu bar app and sign in.')
    io.print('')
    await io.prompt('Press Enter after connecting...')
    tsState = await detectTailscale(exec)
  }

  if (tsState.state !== 'running') {
    throw new Error('Unexpected Tailscale state')
  }

  // Step 2: Capture identity
  io.print(`\n✅ Tailscale is connected.`)
  io.print(`   IP:       ${tsState.ip}`)
  if (tsState.hostname) {
    io.print(`   Hostname: ${tsState.hostname}`)
  }

  // Step 3: Guide iPhone setup
  io.print('\n📱 iPhone Setup')
  io.print('   1. Install Tailscale from the App Store')
  io.print('   2. Sign in with the same account as this Mac')
  io.print('   3. Verify it shows "Connected"')

  if (hubPort > 0) {
    io.print(`\n   To verify, open this URL in Safari on your phone:`)
    io.print(`   http://${tsState.hostname || tsState.ip}:${hubPort}/api/info`)
    io.print('   (Start `colive serve` first if it\'s not running.)')
  }

  await io.prompt('\nPress Enter when your iPhone is set up (or just press Enter to skip)...')

  // Step 4: Write config
  const prefer: RemoteConfig['prefer'] = tsState.hostname ? 'hostname' : 'ip'
  const config: RemoteConfig = {
    tailscaleHostname: tsState.hostname,
    tailscaleIp: tsState.ip,
    prefer,
  }
  const configPath = await writeRemoteConfig(config, configDir)

  // Step 5: Summary
  io.print(`\n✅ Config saved to ${configPath}`)
  io.print('\nYou\'re set up. Run `colive serve` and your glasses will be')
  io.print('reachable from anywhere on your Tailscale network.\n')

  return { config, configPath }
}

export function createDefaultIO(): WizardIO {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return {
    print: (msg: string) => console.log(msg),
    prompt: async (msg: string) => {
      const answer = await rl.question(msg)
      return answer
    },
  }
}
