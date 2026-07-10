import { describe, expect, it } from 'bun:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { spawn } from 'node:child_process';

import { probeOmpAuth } from '../omp-auth-probe.ts';

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

function emitReady(child: FakeChild): void {
  writeFrame(child, { type: 'ready' });
}

function emitProviders(child: FakeChild, providers: unknown[]): void {
  writeFrame(child, {
    id: 'omp-providers',
    type: 'response',
    command: 'get_login_providers',
    success: true,
    data: { providers },
  });
}

function emitLoginResponse(child: FakeChild, providerId: string): void {
  writeFrame(child, {
    id: 'omp-login',
    type: 'response',
    command: 'login',
    success: true,
    data: { providerId },
  });
}

function emitOpenUrl(child: FakeChild, payload: { url?: string; launchUrl?: string; instructions?: string }): void {
  writeFrame(child, {
    type: 'extension_ui_request',
    id: 'omp-login-url',
    method: 'open_url',
    ...payload,
  });
}

function emitErrorResponse(child: FakeChild, id: string, error: string): void {
  writeFrame(child, {
    id,
    type: 'response',
    success: false,
    error,
  });
}

describe('OMP auth probe', () => {
  it('returns providers without login when only probing', async () => {
    const child = new FakeChild();
    const promise = probeOmpAuth({ timeoutMs: 1000 }, { spawnProcess: spawnFake(child) });
    emitReady(child);
    emitProviders(child, [
      { id: 'deepseek', name: 'DeepSeek', available: true, authenticated: false },
      { id: 'anthropic', name: 'Anthropic', available: true, authenticated: true },
    ]);
    const result = await promise;
    expect(result.success).toBe(true);
    expect(result.providers).toHaveLength(2);
    expect(result.providers?.[0]?.id).toBe('deepseek');
    expect(result.message).toContain('2');
  });

  it('starts login and reports open_url payload', async () => {
    const child = new FakeChild();
    const calls: Array<{ url?: string; launchUrl?: string; instructions?: string }> = [];
    const onOpenUrl = (payload: { url?: string; launchUrl?: string; instructions?: string }) => {
      calls.push(payload);
    };
    const promise = probeOmpAuth(
      { loginProviderId: 'deepseek', timeoutMs: 1000, onOpenUrl },
      { spawnProcess: spawnFake(child) },
    );
    emitReady(child);
    emitProviders(child, [
      { id: 'deepseek', name: 'DeepSeek', available: true, authenticated: false },
    ]);
    emitOpenUrl(child, { url: 'https://example.com/auth', instructions: 'Open this URL' });
    emitLoginResponse(child, 'deepseek');
    const result = await promise;
    expect(result.success).toBe(true);
    expect(result.openUrl).toBe('https://example.com/auth');
    expect(result.instructions).toBe('Open this URL');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://example.com/auth');
  });

  it('reports already-authenticated provider without login', async () => {
    const child = new FakeChild();
    const promise = probeOmpAuth(
      { loginProviderId: 'anthropic', timeoutMs: 1000 },
      { spawnProcess: spawnFake(child) },
    );
    emitReady(child);
    emitProviders(child, [
      { id: 'anthropic', name: 'Anthropic', available: true, authenticated: true },
    ]);
    const result = await promise;
    expect(result.success).toBe(true);
    expect(result.message).toContain('Already authenticated');
  });

  it('fails when provider is unavailable', async () => {
    const child = new FakeChild();
    const promise = probeOmpAuth(
      { loginProviderId: 'deepseek', timeoutMs: 1000 },
      { spawnProcess: spawnFake(child) },
    );
    emitReady(child);
    emitProviders(child, [
      { id: 'deepseek', name: 'DeepSeek', available: false, authenticated: false },
    ]);
    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('no_providers');
  });

  it('fails when no providers are returned', async () => {
    const child = new FakeChild();
    const promise = probeOmpAuth({ timeoutMs: 1000 }, { spawnProcess: spawnFake(child) });
    emitReady(child);
    emitProviders(child, []);
    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('no_providers');
  });

  it('fails on RPC error response', async () => {
    const child = new FakeChild();
    const promise = probeOmpAuth({ timeoutMs: 1000 }, { spawnProcess: spawnFake(child) });
    emitReady(child);
    emitErrorResponse(child, 'omp-providers', 'Configuration missing');
    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('rpc_error');
    expect(result.message).toContain('Configuration missing');
  });

  it('fails on spawn error when executable is missing', async () => {
    const child = new FakeChild();
    const promise = probeOmpAuth({ timeoutMs: 1000 }, { spawnProcess: spawnFake(child) });
    const error = new Error('spawn omp ENOENT');
    (error as unknown as { code: string }).code = 'ENOENT';
    child.emit('error', error);
    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('not_found');
  });

  it('times out when OMP never becomes ready', async () => {
    const child = new FakeChild();
    const result = await probeOmpAuth(
      { timeoutMs: 50 },
      { spawnProcess: spawnFake(child) },
    );
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('timeout');
  });
});
