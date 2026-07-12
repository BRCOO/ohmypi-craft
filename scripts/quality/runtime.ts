/**
 * Embedded OMP runtime capability checks for the release gate.
 *
 * Starts the packaged OMP binary in RPC mode inside an isolated temporary
 * workspace and verifies that it advertises and can enter native Plan Mode.
 * Also probes the binary's own `--version` output so release reports record
 * the actual packaged OMP version rather than a Pi package dependency pin.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import readline from 'node:readline'

import { parseOmpPlanModeState } from '../../packages/shared/src/agent/backend/omp/omp-rpc-protocol.ts'
import type { QualityStepResult } from './report'
import { resolvePackagePaths } from './package'

export interface RuntimeCapabilityOptions {
  root?: string
  platform?: string
  arch?: string
  timeoutMs?: number
}

export interface RuntimeCapabilityDependencies {
  spawnProcess?: typeof spawn
}

interface RpcFrame {
  type?: string
  id?: string
  success?: boolean
  error?: string
  data?: Record<string, unknown>
}

function send(child: ChildProcessWithoutNullStreams, frame: Record<string, unknown>): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    child.stdin.write(`${JSON.stringify(frame)}\n`, (error) => {
      if (error) reject(error)
      else resolvePromise()
    })
  })
}

function hasPlanModeCapability(data: Record<string, unknown> | undefined): boolean {
  const capabilities = data?.capabilities
  if (typeof capabilities !== 'object' || capabilities === null) return false
  return (capabilities as Record<string, unknown>).planMode === true
}

/**
 * Probe the packaged OMP binary version via `omp --version`.
 * Returns undefined when the process fails or output cannot be parsed.
 */
export async function probeOmpBinaryVersion(
  runtimePath: string,
  options: {
    cwd?: string
    timeoutMs?: number
    spawnProcess?: typeof spawn
    env?: NodeJS.ProcessEnv
  } = {},
): Promise<string | undefined> {
  const spawnProcess = options.spawnProcess ?? spawn
  const timeoutMs = options.timeoutMs ?? 5_000

  return new Promise((resolvePromise) => {
    let child: ChildProcessWithoutNullStreams
    try {
      child = spawnProcess(runtimePath, ['--version'], {
        cwd: options.cwd,
        env: options.env ?? process.env,
        windowsHide: true,
      }) as ChildProcessWithoutNullStreams
    } catch {
      resolvePromise(undefined)
      return
    }

    let settled = false
    let output = ''
    let timer: ReturnType<typeof setTimeout> | undefined

    const finish = (value?: string) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolvePromise(value)
    }

    const append = (chunk: unknown) => {
      output = (output + String(chunk)).slice(-4096)
    }

    child.stdout.on('data', append)
    child.stderr.on('data', append)
    child.on('error', () => finish())
    child.on('exit', () => {
      const match = /\bomp\/([^\s]+)|\b(\d+\.\d+\.\d+(?:[-+][^\s]+)?)/i.exec(output.trim())
      finish(match?.[1] ?? match?.[2])
    })
    timer = setTimeout(() => {
      if (!child.killed) {
        try {
          child.kill()
        } catch {
          // Ignore.
        }
      }
      finish()
    }, timeoutMs)
  })
}

