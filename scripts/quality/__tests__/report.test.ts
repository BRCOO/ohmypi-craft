import { describe, it, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sha256File, fileArtifact, createReport } from '../report'

describe('report helpers', () => {
  it('sha256File returns a stable hex digest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'omp-report-'))
    const path = join(dir, 'sample.txt')
    writeFileSync(path, 'hello', 'utf-8')
    try {
      expect(sha256File(path)).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fileArtifact returns bytes and sha256 for an existing file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'omp-report-'))
    const path = join(dir, 'sample.txt')
    writeFileSync(path, 'hello', 'utf-8')
    try {
      const artifact = fileArtifact(path)
      expect(artifact).toBeDefined()
      expect(artifact?.bytes).toBe(5)
      expect(artifact?.sha256).toBe(sha256File(path))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fileArtifact returns undefined for a missing path', () => {
    expect(fileArtifact(join(tmpdir(), 'does-not-exist'))).toBeUndefined()
  })

  it('createReport includes version, commit and environment metadata', () => {
    const report = createReport('quality:quick', '1.2.3')
    expect(report.command).toBe('quality:quick')
    expect(report.version).toBe('1.2.3')
    expect(report.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(typeof report.dirty).toBe('boolean')
    expect(report.environment.os).toBe(process.platform)
  }, { timeout: 20_000 })
})
