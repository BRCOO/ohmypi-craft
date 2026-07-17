#!/usr/bin/env bun

/**
 * omp-cli
 *
 * A small local launcher that follows the public OMP CLI contract while adding
 * two integration helpers used by the desktop parity audit:
 *
 *   omp-cli doctor       Inspect the bundled/runtime OMP RPC surface.
 *   omp-cli rpc <cmd>    Send one typed JSON-RPC command to a fresh session.
 *
 * All other arguments are passed through unchanged to the official OMP binary.
 * That keeps this CLI compatible with upstream commands such as `acp`, `models`,
 * `plugin`, `stats`, and the normal interactive TUI.
 */

import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import readline from 'node:readline'
import { OMP_CLI_COMMANDS, findOmpCliCommand, getOmpCliManifest } from './commands.ts'

export interface ResolvedOmpCliCommand {
  command: string
  args: string[]
  source: 'env' | 'bundled' | 'path'
}

export interface OmpRpcFrame {
  type?: string
  id?: string
  command?: string
  success?: boolean
  data?: unknown
  error?: string
  [key: string]: unknown
}

const ROOT_DIR = resolve(import.meta.dir, '../../..')
const PLATFORM_DIR = `${process.platform}-${process.arch}`
const BUNDLED_EXECUTABLE = process.platform === 'win32' ? 'omp.exe' : 'omp'

export const OMP_DOCTOR_RPC_COMMANDS = [
  'get_state',
  'get_available_models',
  'get_available_commands',
  'get_runtime_resources',
  'get_plan_mode_state',
  'get_goal_state',
  'get_loop_state',
  'get_login_providers',
] as const

function splitCommand(raw: string): { command: string; args: string[] } {
  const trimmed = raw.trim()
  const quoted = trimmed.match(/^"([^"]+)"(?:\s+(.*))?$/)
  if (quoted?.[1]) return { command: quoted[1], args: quoted[2]?.split(/\s+/).filter(Boolean) ?? [] }

  // Persisted Windows paths commonly contain spaces. Keep the executable as a
  // single token when it has an executable extension.
  const windowsExecutable = trimmed.match(/^([A-Za-z]:\\.+?\.(?:exe|cmd|bat|ps1))(?:\s+(.*))?$/i)
  if (windowsExecutable?.[1]) {
    return { command: windowsExecutable[1], args: windowsExecutable[2]?.split(/\s+/).filter(Boolean) ?? [] }
  }

  const parts = trimmed.split(/\s+/).filter(Boolean)
  return { command: parts[0] ?? trimmed, args: parts.slice(1) }
}

export function resolveOmpCliCommand(env: NodeJS.ProcessEnv = process.env): ResolvedOmpCliCommand {
  const configured = env.OMP_COMMAND?.trim()
  if (configured) return { ...splitCommand(configured), source: 'env' }

  const bundled = join(ROOT_DIR, 'apps', 'electron', 'resources', 'omp', PLATFORM_DIR, BUNDLED_EXECUTABLE)
  if (existsSync(bundled)) return { command: bundled, args: [], source: 'bundled' }

  return { command: 'omp', args: [], source: 'path' }
}

function printHelp(): void {
  process.stdout.write(`omp-cli — local OMP CLI launcher\n\n`)
  process.stdout.write(`Usage:\n  omp-cli [OMP options] [COMMAND]\n  omp-cli doctor\n  omp-cli rpc <command> [json-payload]\n\n`)
  process.stdout.write(`The normal OMP CLI is passed through unchanged. Examples:\n`)
  process.stdout.write(`  omp-cli --help\n  omp-cli --model kimi-code/kimi-for-coding\n  omp-cli -p "List files in src"\n  omp-cli acp\n  omp-cli models\n  omp-cli doctor\n  omp-cli rpc get_state\n  omp-cli rpc set_model '{"provider":"kimi-code","modelId":"kimi-for-coding"}'\n\n`)
  process.stdout.write(`Environment:\n  OMP_COMMAND  Override the OMP executable and optional arguments\n`)
}

