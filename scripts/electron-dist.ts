import { existsSync } from 'fs'
import { join } from 'path'

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

function builderArgs(platform: PlatformTarget): string[] {
  const args = ['--config', 'electron-builder.yml']
  if (platform !== 'current') {
    args.push(`--${platform}`)
  }
  return args
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

  if (!skipBuild) {
    await run([BUN_EXE, 'run', 'electron:build'], { cwd: ROOT_DIR, env })
  }

  await run([NODE_EXE, ELECTRON_BUILDER_CLI, ...builderArgs(platform)], {
    cwd: ELECTRON_DIR,
    env,
  })
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
