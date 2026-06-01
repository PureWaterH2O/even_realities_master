# Co-Live Terminal M2 — Tailscale Remote Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the glasses work from anywhere by always connecting through Tailscale — a one-time `colive setup` wizard + serve-time auto-detect so the desk-to-away transition is invisible.

**Architecture:** Two new modules (`src/remote/tailscale.ts` for detecting Tailscale state, `src/remote/config.ts` for persisting the user's Tailscale identity) feed into a `colive setup` wizard and a modified `colive serve` boot path. The Hub server binds to `0.0.0.0` and generates the QR with the Tailscale-routable address so the phone/glasses always connect through the WireGuard tunnel.

**Tech Stack:** Node.js built-in `child_process` (exec), `fs/promises`, `readline/promises`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-31-colive-terminal-m2-design.md`

---

## File Map

| File | Responsibility |
|------|----------------|
| `src/remote/tailscale.ts` | Detect Tailscale: run `tailscale status --json`, parse output, extract IP + MagicDNS hostname, report state (running / not-installed / not-connected). Injectable executor for testing. |
| `src/remote/config.ts` | Read/write/validate `~/.config/colive/remote.json`. Resolve the preferred address (hostname vs IP). Injectable config dir for testing. |
| `src/remote/setup.ts` | Interactive setup wizard. Orchestrates detect → guide → verify → write-config. Injectable I/O for testing. |
| `src/index.ts` | Wire `colive setup` subcommand. Modify `runServe` to read remote config, verify Tailscale, and pass `advertiseHost` to the server. |
| `src/hub/server.ts` | Add optional `advertiseHost` to the server config. `buildQrPayload` and `printStartupBanner` use it when present. |
| `src/core/config.ts` | Add optional `advertiseHost` field to `ResolvedConfig`. |
| `test/remote/tailscale.test.ts` | Unit tests for Tailscale detection against fixture JSON. |
| `test/remote/config.test.ts` | Unit tests for config read/write/validate. |
| `test/remote/setup.test.ts` | Integration test for the wizard flow with mocked exec + I/O. |
| `test/hub/server.test.ts` | Extend: QR payload uses `advertiseHost` when set. |
| `test/hub/index.test.ts` | Extend: `runServe` with remote config behavior. |
| `colive-terminal/docs/remote-setup.md` | Fallback written guide for Tailscale setup. |

---

### Task 1: Tailscale Detector

**Files:**
- Create: `src/remote/tailscale.ts`
- Create: `test/remote/tailscale.test.ts`

The Tailscale detector is a pure module that shells out to `tailscale status --json`, parses the result, and returns a discriminated union of states. The shell executor is injectable so tests pass fixture data without needing Tailscale installed.

- [ ] **Step 1.1: Write the type definitions and failing test for the "running" happy path**

Create `src/remote/tailscale.ts` with just the types:

```ts
export type TailscaleState =
  | { state: 'running'; ip: string; hostname: string }
  | { state: 'not-installed' }
  | { state: 'not-connected'; backendState: string }

export type ShellExec = (cmd: string) => Promise<{ stdout: string; stderr: string }>

export async function detectTailscale(exec?: ShellExec): Promise<TailscaleState> {
  throw new Error('not implemented')
}
```

Create `test/remote/tailscale.test.ts`:

```ts
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
})
```

- [ ] **Step 1.2: Run the test to verify it fails**

Run: `cd colive-terminal && npx vitest run test/remote/tailscale.test.ts`
Expected: FAIL with "not implemented"

- [ ] **Step 1.3: Implement detectTailscale for the running case**

Replace the function body in `src/remote/tailscale.ts`:

```ts
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

  const data = JSON.parse(stdout)
  const backendState: string = data.BackendState ?? ''

  if (backendState !== 'Running') {
    return { state: 'not-connected', backendState }
  }

  const ip: string = data.Self?.TailscaleIPs?.[0] ?? ''
  const rawHostname: string = data.Self?.DNSName ?? ''
  const hostname = rawHostname.replace(/\.$/, '')

  return { state: 'running', ip, hostname }
}
```

- [ ] **Step 1.4: Run the test to verify it passes**

Run: `cd colive-terminal && npx vitest run test/remote/tailscale.test.ts`
Expected: PASS

- [ ] **Step 1.5: Add tests for not-installed and not-connected states**

Append to `test/remote/tailscale.test.ts`:

```ts
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
```

- [ ] **Step 1.6: Run tests to verify they all pass**

Run: `cd colive-terminal && npx vitest run test/remote/tailscale.test.ts`
Expected: 4 tests PASS

- [ ] **Step 1.7: Add test for empty DNSName (MagicDNS disabled)**

Append to `test/remote/tailscale.test.ts`:

```ts
  it('returns empty hostname when DNSName is empty (MagicDNS disabled)', async () => {
    const noDns = JSON.stringify({
      BackendState: 'Running',
      Self: { TailscaleIPs: ['100.64.1.2'], DNSName: '', Online: true },
    })
    const exec: ShellExec = async () => ({ stdout: noDns, stderr: '' })
    const result = await detectTailscale(exec)
    expect(result).toEqual({ state: 'running', ip: '100.64.1.2', hostname: '' })
  })
