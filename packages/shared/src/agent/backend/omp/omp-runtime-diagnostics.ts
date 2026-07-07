import {
  spawn,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process';

import type {
  OmpRuntimeErrorCode,
  OmpRuntimeStatus,
} from '../../../protocol/dto.ts';
import {
  discoverOmpModels,
  type OmpModelDiscoveryDependencies,
} from './omp-model-discovery.ts';
import { resolveOmpRuntimeCommand } from './omp-command.ts';

export interface OmpRuntimeDiagnosticsOptions {
  configuredCommand?: unknown;
  envCommand?: unknown;
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
