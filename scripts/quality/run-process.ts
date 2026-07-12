/**
 * Streaming process runner for long quality-gate steps.
 *
 * `spawnSync` with utf-8 encoding buffers the full stdout/stderr. electron-builder
 * routinely exceeds Node's 1 MB default maxBuffer after the installer is already
 * written, which surfaces as "artifact generated but command failed/timed out".
 * This helper streams output and can recover when a known artifact appears.
 */

import { spawn, type SpawnOptionsWithoutStdio } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'

export interface RunProcessOptions {
  cwd: string
  env?: NodeJS.ProcessEnv
  /** Soft wall-clock limit. On timeout the child is killed; recovery may still apply. */
  timeoutMs?: number
  /** Captured tail length kept for the step report. */
  captureTailBytes?: number
  shell?: boolean
}

export interface RunProcessResult {
  status: number | null
  signal: NodeJS.Signals | null
  durationMs: number
  timedOut: boolean
  stdoutTail: string
  stderrTail: string
  error?: string
}

export interface ArtifactRecoveryOptions {
  /** Absolute path that must exist after a successful build. */
  path: string
  /** Reject artifacts older than this (ms before process start). Default 10 minutes. */
  maxAgeMs?: number
  /** Minimum size in bytes. Default 1 MB for NSIS installers. */
  minBytes?: number
}

function appendTail(current: string, chunk: string, maxBytes: number): string {
  const next = `${current}${chunk}`
  if (next.length <= maxBytes) return next
  return next.slice(next.length - maxBytes)
}

export function runProcess(
  command: string,
  args: string[],
  options: RunProcessOptions,
): Promise<RunProcessResult> {
  const start = Date.now()
  const captureTailBytes = options.captureTailBytes ?? 32 * 1024

  return new Promise((resolve) => {
    let stdoutTail = ''
    let stderrTail = ''
    let timedOut = false
    let settled = false

    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : process.env,
      shell: options.shell ?? false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    } satisfies SpawnOptionsWithoutStdio)

    const finish = (status: number | null, signal: NodeJS.Signals | null, error?: string) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve({
        status,
        signal,
        durationMs: Date.now() - start,
        timedOut,
        stdoutTail: stdoutTail.trim(),
        stderrTail: stderrTail.trim(),
        error,
      })
    }

    child.stdout?.on('data', (chunk: Buffer | string) => {
      const text = String(chunk)
      process.stdout.write(text)
      stdoutTail = appendTail(stdoutTail, text, captureTailBytes)
    })
    child.stderr?.on('data', (chunk: Buffer | string) => {
      const text = String(chunk)
      process.stderr.write(text)
      stderrTail = appendTail(stderrTail, text, captureTailBytes)
    })

    child.on('error', (error) => {
      finish(null, null, error.message)
    })

    child.on('exit', (code, signal) => {
      finish(code, signal)
    })

    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true
          try {
            child.kill()
          } catch {
            // best effort
          }
          // Give a short grace period for exit handlers; force resolve if hung.
          setTimeout(() => {
            finish(null, 'SIGTERM', `Timed out after ${options.timeoutMs}ms`)
          }, 5_000)
        }, options.timeoutMs)
      : null
  })
}

/**
 * True when a release artifact looks freshly produced for this build attempt.
 * Used to recover from post-write hangs / maxBuffer-style process kills.
 */
export function isRecoverableArtifact(
  artifact: ArtifactRecoveryOptions,
  processStartedAt: number,
): boolean {
  if (!existsSync(artifact.path)) return false
  try {
    const stats = statSync(artifact.path)
    if (!stats.isFile()) return false
    const minBytes = artifact.minBytes ?? 1_000_000
    if (stats.size < minBytes) return false
    const maxAgeMs = artifact.maxAgeMs ?? 10 * 60 * 1000
    // Accept files written during this run, or slightly before start (clock skew / FS delay).
    return stats.mtimeMs >= processStartedAt - maxAgeMs
  } catch {
    return false
  }
}

export function processFailed(result: RunProcessResult): boolean {
  if (result.error) return true
  if (result.timedOut) return true
  if (result.signal) return true
  return result.status !== 0
}
