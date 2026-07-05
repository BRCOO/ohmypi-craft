import { describe, expect, it } from 'bun:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { spawn } from 'node:child_process';

import { discoverOmpModels } from '../omp-model-discovery.ts';

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

describe('discoverOmpModels', () => {
  it('correlates model and state responses and cleans up the child', async () => {
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
              { provider: 'deepseek', id: 'deepseek-v4-flash', name: 'Flash', contextWindow: 1000 },
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

    queueMicrotask(() => {
      child.stdout.write('not json\n');
      writeFrame(child, { type: 'ready' });
    });

    const result = await discoverOmpModels(
      { timeoutMs: 100 },
      { spawnProcess: spawnFake(child) },
    );

    expect(result.models.map((model) => model.id)).toEqual(['deepseek/deepseek-v4-flash']);
    expect(result.serverDefault).toBe('deepseek/deepseek-v4-flash');
    expect(child.killed).toBe(true);
  });

  it('includes bounded stderr context in RPC failures', async () => {
    const child = new FakeChild();
    child.stdin.on('data', (chunk) => {
      const command = JSON.parse(String(chunk)) as { id: string };
      if (command.id === 'omp-models') {
        child.stderr.write('provider credentials missing');
        writeFrame(child, {
          id: command.id,
          type: 'response',
          success: false,
          error: 'model discovery failed',
        });
      }
    });
    queueMicrotask(() => writeFrame(child, { type: 'ready' }));

    await expect(discoverOmpModels(
      { timeoutMs: 100 },
      { spawnProcess: spawnFake(child) },
    )).rejects.toThrow('model discovery failed\nOMP stderr: provider credentials missing');
    expect(child.killed).toBe(true);
  });

  it('times out and terminates an unresponsive child', async () => {
    const child = new FakeChild();

    await expect(discoverOmpModels(
      { timeoutMs: 5 },
      { spawnProcess: spawnFake(child) },
    )).rejects.toThrow('Timed out after 5ms while discovering OMP models');
    expect(child.killed).toBe(true);
  });

  it('rejects an unexpected child exit', async () => {
    const child = new FakeChild();
    queueMicrotask(() => child.emit('exit', 7, null));

    await expect(discoverOmpModels(
      { timeoutMs: 100 },
      { spawnProcess: spawnFake(child) },
    )).rejects.toThrow('OMP exited with code 7 during model discovery');
  });
});
