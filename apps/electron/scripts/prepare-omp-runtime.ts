import { access, copyFile, mkdir } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

interface RuntimeTarget {
  platform: 'win32' | 'darwin' | 'linux'
  arch: 'x64' | 'arm64'
}

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function parseTarget(): RuntimeTarget {
  const platform = readArg('--platform') ?? process.platform
  const arch = readArg('--arch') ?? process.arch
  if (!['win32', 'darwin', 'linux'].includes(platform)) {
    throw new Error(`Unsupported OMP runtime platform: ${platform}`)
  }
  if (!['x64', 'arm64'].includes(arch)) {
    throw new Error(`Unsupported OMP runtime architecture: ${arch}`)
  }
  return {
    platform: platform as RuntimeTarget['platform'],
    arch: arch as RuntimeTarget['arch'],
  }
}

function commandForTarget(target: RuntimeTarget): string {
  return `${target.platform === 'win32' ? 'windows' : target.platform}-${target.arch}`
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: 'inherit',
      windowsHide: true,
    })
    child.once('error', reject)
    child.once('exit', code => {
      if (code === 0) {
        resolvePromise()
      } else {
        reject(new Error(`${command} ${args.join(' ')} failed with exit code ${code ?? 'unknown'}`))
      }
    })
  })
}

async function main(): Promise<void> {
  const target = parseTarget()
  const electronRoot = resolve(import.meta.dir, '..')
  const defaultUpstreamRoot = resolve(electronRoot, '..', '..', '..', 'oh-my-pi-upstream')
  const upstreamRoot = resolve(process.env.OMP_UPSTREAM_DIR ?? defaultUpstreamRoot)
  const codingAgentRoot = join(upstreamRoot, 'packages', 'coding-agent')
  const isHostTarget = target.platform === process.platform && target.arch === process.arch
  const crossTarget = isHostTarget ? undefined : commandForTarget(target)
  const outputName = crossTarget ? `omp-${crossTarget}` : 'omp'
  const sourceBinary = join(codingAgentRoot, 'dist', `${outputName}${target.platform === 'win32' ? '.exe' : ''}`)

  if (!(await pathExists(join(codingAgentRoot, 'package.json')))) {
    throw new Error(`OMP upstream source was not found at ${upstreamRoot}. Set OMP_UPSTREAM_DIR to the Oh My Pi source checkout.`)
  }

  if (isHostTarget) {
    await run('bun', ['--cwd=packages/natives', 'run', 'build'], upstreamRoot)
  }
  await run('bun', ['run', 'build'], codingAgentRoot, {
    ...process.env,
    ...(crossTarget ? { CROSS_TARGET: crossTarget } : {}),
  })

  if (!(await pathExists(sourceBinary))) {
    throw new Error(`OMP build completed but did not produce ${sourceBinary}`)
  }

  const destination = join(
    electronRoot,
    'resources',
    'omp',
    `${target.platform}-${target.arch}`,
    target.platform === 'win32' ? 'omp.exe' : 'omp',
  )
  await mkdir(dirname(destination), { recursive: true })
  await copyFile(sourceBinary, destination)
  console.log(`Bundled OMP runtime: ${destination}`)
}

await main()
