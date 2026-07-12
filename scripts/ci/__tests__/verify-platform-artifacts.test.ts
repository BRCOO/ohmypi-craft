import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyPlatformArtifacts } from '../verify-platform-artifacts'
import { assembleRelease } from '../assemble-release'
import { normalizeTag, parseTargets, readPinnedTag } from '../fetch-omp-runtime'

describe('fetch-omp-runtime helpers', () => {
  it('parses target lists', () => {
    expect(parseTargets('win32-x64,darwin-arm64')).toEqual(['win32-x64', 'darwin-arm64'])
  })

  it('rejects unknown targets', () => {
    expect(() => parseTargets('solaris-x64')).toThrow(/Unknown OMP target/)
  })

  it('normalizes tags', () => {
    expect(normalizeTag('16.3.6')).toBe('v16.3.6')
    expect(normalizeTag('v16.3.6')).toBe('v16.3.6')
    expect(normalizeTag('latest')).toBe('latest')
  })

  it('reads pinned tag from VERSION file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'omp-pin-'))
    try {
      writeFileSync(join(dir, 'VERSION'), 'v16.3.6\n')
      expect(readPinnedTag(join(dir, 'VERSION'), {})).toBe('v16.3.6')
      expect(readPinnedTag(join(dir, 'VERSION'), { OMP_RUNTIME_TAG: '16.4.0' })).toBe('v16.4.0')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('verifyPlatformArtifacts', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'omp-verify-'))
    mkdirSync(join(root, 'apps', 'electron'), { recursive: true })
    writeFileSync(
      join(root, 'apps', 'electron', 'package.json'),
      JSON.stringify({ version: '0.10.5' }),
    )
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('verifies a windows installer layout', async () => {
    const release = join(root, 'apps', 'electron', 'release')
    mkdirSync(release, { recursive: true })
    writeFileSync(join(release, 'Oh-My-Pi-Setup-0.10.5-x64.exe'), Buffer.alloc(1_000_001, 1))
    writeFileSync(join(release, 'latest.yml'), 'version: 0.10.5\n')
    const result = await verifyPlatformArtifacts({
      platform: 'windows',
      root,
      version: '0.10.5',
      signing: 'unsigned',
    })
    expect(result.artifacts.some((a) => a.name.endsWith('.exe'))).toBe(true)
    expect(result.checksumsPath.endsWith('SHA256SUMS.txt')).toBe(true)
  })

  it('verifies macos dmg/zip presence', async () => {
    const release = join(root, 'apps', 'electron', 'release')
    mkdirSync(release, { recursive: true })
    for (const name of [
      'Oh-My-Pi-arm64.dmg',
      'Oh-My-Pi-x64.dmg',
      'Oh-My-Pi-arm64.zip',
      'Oh-My-Pi-x64.zip',
    ]) {
      writeFileSync(join(release, name), Buffer.alloc(1_000_001, 2))
    }
    const result = await verifyPlatformArtifacts({
      platform: 'macos',
      root,
      version: '0.10.5',
      signing: 'unsigned',
    })
    expect(result.artifacts.filter((a) => a.name.endsWith('.dmg')).length).toBe(2)
  })

  it('verifies linux AppImage magic', async () => {
    const release = join(root, 'apps', 'electron', 'release')
    mkdirSync(release, { recursive: true })
    const image = Buffer.alloc(1_000_001, 0)
    image[0] = 0x7f
    image[1] = 0x45
    image[2] = 0x4c
    image[3] = 0x46
    writeFileSync(join(release, 'Oh-My-Pi-x64.AppImage'), image)
    const result = await verifyPlatformArtifacts({
      platform: 'linux',
      root,
      version: '0.10.5',
      signing: 'unsigned',
    })
    expect(result.artifacts.some((a) => a.name.endsWith('.AppImage'))).toBe(true)
  })

  it('fails when installer is missing', async () => {
    mkdirSync(join(root, 'apps', 'electron', 'release'), { recursive: true })
    await expect(
      verifyPlatformArtifacts({ platform: 'windows', root, version: '0.10.5' }),
    ).rejects.toThrow(/No Windows NSIS installer/)
  })
})

describe('assembleRelease', () => {
  it('rehashes files and writes notes', () => {
    const input = mkdtempSync(join(tmpdir(), 'omp-in-'))
    const output = mkdtempSync(join(tmpdir(), 'omp-out-'))
    try {
      const winDir = join(input, 'oh-my-pi-windows-x64-abc')
      mkdirSync(winDir, { recursive: true })
      writeFileSync(join(winDir, 'Oh-My-Pi-Setup-0.10.5-x64.exe'), 'installer')
      writeFileSync(
        join(winDir, 'build-meta-windows.json'),
        JSON.stringify({ platform: 'windows', signing: 'unsigned' }),
      )
      const result = assembleRelease({
        inputDir: input,
        outputDir: output,
        version: '0.10.5',
        tag: 'v0.10.5',
        commit: 'abc123',
      })
      expect(result.files.some((f) => f.endsWith('SHA256SUMS.txt'))).toBe(true)
      expect(result.signingSummary.some((s) => s.includes('unsigned'))).toBe(true)
    } finally {
      rmSync(input, { recursive: true, force: true })
      rmSync(output, { recursive: true, force: true })
    }
  })
})
