import { existsSync } from 'fs'
import { join } from 'path'
import {
  downloadBun,
  copyRipgrep,
  copySDK,
  downloadUv,
  verifySDKCopy,
  type Arch,
  type BuildConfig,
  type Platform,
} from './build/common'

const ROOT_DIR = join(import.meta.dir, '..')
const ELECTRON_DIR = join(ROOT_DIR, 'apps/electron')
const BUN_EXE = process.versions.bun ? process.execPath : (Bun.which('bun') ?? 'bun')
const NODE_EXE = process.env.NODE_EXE ?? Bun.which('node') ?? 'node'
const ELECTRON_BUILDER_CLI = join(ROOT_DIR, 'node_modules/electron-builder/out/cli/cli.js')

type PlatformTarget = 'current' | 'mac' | 'win' | 'linux'

function parseArgs(): { platform: PlatformTarget; dev: boolean; skipBuild: boolean } {
  let platform: PlatformTarget = 'current'
  let dev = false
  let skipBuild = false

  for (const arg of process.argv.slice(2)) {
    if (arg === '--dev') {
      dev = true
    } else if (arg === '--skip-build') {
      skipBuild = true
    } else if (arg.startsWith('--platform=')) {
      const value = arg.slice('--platform='.length)
      if (!['current', 'mac', 'win', 'linux'].includes(value)) {
        throw new Error(`Unsupported platform "${value}". Use current, mac, win, or linux.`)
      }
      platform = value as PlatformTarget
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return { platform, dev, skipBuild }
}

async function run(cmd: string[], options: { cwd: string; env?: Record<string, string | undefined> }): Promise<void> {
  console.log(`> ${cmd.join(' ')}`)
  const proc = Bun.spawn({
    cmd,
    cwd: options.cwd,
    env: {
      ...process.env,
      ...options.env,
    },
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    throw new Error(`Command failed with exit code ${exitCode}: ${cmd.join(' ')}`)
  }
}

function builderArgs(platform: PlatformTarget, options: { dev: boolean; arch: Arch }): string[] {
  const args = ['--config', 'electron-builder.yml']
  if (platform !== 'current') {
    args.push(`--${platform}`)
  }
  args.push(options.arch === 'arm64' ? '--arm64' : '--x64')
  if (options.dev && targetPlatform(platform) === 'win32') {
    // Dev Windows packaging must run for regular users. electron-builder's
    // winCodeSign helper archive contains macOS symlinks, which fail to extract
    // on Windows without Developer Mode/admin privileges. Keep full signing and
    // resource editing for the non-dev distribution commands.
    args.push('--config.win.signAndEditExecutable=false')
  }
  if (options.dev) {
    // Dev packaging is a local acceptance artifact built from already-bundled
    // app output. Avoid electron-builder's online dependency install/rebuild
    // step so smoke tests do not depend on registry access or local TLS setup.
    args.push('--config.npmRebuild=false')
    args.push('--config.nodeGypRebuild=false')
    args.push('--config.buildDependenciesFromSource=false')
  }
  return args
}

function currentPlatform(): Platform {
  if (process.platform === 'darwin') return 'darwin'
  if (process.platform === 'win32') return 'win32'
  if (process.platform === 'linux') return 'linux'
  throw new Error(`Unsupported platform: ${process.platform}`)
}

function currentArch(): Arch {
  if (process.arch === 'arm64') return 'arm64'
  if (process.arch === 'x64') return 'x64'
  throw new Error(`Unsupported architecture: ${process.arch}`)
}

function targetPlatform(platform: PlatformTarget): Platform {
  if (platform === 'mac') return 'darwin'
  if (platform === 'win') return 'win32'
  if (platform === 'linux') return 'linux'
  return currentPlatform()
}

function targetArchs(platform: PlatformTarget): Arch[] {
  if (platform === 'mac') return ['arm64', 'x64']
  if (platform === 'win' || platform === 'linux') return ['x64']
  return currentPlatform() === 'darwin' ? ['arm64', 'x64'] : [currentArch()]
}

async function ensureBundledUv(platform: PlatformTarget): Promise<void> {
  const resolvedPlatform = targetPlatform(platform)
  for (const arch of targetArchs(platform)) {
    await downloadUv({
      platform: resolvedPlatform,
      arch,
      upload: false,
      uploadLatest: false,
      uploadScript: false,
      rootDir: ROOT_DIR,
      electronDir: ELECTRON_DIR,
    })
  }
}

async function ensureBundledBun(platform: PlatformTarget): Promise<void> {
  const resolvedPlatform = targetPlatform(platform)

  // The current electron-builder resource layout has a single vendor/bun path.
  // Windows is the acceptance target for this packaged smoke flow and ships one
  // x64 artifact, so stage that runtime explicitly here. macOS universal Bun
  // packaging needs a per-arch resource layout before this can be generalized.
  if (resolvedPlatform !== 'win32') {
    return
  }

  const bunBinary = join(ELECTRON_DIR, 'vendor', 'bun', 'bun.exe')
  if (existsSync(bunBinary)) {
    console.log(`Bundled Bun already present at ${bunBinary}`)
    return
  }

  await downloadBun(buildConfig(resolvedPlatform, 'x64'))
}

function buildConfig(platform: Platform, arch: Arch): BuildConfig {
  return {
    platform,
    arch,
    upload: false,
    uploadLatest: false,
    uploadScript: false,
    rootDir: ROOT_DIR,
    electronDir: ELECTRON_DIR,
  }
}

function stageRuntimeDependencies(platform: PlatformTarget, arch: Arch): void {
  const resolvedPlatform = targetPlatform(platform)
  const config = buildConfig(resolvedPlatform, arch)
  copySDK(config)
  verifySDKCopy(config)
  copyRipgrep(config)
}

async function main(): Promise<void> {
  const { platform, dev, skipBuild } = parseArgs()
  if (!existsSync(ELECTRON_BUILDER_CLI)) {
    throw new Error(`electron-builder CLI not found at ${ELECTRON_BUILDER_CLI}. Run bun install first.`)
  }

  const env: Record<string, string | undefined> = {}
  if (dev) {
    env.CRAFT_DEV_RUNTIME = '1'
    env.CSC_IDENTITY_AUTO_DISCOVERY = 'false'
  }

  await ensureBundledUv(platform)
  await ensureBundledBun(platform)

  if (!skipBuild) {
    await run([BUN_EXE, 'run', 'electron:build'], { cwd: ROOT_DIR, env })
  }

  for (const arch of targetArchs(platform)) {
    stageRuntimeDependencies(platform, arch)
    await run([NODE_EXE, ELECTRON_BUILDER_CLI, ...builderArgs(platform, { dev, arch })], {
      cwd: ELECTRON_DIR,
      env,
    })
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
