import {
  spawn,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process';
import readline from 'node:readline';

import type {
  OmpRuntimeErrorCode,
  OmpRuntimeStatus,
} from '../../../protocol/dto.ts';
import {
  discoverOmpModels,
  type OmpModelDiscoveryDependencies,
} from './omp-model-discovery.ts';
import { resolveOmpRuntimeCommand } from './omp-command.ts';
import { probeOmpAuth } from './omp-auth-probe.ts';
import { checkOmpVersionCompatibility } from './omp-version-check.ts';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { parseOmpRuntimeResources, type OmpRpcRuntimeResources } from './omp-rpc-protocol.ts';

export interface OmpRuntimeDiagnosticsOptions {
  configuredCommand?: unknown;
  envCommand?: unknown;
  bundledCommand?: unknown;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export interface OmpRuntimeDiagnosticsDependencies extends OmpModelDiscoveryDependencies {
  /** Set to null to skip the non-fatal version probe. */
  versionSpawnProcess?: typeof spawn | null;
}

export async function detectOmpVersion(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    spawnProcess?: typeof spawn;
  } = {},
): Promise<string | undefined> {
  const spawnProcess = options.spawnProcess ?? spawn;
  return new Promise((resolve) => {
    let child: ChildProcessWithoutNullStreams;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      child = spawnProcess(command, [...args, '--version'], {
        cwd: options.cwd,
        env: options.env ? { ...process.env, ...options.env } : process.env,
        windowsHide: true,
      });
    } catch {
      resolve(undefined);
      return;
    }

    let settled = false;
    let output = '';
    const finish = (value?: string) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(value);
    };
    const append = (chunk: unknown) => {
      output = (output + String(chunk)).slice(-4096);
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.on('error', () => finish());
    child.on('exit', () => {
      const match = /\bomp\/([^\s]+)|\b(\d+\.\d+\.\d+(?:[-+][^\s]+)?)/i.exec(output.trim());
      finish(match?.[1] ?? match?.[2]);
    });
    timer = setTimeout(() => {
      if (!child.killed) child.kill();
      finish();
    }, options.timeoutMs ?? 2_000);
  });
}

function classifyOmpRuntimeError(message: string): OmpRuntimeErrorCode {
  const lower = message.toLowerCase();
  if (lower.includes('enoent') || lower.includes('not found')) return 'not_found';
  if (lower.includes('timed out')) return 'timeout';
  if (lower.includes('no valid models') || lower.includes('no models')) return 'no_models';
  if (lower.includes('rpc') || lower.includes('command failed') || lower.includes('response')) return 'rpc_error';
  if (lower.includes('exited with') || lower.includes('spawn')) return 'spawn_failed';
  return 'unknown';
}

export async function checkOmpRuntime(
  options: OmpRuntimeDiagnosticsOptions = {},
  dependencies: OmpRuntimeDiagnosticsDependencies = {},
): Promise<OmpRuntimeStatus> {
  const resolved = resolveOmpRuntimeCommand({
    configuredCommand: options.configuredCommand,
    envCommand: options.envCommand ?? process.env.OMP_COMMAND,
    bundledCommand: options.bundledCommand,
  });
  const startedAt = Date.now();
  const base = {
    command: resolved.command,
    args: resolved.args,
    rawCommand: resolved.rawCommand,
    source: resolved.source,
    cwd: options.cwd,
    protocolVersion: 'unversioned' as const,
  };
  const versionSpawnProcess = dependencies.versionSpawnProcess === null
    ? null
    : dependencies.versionSpawnProcess ?? (dependencies.spawnProcess ? null : spawn);
  const versionPromise = versionSpawnProcess
    ? detectOmpVersion(resolved.command, resolved.args, {
        cwd: options.cwd,
        env: options.env,
        timeoutMs: Math.min(options.timeoutMs ?? 2_000, 2_000),
        spawnProcess: versionSpawnProcess,
      })
    : Promise.resolve(undefined);

  try {
    const [result, version] = await Promise.all([
      discoverOmpModels({
        rawCommand: resolved.rawCommand,
        cwd: options.cwd,
        env: options.env,
        timeoutMs: options.timeoutMs ?? 15_000,
      }, dependencies),
      versionPromise,
    ]);

    return {
      ...base,
      ok: true,
      elapsedMs: Date.now() - startedAt,
      modelCount: result.models.length,
      defaultModel: result.serverDefault,
      version,
      checkedAt: Date.now(),
    };
  } catch (error) {
    const version = await versionPromise;
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...base,
      ok: false,
      elapsedMs: Date.now() - startedAt,
      error: message,
      errorCode: classifyOmpRuntimeError(message),
      version,
      checkedAt: Date.now(),
    };
  }
}

export interface OmpDiagnosticsSummary {
  runtime: OmpRuntimeStatus;
  /** Provider list and high-level auth status from OMP, when reachable. */
  providers?: {
    providers: import('./omp-rpc-protocol.ts').OmpRpcLoginProvider[];
    authenticated: number;
    available: number;
    total: number;
  };
  /** Absolute path to the OMP agent/config directory, if CLI is usable. */
  agentDir?: string;
  /** Whether the main config file (config.yml) exists. */
  configFileExists?: boolean;
  /** Whether the OMP auth directory exists. */
  authDirExists?: boolean;
  /** Resources loaded by OMP's real discovery providers for this cwd. */
  runtimeResources?: OmpRpcRuntimeResources;
  runtimeResourcesError?: string;
  /** Version compatibility conclusion from the runtime probe. */
  versionCompatibility?: {
    ompVersion?: string;
    compatible: boolean;
    warning?: string;
  };
}

