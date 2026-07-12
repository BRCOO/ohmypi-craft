#!/usr/bin/env bun
/**
 * Fetch prebuilt OMP runtime binaries into apps/electron/resources/omp/.
 *
 * Used by GitHub Actions multi-platform packaging so CI does not need a local
 * oh-my-pi-upstream checkout. Binaries come from can1357/oh-my-pi Releases.
 *
 * Usage:
 *   bun run scripts/ci/fetch-omp-runtime.ts --targets=win32-x64
 *   bun run scripts/ci/fetch-omp-runtime.ts --targets=darwin-arm64,darwin-x64
 *   bun run scripts/ci/fetch-omp-runtime.ts --targets=linux-x64 --tag=v16.3.6
 *
 * Env:
 *   OMP_RUNTIME_TAG / OMP_RUNTIME_VERSION — override pin (e.g. v16.3.6 or latest)
 *   OMP_RUNTIME_REPO — override GitHub repo (default can1357/oh-my-pi)
 *   GITHUB_TOKEN — optional, raises rate limits for private/network fetches
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '..', '..')
const ELECTRON_DIR = join(ROOT, 'apps', 'electron')
const OMP_ROOT = join(ELECTRON_DIR, 'resources', 'omp')
const VERSION_FILE = join(OMP_ROOT, 'VERSION')
const DEFAULT_REPO = 'can1357/oh-my-pi'

export type OmpTargetId =
  | 'win32-x64'
  | 'darwin-arm64'
  | 'darwin-x64'
  | 'linux-x64'
  | 'linux-arm64'

interface OmpTarget {
  id: OmpTargetId
  /** GitHub release asset name */
  asset: string
  /** Destination relative to resources/omp */
  destDir: string
  /** Destination file name */
  destName: string
}

const TARGETS: Record<OmpTargetId, OmpTarget> = {
  'win32-x64': {
    id: 'win32-x64',
    asset: 'omp-windows-x64.exe',
    destDir: 'win32-x64',
    destName: 'omp.exe',
  },
  'darwin-arm64': {
    id: 'darwin-arm64',
    asset: 'omp-darwin-arm64',
    destDir: 'darwin-arm64',
    destName: 'omp',
  },
  'darwin-x64': {
    id: 'darwin-x64',
    asset: 'omp-darwin-x64',
    destDir: 'darwin-x64',
    destName: 'omp',
  },
  'linux-x64': {
    id: 'linux-x64',
    asset: 'omp-linux-x64',
    destDir: 'linux-x64',
    destName: 'omp',
  },
  'linux-arm64': {
    id: 'linux-arm64',
    asset: 'omp-linux-arm64',
    destDir: 'linux-arm64',
    destName: 'omp',
  },
}

const MIN_BYTES = 1_000_000

export function readPinnedTag(versionFile = VERSION_FILE, env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.OMP_RUNTIME_TAG || env.OMP_RUNTIME_VERSION
  if (fromEnv && fromEnv.trim()) return normalizeTag(fromEnv.trim())
  if (existsSync(versionFile)) {
    const text = readFileSync(versionFile, 'utf-8').trim()
    if (text) return normalizeTag(text)
  }
  return 'latest'
}

export function normalizeTag(tag: string): string {
  if (tag === 'latest') return 'latest'
  return tag.startsWith('v') ? tag : `v${tag}`
}

export function parseTargets(raw: string | undefined): OmpTargetId[] {
  if (!raw || !raw.trim()) {
    throw new Error('Missing --targets. Example: --targets=win32-x64')
  }
  const ids = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const out: OmpTargetId[] = []
  for (const id of ids) {
    if (!(id in TARGETS)) {
      throw new Error(`Unknown OMP target "${id}". Valid: ${Object.keys(TARGETS).join(', ')}`)
    }
    out.push(id as OmpTargetId)
  }
  return out
}

