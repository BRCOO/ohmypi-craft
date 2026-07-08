import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import readline from 'node:readline';

import { resolveOmpRuntimeCommand } from '@craft-agent/shared/agent/backend';

interface ResponseFrame {
  type: 'response';
  id?: string;
  command: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

const REQUEST_TIMEOUT_MS = 30_000;
const READY_TIMEOUT_MS = 15_000;

async function main(): Promise<void> {
  const resolved = resolveOmpRuntimeCommand({
    configuredCommand: process.env.OMP_COMMAND,
  });
  const child = spawn(resolved.command, [...resolved.args, '--mode', 'rpc'], {
    cwd: process.cwd(),
    env: process.env,
    windowsHide: true,
  });

  const pending = new Map<string, PendingRequest>();
  let requestId = 0;
  let stderr = '';
  let readyResolve: (() => void) | undefined;
  let readyReject: ((error: Error) => void) | undefined;
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const readyTimer = setTimeout(() => {
    readyReject?.(new Error(`OMP ready timed out. ${stderr}`));
  }, READY_TIMEOUT_MS);

  const reader = readline.createInterface({ input: child.stdout });
  reader.on('line', (line) => {
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    if (frame.type === 'ready') {
      clearTimeout(readyTimer);
      readyResolve?.();
      return;
    }
    if (frame.type !== 'response') return;
    const response = frame as unknown as ResponseFrame;
    const entry = response.id ? pending.get(response.id) : undefined;
    if (!entry || !response.id) return;
    pending.delete(response.id);
    clearTimeout(entry.timer);
    if (response.success) {
      entry.resolve(response.data);
    } else {
      entry.reject(new Error(response.error ?? `${response.command} failed`));
    }
  });
  child.stderr.on('data', (chunk) => {
    stderr = `${stderr}${String(chunk)}`.slice(-4096);
  });

  const failAll = (error: Error) => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
  };
  child.on('error', failAll);
  child.on('exit', (code, signal) => {
    failAll(new Error(`OMP exited with ${signal ? `signal ${signal}` : `code ${code ?? 0}`}`));
  });

  const request = (type: string, payload: Record<string, unknown> = {}) => {
    const id = `runtime-smoke-${++requestId}`;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${type} timed out. ${stderr}`));
      }, REQUEST_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ id, type, ...payload })}\n`);
    });
  };

  try {
    await ready;
    const initial = await request('get_state') as Record<string, unknown>;
    const initialStats = await request('get_session_stats') as Record<string, unknown>;

    if (typeof initial.autoCompactionEnabled !== 'boolean') {
      throw new Error('get_state omitted autoCompactionEnabled');
    }
    await request('set_auto_compaction', { enabled: initial.autoCompactionEnabled });
    await request('abort_retry');

    const newSession = await request('new_session') as { cancelled?: boolean } | undefined;
    if (newSession?.cancelled) throw new Error('OMP cancelled disposable new_session');
    const disposable = await request('get_state') as Record<string, unknown>;

    let compact: 'success' | 'benign-empty-session-error' = 'success';
    try {
      await request('compact');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/nothing|no .*message|no .*candidate|empty|compact/i.test(message)) throw error;
      compact = 'benign-empty-session-error';
    }
    const disposableStats = await request('get_session_stats') as Record<string, unknown>;

    console.log(JSON.stringify({
      ok: true,
      executable: resolved.command,
      initialSessionId: initial.sessionId,
      initialMessageCount: initialStats.totalMessages,
      contextUsageAvailable: !!initial.contextUsage,
      disposableSessionId: disposable.sessionId,
      disposableMessageCount: disposableStats.totalMessages,
      autoCompactionRoundTrip: initial.autoCompactionEnabled,
      abortRetry: 'success',
      compact,
    }, null, 2));
  } finally {
    clearTimeout(readyTimer);
    reader.close();
    stopChild(child);
  }
}

function stopChild(child: ChildProcessWithoutNullStreams): void {
  if (!child.killed) child.kill();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