async function probeOmpRuntimeResources(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; spawnProcess?: typeof spawn },
): Promise<{ resources?: OmpRpcRuntimeResources; error?: string }> {
  return new Promise((resolve) => {
    const spawnProcess = options.spawnProcess ?? spawn;
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawnProcess(command, [...args, '--mode', 'rpc', '--no-session'], {
        cwd: options.cwd,
        env: options.env ? { ...process.env, ...options.env } : process.env,
        windowsHide: true,
      });
    } catch (error) {
      resolve({ error: error instanceof Error ? error.message : String(error) });
      return;
    }

    let settled = false;
    let stderr = '';
    const reader = readline.createInterface({ input: child.stdout });
    const finish = (result: { resources?: OmpRpcRuntimeResources; error?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reader.close();
      if (!child.killed) child.kill();
      resolve(result);
    };
    const timer = setTimeout(() => finish({ error: 'Timed out while reading OMP runtime resources.' }), options.timeoutMs ?? 15_000);

    child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-4096); });
    child.on('error', error => finish({ error: error.message }));
    child.on('exit', code => {
      if (!settled) finish({ error: stderr.trim() || `OMP exited with code ${code ?? 0} while reading runtime resources.` });
    });
    reader.on('line', line => {
      let frame: Record<string, unknown>;
      try {
        frame = JSON.parse(line) as Record<string, unknown>;
      } catch {
        return;
      }
      if (frame.type === 'ready') {
        child.stdin.write(`${JSON.stringify({ id: 'omp-runtime-resources', type: 'get_runtime_resources' })}\n`);
        return;
      }
      if (frame.type !== 'response' || frame.id !== 'omp-runtime-resources') return;
      if (frame.success === false) {
        finish({ error: typeof frame.error === 'string' ? frame.error : 'OMP get_runtime_resources failed.' });
        return;
      }
      const resources = parseOmpRuntimeResources(frame.data);
      finish(resources ? { resources } : { error: 'OMP returned invalid runtime resource data.' });
    });
  });
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function probeOmpAgentDir(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; spawnProcess?: typeof spawn },
): Promise<string | undefined> {
  return new Promise((resolve) => {
    const spawnProcess = options.spawnProcess ?? spawn;
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawnProcess(command, [...args, 'config', 'path'], {
        cwd: options.cwd,
        env: options.env ? { ...process.env, ...options.env } : process.env,
        windowsHide: true,
      });
    } catch {
      resolve(undefined);
      return;
    }

    let settled = false;
    let output = '';
    const timer = setTimeout(() => {
      if (!child.killed) child.kill();
      finish();
    }, options.timeoutMs ?? 3_000);

    const finish = (value?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    child.stdout.on('data', (chunk) => {
      output = (output + String(chunk)).slice(-4096);
    });
    child.stderr.on('data', () => {});
    child.on('error', () => finish());
    child.on('exit', () => {
      const trimmed = output.trim();
      finish(trimmed || undefined);
    });
  });
}

export async function getOmpDiagnosticsSummary(
  options: OmpRuntimeDiagnosticsOptions = {},
  dependencies: OmpRuntimeDiagnosticsDependencies = {},
): Promise<OmpDiagnosticsSummary> {
  const runtime = await checkOmpRuntime(options, dependencies);

  if (!runtime.ok) {
    return {
      runtime,
      versionCompatibility: runtime.version
        ? { ompVersion: runtime.version, ...checkOmpVersionCompatibility(runtime.version, undefined) }
        : undefined,
    };
  }

  const [authResult, agentDir, runtimeResourceResult] = await Promise.all([
    probeOmpAuth({
      rawCommand: runtime.rawCommand,
      cwd: runtime.cwd,
      env: options.env,
      timeoutMs: options.timeoutMs ?? 30_000,
    }, { spawnProcess: dependencies.spawnProcess }),
    probeOmpAgentDir(runtime.command, runtime.args, {
      cwd: runtime.cwd,
      env: options.env,
      timeoutMs: 3_000,
      spawnProcess: dependencies.spawnProcess,
    }),
    probeOmpRuntimeResources(runtime.command, runtime.args, {
      cwd: runtime.cwd,
      env: options.env,
      timeoutMs: Math.min(options.timeoutMs ?? 30_000, 15_000),
      spawnProcess: dependencies.spawnProcess,
    }),
  ]);

  const providers = authResult.success
    ? {
        providers: authResult.providers ?? [],
        authenticated: authResult.providers?.filter(p => p.authenticated).length ?? 0,
        available: authResult.providers?.filter(p => p.available).length ?? 0,
        total: authResult.providers?.length ?? 0,
      }
    : undefined;

  let configFileExists: boolean | undefined;
  let authDirExists: boolean | undefined;
  if (agentDir) {
    [configFileExists, authDirExists] = await Promise.all([
      pathExists(join(agentDir, 'config.yml')),
      pathExists(join(agentDir, 'auth')),
    ]);
  }

  return {
    runtime,
    providers,
    agentDir,
    configFileExists,
    authDirExists,
    runtimeResources: runtimeResourceResult.resources,
    runtimeResourcesError: runtimeResourceResult.error,
    versionCompatibility: {
      ompVersion: runtime.version,
      ...checkOmpVersionCompatibility(runtime.version, undefined),
    },
  };
}
