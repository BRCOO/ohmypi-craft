import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { CliRpcClient } from '../apps/cli/src/client.ts'
import { type CliArgs, setupLlmConnection } from '../apps/cli/src/index.ts'
import type { OmpFeatureCenterStateDto } from '../packages/shared/src/protocol/dto.ts'

const ROOT_DIR = join(import.meta.dir, '..')
const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_SEND_TIMEOUT_MS = 180_000

interface SmokeArgs {
  exe?: string
  message: string
  model?: string
  timeoutMs: number
  sendTimeoutMs: number
  skipSend: boolean
  keepArtifacts: boolean
  allowMissingPackage: boolean
}

interface HeadlessInfo {
  url: string
  token: string
}

interface Workspace {
  id: string
}

interface Session {
  id: string
}

function parseArgs(argv: string[]): SmokeArgs {
  const args = argv.slice(2)
  const parsed: SmokeArgs = {
    message: '/context',
    timeoutMs: DEFAULT_TIMEOUT_MS,
    sendTimeoutMs: DEFAULT_SEND_TIMEOUT_MS,
    skipSend: false,
    keepArtifacts: false,
    allowMissingPackage: false,
  }

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    switch (arg) {
      case '--exe':
        parsed.exe = args[++i]
        break
      case '--message':
        parsed.message = args[++i] ?? parsed.message
        break
      case '--model':
        parsed.model = args[++i]
        break
      case '--timeout':
        parsed.timeoutMs = Number.parseInt(args[++i] ?? String(DEFAULT_TIMEOUT_MS), 10)
        break
      case '--send-timeout':
        parsed.sendTimeoutMs = Number.parseInt(args[++i] ?? String(DEFAULT_SEND_TIMEOUT_MS), 10)
        break
      case '--skip-send':
        parsed.skipSend = true
        break
      case '--keep-artifacts':
        parsed.keepArtifacts = true
        break
      case '--allow-missing-package':
        parsed.allowMissingPackage = true
        break
      default:
        throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return parsed
}

function defaultPackagedExe(): string {
  if (process.platform === 'win32') {
    return join(ROOT_DIR, 'apps', 'electron', 'release', 'win-unpacked', 'Oh My Pi.exe')
  }
  if (process.platform === 'darwin') {
    return join(ROOT_DIR, 'apps', 'electron', 'release', 'mac', 'Oh My Pi.app', 'Contents', 'MacOS', 'Oh My Pi')
  }
  return join(ROOT_DIR, 'apps', 'electron', 'release', 'linux-unpacked', 'oh-my-pi')
}

function parseHeadlessInfo(raw: string): HeadlessInfo {
  const pairs = new Map<string, string>()
  for (const line of raw.split(/\r?\n/)) {
    const index = line.indexOf('=')
    if (index <= 0) continue
    pairs.set(line.slice(0, index), line.slice(index + 1))
  }

  const url = pairs.get('CRAFT_SERVER_URL')
  const token = pairs.get('CRAFT_SERVER_TOKEN')
  if (!url || !token) {
    throw new Error('Headless connection file did not contain CRAFT_SERVER_URL and CRAFT_SERVER_TOKEN')
  }
  return { url, token }
}

async function waitForHeadlessInfo(filePath: string, timeoutMs: number): Promise<HeadlessInfo> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown

  while (Date.now() < deadline) {
    try {
      return parseHeadlessInfo(await readFile(filePath, 'utf8'))
    } catch (error) {
      lastError = error
      await new Promise(resolve => setTimeout(resolve, 250))
    }
  }

  throw new Error(`Timed out waiting for headless connection file (${filePath}): ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

async function waitForSendEvents(
  client: CliRpcClient,
  sessionId: string,
  message: string,
  timeoutMs: number,
): Promise<{ eventTypes: string[]; textDeltaCount: number }> {
  const seen = new Set<string>()
  let textDeltaCount = 0
  let finished = false
  let terminalError = ''

  const unsub = client.on('session:event', (event: unknown) => {
    const ev = event as { type?: string; sessionId?: string; error?: unknown; [key: string]: unknown }
    if (ev.sessionId !== sessionId || !ev.type) return

    seen.add(ev.type)
    if (ev.type === 'text_delta') textDeltaCount += 1
    if (ev.type === 'error') {
      terminalError = String(ev.error ?? 'unknown session error')
      finished = true
    } else if (ev.type === 'complete' || ev.type === 'interrupted') {
      finished = true
    }
  })

  try {
    await client.invoke('sessions:sendMessage', sessionId, message)

    const deadline = Date.now() + timeoutMs
    while (!finished && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    if (!finished) {
      throw new Error(`Timed out waiting for session completion. Seen events: ${[...seen].join(', ') || 'none'}`)
    }
    if (terminalError) {
      throw new Error(`Session returned an error event: ${terminalError}`)
    }
    if (!seen.has('complete')) {
      throw new Error(`Session did not complete successfully. Seen events: ${[...seen].join(', ')}`)
    }
    const hasMeaningfulOutput = textDeltaCount > 0
      || seen.has('info')
      || seen.has('status')
      || seen.has('extension_ui_request')
      || seen.has('tool_start')
      || seen.has('tool_result')
    if (!hasMeaningfulOutput) {
      throw new Error(`Session completed without visible output events. Seen events: ${[...seen].join(', ')}`)
    }

    return { eventTypes: [...seen], textDeltaCount }
  } finally {
    unsub()
  }
}

function cliSetupArgs(): CliArgs {
  return {
    url: '',
    token: '',
    timeout: 30_000,
    json: false,
    sendTimeout: DEFAULT_SEND_TIMEOUT_MS,
    command: '',
    rest: [],
    sources: [],
    mode: '',
    outputFormat: 'text',
    noCleanup: false,
    noSpinner: true,
    verbose: false,
    provider: 'omp',
    model: '',
    apiKey: '',
    baseUrl: '',
  }
}

async function stopProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
  const hasExited = () => child.exitCode !== null || child.signalCode !== null
  const waitForExit = async (timeoutMs: number): Promise<boolean> => {
    if (hasExited()) return true
    return await Promise.race([
      new Promise<boolean>(resolve => child.once('exit', () => resolve(true))),
      new Promise<boolean>(resolve => setTimeout(() => resolve(false), timeoutMs)),
    ])
  }

  if (hasExited()) return
  child.kill()
  if (await waitForExit(5_000)) return

  if (!hasExited()) {
    child.kill('SIGKILL')
    await waitForExit(5_000)
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv)
  const exe = resolve(args.exe ?? defaultPackagedExe())
  if (!existsSync(exe)) {
    const message = `Packaged Electron app not found: ${exe}`
    if (args.allowMissingPackage) {
      console.warn(`⚠️  ${message}`)
      return
    }
    throw new Error(`${message}. Run bun run electron:dist:dev:win first.`)
  }

  const runRoot = join(ROOT_DIR, '.tmp', `packaged-e2e-${Date.now()}`)
  const configDir = join(runRoot, 'config')
  const workspaceDir = join(runRoot, 'workspace')
  const headlessFile = join(runRoot, 'headless.env')
  await mkdir(configDir, { recursive: true })
  await mkdir(workspaceDir, { recursive: true })

  const child = spawn(exe, [], {
    cwd: dirname(exe),
    env: {
      ...process.env,
      CRAFT_HEADLESS: '1',
      CRAFT_CONFIG_DIR: configDir,
      CRAFT_HEADLESS_LOG_FILE: headlessFile,
      CRAFT_IS_PACKAGED: 'true',
      CRAFT_APP_NAME: 'Oh My Pi Packaged Smoke',
      CRAFT_RPC_PORT: '0',
      ELECTRON_ENABLE_LOGGING: '1',
      ELECTRON_ENABLE_STACK_DUMPING: '1',
      NO_UPDATE_NOTIFIER: '1',
    },
    windowsHide: true,
  })

  let stdoutTail = ''
  let stderrTail = ''
  child.stdout.on('data', chunk => {
    stdoutTail = `${stdoutTail}${String(chunk)}`.slice(-4096)
  })
  child.stderr.on('data', chunk => {
    stderrTail = `${stderrTail}${String(chunk)}`.slice(-4096)
  })

  let waitingForStartup = true
  let rejectEarlyExit: ((error: Error) => void) | undefined
  const earlyExit = new Promise<never>((_resolve, reject) => {
    rejectEarlyExit = reject
  })
  child.once('exit', (code, signal) => {
    if (!waitingForStartup) return
    const reason = signal ? `signal ${signal}` : `code ${code ?? 0}`
    rejectEarlyExit?.(new Error(`Electron exited before writing headless connection info (${reason})`))
  })

  let sessionId: string | undefined
  let client: CliRpcClient | undefined
  let succeeded = false

  try {
    const info = await Promise.race([
      waitForHeadlessInfo(headlessFile, args.timeoutMs),
      earlyExit,
    ])
    waitingForStartup = false
    client = new CliRpcClient(info.url, {
      token: info.token,
      requestTimeout: 60_000,
      connectTimeout: 30_000,
    })
    await client.connect()

    await client.invoke('system:versions')

    const workspace = await client.invoke('workspaces:create', workspaceDir, 'packaged-e2e-workspace') as Workspace
    await client.invoke('window:switchWorkspace', workspace.id).catch(() => {})

    const featureCenter = await client.invoke('omp:getFeatureCenterState', workspace.id) as OmpFeatureCenterStateDto
    const resourceSummary = {
      skills: featureCenter.skills.count,
      mcp: featureCenter.mcp.count,
      agents: featureCenter.agents.count,
    }

    const connection = await setupLlmConnection(client, cliSetupArgs())
    const selectedModel = args.model

    const session = await client.invoke('sessions:create', workspace.id, {
      permissionMode: 'allow-all',
      name: 'Packaged OMP smoke',
    }) as Session
    sessionId = session.id

    if (selectedModel) {
      await client.invoke('session:setModel', session.id, workspace.id, selectedModel, connection.connectionSlug)
    }

    let sendSummary: { eventTypes: string[]; textDeltaCount: number } | undefined
    if (!args.skipSend) {
      sendSummary = await waitForSendEvents(client, session.id, args.message, args.sendTimeoutMs)
    }

    await client.invoke('sessions:delete', session.id).catch(() => {})
    sessionId = undefined
    succeeded = true

    console.log(JSON.stringify({
      ok: true,
      executable: exe,
      url: info.url,
      workspaceId: workspace.id,
      connectionSlug: connection.connectionSlug,
      model: selectedModel ?? null,
      resourceSummary,
      sentMessage: !args.skipSend,
      sendSummary,
      artifacts: runRoot,
    }, null, 2))
  } catch (error) {
    if (stdoutTail) console.error(`Electron stdout tail:\n${stdoutTail}`)
    if (stderrTail) console.error(`Electron stderr tail:\n${stderrTail}`)
    throw error
  } finally {
    waitingForStartup = false
    if (sessionId && client?.isConnected) {
      await client.invoke('sessions:delete', sessionId).catch(() => {})
    }
    client?.destroy()
    await stopProcess(child)
    if (succeeded && !args.keepArtifacts) {
      await rm(runRoot, { recursive: true, force: true }).catch(() => {})
    }
  }
}

main().catch(error => {
  console.error('❌ Packaged Electron smoke failed:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
