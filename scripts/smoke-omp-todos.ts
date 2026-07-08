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

type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'abandoned';

interface TodoItem {
  content: string;
  status: TodoStatus;
  details?: string;
  notes?: string[];
}

interface TodoPhase {
  name: string;
  tasks: TodoItem[];
}

const REQUEST_TIMEOUT_MS = 30_000;
const READY_TIMEOUT_MS = 15_000;
const args = new Set(process.argv.slice(2));

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseTodoPhases(value: unknown): TodoPhase[] {
  if (!Array.isArray(value)) throw new Error('todoPhases is not an array');
  return value.map((phase, phaseIndex) => {
    if (!isObject(phase) || typeof phase.name !== 'string' || !Array.isArray(phase.tasks)) {
      throw new Error(`Invalid Todo phase at index ${phaseIndex}`);
    }
    return {
      name: phase.name,
      tasks: phase.tasks.map((task, taskIndex) => {
        if (
          !isObject(task)
          || typeof task.content !== 'string'
          || (
            task.status !== 'pending'
            && task.status !== 'in_progress'
            && task.status !== 'completed'
            && task.status !== 'abandoned'
          )
        ) {
          throw new Error(`Invalid Todo task at ${phaseIndex}.${taskIndex}`);
        }
        return {
          content: task.content,
          status: task.status,
          details: typeof task.details === 'string' ? task.details : undefined,
          notes: Array.isArray(task.notes) ? task.notes.filter((note): note is string => typeof note === 'string') : undefined,
        };
      }),
    };
  });
}

function todoSignature(phases: TodoPhase[]): string {
  return JSON.stringify(phases);
}

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
  let initialPhases: TodoPhase[] | null = null;
  let wroteSmokeSnapshot = false;
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
    readyReject?.(error);
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
    const id = `todo-smoke-${++requestId}`;
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
    initialPhases = parseTodoPhases(initial.todoPhases);

    const smokePhases: TodoPhase[] = [
      {
        name: 'Craft OMP Todo smoke',
        tasks: [
          { content: 'pending round trip', status: 'pending' },
          { content: 'active round trip', status: 'in_progress' },
          { content: 'completed round trip', status: 'completed' },
          { content: 'abandoned round trip', status: 'abandoned' },
        ],
      },
    ];

    const writeResult = await request('set_todos', { phases: smokePhases }) as Record<string, unknown>;
    wroteSmokeSnapshot = true;
    const written = parseTodoPhases(writeResult.todoPhases);
    if (todoSignature(written) !== todoSignature(smokePhases)) {
      throw new Error('set_todos response did not match the smoke snapshot');
    }

    const afterWrite = await request('get_state') as Record<string, unknown>;
    const readBack = parseTodoPhases(afterWrite.todoPhases);
    if (todoSignature(readBack) !== todoSignature(smokePhases)) {
      throw new Error('get_state did not return the smoke Todo snapshot');
    }

    await request('set_todos', { phases: initialPhases });
    wroteSmokeSnapshot = false;

    console.log(JSON.stringify({
      ok: true,
      executable: resolved.command,
      sessionId: initial.sessionId,
      originalPhaseCount: initialPhases.length,
      smokePhaseCount: readBack.length,
      smokeTaskCount: readBack.reduce((sum, phase) => sum + phase.tasks.length, 0),
      restored: true,
    }, null, 2));
  } finally {
    if (wroteSmokeSnapshot && initialPhases) {
      try {
        await request('set_todos', { phases: initialPhases });
      } catch (error) {
        console.error('WARNING: failed to restore original OMP Todos:', error instanceof Error ? error.message : error);
        process.exitCode = 1;
      }
    }
    clearTimeout(readyTimer);
    reader.close();
    stopChild(child);
  }
}

function stopChild(child: ChildProcessWithoutNullStreams): void {
  if (!child.killed) child.kill();
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (args.has('--allow-missing-omp') && /enoent|not found|spawn/i.test(message)) {
    console.warn(`OMP Todo smoke skipped: ${message}`);
    return;
  }
  console.error(message);
  process.exitCode = 1;
});