```

- [ ] **Step 1.8: Run full test suite + typecheck**

Run: `cd colive-terminal && npx vitest run test/remote/tailscale.test.ts && npm run typecheck`
Expected: 5 tests PASS, typecheck clean

- [ ] **Step 1.9: Commit**

```bash
cd colive-terminal
git add src/remote/tailscale.ts test/remote/tailscale.test.ts
git commit -m "feat(remote): Tailscale detector — detect state, extract IP + MagicDNS hostname"
```

---

### Task 2: Remote Config Reader/Writer

**Files:**
- Create: `src/remote/config.ts`
- Create: `test/remote/config.test.ts`

Pure module for reading and writing `~/.config/colive/remote.json`. The config dir path is injectable for testing (so we write to a tmp dir, not the real home dir).

- [ ] **Step 2.1: Write types and failing test for readRemoteConfig**

Create `src/remote/config.ts`:

```ts
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

export interface RemoteConfig {
  tailscaleHostname: string
  tailscaleIp: string
  prefer: 'hostname' | 'ip'
}

const CONFIG_DIR_NAME = '.config/colive'
const CONFIG_FILE_NAME = 'remote.json'

function configPath(configDir?: string): string {
  return join(configDir ?? join(homedir(), CONFIG_DIR_NAME), CONFIG_FILE_NAME)
}

export async function readRemoteConfig(configDir?: string): Promise<RemoteConfig | null> {
  throw new Error('not implemented')
}

export async function writeRemoteConfig(config: RemoteConfig, configDir?: string): Promise<string> {
  throw new Error('not implemented')
}