function parseArgs(argv: string[]): { targets: OmpTargetId[]; tag?: string; repo?: string } {
  let targetsRaw: string | undefined
  let tag: string | undefined
  let repo: string | undefined
  for (const arg of argv) {
    if (arg.startsWith('--targets=')) targetsRaw = arg.slice('--targets='.length)
    else if (arg.startsWith('--tag=')) tag = arg.slice('--tag='.length)
    else if (arg.startsWith('--repo=')) repo = arg.slice('--repo='.length)
    else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: bun run scripts/ci/fetch-omp-runtime.ts --targets=<id[,id...]> [--tag=vX.Y.Z|latest]`)
      process.exit(0)
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return {
    targets: parseTargets(targetsRaw),
    tag: tag ? normalizeTag(tag) : undefined,
    repo,
  }
}

async function resolveReleaseApiUrl(repo: string, tag: string): Promise<string> {
  if (tag === 'latest') {
    return `https://api.github.com/repos/${repo}/releases/latest`
  }
  return `https://api.github.com/repos/${repo}/releases/tags/${tag}`
}

async function fetchJson(url: string, token?: string): Promise<any> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'ohmypi-craft-ci',
  }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(url, { headers })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`GitHub API ${res.status} for ${url}: ${body.slice(0, 300)}`)
  }
  return res.json()
}

async function downloadBinary(url: string, dest: string, token?: string): Promise<void> {
  const headers: Record<string, string> = {
    Accept: 'application/octet-stream',
    'User-Agent': 'ohmypi-craft-ci',
  }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(url, { headers, redirect: 'follow' })
  if (!res.ok) {
    throw new Error(`Download failed ${res.status} for ${url}`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.byteLength < MIN_BYTES) {
    throw new Error(`Downloaded binary too small (${buf.byteLength} bytes) from ${url}`)
  }
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, buf)
  if (!dest.endsWith('.exe')) {
    try {
      chmodSync(dest, 0o755)
    } catch {
      // Windows host may ignore chmod; fine for Unix runners.
    }
  }
}

export async function fetchOmpRuntimes(options: {
  targets: OmpTargetId[]
  tag?: string
  repo?: string
  token?: string
  ompRoot?: string
}): Promise<{ tag: string; files: string[] }> {
  const repo = options.repo || process.env.OMP_RUNTIME_REPO || DEFAULT_REPO
  const tag = options.tag || readPinnedTag()
  const token = options.token || process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  const ompRoot = options.ompRoot || OMP_ROOT

  const apiUrl = await resolveReleaseApiUrl(repo, tag)
  console.log(`Resolving OMP runtime from ${repo} @ ${tag}`)
  const release = await fetchJson(apiUrl, token)
  const resolvedTag = release.tag_name as string
  const assets = (release.assets ?? []) as Array<{ name: string; url: string; browser_download_url: string }>

  const files: string[] = []
  for (const targetId of options.targets) {
    const target = TARGETS[targetId]
    const asset = assets.find((a) => a.name === target.asset)
    if (!asset) {
      const names = assets.map((a) => a.name).join(', ')
      throw new Error(
        `Release ${resolvedTag} is missing asset "${target.asset}". Available: ${names || '(none)'}`,
      )
    }
    const dest = join(ompRoot, target.destDir, target.destName)
    // Prefer API asset URL (works with token) over browser_download_url.
    const url = asset.url || asset.browser_download_url
    console.log(`Downloading ${target.asset} → ${dest}`)
    await downloadBinary(url, dest, token)
    files.push(dest)
    console.log(`  OK ${target.destDir}/${target.destName} (${(require('node:fs').statSync(dest).size / 1024 / 1024).toFixed(1)} MB)`)
  }

  // Record the resolved tag for packaging reports.
  mkdirSync(ompRoot, { recursive: true })
  writeFileSync(join(ompRoot, 'FETCHED_VERSION'), `${resolvedTag}\n`, 'utf-8')
  return { tag: resolvedTag, files }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const result = await fetchOmpRuntimes({
    targets: args.targets,
    tag: args.tag,
    repo: args.repo,
  })
  console.log(`Fetched ${result.files.length} OMP runtime(s) from ${result.tag}`)
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
