#!/usr/bin/env bun
/**
 * Assemble multi-platform CI artifacts into a GitHub Release payload.
 *
 * - Collects installers / DMG / ZIP / AppImage / yml / blockmaps
 * - Regenerates a unified SHA256SUMS.txt (re-hash on disk)
 * - Writes release-notes.md for gh release
 *
 * Usage:
 *   bun run scripts/ci/assemble-release.ts \
 *     --input=./downloaded-artifacts \
 *     --output=./release-upload \
 *     --version=0.10.5 \
 *     --tag=v0.10.5 \
 *     --commit=<sha>
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, join, resolve } from 'node:path'

const DISTRIBUTABLE_PATTERN =
  /\.(exe|dmg|zip|AppImage|yml|blockmap)$/i

export interface AssembleOptions {
  inputDir: string
  outputDir: string
  version: string
  tag: string
  commit: string
}

export interface AssembledRelease {
  files: string[]
  checksumsPath: string
  notesPath: string
  signingSummary: string[]
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function walkFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walkFiles(full))
    else if (entry.isFile()) out.push(full)
  }
  return out
}

function hashFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function shouldPublish(name: string): boolean {
  if (name === 'SHA256SUMS.txt') return false
  if (name.startsWith('builder-') && name.endsWith('.yml')) return false
  if (name.includes('unpacked')) return false
  return DISTRIBUTABLE_PATTERN.test(name)
}

export function assembleRelease(options: AssembleOptions): AssembledRelease {
  const inputDir = resolve(options.inputDir)
  const outputDir = resolve(options.outputDir)
  mkdirSync(outputDir, { recursive: true })

  const allSources = walkFiles(inputDir)
  const sources = allSources.filter((p) => shouldPublish(basename(p)))
  if (sources.length === 0) {
    throw new Error(`No publishable artifacts found under ${inputDir}`)
  }

  const copied: string[] = []
  const usedNames = new Set<string>()
  for (const src of sources) {
    let name = basename(src)
    // Avoid collisions if platforms upload identically named sidecar files.
    if (usedNames.has(name)) {
      const platformHint = src.replace(/\\/g, '/').includes('windows')
        ? 'windows'
        : src.replace(/\\/g, '/').includes('macos')
          ? 'macos'
          : src.replace(/\\/g, '/').includes('linux')
            ? 'linux'
            : 'extra'
      const idx = name.lastIndexOf('.')
      name = idx > 0
        ? `${name.slice(0, idx)}-${platformHint}${name.slice(idx)}`
        : `${name}-${platformHint}`
    }
    usedNames.add(name)
    const dest = join(outputDir, name)
    copyFileSync(src, dest)
    copied.push(dest)
  }

  // Re-hash every file that will be uploaded (design: recompute before release).
  const hashLines: string[] = []
  for (const file of copied.sort((a, b) => basename(a).localeCompare(basename(b)))) {
    if (!isFile(file)) continue
    hashLines.push(`${hashFile(file)}  ${basename(file)}`)
  }
  const checksumsPath = join(outputDir, 'SHA256SUMS.txt')
  writeFileSync(checksumsPath, `${hashLines.join('\n')}\n`, 'utf-8')
  copied.push(checksumsPath)

  const signingSummary: string[] = []
  for (const file of allSources) {
    const name = basename(file)
    if (/build-meta-.*\.json$/i.test(name) || /^release-win-.*\.json$/i.test(name)) {
      try {
        const json = JSON.parse(readFileSync(file, 'utf-8')) as {
          platform?: string
          signing?: string | { status?: string }
        }
        const status =
          typeof json.signing === 'string'
            ? json.signing
            : json.signing?.status ?? 'unknown'
        signingSummary.push(`${json.platform ?? name}: ${status}`)
      } catch {
        // ignore malformed meta
      }
    }
  }
  if (signingSummary.length === 0) {
    signingSummary.push('No signing metadata found (treat as unsigned unless verified manually)')
  }

  const notesPath = join(outputDir, 'release-notes.md')
  const fileList = copied
    .map((f) => basename(f))
    .filter((n) => n !== 'release-notes.md')
    .sort()
    .map((n) => `- \`${n}\``)
    .join('\n')

  const notes = [
    `## Oh My Pi ${options.tag}`,
    '',
    `| Field | Value |`,
    `| --- | --- |`,
    `| Version | \`${options.version}\` |`,
    `| Commit | \`${options.commit}\` |`,
    `| Built at (UTC) | \`${new Date().toISOString()}\` |`,
    '',
    '### Signing status',
    '',
    ...signingSummary.map((s) => `- ${s}`),
    '',
    '### Assets',
    '',
    fileList,
    '',
    '### Checksums',
    '',
    'See `SHA256SUMS.txt` attached to this release. Hashes were recomputed on the release runner after downloading CI artifacts.',
    '',
    '> Packages without configured code-signing secrets are **unsigned** test/production candidates. Do not treat them as notarized or Authenticode-trusted.',
    '',
  ].join('\n')
  writeFileSync(notesPath, notes, 'utf-8')

  return { files: copied, checksumsPath, notesPath, signingSummary }
}

function parseArgs(argv: string[]): AssembleOptions {
  let inputDir = ''
  let outputDir = ''
  let version = ''
  let tag = ''
  let commit = process.env.GITHUB_SHA || 'unknown'
  for (const arg of argv) {
    if (arg.startsWith('--input=')) inputDir = arg.slice('--input='.length)
    else if (arg.startsWith('--output=')) outputDir = arg.slice('--output='.length)
    else if (arg.startsWith('--version=')) version = arg.slice('--version='.length)
    else if (arg.startsWith('--tag=')) tag = arg.slice('--tag='.length)
    else if (arg.startsWith('--commit=')) commit = arg.slice('--commit='.length)
    else throw new Error(`Unknown argument: ${arg}`)
  }
  if (!inputDir || !outputDir || !version || !tag) {
    throw new Error('Required: --input --output --version --tag')
  }
  return { inputDir, outputDir, version, tag, commit }
}

function main(): void {
  const options = parseArgs(process.argv.slice(2))
  const result = assembleRelease(options)
  console.log(JSON.stringify({
    fileCount: result.files.length,
    checksumsPath: result.checksumsPath,
    notesPath: result.notesPath,
    signingSummary: result.signingSummary,
    files: result.files.map((f) => basename(f)),
  }, null, 2))
}

if (import.meta.main) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