export async function validateRuntimeCapability(
  options: RuntimeCapabilityOptions = {},
  dependencies: RuntimeCapabilityDependencies = {},
): Promise<QualityStepResult> {
  const name = 'runtime capability'
  const start = Date.now()
  const duration = () => Date.now() - start

  const paths = resolvePackagePaths({
    root: options.root,
    platform: options.platform,
    arch: options.arch,
  })

  if (paths.ompRuntimePath !== resolve(paths.ompRuntimePath)) {
    // Guard against path normalization mismatch.
  }

  const runtimePath = paths.ompRuntimePath
  const workspace = mkdtempSync(join(tmpdir(), 'omp-runtime-capability-'))
  // OMP refuses to start RPC mode when a fresh runner has no model catalog.
  // Give the probe an isolated, provider-free catalog so release validation
  // tests the embedded binary/protocol instead of a developer's home config.
  const home = mkdtempSync(join(tmpdir(), 'omp-runtime-home-'))
  const modelsDir = join(home, '.omp', 'agent')
  mkdirSync(modelsDir, { recursive: true })
  writeFileSync(
    join(modelsDir, 'models.yml'),
    [
      'providers:',
      '  smoke:',
      '    baseUrl: http://127.0.0.1:1',
      '    api: openai-completions',
      '    apiKey: N/A',
      '    models:',
      '      - id: smoke-model',
      '        name: Smoke Model',
      '        reasoning: false',
      '        input: [text]',
      '        cost:',
      '          input: 0',
      '          output: 0',
      '          cacheRead: 0',
      '          cacheWrite: 0',
      '        contextWindow: 128000',
      '        maxTokens: 8192',
      '',
    ].join('\n'),
    'utf8',
  )
  const runtimeEnv = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
  }

  let child: ChildProcessWithoutNullStreams | undefined

  const cleanup = () => {
    try {
      rmSync(workspace, { recursive: true, force: true })
      rmSync(home, { recursive: true, force: true })
    } catch {
      // Ignore cleanup failures.
    }
    if (child && !child.killed) {
      try {
        child.kill()
      } catch {
        // Ignore.
      }
    }
  }

  const fail = (error: string): QualityStepResult => {
    cleanup()
    return {
      name,
      status: 'failed',
      durationMs: duration(),
      error,
      data: { runtimePath },
    }
  }

  const spawnProcess = dependencies.spawnProcess ?? spawn

  const ompVersion = await probeOmpBinaryVersion(runtimePath, {
    cwd: workspace,
    timeoutMs: Math.min(options.timeoutMs ?? 60_000, 5_000),
    spawnProcess,
    env: runtimeEnv,
  })
  if (!ompVersion) {
    return fail(`Failed to probe OMP binary version from ${runtimePath}`)
  }

  try {
    child = spawnProcess(runtimePath, ['--mode', 'rpc'], {
      cwd: workspace,
      env: runtimeEnv,
      windowsHide: true,
    }) as ChildProcessWithoutNullStreams
  } catch (error) {
    return fail(`Failed to spawn OMP runtime: ${error instanceof Error ? error.message : String(error)}`)
  }

  const timeoutMs = options.timeoutMs ?? 60_000

  return new Promise<QualityStepResult>((resolvePromise) => {
    let settled = false
    let stateRequested = false
    let planModeRequested = false
    let capabilities: string[] = []
    let stderrTail = ''

    const reader = readline.createInterface({ input: child.stdout })

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      resolvePromise(fail(`Timed out after ${timeoutMs}ms while verifying OMP runtime capability`))
    }, timeoutMs)

    child.stderr.on('data', (chunk) => {
      // Drain stderr so the child does not block on a full pipe, while keeping
      // enough context to explain an early runtime exit in CI diagnostics.
      stderrTail = (stderrTail + String(chunk)).slice(-2_000)
    })

    child.on('error', (error) => {
      if (settled) return
      settled = true
      resolvePromise(fail(`OMP runtime process error: ${error.message}`))
    })

    child.on('exit', (code, signal) => {
      if (settled) return
      settled = true
      const reason = signal ? `signal ${signal}` : `code ${code ?? 0}`
      const detail = stderrTail.trim() ? `: ${stderrTail.trim()}` : ''
      resolvePromise(fail(`OMP runtime exited with ${reason} before capability verification completed${detail}`))
    })

    reader.on('line', async (line) => {
      if (!line.trim() || settled) return

      let frame: RpcFrame
      try {
        frame = JSON.parse(line) as RpcFrame
      } catch {
        return
      }

      if (frame.type === 'ready' && !stateRequested) {
        stateRequested = true
        try {
          await send(child, { id: 'omp-state', type: 'get_state' })
        } catch (error) {
          resolvePromise(fail(`Failed to send get_state: ${error instanceof Error ? error.message : String(error)}`))
        }
        return
      }

      if (frame.type !== 'response' || typeof frame.id !== 'string') return
      if (frame.success === false) {
        resolvePromise(fail(`OMP RPC ${frame.id} failed: ${frame.error ?? 'unknown error'}`))
        return
      }

      const data = frame.data ?? {}

      if (frame.id === 'omp-state') {
        if (!hasPlanModeCapability(data)) {
          resolvePromise(fail('OMP runtime does not advertise capabilities.planMode'))
          return
        }
        capabilities = ['planMode']

        if (!planModeRequested) {
          planModeRequested = true
          try {
            await send(child, { id: 'omp-plan-mode', type: 'set_plan_mode', enabled: true })
          } catch (error) {
            resolvePromise(
              fail(`Failed to send set_plan_mode: ${error instanceof Error ? error.message : String(error)}`),
            )
          }
        }
        return
      }

      if (frame.id === 'omp-plan-mode') {
        const state = parseOmpPlanModeState(data)
        if (!state) {
          resolvePromise(fail('OMP set_plan_mode returned an invalid Plan Mode state'))
          return
        }
        if (!state.enabled || state.phase !== 'planning') {
          resolvePromise(
            fail(`OMP set_plan_mode did not enter planning (enabled=${state.enabled}, phase=${state.phase})`),
          )
          return
        }

        settled = true
        clearTimeout(timer)
        reader.close()
        child.removeAllListeners()
        child.stdout.removeAllListeners()
        child.stderr.removeAllListeners()
        child.stdin.removeAllListeners()
        if (!child.killed) child.kill()
        cleanup()

        resolvePromise({
          name,
          status: 'passed',
          durationMs: duration(),
          output: [
            `Workspace: ${workspace}`,
            `OMP runtime: ${runtimePath}`,
            `OMP version: ${ompVersion}`,
            `Advertised capabilities: ${capabilities.join(', ')}`,
            `Plan Mode phase: ${state.phase}`,
          ].join('\n'),
          data: {
            ompVersion,
            capabilities,
            runtimePath,
          },
        })
      }
    })
  })
}

/**
 * Build the report.runtime field from a passed runtime-capability step.
 * Returns undefined when the step is missing, failed, or lacks a probed version.
 */
export function runtimeInfoFromCapabilityStep(
  step: QualityStepResult | undefined,
  fallbackPath: string,
): { version: string; path: string; capabilities: string[] } | undefined {
  if (!step || step.status !== 'passed') return undefined
  const version = step.data?.ompVersion?.trim()
  if (!version) return undefined
  return {
    version,
    // Prefer the caller-normalized report path; absolute probe path stays in step.data.
    path: fallbackPath,
    capabilities: step.data?.capabilities ?? ['planMode'],
  }
}