export function resolveRemoteHost(config: RemoteConfig): string {
  throw new Error('not implemented')
}
```

Create `test/remote/config.test.ts`:

```ts
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
})
```

- [ ] **Step 2.2: Run the test to verify it fails**

Run: `cd colive-terminal && npx vitest run test/remote/config.test.ts`
Expected: FAIL with "not implemented"

- [ ] **Step 2.3: Implement readRemoteConfig**

Replace the function body in `src/remote/config.ts`:

```ts
export async function readRemoteConfig(configDir?: string): Promise<RemoteConfig | null> {
  const path = configPath(configDir)
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return null
  }

  const data = JSON.parse(raw)
  if (
    typeof data.tailscaleHostname !== 'string' ||
    typeof data.tailscaleIp !== 'string' ||
    (data.prefer !== 'hostname' && data.prefer !== 'ip')
  ) {
    throw new Error(`Invalid remote config at ${path}: missing or malformed fields`)
  }

  return {
    tailscaleHostname: data.tailscaleHostname,
    tailscaleIp: data.tailscaleIp,
    prefer: data.prefer,
  }
}
```

- [ ] **Step 2.4: Run test to verify it passes**

Run: `cd colive-terminal && npx vitest run test/remote/config.test.ts`
Expected: PASS

- [ ] **Step 2.5: Add writeRemoteConfig + round-trip test**

Implement `writeRemoteConfig`:

```ts
export async function writeRemoteConfig(config: RemoteConfig, configDir?: string): Promise<string> {
  const dir = configDir ?? join(homedir(), CONFIG_DIR_NAME)
  await mkdir(dir, { recursive: true })
  const path = join(dir, CONFIG_FILE_NAME)
  await writeFile(path, JSON.stringify(config, null, 2) + '\n', 'utf8')
  return path
}
```

Add test:

```ts
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
```

- [ ] **Step 2.6: Add resolveRemoteHost + tests**

Implement `resolveRemoteHost`:

```ts
export function resolveRemoteHost(config: RemoteConfig): string {
  if (config.prefer === 'hostname' && config.tailscaleHostname !== '') {
    return config.tailscaleHostname
  }
  return config.tailscaleIp
}
```

Add tests:

```ts
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
```

- [ ] **Step 2.7: Add test for malformed JSON**

```ts
  it('throws on malformed config (missing prefer field)', async () => {
    dir = await mkdtemp(join(tmpdir(), 'colive-cfg-'))
    const path = join(dir, 'remote.json')
    const { writeFile: wf } = await import('node:fs/promises')
    await wf(path, JSON.stringify({ tailscaleHostname: 'x', tailscaleIp: 'y' }))
    await expect(readRemoteConfig(dir)).rejects.toThrow('missing or malformed')
  })
```

- [ ] **Step 2.8: Run full test suite + typecheck**

Run: `cd colive-terminal && npx vitest run test/remote/config.test.ts && npm run typecheck`
Expected: all tests PASS, typecheck clean

- [ ] **Step 2.9: Commit**

```bash
cd colive-terminal
git add src/remote/config.ts test/remote/config.test.ts
git commit -m "feat(remote): config reader/writer for ~/.config/colive/remote.json"
```

---

### Task 3: Serve Boot Changes

**Files:**
- Modify: `src/core/config.ts` (add `advertiseHost` to `ResolvedConfig`)
- Modify: `src/hub/server.ts` (use `advertiseHost` in QR + banner)
- Modify: `src/index.ts` (read remote config in `runServe`, verify Tailscale, wire the host)
- Modify: `test/hub/server.test.ts` (extend `buildQrPayload` test)
- Modify: `test/hub/index.test.ts` (extend `runServe` tests)

This task modifies existing code. The key change: when remote config exists and Tailscale is connected, `colive serve` binds to `0.0.0.0` but the QR/banner advertise the Tailscale address.

- [ ] **Step 3.1: Add `advertiseHost` to `ResolvedConfig`**

In `src/core/config.ts`, add the optional field to the `ResolvedConfig` interface:

```ts
export interface ResolvedConfig {
  model: string
  permissionMode: PermissionMode
  settingSources: SettingSource[]
  host: string
  port: number
  token: string
  projectDir: string
  advertiseHost?: string
}
```

- [ ] **Step 3.2: Run typecheck to verify no breakage**

Run: `cd colive-terminal && npm run typecheck`
Expected: clean (optional field, no existing code needs it)

- [ ] **Step 3.3: Write failing test for QR with advertiseHost**

Add to `test/hub/server.test.ts`:

```ts
  it('uses advertiseHost instead of host when provided', () => {
    const payload = buildQrPayload({
      host: '0.0.0.0',
      port: 3456,
      token: 'tok',
      advertiseHost: 'my-mac.tailnet.ts.net',
    })
    expect(payload).toBe('http://my-mac.tailnet.ts.net:3456?token=tok&defaultProvider=claude')
  })

  it('uses host when advertiseHost is not provided', () => {
    const payload = buildQrPayload({ host: '192.168.1.5', port: 3456, token: 'tok' })
    expect(payload).toBe('http://192.168.1.5:3456?token=tok&defaultProvider=claude')
  })
