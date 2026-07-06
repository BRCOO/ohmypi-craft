import { describe, expect, it } from 'bun:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';

import { createMockBackendConfig } from '../../../__tests__/test-utils.ts';
import {
  DEFAULT_OMP_MODEL,
  OmpRpcBackend,
  resolveOmpModelSelection,
} from '../omp-rpc-backend.ts';

class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly writes: string[] = [];
  killed = false;

  constructor() {
    super();
    this.stdin.on('data', (chunk) => this.writes.push(String(chunk)));
  }

  kill(): boolean {
    this.killed = true;
    return true;
  }

  emitFrame(frame: Record<string, unknown>): void {
    this.stdout.write(`${JSON.stringify(frame)}\n`);
  }

  get frames(): Array<Record<string, unknown>> {
    return this.writes
      .join('')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }
}

function createHarness(options: {
  readyTimeoutMs?: number;
  requestTimeoutMs?: number;
  onSessionId?: (id: string) => void;
} = {}) {
  const children: FakeChild[] = [];
  const spawnProcess = (() => {
    const child = new FakeChild();
    children.push(child);
    return child as unknown as ChildProcessWithoutNullStreams;
  }) as unknown as typeof spawn;

  const backend = new OmpRpcBackend(createMockBackendConfig({
    provider: 'omp',
    model: DEFAULT_OMP_MODEL,
    runtime: { ompCommand: 'omp' },
    onSdkSessionIdUpdate: options.onSessionId,
  }), {
    spawnProcess,
    readyTimeoutMs: options.readyTimeoutMs,
    requestTimeoutMs: options.requestTimeoutMs,
  });

  return { backend, children };
}

async function startReady(backend: OmpRpcBackend, children: FakeChild[]): Promise<FakeChild> {
  const ready = (backend as any).ensureSubprocess() as Promise<void>;
  const child = children.at(-1);
  if (!child) throw new Error('Expected OMP child to spawn');
  await respondReady(child, `session-${children.length}`);
  await ready;
  return child;
}

function sessionState(sessionId: string): Record<string, unknown> {
  return {
    sessionId,
    isStreaming: false,
    isCompacting: false,
    steeringMode: 'all',
    followUpMode: 'all',
    interruptMode: 'immediate',
    autoCompactionEnabled: true,
    messageCount: 0,
    queuedMessageCount: 0,
    todoPhases: [],
  };
}

