import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import readline from 'node:readline';

import { resolveOmpCommand } from './omp-command.ts';
import {
  parseOmpLoginProvidersResponseData,
  parseOmpLoginResult,
  type OmpRpcLoginProvider,
} from './omp-rpc-protocol.ts';

const STDERR_LIMIT = 8192;

export type OmpAuthProbeErrorCode =
  | 'not_found'
  | 'spawn_failed'
  | 'timeout'
  | 'rpc_error'
  | 'no_providers'
  | 'login_cancelled'
  | 'unknown';

export interface OmpAuthProbeResult {
  success: boolean;
  /** Present when at least one provider was returned by OMP. */
  providers?: OmpRpcLoginProvider[];
  /** Human-readable message suitable for UI display. */
  message: string;
  /** Structured error code for diagnostics and branching logic. */
  errorCode?: OmpAuthProbeErrorCode;
  /** Raw stderr tail when the subprocess produced one. */
  stderr?: string;
  /** URL the host should open when a login flow was initiated. */
  openUrl?: string;
  launchUrl?: string;
  instructions?: string;
}

export interface OmpAuthProbeOptions {
  rawCommand?: unknown;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  /** When set, the probe also starts a login flow for this provider. */
  loginProviderId?: string;
  /** Called when OMP requests the host to open a URL during login. */
  onOpenUrl?: (payload: { url?: string; launchUrl?: string; instructions?: string }) => void;
}

export interface OmpAuthProbeDependencies {
  spawnProcess?: typeof spawn;
}

function responseError(frame: Record<string, unknown>): string {
  return typeof frame.error === 'string' && frame.error.trim()
    ? frame.error.trim()
    : 'OMP RPC command failed';
}

function classifySpawnError(error: Error, rawCommand: string): OmpAuthProbeResult {
  const message = error.message.toLowerCase();
  if (
    message.includes('enoent')
    || message.includes('no such file')
    || message.includes('cannot find')
    || message.includes('is not recognized')
  ) {
    return {
      success: false,
      message: `Oh My Pi CLI not found: "${rawCommand}". Install OMP or set its path in settings.`,
      errorCode: 'not_found',
    };
  }
  return {
    success: false,
    message: `Failed to start Oh My Pi: ${error.message}`,
    errorCode: 'spawn_failed',
  };
}