```

- [ ] **Step 3.4: Run to verify it fails**

Run: `cd colive-terminal && npx vitest run test/hub/server.test.ts`
Expected: FAIL (buildQrPayload doesn't accept advertiseHost yet)

- [ ] **Step 3.5: Update buildQrPayload to accept and use advertiseHost**

In `src/hub/server.ts`, change the `buildQrPayload` signature and body:

```ts
export function buildQrPayload(config: {
  host: string
  port: number
  token: string
  advertiseHost?: string
}): string {
  const host = config.advertiseHost ?? config.host
  return `http://${host}:${config.port}?token=${config.token}&defaultProvider=claude`
}
```

- [ ] **Step 3.6: Update printStartupBanner to show Tailscale + localhost when advertiseHost is set**

In `src/hub/server.ts`, modify `printStartupBanner`:

```ts
function printStartupBanner(config: ResolvedConfig, boundPort: number): void {
  const payload = buildQrPayload({
    host: config.host,
    port: boundPort,
    token: config.token,
    advertiseHost: config.advertiseHost,
  })
  // eslint-disable-next-line no-console
  console.log('\nCo-Live Terminal — Client Hub')
  if (config.advertiseHost) {
    console.log(`  listening   http://0.0.0.0:${boundPort}`)
    console.log(`  glasses     http://${config.advertiseHost}:${boundPort} (via Tailscale)`)
    console.log(`  desk        http://localhost:${boundPort}`)
  } else {
    console.log(`  listening   http://${config.host}:${boundPort}`)
  }
  console.log(`  model       ${config.model}`)
  console.log('\nScan to connect:')
  qrcode.generate(payload, { small: true }, (qr) => console.log(qr))
  console.log('Or enter manually:')
  console.log(`  host   ${config.advertiseHost ?? config.host}`)
  console.log(`  port   ${boundPort}`)
  console.log(`  token  ${config.token}\n`)
}
```

- [ ] **Step 3.7: Run server tests to verify they pass**

Run: `cd colive-terminal && npx vitest run test/hub/server.test.ts`
Expected: all tests PASS

- [ ] **Step 3.8: Modify runServe to read remote config and verify Tailscale**

In `src/index.ts`, update the `runServe` function. Add imports at the top:

```ts
import { readRemoteConfig, resolveRemoteHost } from './remote/config'
import { detectTailscale, type ShellExec } from './remote/tailscale'
```

Replace `runServe`:

```ts
export async function runServe(
  argv: string[],
  env: ConfigEnv = process.env,
  exec?: ShellExec,
): Promise<RunningServer> {
  const args = parseServeArgs(argv)
  const config = resolveConfig(env, args)

  if (args.host !== undefined) {
    return startServer(config)
  }

  const remoteConfig = await readRemoteConfig()
  if (remoteConfig === null) {
    throw new Error(
      'No remote config found. Run `colive setup` first, or pass `--host <ip>` manually.',
    )
  }

  const tsState = await detectTailscale(exec)
  if (tsState.state !== 'running') {
    const hint =
      tsState.state === 'not-installed'
        ? 'Tailscale is not installed. Run `colive setup` for installation guidance.'
        : `Tailscale is not connected (state: ${tsState.backendState}). Run \`tailscale up\` or open the menu bar app.`
    throw new Error(hint)
  }

  const advertiseHost = resolveRemoteHost(remoteConfig)
  return startServer({ ...config, host: '0.0.0.0', advertiseHost })
}
```

- [ ] **Step 3.9: Run full test suite + typecheck**

Run: `cd colive-terminal && npm test && npm run typecheck`
Expected: all existing tests PASS, typecheck clean. (The `runServe` tests in `index.test.ts` don't inject a remote config, so they still test the `--host` override path which skips the new logic.)

- [ ] **Step 3.10: Commit**

```bash
cd colive-terminal
git add src/core/config.ts src/hub/server.ts src/index.ts test/hub/server.test.ts
git commit -m "feat(remote): serve reads Tailscale config, QR advertises Tailscale address"
```

---

### Task 4: Setup Wizard

**Files:**
- Create: `src/remote/setup.ts`
- Create: `test/remote/setup.test.ts`

The interactive wizard. Uses an injectable I/O interface so the integration test drives it without a real TTY or Tailscale installation.

- [ ] **Step 4.1: Define the WizardIO interface and write the skeleton**

Create `src/remote/setup.ts`:

```ts
import { createInterface } from 'node:readline/promises'
import http from 'node:http'
import { detectTailscale, type ShellExec, type TailscaleState } from './tailscale'
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
  throw new Error('not implemented')
}
```

- [ ] **Step 4.2: Write the integration test for the happy path**

Create `test/remote/setup.test.ts`:

```ts
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
})
```

- [ ] **Step 4.3: Run the test to verify it fails**

Run: `cd colive-terminal && npx vitest run test/remote/setup.test.ts`
Expected: FAIL with "not implemented"

- [ ] **Step 4.4: Implement runSetup**

Replace the function body in `src/remote/setup.ts`:

```ts
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
  const prefer = tsState.hostname ? 'hostname' : 'ip' as const
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
```

- [ ] **Step 4.5: Run the test to verify it passes**

Run: `cd colive-terminal && npx vitest run test/remote/setup.test.ts`
Expected: PASS

- [ ] **Step 4.6: Add test for not-installed → re-check → found flow**

Append to `test/remote/setup.test.ts`:

```ts
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
```

- [ ] **Step 4.7: Add test for not-connected → re-check → connected flow**

```ts
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
```

- [ ] **Step 4.8: Add test for empty hostname → prefer=ip**

```ts
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
```

- [ ] **Step 4.9: Run full test suite + typecheck**

Run: `cd colive-terminal && npm test && npm run typecheck`
Expected: all tests PASS, typecheck clean

- [ ] **Step 4.10: Commit**

```bash
cd colive-terminal
git add src/remote/setup.ts test/remote/setup.test.ts
git commit -m "feat(remote): setup wizard — detect Tailscale, guide iPhone, write config"
```

---

### Task 5: Wire `colive setup` + Update Usage

**Files:**
- Modify: `src/index.ts` (add `setup` case to `main`)
- Modify: `test/hub/index.test.ts` (test the new subcommand)

- [ ] **Step 5.1: Add the `setup` case to `main()` in index.ts**

In `src/index.ts`, add the import at the top:

```ts
import { runSetup, createDefaultIO } from './remote/setup'
```

In the `switch (subcommand)` block, add between `desk` and `default`:

```ts
    case 'setup':
      try {
        await runSetup({ io: createDefaultIO() })
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(err instanceof Error ? err.message : String(err))
        process.exitCode = 1
      }
      return
