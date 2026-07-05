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
  dependencies: OmpModelDiscoveryDependencies = {},
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
  };

  try {
    const result = await discoverOmpModels({
      rawCommand: resolved.rawCommand,
      cwd: options.cwd,
      env: options.env,
      timeoutMs: options.timeoutMs ?? 15_000,
    }, dependencies);

    return {
      ...base,
      ok: true,
      elapsedMs: Date.now() - startedAt,
      modelCount: result.models.length,
      defaultModel: result.serverDefault,
      checkedAt: Date.now(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...base,
      ok: false,
      elapsedMs: Date.now() - startedAt,
      error: message,
      errorCode: classifyOmpRuntimeError(message),
      checkedAt: Date.now(),
    };
  }
}

