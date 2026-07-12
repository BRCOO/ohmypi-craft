#!/usr/bin/env bun
/**
 * Verify multi-platform Electron release artifacts and emit SHA-256 manifests.
 *
 * Usage:
 *   bun run scripts/ci/verify-platform-artifacts.ts --platform=windows
 *   bun run scripts/ci/verify-platform-artifacts.ts --platform=macos
 *   bun run scripts/ci/verify-platform-artifacts.ts --platform=linux
 *
 * Options:
 *   --release-dir=path   Override apps/electron/release
 *   --version=X.Y.Z      Expected product version (default: apps/electron package.json)
 *   --signing=status     Recorded signing status (signed|unsigned|unknown)
 *   --out-meta=path      Write build-meta.json
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { join, relative, resolve, basename } from 'node:path'

const ROOT = resolve(import.meta.dir, '..', '..')
const DEFAULT_RELEASE_DIR = join(ROOT, 'apps', 'electron', 'release')
const APP_PACKAGE = join(ROOT, 'apps', 'electron', 'package.json')

export type PlatformId = 'windows' | 'macos' | 'linux'
export type SigningStatus = 'signed' | 'unsigned' | 'unknown'

export interface VerifyOptions {
  platform: PlatformId
  releaseDir?: string
  version?: string
  signing?: SigningStatus
  commit?: string
  outMeta?: string
  root?: string
}

export interface ArtifactRecord {
  name: string
  path: string
  bytes: number
  sha256: string
}

export interface VerifyResult {
  platform: PlatformId
  version: string
  signing: SigningStatus
  artifacts: ArtifactRecord[]
  checksumsPath: string
  metaPath?: string
  notes: string[]
}

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

function readVersion(root = ROOT): string {
  const pkg = JSON.parse(readFileSync(join(root, 'apps', 'electron', 'package.json'), 'utf-8')) as {
    version?: string
  }
  return pkg.version ?? '0.0.0'
}

export async function hashFile(path: string): Promise<string> {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function requireNonEmptyFile(path: string, label: string, minBytes = 1): void {
  if (!isFile(path)) {
    throw new Error(`${label} missing: ${path}`)
  }
  const size = statSync(path).size
  if (size < minBytes) {
    throw new Error(`${label} too small (${size} bytes): ${path}`)
  }
}

function listReleaseFiles(releaseDir: string): string[] {
  if (!isDirectory(releaseDir)) return []
  const out: string[] = []
  for (const name of readdirSync(releaseDir)) {
    const full = join(releaseDir, name)
    if (isFile(full)) out.push(full)
  }
  return out
}

function findByRegex(releaseDir: string, pattern: RegExp): string[] {
  return listReleaseFiles(releaseDir).filter((p) => pattern.test(basename(p)))
}

function assertOmpRuntime(unpackedRoot: string, platformDir: string, binaryName: string): string {
  const ompPath = join(unpackedRoot, 'resources', 'omp', platformDir, binaryName)
  requireNonEmptyFile(ompPath, `OMP runtime (${platformDir})`, 1_000_000)
  return ompPath
}

function assertSdkBinary(unpackedAppNodeModules: string): string {
  const binary = join(
    unpackedAppNodeModules,
    '@anthropic-ai',
    'claude-agent-sdk-binary',
    'claude',
  )
  // SDK binary is large (~210MB) on real packages; keep a modest floor for fixtures.
  requireNonEmptyFile(binary, 'SDK native binary', 1_000)
  return binary
}

async function collectArtifact(path: string, root: string): Promise<ArtifactRecord> {
  const stats = statSync(path)
  return {
    name: basename(path),
    path: relative(root, path).replace(/\\/g, '/'),
    bytes: stats.size,
    sha256: await hashFile(path),
  }
}

function writeChecksums(releaseDir: string, artifacts: ArtifactRecord[]): string {
  const lines = artifacts
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((a) => `${a.sha256}  ${a.name}`)
  const path = join(releaseDir, 'SHA256SUMS.txt')
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf-8')
  return path
}

function writeMeta(path: string, payload: Record<string, unknown>): void {
  mkdirSync(dirnameSafe(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8')
}

function dirnameSafe(path: string): string {
  return path.replace(/[\\/][^\\/]+$/, '') || '.'
}

export async function verifyPlatformArtifacts(options: VerifyOptions): Promise<VerifyResult> {
  const root = options.root ?? ROOT
  const releaseDir = options.releaseDir ?? join(root, 'apps', 'electron', 'release')
  const version = options.version ?? readVersion(root)
  const signing = options.signing ?? 'unsigned'
  const platform = options.platform
  const notes: string[] = []
  const selected: string[] = []

  if (!isDirectory(releaseDir)) {
    throw new Error(`Release directory not found: ${releaseDir}`)
  }

  if (platform === 'windows') {
    const installers = findByRegex(releaseDir, /^Oh-My-Pi-Setup-.*\.exe$/i)
    if (installers.length === 0) {
      throw new Error('No Windows NSIS installer (Oh-My-Pi-Setup-*.exe) found')
    }
    const preferred =
      installers.find((p) => basename(p).includes(version)) ??
      installers.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]!
    requireNonEmptyFile(preferred, 'Windows installer', 1_000_000)
    if (!basename(preferred).includes(version)) {
      notes.push(`Installer name does not include version ${version}: ${basename(preferred)}`)
    }
    selected.push(preferred)

    const blockmap = `${preferred}.blockmap`
    if (isFile(blockmap)) selected.push(blockmap)
    for (const yml of findByRegex(releaseDir, /^latest.*\.yml$/i)) selected.push(yml)
    for (const report of findByRegex(releaseDir, /^release-win-.*\.json$/i)) selected.push(report)

    const unpacked = join(releaseDir, 'win-unpacked')
    if (isDirectory(unpacked)) {
      assertOmpRuntime(unpacked, 'win32-x64', 'omp.exe')
      notes.push('win-unpacked OMP runtime present')
    } else {
      notes.push('win-unpacked not present next to installer (optional for artifact set)')
    }
  } else if (platform === 'macos') {
    const dmgs = findByRegex(releaseDir, /^Oh-My-Pi-(arm64|x64)\.dmg$/i)
    const zips = findByRegex(releaseDir, /^Oh-My-Pi-(arm64|x64)\.zip$/i)
    if (dmgs.length === 0) throw new Error('No macOS DMG (Oh-My-Pi-arm64.dmg / Oh-My-Pi-x64.dmg) found')
    if (zips.length === 0) throw new Error('No macOS ZIP (Oh-My-Pi-arm64.zip / Oh-My-Pi-x64.zip) found')
    for (const dmg of dmgs) {
      requireNonEmptyFile(dmg, 'macOS DMG', 1_000_000)
      selected.push(dmg)
    }
    for (const zip of zips) {
      requireNonEmptyFile(zip, 'macOS ZIP', 1_000_000)
      selected.push(zip)
    }
    for (const yml of findByRegex(releaseDir, /^latest-mac\.yml$/i)) selected.push(yml)

    // Validate app bundles when electron-builder left them on disk.
    for (const macDir of ['mac-arm64', 'mac']) {
      const appRoot = join(releaseDir, macDir, 'Oh My Pi.app')
      if (!isDirectory(appRoot)) continue
      const resources = join(appRoot, 'Contents', 'Resources')
      const archDir = macDir === 'mac-arm64' ? 'darwin-arm64' : 'darwin-x64'
      assertOmpRuntime(resources, archDir, 'omp')
      const sdkRoot = join(resources, 'app', 'node_modules')
      if (isDirectory(sdkRoot)) {
        assertSdkBinary(sdkRoot)
      }
      notes.push(`Validated app bundle under ${macDir}/`)
    }
  } else if (platform === 'linux') {
    const images = findByRegex(releaseDir, /^Oh-My-Pi-.*\.AppImage$/i)
    if (images.length === 0) throw new Error('No Linux AppImage (Oh-My-Pi-*.AppImage) found')
    const image =
      images.find((p) => /x64|x86_64/i.test(basename(p))) ??
      images.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]!
    requireNonEmptyFile(image, 'Linux AppImage', 1_000_000)

    // AppImage is an ELF executable wrapper (0x7f ELF) or a shell script scripted image.
    const head = readFileSync(image).subarray(0, 4)
    const isElf = head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46
    const isScript = head[0] === 0x23 && head[1] === 0x21 // #!
    if (!isElf && !isScript) {
      throw new Error(`AppImage does not look like an executable package: ${basename(image)}`)
    }
    selected.push(image)
    for (const yml of findByRegex(releaseDir, /^latest-linux\.yml$/i)) selected.push(yml)

    const unpacked = join(releaseDir, 'linux-unpacked')
    if (isDirectory(unpacked)) {
      assertOmpRuntime(unpacked, 'linux-x64', 'omp')
      const sdkRoot = join(unpacked, 'resources', 'app', 'node_modules')
      if (isDirectory(sdkRoot)) {
        assertSdkBinary(sdkRoot)
      }
      notes.push('linux-unpacked OMP/SDK checks passed')
    } else {
      notes.push('linux-unpacked not present (AppImage-only layout)')
    }
  } else {
    throw new Error(`Unsupported platform: ${platform}`)
  }

  // Deduplicate selected paths
  const unique = [...new Set(selected)]
  const artifacts: ArtifactRecord[] = []
  for (const path of unique) {
    artifacts.push(await collectArtifact(path, root))
  }

  const checksumsPath = writeChecksums(releaseDir, artifacts)
  // Include checksum file itself in a companion list for the release job.
  const checksumRecord = await collectArtifact(checksumsPath, root)

  const meta = {
    platform,
    version,
    signing,
    commit: options.commit ?? process.env.GITHUB_SHA ?? 'unknown',
    createdAt: new Date().toISOString(),
    artifacts: [...artifacts, checksumRecord],
    notes,
  }

  const metaPath = options.outMeta ?? join(releaseDir, `build-meta-${platform}.json`)
  writeMeta(metaPath, meta)

  return {
    platform,
    version,
    signing,
    artifacts: [...artifacts, checksumRecord],
    checksumsPath,
    metaPath,
    notes,
  }
}

function parseArgs(argv: string[]): VerifyOptions {
  let platform: PlatformId | undefined
  let releaseDir: string | undefined
  let version: string | undefined
  let signing: SigningStatus | undefined
  let outMeta: string | undefined
  for (const arg of argv) {
    if (arg.startsWith('--platform=')) platform = arg.slice('--platform='.length) as PlatformId
    else if (arg.startsWith('--release-dir=')) releaseDir = arg.slice('--release-dir='.length)
    else if (arg.startsWith('--version=')) version = arg.slice('--version='.length)
    else if (arg.startsWith('--signing=')) signing = arg.slice('--signing='.length) as SigningStatus
    else if (arg.startsWith('--out-meta=')) outMeta = arg.slice('--out-meta='.length)
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: bun run scripts/ci/verify-platform-artifacts.ts --platform=windows|macos|linux')
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  if (!platform || !['windows', 'macos', 'linux'].includes(platform)) {
    throw new Error('Required --platform=windows|macos|linux')
  }
  return { platform, releaseDir, version, signing, outMeta }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  if (!options.version && existsSync(APP_PACKAGE)) {
    options.version = readVersion()
  }
  const result = await verifyPlatformArtifacts(options)
  console.log(JSON.stringify({
    platform: result.platform,
    version: result.version,
    signing: result.signing,
    artifactCount: result.artifacts.length,
    checksumsPath: result.checksumsPath,
    metaPath: result.metaPath,
    notes: result.notes,
    artifacts: result.artifacts.map((a) => ({ name: a.name, bytes: a.bytes, sha256: a.sha256 })),
  }, null, 2))
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