```

Update the usage line in the `default` case:

```ts
      console.error('Usage: colive <serve|desk|setup> [options]')
```

- [ ] **Step 5.2: Run typecheck**

Run: `cd colive-terminal && npm run typecheck`
Expected: clean

- [ ] **Step 5.3: Run full test suite**

Run: `cd colive-terminal && npm test`
Expected: all existing tests PASS. The `runServe` tests that pass `--host` explicitly skip the remote config path. Tests without `--host` will now fail with "No remote config found" — if any of those exist, they need to be updated to pass `--host 127.0.0.1` explicitly.

- [ ] **Step 5.4: Fix any runServe tests that now fail**

Check `test/hub/index.test.ts`. The existing `runServe` boot test calls `runServe([], env)` — with no `--host` arg, it will now try to read remote config and fail. Fix by passing `--host 127.0.0.1` explicitly:

In the test that calls `runServe`, change the argv from `[]` to `['--host', '127.0.0.1']`:

```ts
running = await runServe(['--host', '127.0.0.1'], {
  // ... existing env overrides
})
```

- [ ] **Step 5.5: Run full test suite again**

Run: `cd colive-terminal && npm test`
Expected: all tests PASS

- [ ] **Step 5.6: Commit**

```bash
cd colive-terminal
git add src/index.ts test/hub/index.test.ts
git commit -m "feat(remote): wire colive setup subcommand + update serve boot path"
```

---

### Task 6: Fallback Documentation

**Files:**
- Create: `colive-terminal/docs/remote-setup.md`

A step-by-step written guide for users who prefer reading instructions over running the wizard, or as a reference for what the wizard does.

- [ ] **Step 6.1: Write the guide**

Create `colive-terminal/docs/remote-setup.md`:

```markdown
# Remote Setup Guide (Tailscale)

