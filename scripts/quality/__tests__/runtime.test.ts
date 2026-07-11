import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { EventEmitter } from 'node:events'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import {
  probeOmpBinaryVersion,
  runtimeInfoFromCapabilityStep,
  validateRuntimeCapability,
} from '../runtime'

class FakeChild extends EventEmitter implements ChildProcessWithoutNullStreams {
  stdout = new PassThrough()
  stderr = new PassThrough()
  stdin = {
    write: (_data: string, _encoding?: unknown, callback?: (error?: Error | null) => void) => {
      if (typeof callback === 'function') callback(null)
      return true
    },
    end: () => {},
    removeAllListeners: () => this.stdin,
  } as unknown as ChildProcessWithoutNullStreams['stdin']

  killed = false

  kill(): boolean {
    this.killed = true
    return true
  }

  removeAllListeners(event?: string | symbol): this {
    super.removeAllListeners(event)
    this.stdout.removeAllListeners(event)
    this.stderr.removeAllListeners(event)
    return this
  }
}

/**
 * Sequence-aware fake spawn: first call is --version, subsequent calls are RPC.
 */
function createFakeSpawn(options: {
  versionOutput?: string | null
  rpcSequence?: (child: FakeChild) => void
}) {
  let call = 0
  return (command: string, args: string[]) => {
    call += 1
    const child = new FakeChild()

    if (args.includes('--version')) {
      setTimeout(() => {
        if (options.versionOutput === null) {
          child.emit('exit', 1, null)
          return
        }
        child.stdout.write(options.versionOutput ?? 'omp/1.4.2\n')
        child.emit('exit', 0, null)
      }, 5)
      return child
    }

    setTimeout(() => options.rpcSequence?.(child), 5)
    return child
  }
}

describe('probeOmpBinaryVersion', () => {
  it('parses omp/<version> from --version output', async () => {
    const spawn = createFakeSpawn({ versionOutput: 'omp/2.1.0-rc1 platform=win32\n' })
    const version = await probeOmpBinaryVersion('omp.exe', {
      spawnProcess: spawn as unknown as typeof import('node:child_process').spawn,
    })
    expect(version).toBe('2.1.0-rc1')
  })

  it('returns undefined when the process fails', async () => {
    const spawn = createFakeSpawn({ versionOutput: null })
    const version = await probeOmpBinaryVersion('omp.exe', {
      spawnProcess: spawn as unknown as typeof import('node:child_process').spawn,
      timeoutMs: 200,
    })
    expect(version).toBeUndefined()
  })
})

describe('runtimeInfoFromCapabilityStep', () => {
  it('uses the probed OMP binary version from the capability step', () => {
    const info = runtimeInfoFromCapabilityStep(
      {
        name: 'runtime capability',
        status: 'passed',
        durationMs: 10,
        data: {
          ompVersion: '1.4.2',
          capabilities: ['planMode'],
          runtimePath: 'apps/electron/release/win-unpacked/resources/omp/win32-x64/omp.exe',
        },
      },
      'fallback/path',
    )
    expect(info).toEqual({
      version: '1.4.2',
      path: 'fallback/path',
      capabilities: ['planMode'],
    })
  })

  it('returns undefined when the step lacks a probed version', () => {
    expect(
      runtimeInfoFromCapabilityStep(
        { name: 'runtime capability', status: 'passed', durationMs: 1 },
        'fallback',
      ),
    ).toBeUndefined()
  })
})