async function runPassthrough(args: string[]): Promise<number> {
  const resolved = resolveOmpCliCommand()
  const child = spawn(resolved.command, [...resolved.args, ...args], {
    cwd: process.cwd(),
    env: process.env,
    windowsHide: false,
    stdio: 'inherit',
  })
  return await new Promise<number>((resolveExit) => {
    child.once('error', (error) => {
      process.stderr.write(`omp-cli: failed to start ${resolved.command}: ${error.message}\n`)
      resolveExit(1)
    })
    child.once('exit', (code, signal) => resolveExit(code ?? (signal ? 1 : 0)))
  })
}

interface CapturedProcessResult {
  code: number
  signal: string | null
  stdout: string
  stderr: string
}

async function runCaptured(args: string[], timeoutMs = 20_000): Promise<CapturedProcessResult> {
  const resolved = resolveOmpCliCommand()
  const child = spawn(resolved.command, [...resolved.args, ...args], {
    cwd: process.cwd(),
    env: process.env,
    windowsHide: true,
    stdio: 'pipe',
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', chunk => { stdout += String(chunk) })
  child.stderr.on('data', chunk => { stderr += String(chunk) })

  return await new Promise<CapturedProcessResult>((resolveResult) => {
    const timer = setTimeout(() => {
      child.kill()
      resolveResult({ code: 124, signal: 'timeout', stdout, stderr })
    }, timeoutMs)
    child.once('error', error => {
      clearTimeout(timer)
      resolveResult({ code: 1, signal: null, stdout, stderr: `${stderr}${error.message}` })
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      resolveResult({ code: code ?? (signal ? 1 : 0), signal, stdout, stderr })
    })
  })
}

function wantsJson(args: string[]): boolean {
  return args.includes('--json')
}

function printCommandList(args: string[]): number {
  if (wantsJson(args)) {
    process.stdout.write(JSON.stringify(getOmpCliManifest(), null, 2) + '\n')
    return 0
  }
  process.stdout.write('OMP CLI commands\n\n')
  for (const command of OMP_CLI_COMMANDS) {
    const desktop = command.desktopEquivalent ? `  [desktop: ${command.desktopEquivalent}]` : ''
    process.stdout.write(`  ${command.name.padEnd(14)} ${command.description}${desktop}\n`)
  }
  process.stdout.write(`\nGlobal flags mirrored: ${getOmpCliManifest().globalFlags.length}\n`)
  return 0
}

async function checkAllCommands(args: string[]): Promise<number> {
  const timeoutMsIndex = args.indexOf('--timeout')
  const timeoutMs = timeoutMsIndex >= 0 ? Number(args[timeoutMsIndex + 1] ?? 20_000) : 20_000
  const checks: Array<Record<string, unknown>> = []
  for (const spec of OMP_CLI_COMMANDS) {
    const result = await runCaptured([spec.name, '--help'], timeoutMs)
    checks.push({
      command: spec.name,
      ok: result.code === 0,
      exitCode: result.code,
      signal: result.signal,
      helpPreview: result.stdout.trim().split(/\r?\n/).slice(0, 2).join(' '),
      error: result.code === 0 ? undefined : result.stderr.trim().slice(-500),
    })
  }
  const report = {
    ok: checks.every(check => check.ok),
    checked: checks.length,
    passed: checks.filter(check => check.ok).length,
    failed: checks.filter(check => !check.ok).map(check => check.command),
    checks,
  }
  if (wantsJson(args)) process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  else {
    process.stdout.write(`OMP CLI command help check: ${report.passed}/${report.checked} passed\n`)
    for (const check of checks) process.stdout.write(`  ${check.ok ? 'PASS' : 'FAIL'} ${String(check.command)}\n`)
  }
  return report.ok ? 0 : 1
}

interface RpcProcess {
  child: ChildProcessWithoutNullStreams
  ready: Promise<void>
  send(frame: Record<string, unknown>): Promise<OmpRpcFrame>
  stop(): void
}

function startRpcProcess(timeoutMs = 15_000): RpcProcess {
  const resolved = resolveOmpCliCommand()
  const child = spawn(resolved.command, [...resolved.args, '--mode', 'rpc', '--no-session'], {
    cwd: process.cwd(),
    env: process.env,
    windowsHide: true,
    stdio: 'pipe',
  })

  const pending = new Map<string, { resolve: (frame: OmpRpcFrame) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  let readyResolve!: () => void
  let readyReject!: (error: Error) => void
  const ready = new Promise<void>((resolveReady, rejectReady) => {
    readyResolve = resolveReady
    readyReject = rejectReady
  })
  let readySettled = false
  const startupTimer = setTimeout(() => {
    if (readySettled) return
    readySettled = true
    readyReject(new Error(`OMP RPC did not become ready within ${timeoutMs}ms`))
    child.kill()
  }, timeoutMs)

  const reader = readline.createInterface({ input: child.stdout })
  reader.on('line', (line) => {
    if (!line.trim()) return
    let frame: OmpRpcFrame
    try {
      frame = JSON.parse(line) as OmpRpcFrame
    } catch {
      return
    }
    if (frame.type === 'ready' && !readySettled) {
      readySettled = true
      clearTimeout(startupTimer)
      readyResolve()
      return
    }
    if (frame.type !== 'response' || typeof frame.id !== 'string') return
    const request = pending.get(frame.id)
    if (!request) return
    pending.delete(frame.id)
    clearTimeout(request.timer)
    if (frame.success === false) request.reject(new Error(frame.error || `${frame.command ?? 'OMP RPC'} failed`))
    else request.resolve(frame)
  })

  child.stderr.on('data', (chunk) => {
    // Keep stderr available for diagnostics without polluting JSON stdout.
    if (process.env.OMP_CLI_VERBOSE) process.stderr.write(String(chunk))
  })
  child.once('error', (error) => {
    if (!readySettled) {
      readySettled = true
      clearTimeout(startupTimer)
      readyReject(error)
    }
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    pending.clear()
  })
  child.once('exit', (code, signal) => {
    const error = new Error(`OMP exited before response (${signal ? `signal ${signal}` : `code ${code ?? 0}`})`)
    if (!readySettled) {
      readySettled = true
      clearTimeout(startupTimer)
      readyReject(error)
    }
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    pending.clear()
  })

  const send = (frame: Record<string, unknown>) => {
    const id = typeof frame.id === 'string' ? frame.id : crypto.randomUUID()
    const payload = { ...frame, id }
    return new Promise<OmpRpcFrame>((resolveResponse, rejectResponse) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        rejectResponse(new Error(`OMP RPC timeout: ${String(frame.type)}`))
      }, timeoutMs)
      pending.set(id, { resolve: resolveResponse, reject: rejectResponse, timer })
      child.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
        if (!error) return
        clearTimeout(timer)
        pending.delete(id)
        rejectResponse(error)
      })
    })
  }

  return {
    child,
    ready,
    send,
    stop: () => {
      reader.close()
      clearTimeout(startupTimer)
      for (const request of pending.values()) {
        clearTimeout(request.timer)
        request.reject(new Error('OMP RPC process stopped'))
      }
      pending.clear()
      if (!child.killed) child.kill()
    },
  }
}

