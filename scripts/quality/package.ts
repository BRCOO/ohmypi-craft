/**
 * Packaged-app integrity checks for the Windows release gate.
 *
 * Validates that the Electron Builder `win-unpacked` output contains the
 * application executable, the expected icon, exactly one embedded OMP runtime,
 * and no duplicate runtime shipped in another location.
 */

import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import type { QualityStepResult } from './report'

export interface PackageIntegrityOptions {
  root?: string
  platform?: string
  arch?: string
}

export interface PackageIntegrityDetails {
  unpackedDir: string
  appExe: string
  iconPath: string
  ompDir: string
  ompRuntimePath: string
}

const DEFAULT_PLATFORM = 'win32'
const DEFAULT_ARCH = 'x64'

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function executableNameForWin(productName: string): string {
  return `${productName}.exe`
}

function normalizePathSeparators(path: string): string {
  return path.replace(/\\/g, '/')
}

function collectFiles(dir: string): string[] {
  const results: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...collectFiles(full))
    } else if (entry.isFile()) {
      results.push(full)
    }
  }
  return results
}

function findOmpExecutables(ompDir: string): string[] {
  if (!isDirectory(ompDir)) return []
  return collectFiles(ompDir).filter((p) =>
    process.platform === 'win32' ? p.toLowerCase().endsWith('.exe') : p.endsWith('/omp'),
  )
}

function findAllOmpExecutables(unpackedDir: string, ompDir: string): string[] {
  const all = collectFiles(unpackedDir)
  const runtimeName = process.platform === 'win32' ? 'omp.exe' : 'omp'
  return all.filter((p) => {
    const base = p.split(/[\\/]/).pop() ?? ''
    return base.toLowerCase() === runtimeName.toLowerCase()
  })
}

function findIcon(unpackedDir: string): string | undefined {
  const candidates = [
    join(unpackedDir, 'resources', 'app', 'dist', 'resources', 'icon.ico'),
    join(unpackedDir, 'resources', 'app', 'resources', 'icon.ico'),
    join(unpackedDir, 'resources', 'icon.ico'),
  ]
  return candidates.find(isFile)
}

export function resolvePackagePaths(options: PackageIntegrityOptions = {}): PackageIntegrityDetails {
  const root = options.root ?? resolve(import.meta.dir ?? new URL('.', import.meta.url).pathname, '..', '..')
  const platform = options.platform ?? DEFAULT_PLATFORM
  const arch = options.arch ?? DEFAULT_ARCH
  const unpackedDir = join(root, 'apps', 'electron', 'release', 'win-unpacked')
  const appExe = join(unpackedDir, executableNameForWin('Oh My Pi'))
  const iconPath = findIcon(unpackedDir) ?? join(unpackedDir, 'resources', 'icon.ico')
  const ompDir = join(unpackedDir, 'resources', 'omp')
  const ompRuntimePath = join(ompDir, `${platform}-${arch}`, 'omp.exe')
  return { unpackedDir, appExe, iconPath, ompDir, ompRuntimePath }
}

export function validatePackageIntegrity(options: PackageIntegrityOptions = {}): QualityStepResult {
  const name = 'package integrity'
  const start = Date.now()
  const details = resolvePackagePaths(options)
  const { unpackedDir, appExe, iconPath, ompDir, ompRuntimePath } = details

  if (!isDirectory(unpackedDir)) {
    return {
      name,
      status: 'failed',
      durationMs: Date.now() - start,
      error: `win-unpacked not found at ${unpackedDir}; run the Windows build first`,
    }
  }

  if (!isFile(appExe)) {
    return {
      name,
      status: 'failed',
      durationMs: Date.now() - start,
      error: `Application executable missing: ${appExe}`,
    }
  }

  if (!isFile(iconPath)) {
    return {
      name,
      status: 'failed',
      durationMs: Date.now() - start,
      error: `Application icon missing: ${iconPath}`,
    }
  }

  if (!isDirectory(ompDir)) {
    return {
      name,
      status: 'failed',
      durationMs: Date.now() - start,
      error: `Embedded OMP resources directory missing: ${ompDir}`,
    }
  }

  const expectedOmpExecutables = findOmpExecutables(ompDir)
  if (expectedOmpExecutables.length === 0) {
    return {
      name,
      status: 'failed',
      durationMs: Date.now() - start,
      error: `No OMP executable found under ${ompDir}`,
    }
  }

  if (expectedOmpExecutables.length > 1) {
    return {
      name,
      status: 'failed',
      durationMs: Date.now() - start,
      error: `Expected exactly one OMP executable under ${ompDir}, found ${expectedOmpExecutables.length}: ${expectedOmpExecutables.map((p) => normalizePathSeparators(relative(unpackedDir, p))).join(', ')}`,
    }
  }

  const runtimePath = expectedOmpExecutables[0]!
  if (runtimePath !== ompRuntimePath) {
    return {
      name,
      status: 'failed',
      durationMs: Date.now() - start,
      error: `OMP runtime is at an unexpected path: ${normalizePathSeparators(runtimePath)} (expected ${normalizePathSeparators(ompRuntimePath)})`,
    }
  }

  const allRuntimeMatches = findAllOmpExecutables(unpackedDir, ompDir)
  const duplicates = allRuntimeMatches.filter((p) => p !== runtimePath)
  if (duplicates.length > 0) {
    return {
      name,
      status: 'failed',
      durationMs: Date.now() - start,
      error: `Duplicate OMP runtime found outside ${ompDir}: ${duplicates.map((p) => normalizePathSeparators(relative(unpackedDir, p))).join(', ')}`,
    }
  }

  const platformDirs = readdirSync(ompDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
  if (platformDirs.length > 1) {
    return {
      name,
      status: 'failed',
      durationMs: Date.now() - start,
      error: `Multiple OMP platform directories found (possible duplicate runtime): ${platformDirs.join(', ')}`,
    }
  }

  return {
    name,
    status: 'passed',
    durationMs: Date.now() - start,
    output: [
      `Application: ${normalizePathSeparators(relative(unpackedDir, appExe))}`,
      `Icon: ${normalizePathSeparators(relative(unpackedDir, iconPath))}`,
      `OMP runtime: ${normalizePathSeparators(relative(unpackedDir, runtimePath))} (${statSync(runtimePath).size} bytes)`,
      `OMP platform directories: ${platformDirs.join(', ') || '(none)'}`,
    ].join('\n'),
  }
}