describe('validateRuntimeCapability', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'omp-runtime-test-'))
    mkdirSync(join(root, 'apps', 'electron', 'release', 'win-unpacked', 'resources', 'omp', 'win32-x64'), {
      recursive: true,
    })
    writeFileSync(join(root, 'apps', 'electron', 'release', 'win-unpacked', 'resources', 'omp', 'win32-x64', 'omp.exe'), 'omp')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('passes when OMP advertises planMode and enters planning, and records binary version', async () => {
    const spawn = createFakeSpawn({
      versionOutput: 'omp/9.9.9\n',
      rpcSequence: (child) => {
        child.stdout.write(JSON.stringify({ type: 'ready' }) + '\n')
        setTimeout(() => {
          child.stdout.write(
            JSON.stringify({
              type: 'response',
              id: 'omp-state',
              success: true,
              data: { capabilities: { planMode: true } },
            }) + '\n',
          )
        }, 10)
        setTimeout(() => {
          child.stdout.write(
            JSON.stringify({
              type: 'response',
              id: 'omp-plan-mode',
              success: true,
              data: { enabled: true, phase: 'planning' },
            }) + '\n',
          )
        }, 20)
      },
    })

    const result = await validateRuntimeCapability(
      { root },
      { spawnProcess: spawn as unknown as typeof import('node:child_process').spawn },
    )
    expect(result.status).toBe('passed')
    expect(result.output).toContain('Plan Mode phase: planning')
    expect(result.output).toContain('OMP version: 9.9.9')
    expect(result.data?.ompVersion).toBe('9.9.9')
    expect(result.data?.capabilities).toEqual(['planMode'])
  })

  it('fails when the OMP binary version cannot be probed', async () => {
    const spawn = createFakeSpawn({
      versionOutput: null,
      rpcSequence: () => {},
    })

    const result = await validateRuntimeCapability(
      { root, timeoutMs: 500 },
      { spawnProcess: spawn as unknown as typeof import('node:child_process').spawn },
    )
    expect(result.status).toBe('failed')
    expect(result.error).toContain('Failed to probe OMP binary version')
  })

  it('fails when OMP does not advertise planMode', async () => {
    const spawn = createFakeSpawn({
      rpcSequence: (child) => {
        child.stdout.write(JSON.stringify({ type: 'ready' }) + '\n')
        setTimeout(() => {
          child.stdout.write(
            JSON.stringify({
              type: 'response',
              id: 'omp-state',
              success: true,
              data: { capabilities: {} },
            }) + '\n',
          )
        }, 10)
      },
    })

    const result = await validateRuntimeCapability(
      { root, timeoutMs: 500 },
      { spawnProcess: spawn as unknown as typeof import('node:child_process').spawn },
    )
    expect(result.status).toBe('failed')
    expect(result.error).toContain('does not advertise capabilities.planMode')
  })

  it('fails when set_plan_mode does not enter planning', async () => {
    const spawn = createFakeSpawn({
      rpcSequence: (child) => {
        child.stdout.write(JSON.stringify({ type: 'ready' }) + '\n')
        setTimeout(() => {
          child.stdout.emit(
            'data',
            JSON.stringify({
              type: 'response',
              id: 'omp-state',
              success: true,
              data: { capabilities: { planMode: true } },
            }) + '\n',
          )
        }, 10)
        setTimeout(() => {
          child.stdout.write(
            JSON.stringify({
              type: 'response',
              id: 'omp-plan-mode',
              success: true,
              data: { enabled: false, phase: 'inactive' },
            }) + '\n',
          )
        }, 20)
      },
    })

    const result = await validateRuntimeCapability(
      { root, timeoutMs: 500 },
      { spawnProcess: spawn as unknown as typeof import('node:child_process').spawn },
    )
    expect(result.status).toBe('failed')
    expect(result.error).toContain('did not enter planning')
  })

  it('fails when OMP exits before ready', async () => {
    const spawn = createFakeSpawn({
      rpcSequence: (child) => {
        child.emit('exit', 1, null)
      },
    })

    const result = await validateRuntimeCapability(
      { root, timeoutMs: 500 },
      { spawnProcess: spawn as unknown as typeof import('node:child_process').spawn },
    )
    expect(result.status).toBe('failed')
    expect(result.error).toContain('exited with code 1')
  })
})
