import { describe, expect, it } from 'bun:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { spawn } from 'node:child_process';

import { checkOmpRuntime } from '../omp-runtime-diagnostics.ts';

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdin = new PassThrough();
  killed = false;

  kill(): boolean {
    this.killed = true;
    return true;
  }
}

function spawnFake(child: FakeChild): typeof spawn {
  return (() => child) as unknown as typeof spawn;
}

function writeFrame(child: FakeChild, frame: Record<string, unknown>): void {
  child.stdout.write(`${JSON.stringify(frame)}\n`);
}

describe('checkOmpRuntime', () => {
  it('returns model count and default model for a healthy runtime', async () => {
    const child = new FakeChild();
    child.stdin.on('data', (chunk) => {
      const command = JSON.parse(String(chunk)) as { id: string };
      if (command.id === 'omp-models') {
        writeFrame(child, {
          id: command.id,
          type: 'response',
          success: true,
          data: {
            models: [
              { provider: 'deepseek', id: 'deepseek-v4-flash', name: 'Flash' },
            ],
          },
        });
      }
      if (command.id === 'omp-state') {
        writeFrame(child, {
          id: command.id,
          type: 'response',
          success: true,
          data: { model: { provider: 'deepseek', id: 'deepseek-v4-flash' } },
        });
      }
    });
    queueMicrotask(() => writeFrame(child, { type: 'ready' }));

    const status = await checkOmpRuntime(
      { configuredCommand: 'omp-custom', timeoutMs: 100 },
      { spawnProcess: spawnFake(child) },
    );

    expect(status.ok).toBe(true);
    expect(status.source).toBe('config');
    expect(status.rawCommand).toBe('omp-custom');
    expect(status.modelCount).toBe(1);
    expect(status.defaultModel).toBe('deepseek/deepseek-v4-flash');
  });

  it('classifies timeout failures without throwing', async () => {
    const child = new FakeChild();

    const status = await checkOmpRuntime(
      { configuredCommand: '', envCommand: 'omp-env', timeoutMs: 5 },
      { spawnProcess: spawnFake(child) },
    );

    expect(status.ok).toBe(false);
    expect(status.source).toBe('env');
    expect(status.errorCode).toBe('timeout');
    expect(status.error).toContain('Timed out after 5ms');
    expect(child.killed).toBe(true);
  });
});

