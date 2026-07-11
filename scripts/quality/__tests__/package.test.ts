import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validatePackageIntegrity } from '../package'

describe('validatePackageIntegrity', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'omp-package-integrity-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function makeValidTree(): void {
    const unpacked = join(root, 'apps', 'electron', 'release', 'win-unpacked')
    mkdirSync(join(unpacked, 'resources', 'omp', 'win32-x64'), { recursive: true })
    writeFileSync(join(unpacked, 'Oh My Pi.exe'), 'app')
    writeFileSync(join(unpacked, 'resources', 'icon.ico'), 'icon')
    writeFileSync(join(unpacked, 'resources', 'omp', 'win32-x64', 'omp.exe'), 'omp')
  }

  it('passes for a valid packaged tree', () => {
    makeValidTree()
    const result = validatePackageIntegrity({ root })
    expect(result.status).toBe('passed')
    expect(result.output).toContain('OMP runtime: resources/omp/win32-x64/omp.exe')
  })

  it('fails when win-unpacked is missing', () => {
    const result = validatePackageIntegrity({ root })
    expect(result.status).toBe('failed')
    expect(result.error).toContain('win-unpacked not found')
  })

  it('fails when the application executable is missing', () => {
    const unpacked = join(root, 'apps', 'electron', 'release', 'win-unpacked')
    mkdirSync(join(unpacked, 'resources', 'omp', 'win32-x64'), { recursive: true })
    writeFileSync(join(unpacked, 'resources', 'icon.ico'), 'icon')
    writeFileSync(join(unpacked, 'resources', 'omp', 'win32-x64', 'omp.exe'), 'omp')
    const result = validatePackageIntegrity({ root })
    expect(result.status).toBe('failed')
    expect(result.error).toContain('Application executable missing')
  })

  it('fails when the icon is missing', () => {
    const unpacked = join(root, 'apps', 'electron', 'release', 'win-unpacked')
    mkdirSync(join(unpacked, 'resources', 'omp', 'win32-x64'), { recursive: true })
    writeFileSync(join(unpacked, 'Oh My Pi.exe'), 'app')
    writeFileSync(join(unpacked, 'resources', 'omp', 'win32-x64', 'omp.exe'), 'omp')
    const result = validatePackageIntegrity({ root })
    expect(result.status).toBe('failed')
    expect(result.error).toContain('Application icon missing')
  })

  it('fails when more than one OMP executable is present', () => {
    const unpacked = join(root, 'apps', 'electron', 'release', 'win-unpacked')
    const platformDir = join(unpacked, 'resources', 'omp', 'win32-x64')
    mkdirSync(join(platformDir, 'nested'), { recursive: true })
    writeFileSync(join(unpacked, 'Oh My Pi.exe'), 'app')
    writeFileSync(join(unpacked, 'resources', 'icon.ico'), 'icon')
    writeFileSync(join(platformDir, 'omp.exe'), 'omp')
    writeFileSync(join(platformDir, 'nested', 'omp.exe'), 'omp')
    const result = validatePackageIntegrity({ root })
    expect(result.status).toBe('failed')
    expect(result.error).toMatch(/Expected exactly one OMP executable/)
  })

  it('fails when a duplicate OMP executable exists outside resources/omp', () => {
    const unpacked = join(root, 'apps', 'electron', 'release', 'win-unpacked')
    mkdirSync(join(unpacked, 'resources', 'omp', 'win32-x64'), { recursive: true })
    mkdirSync(join(unpacked, 'resources', 'bin', 'win32-x64'), { recursive: true })
    writeFileSync(join(unpacked, 'Oh My Pi.exe'), 'app')
    writeFileSync(join(unpacked, 'resources', 'icon.ico'), 'icon')
    writeFileSync(join(unpacked, 'resources', 'omp', 'win32-x64', 'omp.exe'), 'omp')
    writeFileSync(join(unpacked, 'resources', 'bin', 'win32-x64', 'omp.exe'), 'dup')
    const result = validatePackageIntegrity({ root })
    expect(result.status).toBe('failed')
    expect(result.error).toMatch(/Duplicate OMP runtime found/)
  })
})
