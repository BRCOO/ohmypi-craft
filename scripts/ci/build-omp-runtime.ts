#!/usr/bin/env bun

/** Build a matching OMP RPC runtime from the pinned upstream source.
 *
 * The upstream v16.3.6 release binaries predate the desktop-parity RPC
 * bridge. This builder applies the versioned source overlay kept in this repository,
 * reuses the published platform native addon, and compiles the OMP binary on
 * the GitHub runner that will package Craft.
 */

import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { brotliDecompressSync } from 'node:zlib'

type TargetId = 'win32-x64' | 'darwin-arm64' | 'darwin-x64' | 'linux-x64' | 'linux-arm64'

interface Target {
  id: TargetId
  leafPackage: string
  addonFile: string
  binaryFile: string
  destDir: string
  destFile: string
}

const ROOT = resolve(import.meta.dir, '..', '..')
const OMP_ROOT = join(ROOT, 'apps', 'electron', 'resources', 'omp')
const PATCH_B64_FILE = join(ROOT, 'scripts', 'ci', 'omp-desktop-parity.patch.br.b64')
const RUNTIME_OVERLAY_VERSION = 'desktop-parity-2'
const TARGETS: Record<TargetId, Target> = {
  'win32-x64': {
    id: 'win32-x64',
    leafPackage: '@oh-my-pi/pi-natives-win32-x64',
    addonFile: 'pi_natives.win32-x64-baseline.node',
    binaryFile: 'omp-windows-x64.exe',
    destDir: 'win32-x64',
    destFile: 'omp.exe',
  },
  'darwin-arm64': {
    id: 'darwin-arm64',
    leafPackage: '@oh-my-pi/pi-natives-darwin-arm64',
    addonFile: 'pi_natives.darwin-arm64.node',
    binaryFile: 'omp-darwin-arm64',
    destDir: 'darwin-arm64',
    destFile: 'omp',
  },
  'darwin-x64': {
    id: 'darwin-x64',
    leafPackage: '@oh-my-pi/pi-natives-darwin-x64',
    addonFile: 'pi_natives.darwin-x64-baseline.node',
    binaryFile: 'omp-darwin-x64',
    destDir: 'darwin-x64',
    destFile: 'omp',
  },
  'linux-x64': {
    id: 'linux-x64',
    leafPackage: '@oh-my-pi/pi-natives-linux-x64',
    addonFile: 'pi_natives.linux-x64-baseline.node',
    binaryFile: 'omp-linux-x64',
    destDir: 'linux-x64',
    destFile: 'omp',
  },
  'linux-arm64': {
    id: 'linux-arm64',
    leafPackage: '@oh-my-pi/pi-natives-linux-arm64',
    addonFile: 'pi_natives.linux-arm64.node',
    binaryFile: 'omp-linux-arm64',
    destDir: 'linux-arm64',
    destFile: 'omp',
  },
}

function parseArgs(argv: string[]): { targets: TargetId[]; tag: string; dryRun: boolean } {
  let targetsValue: string | undefined
  let tag = process.env.OMP_RUNTIME_SOURCE_TAG || process.env.OMP_RUNTIME_TAG || 'v16.3.6'
  let dryRun = false
  for (const arg of argv) {
    if (arg.startsWith('--targets=')) targetsValue = arg.slice('--targets='.length)
    else if (arg.startsWith('--tag=')) tag = arg.slice('--tag='.length)
    else if (arg === '--dry-run') dryRun = true
    else throw new Error(`Unknown argument: ${arg}`)
  }
  if (!targetsValue) throw new Error('Missing --targets')
  const targets = targetsValue.split(',').map((value) => value.trim()).filter(Boolean) as TargetId[]
  if (targets.length === 0 || targets.some((target) => !(target in TARGETS))) {
    throw new Error(`Unknown OMP target. Valid: ${Object.keys(TARGETS).join(', ')}`)
  }
  return { targets, tag: tag.startsWith('v') ? tag : `v${tag}`, dryRun }
}