function parseJsonPayload(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('RPC payload must be a JSON object')
    }
    return parsed as Record<string, unknown>
  } catch (error) {
    // PowerShell removes nested quotes from an argument such as
    // `{"provider":"kimi-code"}`. Accept a deliberately small key=value
    // fallback so the CLI remains usable on Windows without a JSON file.
    const tokens = raw.replace(/^\{/, '').replace(/\}$/, '').split(/[\s,]+/).filter(Boolean)
    const fallback: Record<string, unknown> = {}
    for (const token of tokens) {
      const separator = token.includes('=') ? '=' : ':'
      const index = token.indexOf(separator)
      if (index <= 0) {
        throw error
      }
      const key = token.slice(0, index).trim().replace(/^['"]|['"]$/g, '')
      const value = token.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')
      if (!key || !value) throw error
      fallback[key] = value
    }
    if (Object.keys(fallback).length === 0) throw error
    return fallback
  }
}

export function buildRpcPayload(command: string, rawPayload?: string): Record<string, unknown> {
  const type = command.trim().replace(/-/g, '_')
  if (!type) throw new Error('RPC command is required')
  return { type, ...parseJsonPayload(rawPayload) }
}

async function runDoctor(): Promise<number> {
  const resolved = resolveOmpCliCommand()
  const rpc = startRpcProcess()
  try {
    await rpc.ready
    const results = await Promise.all(OMP_DOCTOR_RPC_COMMANDS.map(async (type) => {
      try {
        const frame = await rpc.send({ type })
        return { type, ok: true, data: frame.data }
      } catch (error) {
        return { type, ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    }))
    const modelData = results.find((result) => result.type === 'get_available_models')?.data as { models?: unknown[] } | undefined
    const stateData = results.find((result) => result.type === 'get_state')?.data as {
      model?: unknown
      sessionId?: string
      thinkingLevel?: string
      capabilities?: unknown
    } | undefined
    const commandData = results.find((result) => result.type === 'get_available_commands')?.data as { commands?: Array<{ name?: string }> } | undefined
    const planMode = results.find((result) => result.type === 'get_plan_mode_state')?.data
    const goalMode = results.find((result) => result.type === 'get_goal_state')?.data
    const loopMode = results.find((result) => result.type === 'get_loop_state')?.data
    const resourceData = results.find((result) => result.type === 'get_runtime_resources')?.data as {
      skills?: unknown[]
      mcp?: unknown[]
      agents?: unknown[]
    } | undefined
    const modelEntries = Array.isArray(modelData?.models) ? modelData.models : []
    const modelIds = modelEntries
      .map((model) => typeof model === 'string' ? model : (model && typeof model === 'object' && 'id' in model ? String(model.id) : ''))
      .filter(Boolean)
    const activeModel = stateData?.model && typeof stateData.model === 'object' && 'id' in stateData.model
      ? String(stateData.model.id)
      : typeof stateData?.model === 'string' ? stateData.model : null
    process.stdout.write(JSON.stringify({
      ok: results.every((result) => result.ok),
      runtime: resolved,
      modelCount: modelIds.length,
      modelSample: modelIds.slice(0, 10),
      activeModel,
      thinkingLevel: stateData?.thinkingLevel ?? null,
      sessionId: stateData?.sessionId ?? null,
      planMode,
      goalMode,
      loopMode,
      resources: {
        skills: Array.isArray(resourceData?.skills) ? resourceData.skills.length : 0,
        mcp: Array.isArray(resourceData?.mcp) ? resourceData.mcp.length : 0,
        agents: Array.isArray(resourceData?.agents) ? resourceData.agents.length : 0,
      },
      commandCount: Array.isArray(commandData?.commands) ? commandData.commands.length : 0,
      commandSample: commandData?.commands?.map((command) => command.name).filter(Boolean).slice(0, 20) ?? [],
      checks: results.map((result) => ({
        type: result.type,
        ok: result.ok,
        error: result.error,
      })),
    }, null, 2) + '\n')
    return results.every((result) => result.ok) ? 0 : 1
  } catch (error) {
    process.stderr.write(`omp-cli doctor: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  } finally {
    rpc.stop()
  }
}

async function runRpc(command: string, rawPayload?: string): Promise<number> {
  const rpc = startRpcProcess()
  try {
    await rpc.ready
    const frame = await rpc.send(buildRpcPayload(command, rawPayload))
    process.stdout.write(JSON.stringify(frame.data ?? null, null, 2) + '\n')
    return 0
  } catch (error) {
    process.stderr.write(`omp-cli rpc: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  } finally {
    rpc.stop()
  }
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const [first, second, ...rest] = argv
  // Preserve upstream OMP behavior: no arguments launches the interactive TUI,
  // and --help/--version are answered by the real runtime rather than a stale
  // wrapper copy of its command list.
  if (first === 'help') {
    printHelp()
    return 0
  }
  if (first === 'commands' || first === 'capabilities') {
    return printCommandList([second, ...rest].filter((value): value is string => typeof value === 'string'))
  }
  if (first === 'check-all') return await checkAllCommands(rest)
  if (first === 'doctor') return await runDoctor()
  if (first === 'rpc') {
    if (!second) {
      process.stderr.write('Usage: omp-cli rpc <command> [json-payload]\n')
      return 2
    }
    return await runRpc(second, rest.length > 0 ? rest.join(' ') : undefined)
  }
  // `omp-cli help <command>` is a stable wrapper entry even when upstream
  // changes its help implementation; normal `<command> --help` remains a
  // transparent pass-through too.
  if (first && findOmpCliCommand(first) && second === 'help') return await runPassthrough([first, '--help', ...rest])
  return await runPassthrough(argv)
}

if (import.meta.main) {
  main().then((code) => process.exit(code)).catch((error) => {
    process.stderr.write(`omp-cli: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  })
}