async function respondReady(child: FakeChild, sessionId: string): Promise<void> {
  child.emitFrame({ type: 'ready' });
  await waitFor(() => child.frames.some((frame) => frame.type === 'get_state'));
  const stateRequest = child.frames.findLast((frame) => frame.type === 'get_state')!;
  child.emitFrame({
    type: 'response',
    id: stateRequest.id,
    command: 'get_state',
    success: true,
    data: sessionState(sessionId),
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Timed out waiting for test condition');
}

describe('resolveOmpModelSelection', () => {
  it('does not switch for the default OMP placeholder model', () => {
    expect(resolveOmpModelSelection(undefined)).toBeNull();
    expect(resolveOmpModelSelection('')).toBeNull();
    expect(resolveOmpModelSelection(DEFAULT_OMP_MODEL)).toBeNull();
  });

  it('parses provider/modelId model strings', () => {
    expect(resolveOmpModelSelection('deepseek/deepseek-v4-flash')).toEqual({
      provider: 'deepseek',
      modelId: 'deepseek-v4-flash',
    });
  });

  it('parses provider:modelId model strings', () => {
    expect(resolveOmpModelSelection('deepseek:deepseek-v4-pro')).toEqual({
      provider: 'deepseek',
      modelId: 'deepseek-v4-pro',
    });
  });

  it('leaves bare model IDs alone because OMP set_model requires a provider', () => {
    expect(resolveOmpModelSelection('deepseek-v4-flash')).toBeNull();
  });
});

describe('OmpRpcBackend subprocess lifecycle', () => {
  it('rejects every pending request when the child exits unexpectedly', async () => {
    const { backend, children } = createHarness();
    const child = await startReady(backend, children);
    const request = (backend as any).send({ type: 'get_state' }) as Promise<unknown>;

    child.emit('exit', 17, null);

    await expect(request).rejects.toThrow('OMP exited with code 17');
    expect((backend as any).pending.size).toBe(0);
    expect((backend as any).child).toBeNull();
    backend.destroy();
  });

  it('times out startup, rejects readiness, and kills the unusable child', async () => {
    const { backend, children } = createHarness({ readyTimeoutMs: 5 });
    const ready = (backend as any).ensureSubprocess() as Promise<void>;
    const child = children[0]!;

    await expect(ready).rejects.toThrow('Timed out waiting for OMP ready frame');
    expect(child.killed).toBe(true);
    expect((backend as any).child).toBeNull();
    backend.destroy();
  });

  it('ignores malformed stdout and continues processing later response frames', async () => {
    const { backend, children } = createHarness();
    const child = await startReady(backend, children);
    const request = (backend as any).send({ type: 'get_state' }) as Promise<unknown>;
    const requestId = child.frames.at(-1)?.id as string;

    child.stdout.write('not-json\n');
    child.emitFrame({
      type: 'response',
      id: requestId,
      command: 'get_state',
      success: true,
      data: { alive: true },
    });

    await expect(request).resolves.toEqual({ alive: true });
    backend.destroy();
  });

  it('rejects a correlated command that never receives a response', async () => {
    const { backend, children } = createHarness({ requestTimeoutMs: 5 });
    await startReady(backend, children);

    const request = (backend as any).send({ type: 'get_state' }) as Promise<unknown>;
    await expect(request).rejects.toThrow('OMP RPC command timed out: get_state');
    expect((backend as any).pending.size).toBe(0);
    backend.destroy();
  });

  it('restarts while idle and ignores stale callbacks from the old generation', async () => {
    const sessionIds: string[] = [];
    const { backend, children } = createHarness({ onSessionId: (id) => sessionIds.push(id) });
    const first = await startReady(backend, children);
    const firstGeneration = (backend as any).processGeneration as number;

    first.emit('exit', 1, null);
    const second = await startReady(backend, children);

    first.emit('exit', 2, null);
    first.stderr.write('stale stderr');
    (backend as any).handleLine(
      JSON.stringify({ type: 'ready' }),
      firstGeneration,
    );

    expect((backend as any).child).toBe(second as any);
    expect(second.killed).toBe(false);
    expect(sessionIds).toEqual(['session-1', 'session-2']);
    expect(backend.getRecentStderr()).not.toContain('stale stderr');
    backend.destroy();
  });

  it('isolates identical request ids across concurrent backend instances', async () => {
    const left = createHarness();
    const right = createHarness();
    const leftChild = await startReady(left.backend, left.children);
    const rightChild = await startReady(right.backend, right.children);
    const leftRequest = (left.backend as any).send({ type: 'get_state' }) as Promise<unknown>;
    const rightRequest = (right.backend as any).send({ type: 'get_state' }) as Promise<unknown>;
    const leftId = leftChild.frames.at(-1)?.id as string;
    const rightId = rightChild.frames.at(-1)?.id as string;

    expect(leftId).toBe('omp-2');
    expect(rightId).toBe('omp-2');
    leftChild.emitFrame({ type: 'response', id: leftId, command: 'get_state', success: true, data: { side: 'left' } });
    await expect(leftRequest).resolves.toEqual({ side: 'left' });
    expect((right.backend as any).pending.size).toBe(1);

    rightChild.emitFrame({ type: 'response', id: rightId, command: 'get_state', success: true, data: { side: 'right' } });
    await expect(rightRequest).resolves.toEqual({ side: 'right' });
    left.backend.destroy();
    right.backend.destroy();
  });

  it('sends abort once without replaying a prompt', async () => {
    const { backend, children } = createHarness();
    const child = await startReady(backend, children);

    await backend.abort('test abort');
    const abortFrame = child.frames.at(-1)!;
    expect(abortFrame.type).toBe('abort');
    expect(child.frames.filter((frame) => frame.type === 'prompt')).toHaveLength(0);

    child.emitFrame({
      type: 'response',
      id: abortFrame.id,
      command: 'abort',
      success: true,
    });
    backend.destroy();
  });

  it('does not start a prompt when aborted during startup state synchronization', async () => {
    const { backend, children } = createHarness();
    const eventsPromise = (async () => {
      const events = [];
      for await (const event of backend.chat('must not be sent')) events.push(event);
      return events;
    })();

    await waitFor(() => children.length === 1);
    const child = children[0]!;
    await backend.abort('startup abort');
    await respondReady(child, 'session-startup-abort');

    const events = await eventsPromise;
    expect(events.map((event) => event.type)).toEqual(['complete']);
    expect(child.frames.filter((frame) => frame.type === 'prompt')).toHaveLength(0);
    expect(child.frames.filter((frame) => frame.type === 'abort')).toHaveLength(1);
    backend.destroy();
  });

  it('ends a crashed in-flight turn and only starts a new prompt on the next chat', async () => {
    const { backend, children } = createHarness();
    const firstEventsPromise = (async () => {
      const events = [];
      for await (const event of backend.chat('first prompt')) events.push(event);
      return events;
    })();

    await waitFor(() => children.length === 1);
    const first = children[0]!;
    await respondReady(first, 'session-1');
    await waitFor(() => first.frames.some((frame) => frame.type === 'prompt'));
    first.emit('exit', 9, null);

    const firstEvents = await firstEventsPromise;
    expect(firstEvents.map((event) => event.type)).toEqual(['error', 'complete']);
    expect(first.frames.filter((frame) => frame.type === 'prompt')).toHaveLength(1);

    const secondEventsPromise = (async () => {
      const events = [];
      for await (const event of backend.chat('second prompt')) events.push(event);
      return events;
    })();
    await waitFor(() => children.length === 2);
    const second = children[1]!;
    await respondReady(second, 'session-2');
    await waitFor(() => second.frames.some((frame) => frame.type === 'prompt'));
    const secondPrompt = second.frames.find((frame) => frame.type === 'prompt')!;
    second.emitFrame({ type: 'response', id: secondPrompt.id, command: 'prompt', success: true });
    second.emitFrame({ type: 'agent_end' });

    const secondEvents = await secondEventsPromise;
    expect(secondEvents.at(-1)?.type).toBe('complete');
    expect(second.frames.filter((frame) => frame.type === 'prompt')).toHaveLength(1);
    expect(secondPrompt.message).toContain('second prompt');
    expect(secondPrompt.message).not.toContain('first prompt');
    backend.destroy();
  });

  it('waits for get_state before publishing the real OMP session id', async () => {
    const sessionIds: string[] = [];
    const { backend, children } = createHarness({ onSessionId: (id) => sessionIds.push(id) });
    let readyResolved = false;
    const ready = ((backend as any).ensureSubprocess() as Promise<void>).then(() => {
      readyResolved = true;
    });
    const child = children[0]!;

    child.emitFrame({ type: 'ready', sessionId: 'untrusted-ready-id' });
    await waitFor(() => child.frames.some((frame) => frame.type === 'get_state'));
    expect(readyResolved).toBe(false);
    expect(sessionIds).toEqual([]);

    const stateRequest = child.frames.find((frame) => frame.type === 'get_state')!;
    child.emitFrame({
      type: 'response',
      id: stateRequest.id,
      command: 'get_state',
      success: true,
      data: sessionState('real-session-id'),
    });
    await ready;

    expect(sessionIds).toEqual(['real-session-id']);
    expect((backend as any).sessionState.sessionId).toBe('real-session-id');
    backend.destroy();
  });

  it('rejects startup when get_state does not contain a valid session id', async () => {
    const { backend, children } = createHarness();
    const ready = (backend as any).ensureSubprocess() as Promise<void>;
    const child = children[0]!;

    child.emitFrame({ type: 'ready' });
    await waitFor(() => child.frames.some((frame) => frame.type === 'get_state'));
    const stateRequest = child.frames.find((frame) => frame.type === 'get_state')!;
    const invalidState = sessionState('session-invalid');
    delete invalidState.sessionId;
    child.emitFrame({
      type: 'response',
      id: stateRequest.id,
      command: 'get_state',
      success: true,
      data: invalidState,
    });

    await expect(ready).rejects.toThrow('Failed to synchronize OMP state');
    expect(child.killed).toBe(true);
    expect((backend as any).sessionState).toBeNull();
    backend.destroy();
  });

  it('finishes a local-only prompt from its response without agent_end', async () => {
    const { backend, children } = createHarness();
    const eventsPromise = (async () => {
      const events = [];
      for await (const event of backend.chat('/help')) events.push(event);
      return events;
    })();

    await waitFor(() => children.length === 1);
    const child = children[0]!;
    await respondReady(child, 'session-local-response');
    await waitFor(() => child.frames.some((frame) => frame.type === 'prompt'));
    const prompt = child.frames.find((frame) => frame.type === 'prompt')!;
    child.emitFrame({
      type: 'response',
      id: prompt.id,
      command: 'prompt',
      success: true,
      data: { agentInvoked: false },
    });

    const events = await eventsPromise;
    expect(events.map((event) => event.type)).toEqual(['complete']);
    backend.destroy();
  });

  it('finishes a local-only prompt from prompt_result and ignores later terminal frames', async () => {
    const { backend, children } = createHarness();
    const eventsPromise = (async () => {
      const events = [];
      for await (const event of backend.chat('/models')) events.push(event);
      return events;
    })();

    await waitFor(() => children.length === 1);
    const child = children[0]!;
    await respondReady(child, 'session-local-result');
    await waitFor(() => child.frames.some((frame) => frame.type === 'prompt'));
    const prompt = child.frames.find((frame) => frame.type === 'prompt')!;
    child.emitFrame({ type: 'prompt_result', id: prompt.id, agentInvoked: false });
    child.emitFrame({ type: 'agent_end' });
    child.emitFrame({
      type: 'response',
      id: prompt.id,
      command: 'prompt',
      success: true,
      data: { agentInvoked: false },
    });

    const events = await eventsPromise;
    expect(events.filter((event) => event.type === 'complete')).toHaveLength(1);
    backend.destroy();
  });

  it('does not finish an agent prompt until agent_end and deduplicates a late prompt_result', async () => {
    const { backend, children } = createHarness();
    let completed = false;
    const eventsPromise = (async () => {
      const events = [];
      for await (const event of backend.chat('normal prompt')) events.push(event);
      completed = true;
      return events;
    })();

    await waitFor(() => children.length === 1);
    const child = children[0]!;
    await respondReady(child, 'session-agent');
    await waitFor(() => child.frames.some((frame) => frame.type === 'prompt'));
    const prompt = child.frames.find((frame) => frame.type === 'prompt')!;
    child.emitFrame({
      type: 'response',
      id: prompt.id,
      command: 'prompt',
      success: true,
      data: { agentInvoked: true },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(completed).toBe(false);

    child.emitFrame({ type: 'agent_end' });
    child.emitFrame({ type: 'prompt_result', id: prompt.id, agentInvoked: false });
    const events = await eventsPromise;
    expect(events.filter((event) => event.type === 'complete')).toHaveLength(1);
    backend.destroy();
  });
});
