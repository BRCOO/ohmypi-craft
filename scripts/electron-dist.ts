import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
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

function builderArgs(platform: PlatformTarget, options: { dev: boolean; arch: Arch; unsignedMac?: boolean }): string[] {
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
  if (platform === 'mac' && options.unsignedMac) {
    // electron-builder otherwise attempts a signing pass on macOS even when
    // CSC_IDENTITY_AUTO_DISCOVERY is disabled. Explicit null skips signing.
    args.push('--config.mac.identity=null')
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

function hasWindowsSigningCredentials(): boolean {
  const link = process.env.WIN_CSC_LINK || process.env.CSC_LINK
  const name = process.env.CSC_NAME
  if (name && name.trim()) return true
  if (!link || !link.trim()) return false
  if (link.includes('BEGIN') || link.length > 200) return true
  return existsSync(link)
}

function hasAppleSigningCredentials(): boolean {
  if (process.env.CSC_NAME?.trim() || process.env.APPLE_SIGNING_IDENTITY?.trim()) return true
  const link = process.env.CSC_LINK || process.env.APPLE_CERTIFICATE_BASE64
  if (!link || !link.trim()) return false
  if (link.includes('BEGIN') || link.length > 200) return true
  return existsSync(link)
}

/**
 * electron-builder copies the entire resources/omp tree. Keep only the current
 * platform/arch binary so packages do not ship sibling-arch runtimes and so
 * integrity checks see exactly one OMP executable.
 */
function stageOmpRuntimeForTarget(platform: Platform, arch: Arch): void {
  const ompRoot = join(ELECTRON_DIR, 'resources', 'omp')
  const cacheRoot = join(ELECTRON_DIR, 'resources', '.omp-cache')
  const keepKey = `${platform}-${arch}`
  const binaryName = platform === 'win32' ? 'omp.exe' : 'omp'

  if (!existsSync(ompRoot) && !existsSync(cacheRoot)) {
    console.warn(`OMP runtime directory missing at ${ompRoot}; package integrity may fail.`)
    return
  }

  // Preserve pin/metadata files while restaging architecture directories.
  const preservedFiles: Array<{ name: string; data: Buffer }> = []

  // Seed cache from resources/omp so multi-arch loops can restage each target.
  if (existsSync(ompRoot)) {
    mkdirSync(cacheRoot, { recursive: true })
    for (const entry of readdirSync(ompRoot, { withFileTypes: true })) {
      if (entry.isFile()) {
        preservedFiles.push({ name: entry.name, data: readFileSync(join(ompRoot, entry.name)) })
        continue
      }
      if (!entry.isDirectory()) continue
      const srcBin = join(ompRoot, entry.name, entry.name.startsWith('win32') ? 'omp.exe' : 'omp')
      const altBin = join(ompRoot, entry.name, 'omp.exe')
      const bin = existsSync(srcBin) ? srcBin : existsSync(altBin) ? altBin : null
      if (!bin) continue
      const destDir = join(cacheRoot, entry.name)
      mkdirSync(destDir, { recursive: true })
      const destName = entry.name.startsWith('win32') ? 'omp.exe' : 'omp'
      writeFileSync(join(destDir, destName), readFileSync(bin))
    }
  }

  const cached = join(cacheRoot, keepKey, binaryName)
  if (!existsSync(cached)) {
    console.warn(`OMP runtime not found for ${keepKey} at ${cached}`)
    return
  }

  rmSync(ompRoot, { recursive: true, force: true })
  mkdirSync(join(ompRoot, keepKey), { recursive: true })
  const dest = join(ompRoot, keepKey, binaryName)
  writeFileSync(dest, readFileSync(cached))
  for (const file of preservedFiles) {
    writeFileSync(join(ompRoot, file.name), file.data)
  }
  if (platform !== 'win32') {
    try {
      chmodSync(dest, 0o755)
    } catch {
      // Best-effort on hosts that ignore mode bits.
    }
  }
  console.log(`Staged OMP runtime for ${keepKey}`)
}

async function main(): Promise<void> {
  const { platform, dev, skipBuild } = parseArgs()
  if (!existsSync(ELECTRON_BUILDER_CLI)) {
    throw new Error(`electron-builder CLI not found at ${ELECTRON_BUILDER_CLI}. Run bun install first.`)
  }

  const env: Record<string, string | undefined> = {}
  const resolvedPlatform = targetPlatform(platform)
  const winTarget = resolvedPlatform === 'win32'
  const macTarget = resolvedPlatform === 'darwin'
  const productionWindowsSigning = !dev && winTarget && hasWindowsSigningCredentials()
  const productionAppleSigning = !dev && macTarget && hasAppleSigningCredentials()

  if (dev) {
    env.CRAFT_DEV_RUNTIME = '1'
    env.CSC_IDENTITY_AUTO_DISCOVERY = 'false'
  } else if (winTarget) {
    if (productionWindowsSigning) {
      // Formal Windows Authenticode signing for release candidates.
      env.CSC_IDENTITY_AUTO_DISCOVERY = 'true'
      console.log('Windows code signing credentials detected — enabling Authenticode signing.')
    } else {
      // Local / CI without certs: keep unsigned, avoid winCodeSign symlink extraction.
      env.CSC_IDENTITY_AUTO_DISCOVERY = 'false'
      console.log(
        'Windows code signing credentials not set (WIN_CSC_LINK / CSC_LINK / CSC_NAME). ' +
          'Building an unsigned installer. Production releases must supply signing material.',
      )
    }
  } else if (macTarget) {
    if (productionAppleSigning) {
      // electron-builder consumes CSC_LINK. Accept the documented
      // APPLE_CERTIFICATE_BASE64 alias as a base64/P12 certificate input too.
      if (!process.env.CSC_LINK && process.env.APPLE_CERTIFICATE_BASE64?.trim()) {
        env.CSC_LINK = process.env.APPLE_CERTIFICATE_BASE64
      }
      env.CSC_IDENTITY_AUTO_DISCOVERY = 'true'
      console.log('Apple code signing credentials detected — enabling macOS signing.')
      if (process.env.APPLE_ID && process.env.APPLE_TEAM_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD) {
        console.log('Apple notarization credentials detected.')
      } else {
        console.log(
          'Apple notarization credentials incomplete ' +
            '(APPLE_ID / APPLE_TEAM_ID / APPLE_APP_SPECIFIC_PASSWORD). Building signed but not notarized.',
        )
      }
    } else {
      // CI / local without Developer ID: produce unsigned DMG/ZIP that still installs for QA.
      env.CSC_IDENTITY_AUTO_DISCOVERY = 'false'
      console.log(
        'Apple code signing credentials not set. Building unsigned macOS packages. ' +
          'Do not claim notarization without complete Apple secrets.',
      )
    }
  }

  await ensureBundledUv(platform)
  await ensureBundledBun(platform)

  if (!skipBuild) {
    await run([BUN_EXE, 'run', 'electron:build'], { cwd: ROOT_DIR, env })
  }

  for (const arch of targetArchs(platform)) {
    stageRuntimeDependencies(platform, arch)
    stageOmpRuntimeForTarget(resolvedPlatform, arch)
    const args = builderArgs(platform, { dev, arch, unsignedMac: macTarget && !productionAppleSigning })
    if (productionWindowsSigning) {
      // Override electron-builder.yml default so the cert can edit PE resources.
      args.push('--config.win.signAndEditExecutable=true')
    }
    await run([NODE_EXE, ELECTRON_BUILDER_CLI, ...args], {
      cwd: ELECTRON_DIR,
      env,
    })
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