export async function probeOmpAuth(
  options: OmpAuthProbeOptions = {},
  dependencies: OmpAuthProbeDependencies = {},
): Promise<OmpAuthProbeResult> {
  const resolved = resolveOmpCommand(options.rawCommand ?? process.env.OMP_COMMAND);
  const spawnProcess = dependencies.spawnProcess ?? spawn;
  const child = spawnProcess(resolved.command, [...resolved.args, '--mode', 'rpc'], {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    windowsHide: true,
  }) as ChildProcessWithoutNullStreams;

  const timeoutMs = options.timeoutMs ?? 30_000;
  let stderr = '';
  let settled = false;
  let requestedProviders = false;
  let sentLogin = false;
  let loginFinished = false;
  let providersData: Record<string, unknown> | null = null;
  let loginResultData: unknown = null;
  let openUrlPayload: { url?: string; launchUrl?: string; instructions?: string } | null = null;

  return new Promise<OmpAuthProbeResult>((resolve) => {
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

    const finish = (result: OmpAuthProbeResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const fail = (error: Error, errorCode: OmpAuthProbeErrorCode = 'unknown') => {
      const detail = stderr.trim();
      finish({
        success: false,
        message: detail ? `${error.message}\nOMP stderr: ${detail}` : error.message,
        errorCode,
        stderr: detail || undefined,
      });
    };

    const send = (frame: Record<string, unknown>) => {
      if (settled) return;
      child.stdin.write(`${JSON.stringify(frame)}\n`, (error) => {
        if (error && !settled) fail(error, 'rpc_error');
      });
    };

    const succeedWithProviders = () => {
      const parsed = parseOmpLoginProvidersResponseData(providersData);
      if (!parsed || parsed.providers.length === 0) {
        finish({
          success: false,
          message: 'Oh My Pi returned no login providers. Configure a provider in OMP or check its output.',
          errorCode: 'no_providers',
          stderr: stderr.trim() || undefined,
        });
        return;
      }

      if (!options.loginProviderId) {
        finish({
          success: true,
          providers: parsed.providers,
          message: `Found ${parsed.providers.length} Oh My Pi provider(s).`,
        });
        return;
      }

      const provider = parsed.providers.find(p => p.id === options.loginProviderId);
      if (!provider) {
        finish({
          success: false,
          message: `Provider "${options.loginProviderId}" is not available. Choose one of: ${parsed.providers.map(p => p.name).join(', ')}.`,
          errorCode: 'no_providers',
        });
        return;
      }

      if (provider.authenticated) {
        finish({
          success: true,
          providers: parsed.providers,
          message: `Already authenticated with ${provider.name}.`,
        });
        return;
      }

      if (!provider.available) {
        finish({
          success: false,
          message: `${provider.name} is not available. Check OMP configuration.`,
          errorCode: 'no_providers',
          providers: parsed.providers,
        });
        return;
      }

      if (!sentLogin) {
        sentLogin = true;
        send({ id: 'omp-login', type: 'login', providerId: options.loginProviderId });
      }
    };

    const succeedWithLogin = () => {
      const parsed = parseOmpLoginResult(loginResultData);
      if (!parsed) {
        finish({
          success: false,
          message: 'Oh My Pi login returned an invalid result.',
          errorCode: 'rpc_error',
        });
        return;
      }
      finish({
        success: true,
        message: `Login flow completed for ${parsed.providerId}.`,
        ...(openUrlPayload
          ? {
              openUrl: openUrlPayload.url,
              launchUrl: openUrlPayload.launchUrl,
              instructions: openUrlPayload.instructions,
            }
          : {}),
      });
    };

    const timer = setTimeout(() => {
      fail(new Error(`Timed out after ${timeoutMs}ms while probing OMP auth`), 'timeout');
    }, timeoutMs);

    child.stderr.on('data', (chunk) => {
      stderr = (stderr + String(chunk)).slice(-STDERR_LIMIT);
    });

    child.on('error', (error) => {
      if (settled) return;
      finish(classifySpawnError(error, resolved.command));
    });

    child.on('exit', (code, signal) => {
      if (settled) return;
      const reason = signal ? `signal ${signal}` : `code ${code ?? 0}`;
      fail(new Error(`OMP exited with ${reason} during auth probe`), 'rpc_error');
    });

    reader.on('line', (line) => {
      if (!line.trim() || settled) return;

      let frame: Record<string, unknown>;
      try {
        frame = JSON.parse(line) as Record<string, unknown>;
      } catch {
        return;
      }

      if (frame.type === 'ready' && !requestedProviders) {
        requestedProviders = true;
        send({ id: 'omp-providers', type: 'get_login_providers' });
        return;
      }

      if (frame.type === 'extension_ui_request') {
        const method = typeof frame.method === 'string' ? frame.method : '';
        if (method === 'open_url') {
          openUrlPayload = {
            url: typeof frame.url === 'string' ? frame.url : undefined,
            launchUrl: typeof frame.launchUrl === 'string' ? frame.launchUrl : undefined,
            instructions: typeof frame.instructions === 'string' ? frame.instructions : undefined,
          };
          try {
            options.onOpenUrl?.(openUrlPayload);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            fail(new Error(`Host open-url callback failed: ${message}`), 'rpc_error');
            return;
          }
        }
        return;
      }

      if (frame.type !== 'response' || typeof frame.id !== 'string') return;
      if (frame.success === false) {
        const errorMessage = responseError(frame);
        finish({
          success: false,
          message: errorMessage,
          errorCode: 'rpc_error',
          stderr: stderr.trim() || undefined,
        });
        return;
      }

      if (frame.id === 'omp-providers') {
        providersData = typeof frame.data === 'object' && frame.data !== null
          ? frame.data as Record<string, unknown>
          : {};
        succeedWithProviders();
        return;
      }

      if (frame.id === 'omp-login') {
        loginFinished = true;
        loginResultData = frame.data;
        succeedWithLogin();
      }
    });
  });
}
