import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import readline from 'node:readline';

import type { ModelFetchResult } from '../../../config/model-fetcher.ts';
import { resolveOmpCommand } from './omp-command.ts';
import { normalizeOmpModels, resolveOmpServerDefault } from './omp-models.ts';

const STDERR_LIMIT = 8192;

export interface OmpModelDiscoveryOptions {
  rawCommand?: unknown;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export interface OmpModelDiscoveryDependencies {
  spawnProcess?: typeof spawn;
}

function responseError(frame: Record<string, unknown>): string {
  return typeof frame.error === 'string' && frame.error.trim()
    ? frame.error.trim()
    : 'OMP RPC command failed';
}

export async function discoverOmpModels(
  options: OmpModelDiscoveryOptions = {},
  dependencies: OmpModelDiscoveryDependencies = {},
): Promise<ModelFetchResult> {
  const resolved = resolveOmpCommand(options.rawCommand ?? process.env.OMP_COMMAND);
  const spawnProcess = dependencies.spawnProcess ?? spawn;
  const child = spawnProcess(resolved.command, [...resolved.args, '--mode', 'rpc'], {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    windowsHide: true,
  }) as ChildProcessWithoutNullStreams;

  const timeoutMs = options.timeoutMs ?? 15_000;
  let stderr = '';
  let settled = false;
  let requested = false;
  let modelsData: Record<string, unknown> | null = null;
  let stateData: Record<string, unknown> | null = null;

  return new Promise<ModelFetchResult>((resolve, reject) => {
    const reader = readline.createInterface({ input: child.stdout });

    const cleanup = () => {
      clearTimeout(timer);
      reader.close();
      child.removeAllListeners();
      child.stdout.removeAllListeners();
      child.stderr.removeAllListeners();
      child.stdin.removeAllListeners();
      if (!child.killed) child.kill();
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      const detail = stderr.trim();
      reject(new Error(detail ? `${error.message}\nOMP stderr: ${detail}` : error.message));
    };

    const succeedIfComplete = () => {
      if (settled || !modelsData || !stateData) return;

      const models = normalizeOmpModels(modelsData.models);
      if (models.length === 0) {
        fail(new Error('OMP returned no valid models'));
        return;
      }

      settled = true;
      cleanup();
      resolve({
        models,
        serverDefault: resolveOmpServerDefault(models, stateData),
      });
    };

    const send = (frame: Record<string, unknown>) => {
      child.stdin.write(`${JSON.stringify(frame)}\n`, (error) => {
        if (error) fail(error);
      });
    };

    const timer = setTimeout(() => {
      fail(new Error(`Timed out after ${timeoutMs}ms while discovering OMP models`));
    }, timeoutMs);

    child.stderr.on('data', (chunk) => {
      stderr = (stderr + String(chunk)).slice(-STDERR_LIMIT);
    });

    child.on('error', (error) => fail(error));
    child.on('exit', (code, signal) => {
      const reason = signal ? `signal ${signal}` : `code ${code ?? 0}`;
      fail(new Error(`OMP exited with ${reason} during model discovery`));
    });

    reader.on('line', (line) => {
      if (!line.trim()) return;

      let frame: Record<string, unknown>;
      try {
        frame = JSON.parse(line) as Record<string, unknown>;
      } catch {
        return;
      }

      if (frame.type === 'ready' && !requested) {
        requested = true;
        send({ id: 'omp-models', type: 'get_available_models' });
        send({ id: 'omp-state', type: 'get_state' });
        return;
      }

      if (frame.type !== 'response' || typeof frame.id !== 'string') return;
      if (frame.success === false) {
        fail(new Error(responseError(frame)));
        return;
      }

      const data = typeof frame.data === 'object' && frame.data !== null
        ? frame.data as Record<string, unknown>
        : {};

      if (frame.id === 'omp-models') modelsData = data;
      if (frame.id === 'omp-state') stateData = data;
      succeedIfComplete();
    });
  });
}