Use your G2 glasses from anywhere — not just your home LAN — by routing
all traffic through Tailscale. This is a one-time setup.

## 1. Install Tailscale on your Mac

Choose one:

- **Homebrew:** `brew install tailscale`
- **Mac App Store / direct download:** https://tailscale.com/download/mac

After installing, connect:

```
tailscale up
```

Or open the Tailscale menu bar app and sign in. Verify with:

```
tailscale status
```

You should see your machine listed with an IP like `100.x.y.z`.

## 2. Install Tailscale on your iPhone

1. Download **Tailscale** from the App Store.
2. Sign in with the **same account** as your Mac.
3. Tap **Connect**. It will ask to install a VPN profile — allow it.
4. Verify it shows "Connected" in the Tailscale app.

## 3. Run `colive setup`

From the `colive-terminal` directory:

```
npm run dev -- setup
```

The wizard detects your Tailscale state, captures your Mac's Tailscale IP
and MagicDNS hostname, and saves them to `~/.config/colive/remote.json`.

## 4. Start serving

```
npm run dev -- serve
```

The QR code will point to your Tailscale address. Scan it from the Even
app on your phone — the glasses connect through Tailscale from the start.

The desk client still connects via localhost:

```
npm run dev -- desk --host localhost --port 3456 --token <token>
```

## 5. Verify remote access

1. Connect your glasses via the QR while on the same WiFi.
2. Switch your phone to cellular (turn off WiFi).
3. The glasses should continue working — Tailscale re-routes transparently.

## Manual config (without the wizard)

If you prefer to skip the wizard, create `~/.config/colive/remote.json`:

```json
{
  "tailscaleHostname": "your-mac.tailnet-name.ts.net",
  "tailscaleIp": "100.x.y.z",
  "prefer": "hostname"
}
```

Get these values from `tailscale status --json` (look for `Self.TailscaleIPs[0]`
and `Self.DNSName`).

## Troubleshooting

- **`colive serve` fails with "Tailscale is not connected"** — run `tailscale up`
  or open the Tailscale menu bar app.
- **Glasses can't connect** — make sure your phone's Tailscale VPN is active
  (check the Tailscale app on your phone).
- **Slow connection** — if Tailscale can't establish a direct connection, it
  relays through a DERP server. This adds latency but still works. Check
  `tailscale status` for "relay" indicators.
```

- [ ] **Step 6.2: Commit**

```bash
cd colive-terminal
git add docs/remote-setup.md
git commit -m "docs: Tailscale remote setup guide (fallback for colive setup wizard)"
```

- [ ] **Step 6.3: Run full test suite + typecheck one final time**

Run: `cd colive-terminal && npm test && npm run typecheck`
Expected: all tests PASS, typecheck clean

---

## Hardware Acceptance (Task 7 — manual, not automated)

After all code tasks are complete, this is the acceptance test performed by the user with real hardware. Not tracked as build steps — this is the UAT run-book.

1. Install Tailscale on Mac + iPhone (if not already done during `colive setup`).
2. Run `colive setup` — verify it detects Tailscale, writes config to `~/.config/colive/remote.json`.
3. Run `colive serve` — verify the QR encodes the Tailscale address (check the banner output).
4. Scan QR from the glasses (Even app). Verify connection works on the same LAN.
5. On the phone, disconnect from home WiFi (leave only cellular + Tailscale VPN). Verify the glasses still work — send a message, get a response on the HUD.
6. **The big moment:** start a session at the desk via `colive desk`, interact, then physically leave the house (or disconnect WiFi). Dictate a follow-up from the glasses. Verify the response streams to the HUD.
7. Record 🧪 result in `projects/colive-terminal/notes.md` + `PROGRESS.md`.