async function run(command: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  console.log(`$ ${command.join(' ')}`)
  const child = Bun.spawn(command, { cwd, env, stdout: 'inherit', stderr: 'inherit' })
  const code = await child.exited
  if (code !== 0) throw new Error(`Command failed with exit code ${code}: ${command.join(' ')}`)
}

async function downloadAddon(buildRoot: string, target: Target, version: string): Promise<string> {
  const packageName = target.leafPackage.split('/').at(-1)!
  const packagePath = target.leafPackage.replace('/', '%2f')
  const url = `https://registry.npmjs.org/${packagePath}/-/${packageName}-${version}.tgz`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to download ${target.leafPackage}@${version}: HTTP ${response.status}`)
  const archive = join(buildRoot, `${target.id}.tgz`)
  const extractRoot = join(buildRoot, `extract-${target.id}`)
  mkdirSync(extractRoot, { recursive: true })
  await Bun.write(archive, await response.arrayBuffer())
  await run(['tar', '-xzf', archive, '-C', extractRoot], buildRoot)
  const addon = join(extractRoot, 'package', target.addonFile)
  if (!existsSync(addon)) throw new Error(`Published native addon missing from ${url}: ${target.addonFile}`)
  return addon
}

async function main(): Promise<void> {
  const { targets, tag, dryRun } = parseArgs(process.argv.slice(2))
  const sourceRepo = process.env.OMP_RUNTIME_SOURCE_REPO || 'can1357/oh-my-pi'
  const buildRoot = mkdtempSync(join(tmpdir(), 'omp-desktop-parity-build-'))
  const sourceRoot = join(buildRoot, 'oh-my-pi')

  try {
    if (dryRun) {
      console.log(`DRY RUN clone ${sourceRepo}@${tag}`)
      console.log(`DRY RUN decode/apply ${PATCH_B64_FILE}`)
      console.log(`DRY RUN build targets ${targets.join(',')}`)
      return
    }

    await run(['git', 'clone', '--depth=1', '--branch', tag, `https://github.com/${sourceRepo}.git`, sourceRoot], ROOT)
    const patchFile = join(buildRoot, 'omp-desktop-parity.patch')
    const patchBase64 = (await Bun.file(PATCH_B64_FILE).text()).replace(/\s+/g, '')
    await Bun.write(patchFile, brotliDecompressSync(Buffer.from(patchBase64, 'base64')))
    await run(['git', 'apply', patchFile], sourceRoot)
    // The source lockfile contains platform-conditional optional packages. A
    // writable temporary checkout must resolve those for the current runner;
    // the Craft repository itself remains frozen and unchanged.
    await run(['bun', 'install', '--no-save'], sourceRoot)

    for (const targetId of targets) {
      const target = TARGETS[targetId]
      const addon = await downloadAddon(buildRoot, target, tag.slice(1))
      const addonDestination = join(sourceRoot, 'packages', 'natives', 'native', target.addonFile)
      mkdirSync(dirname(addonDestination), { recursive: true })
      cpSync(addon, addonDestination)
    }

    await run(['bun', 'run', 'ci:release:build-binaries', `--targets=${targets.join(',')}`], sourceRoot)

    for (const targetId of targets) {
      const target = TARGETS[targetId]
      const built = join(sourceRoot, 'packages', 'coding-agent', 'binaries', target.binaryFile)
      if (!existsSync(built)) throw new Error(`OMP build did not produce ${target.binaryFile}`)
      const destination = join(OMP_ROOT, target.destDir, target.destFile)
      mkdirSync(dirname(destination), { recursive: true })
      cpSync(built, destination)
      if (!destination.endsWith('.exe')) chmodSync(destination, 0o755)
      console.log(`Installed ${target.id} runtime: ${destination}`)
    }

    mkdirSync(OMP_ROOT, { recursive: true })
    await Bun.write(join(OMP_ROOT, 'FETCHED_VERSION'), `${tag}-${RUNTIME_OVERLAY_VERSION}\n`)
  } finally {
    rmSync(buildRoot, { recursive: true, force: true })
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
