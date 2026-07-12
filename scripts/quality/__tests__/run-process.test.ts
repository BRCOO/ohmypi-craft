import { describe, expect, it } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isRecoverableArtifact, processFailed, runProcess } from '../run-process'

describe('runProcess', () => {
  it('captures exit code 0 and streams stdout', async () => {
    const result = await runProcess(
      process.execPath,
      ['-e', 'console.log("hello-from-child")'],
      { cwd: process.cwd() },
    )
    expect(result.status).toBe(0)
    expect(result.timedOut).toBe(false)
    expect(result.stdoutTail).toContain('hello-from-child')
    expect(processFailed(result)).toBe(false)
  })

  it('marks non-zero exits as failed', async () => {
    const result = await runProcess(
      process.execPath,
      ['-e', 'process.exit(7)'],
      { cwd: process.cwd() },
    )
    expect(result.status).toBe(7)
    expect(processFailed(result)).toBe(true)
  })

  it('times out long-running processes', async () => {
    const result = await runProcess(
      process.execPath,
      ['-e', 'setTimeout(() => {}, 60_000)'],
      { cwd: process.cwd(), timeoutMs: 400 },
    )
    expect(result.timedOut).toBe(true)
    expect(processFailed(result)).toBe(true)
  }, { timeout: 15_000 })
})

describe('isRecoverableArtifact', () => {
  it('accepts a fresh large-enough file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'omp-artifact-'))
    const path = join(dir, 'setup.exe')
    writeFileSync(path, Buffer.alloc(1_500_000, 1))
    try {
      expect(isRecoverableArtifact({ path, minBytes: 1_000_000 }, Date.now())).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects tiny or missing files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'omp-artifact-'))
    const path = join(dir, 'setup.exe')
    writeFileSync(path, 'tiny')
    try {
      expect(isRecoverableArtifact({ path, minBytes: 1_000_000 }, Date.now())).toBe(false)
      expect(isRecoverableArtifact({ path: join(dir, 'missing.exe') }, Date.now())).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects stale artifacts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'omp-artifact-'))
    const path = join(dir, 'setup.exe')
    writeFileSync(path, Buffer.alloc(1_500_000, 1))
    const old = (Date.now() - 60 * 60 * 1000) / 1000
    utimesSync(path, old, old)
    try {
      expect(
        isRecoverableArtifact({ path, maxAgeMs: 5 * 60 * 1000, minBytes: 1_000_000 }, Date.now()),
      ).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
