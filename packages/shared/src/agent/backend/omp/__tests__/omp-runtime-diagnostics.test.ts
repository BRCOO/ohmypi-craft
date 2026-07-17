import { describe, expect, it } from 'bun:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { spawn } from 'node:child_process';

import { checkOmpRuntime, detectOmpVersion, getOmpDiagnosticsSummary } from '../omp-runtime-diagnostics.ts';

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
    expect(status.protocolVersion).toBe('unversioned');
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

  it('parses the OMP executable version without making it a startup requirement', async () => {
    const child = new FakeChild();
    queueMicrotask(() => {
      child.stdout.write('omp/16.3.0\n');
      child.emit('exit', 0, null);
    });
    await expect(detectOmpVersion('omp', ['--profile', 'test'], {
      timeoutMs: 100,
      spawnProcess: spawnFake(child),
    })).resolves.toBe('16.3.0');
  });

  it('returns undefined and kills a version probe that times out', async () => {
    const child = new FakeChild();
    await expect(detectOmpVersion('omp', [], {
      timeoutMs: 5,
      spawnProcess: spawnFake(child),
    })).resolves.toBeUndefined();
    expect(child.killed).toBe(true);
  });
});

describe('getOmpDiagnosticsSummary', () => {
  it('includes versionCompatibility when model discovery and version probe succeed', async () => {
    function createRpcChild(): FakeChild {
      const child = new FakeChild();
      child.stdin.on('data', (chunk) => {
        const command = JSON.parse(String(chunk)) as { id: string };
        if (command.id === 'omp-models') {
          writeFrame(child, {
            id: command.id,
            type: 'response',
            success: true,
            data: {
              models: [{ provider: 'deepseek', id: 'deepseek-v4-flash', name: 'Flash' }],
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
        if (command.id === 'omp-providers') {
          writeFrame(child, {
            id: command.id,
            type: 'response',
            success: true,
            data: {
              providers: [
                {
                  id: 'deepseek',
                  name: 'DeepSeek',
                  authType: 'oauth',
                  authenticated: true,
                  available: true,
                },
              ],
            },
          });
        }
        if (command.id === 'omp-runtime-resources') {
          writeFrame(child, {
            id: command.id,
            type: 'response',
            success: true,
            data: {
              skills: [{ name: 'review', source: 'user' }],
              mcp: [{ name: 'github', source: 'native', status: 'connected', toolCount: 4 }],
              agents: [{ name: 'explore', source: 'bundled' }],
            },
          });
        }
      });
      queueMicrotask(() => writeFrame(child, { type: 'ready' }));
      return child;
    }

    function createVersionChild(): FakeChild {
      const child = new FakeChild();
      queueMicrotask(() => {
        child.stdout.write('omp/16.3.0\n');
        child.emit('exit', 0, null);
      });
      return child;
    }

    function createConfigPathChild(): FakeChild {
      const child = new FakeChild();
      queueMicrotask(() => {
        child.stdout.write('\n');
        child.emit('exit', 0, null);
      });
      return child;
    }

    const factory = ((command: string, args: string[]) => {
      if (args.includes('--version')) return createVersionChild();
      if (args.includes('config') && args.includes('path')) return createConfigPathChild();
      return createRpcChild();
    }) as unknown as typeof spawn;

    const summary = await getOmpDiagnosticsSummary(
      { configuredCommand: 'omp-custom', timeoutMs: 100 },
      { spawnProcess: factory, versionSpawnProcess: factory },
    );

    expect(summary.versionCompatibility).toBeDefined();
    expect(summary.versionCompatibility?.compatible).toBe(true);
    expect(summary.versionCompatibility?.ompVersion).toBe('16.3.0');
    expect(summary.providers?.total).toBe(1);
    expect(summary.runtimeResources?.skills.map(skill => skill.name)).toEqual(['review']);
    expect(summary.runtimeResources?.mcp[0]?.toolCount).toBe(4);
    expect(summary.runtimeResources?.agents.map(agent => agent.name)).toEqual(['explore']);
    expect(summary.runtimeResourcesError).toBeUndefined();
  });
});
