import { describe, expect, it } from 'bun:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import type { OmpSessionLink } from '../../../../sessions/types.ts';

import { createMockBackendConfig } from '../../../__tests__/test-utils.ts';
import {
  DEFAULT_OMP_MODEL,
  OmpRpcBackend,
  resolveOmpModelSelection,
} from '../omp-rpc-backend.ts';
import type { OmpTodoPhase } from '../omp-rpc-protocol.ts';

class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly writes: string[] = [];
  killed = false;

  constructor() {
    super();
    this.stdin.on('data', (chunk) => {
      const text = String(chunk);
      this.writes.push(text);
      for (const line of text.split('\n').filter(Boolean)) {
        const frame = JSON.parse(line) as Record<string, unknown>;
        if (frame.type === 'set_thinking_level') {
          queueMicrotask(() => this.emitFrame({
            type: 'response',
            id: frame.id,
            command: 'set_thinking_level',
            success: true,
          }));
        }
        if (frame.type === 'get_available_commands') {
          queueMicrotask(() => this.emitFrame({
            type: 'response',
            id: frame.id,
            command: 'get_available_commands',
            success: true,
            data: {
              commands: [
                {
                  name: 'stats',
                  description: 'Show session stats',
                  source: 'builtin',
                  aliases: ['s'],
                  input: { hint: 'optional focus' },
                },
              ],
            },
          }));
        }
        if (frame.type === 'set_todos') {
          queueMicrotask(() => this.emitFrame({
            type: 'response',
            id: frame.id,
            command: 'set_todos',
            success: true,
            data: {
              todoPhases: frame.phases,
            },
          }));
        }
        if (
          frame.type === 'set_steering_mode'
          || frame.type === 'set_follow_up_mode'
          || frame.type === 'set_interrupt_mode'
          || frame.type === 'follow_up'
          || frame.type === 'abort_and_prompt'
          || frame.type === 'steer'
          || frame.type === 'set_session_name'
        ) {
          queueMicrotask(() => this.emitFrame({
            type: 'response',
            id: frame.id,
            command: frame.type as string,
            success: true,
          }));
        }
      }
    });
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
  sessionLink?: OmpSessionLink;
  onSessionLink?: (link: OmpSessionLink) => void;
  attachmentReadFile?: (path: string) => Buffer;
} = {}) {
  const children: FakeChild[] = [];
  const spawnProcess = (() => {
    const child = new FakeChild();
    children.push(child);
    return child as unknown as ChildProcessWithoutNullStreams;
  }) as unknown as typeof spawn;

  const config = createMockBackendConfig({
    provider: 'omp',
    model: DEFAULT_OMP_MODEL,
    runtime: { ompCommand: 'omp' },
    onSdkSessionIdUpdate: options.onSessionId,
    onOmpSessionLinkUpdate: options.onSessionLink,
  });
  if (options.sessionLink) {
    if (!config.session) throw new Error('Mock backend config is missing a session');
    config.session = {
      ...config.session,
      ompSessionLink: options.sessionLink,
    };
  }

  const backend = new OmpRpcBackend(config, {
    spawnProcess,
    readyTimeoutMs: options.readyTimeoutMs,
    requestTimeoutMs: options.requestTimeoutMs,
    attachmentReadFile: options.attachmentReadFile,
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

function sessionState(
  sessionId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
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
    ...overrides,
  };
}

async function respondReady(
  child: FakeChild,
  sessionId: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  child.emitFrame({ type: 'ready' });
  await waitFor(() => child.frames.some((frame) => frame.type === 'get_state'));
  const stateRequest = child.frames.findLast((frame) => frame.type === 'get_state')!;
  child.emitFrame({
    type: 'response',
    id: stateRequest.id,
    command: 'get_state',
    success: true,
    data: sessionState(sessionId, overrides),
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
    expect(backend.getDiagnostics().requestTimeouts).toBe(1);
    backend.destroy();
  });

  it('records redacted protocol diagnostics for malformed, unknown, orphan, and duplicate traffic', async () => {
    const { backend, children } = createHarness();
    const child = await startReady(backend, children);
    child.stdout.write('malformed-json\n');
    child.emitFrame({ type: 'future_frame', prompt: 'secret prompt', image: 'secret base64' });

    const request = (backend as any).send({ type: 'get_state' }) as Promise<unknown>;
    const requestId = child.frames.at(-1)?.id as string;
    const response = {
      type: 'response',
      id: requestId,
      command: 'get_state',
      success: true,
      data: { secret: 'response secret' },
    };
    child.emitFrame(response);
    await request;
    child.emitFrame(response);
    child.emitFrame({ ...response, id: 'orphan-id' });
    await waitFor(() => backend.getDiagnostics().orphanResponses === 1);

    const diagnostics = backend.getDiagnostics();
    expect(diagnostics.malformedLines).toBe(1);
    expect(diagnostics.unknownFramesByType.future_frame).toBe(1);
    expect(diagnostics.duplicateResponses).toBe(1);
    expect(diagnostics.orphanResponses).toBe(1);
    expect(diagnostics.requestLatencyByCommand.get_state).toBeDefined();
    expect(JSON.stringify(diagnostics)).not.toContain('secret prompt');
    expect(JSON.stringify(diagnostics)).not.toContain('secret base64');
    expect(JSON.stringify(diagnostics)).not.toContain('response secret');
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
    expect(backend.getDiagnostics().lastExit).toBeUndefined();
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
    await waitFor(() => backend.getCachedAvailableCommands()[0]?.name === 'stats');
    expect(backend.getCachedAvailableCommands().map((command) => command.name)).toEqual(['stats']);
    backend.destroy();
  });

  it('restores the persisted OMP session file before resolving startup', async () => {
    const links: OmpSessionLink[] = [];
    const sessionIds: string[] = [];
    const persistedLink: OmpSessionLink = {
      provider: 'omp',
      sessionId: 'persisted-session',
      sessionFile: 'C:\\sessions\\persisted.jsonl',
      messageCount: 8,
      lastSyncedAt: 1,
    };
    const { backend, children } = createHarness({
      sessionLink: persistedLink,
      onSessionId: (id) => sessionIds.push(id),
      onSessionLink: (link) => links.push(link),
    });
    const ready = (backend as any).ensureSubprocess() as Promise<void>;
    const child = children[0]!;

    child.emitFrame({ type: 'ready' });
    await waitFor(() => child.frames.some((frame) => frame.type === 'get_state'));
    const initialState = child.frames.find((frame) => frame.type === 'get_state')!;
    child.emitFrame({
      type: 'response',
      id: initialState.id,
      command: 'get_state',
      success: true,
      data: sessionState('fresh-session', {
        sessionFile: 'C:\\sessions\\fresh.jsonl',
      }),
    });

    await waitFor(() => child.frames.some((frame) => frame.type === 'switch_session'));
    const switchRequest = child.frames.find((frame) => frame.type === 'switch_session')!;
    expect(switchRequest.sessionPath).toBe(persistedLink.sessionFile);
    child.emitFrame({
      type: 'response',
      id: switchRequest.id,
      command: 'switch_session',
      success: true,
      data: { cancelled: false },
    });

    await waitFor(() => child.frames.filter((frame) => frame.type === 'get_state').length === 2);
    const restoredState = child.frames.filter((frame) => frame.type === 'get_state').at(-1)!;
    child.emitFrame({
      type: 'response',
      id: restoredState.id,
      command: 'get_state',
      success: true,
      data: sessionState('persisted-session', {
        sessionFile: persistedLink.sessionFile,
        sessionName: 'Restored work',
        messageCount: 8,
      }),
    });
    await ready;

    expect(sessionIds).toEqual(['persisted-session']);
    expect(backend.getOmpSessionLink()).toMatchObject({
      sessionId: 'persisted-session',
      sessionFile: persistedLink.sessionFile,
      sessionName: 'Restored work',
      messageCount: 8,
    });
    expect(links.at(-1)?.lastMismatch).toBeUndefined();
    backend.destroy();
  });

  it('does not switch sessions when startup already matches the persisted file', async () => {
    const sessionFile = 'C:\\sessions\\already-restored.jsonl';
    const { backend, children } = createHarness({
      sessionLink: {
        provider: 'omp',
        sessionId: 'already-restored',
        sessionFile,
        lastSyncedAt: 1,
      },
    });
    const ready = (backend as any).ensureSubprocess() as Promise<void>;
    const child = children[0]!;

    await respondReady(child, 'already-restored', { sessionFile, messageCount: 3 });
    await ready;

    expect(child.frames.filter((frame) => frame.type === 'switch_session')).toHaveLength(0);
    expect(backend.getOmpSessionLink()).toMatchObject({
      sessionId: 'already-restored',
      sessionFile,
      messageCount: 3,
    });
    backend.destroy();
  });

  it('refreshes the OMP session link after branching', async () => {
    const links: OmpSessionLink[] = [];
    const { backend, children } = createHarness({
      onSessionLink: (link) => links.push(link),
    });
    const child = await startReady(backend, children);
    const branchPromise = backend.branchOmpSession('entry-42');

    await waitFor(() => child.frames.some((frame) => frame.type === 'branch'));
    const branchRequest = child.frames.find((frame) => frame.type === 'branch')!;
    expect(branchRequest.entryId).toBe('entry-42');
    child.emitFrame({
      type: 'response',
      id: branchRequest.id,
      command: 'branch',
      success: true,
      data: { text: 'branched', cancelled: false },
    });

    await waitFor(() => child.frames.filter((frame) => frame.type === 'get_state').length === 2);
    const stateRequest = child.frames.filter((frame) => frame.type === 'get_state').at(-1)!;
    child.emitFrame({
      type: 'response',
      id: stateRequest.id,
      command: 'get_state',
      success: true,
      data: sessionState('branched-session', {
        sessionFile: 'C:\\sessions\\branched.jsonl',
        messageCount: 4,
      }),
    });

    await expect(branchPromise).resolves.toEqual({ text: 'branched', cancelled: false });
    expect(links.at(-1)).toMatchObject({
      sessionId: 'branched-session',
      sessionFile: 'C:\\sessions\\branched.jsonl',
      messageCount: 4,
    });
    backend.destroy();
  });

  it('refreshes the OMP session link after handoff', async () => {
    const links: OmpSessionLink[] = [];
    const { backend, children } = createHarness({
      onSessionLink: (link) => links.push(link),
    });
    const child = await startReady(backend, children);
    const handoffPromise = backend.handoffOmpSession('carry the key constraints');

    await waitFor(() => child.frames.some((frame) => frame.type === 'handoff'));
    const handoffRequest = child.frames.find((frame) => frame.type === 'handoff')!;
    expect(handoffRequest.customInstructions).toBe('carry the key constraints');
    child.emitFrame({
      type: 'response',
      id: handoffRequest.id,
      command: 'handoff',
      success: true,
      data: { savedPath: 'C:\\sessions\\handoff.md' },
    });

    await waitFor(() => child.frames.filter((frame) => frame.type === 'get_state').length === 2);
    const stateRequest = child.frames.filter((frame) => frame.type === 'get_state').at(-1)!;
    child.emitFrame({
      type: 'response',
      id: stateRequest.id,
      command: 'get_state',
      success: true,
      data: sessionState('handoff-session', {
        sessionFile: 'C:\\sessions\\handoff.jsonl',
        messageCount: 6,
      }),
    });

    await expect(handoffPromise).resolves.toEqual({ savedPath: 'C:\\sessions\\handoff.md' });
    expect(links.at(-1)).toMatchObject({
      sessionId: 'handoff-session',
      sessionFile: 'C:\\sessions\\handoff.jsonl',
      messageCount: 6,
    });
    backend.destroy();
  });

  it('publishes a persisted mismatch when OMP cannot restore its session file', async () => {
    const links: OmpSessionLink[] = [];
    const persistedLink: OmpSessionLink = {
      provider: 'omp',
      sessionId: 'missing-session',
      sessionFile: 'C:\\sessions\\missing.jsonl',
      lastSyncedAt: 1,
    };
    const { backend, children } = createHarness({
      sessionLink: persistedLink,
      onSessionLink: (link) => links.push(link),
    });
    const ready = (backend as any).ensureSubprocess() as Promise<void>;
    const child = children[0]!;

    child.emitFrame({ type: 'ready' });
    await waitFor(() => child.frames.some((frame) => frame.type === 'get_state'));
    const initialState = child.frames.find((frame) => frame.type === 'get_state')!;
    child.emitFrame({
      type: 'response',
      id: initialState.id,
      command: 'get_state',
      success: true,
      data: sessionState('fresh-session', {
        sessionFile: 'C:\\sessions\\fresh.jsonl',
      }),
    });

    await waitFor(() => child.frames.some((frame) => frame.type === 'switch_session'));
    const switchRequest = child.frames.find((frame) => frame.type === 'switch_session')!;
    child.emitFrame({
      type: 'response',
      id: switchRequest.id,
      command: 'switch_session',
      success: false,
      error: 'Session file not found',
    });

    await expect(ready).rejects.toThrow('Failed to restore OMP session');
    expect(links.at(-1)?.lastMismatch).toMatchObject({
      reason: 'missing-session-file',
    });
    expect(links.at(-1)?.lastMismatch?.detail).toContain('Session file not found');
    expect(child.killed).toBe(true);
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

  it('sends native images and streaming behavior without embedding base64 in prompt text', async () => {
    const { backend, children } = createHarness();
    const eventsPromise = (async () => {
      const events = [];
      for await (const event of backend.chat('describe', [{
        type: 'image',
        path: 'image.png',
        name: 'image.png',
        mimeType: 'image/png',
        base64: 'AQID',
        size: 3,
      }], { streamingBehavior: 'followUp' })) events.push(event);
      return events;
    })();

    await waitFor(() => children.length === 1);
    const child = children[0]!;
    await respondReady(child, 'session-image');
    await waitFor(() => child.frames.some((frame) => frame.type === 'prompt'));
    const prompt = child.frames.find((frame) => frame.type === 'prompt')!;
    expect(prompt.message).toBe('describe');
    expect(prompt.streamingBehavior).toBe('followUp');
    expect(prompt.images).toEqual([{ type: 'image', data: 'AQID', mimeType: 'image/png' }]);
    expect(String(prompt.message)).not.toContain('AQID');
    child.emitFrame({
      type: 'response',
      id: prompt.id,
      command: 'prompt',
      success: true,
      data: { agentInvoked: false },
    });
    await eventsPromise;
    backend.destroy();
  });

  it('updates cached available commands from push updates and exposes control state', async () => {
    const states: unknown[] = [];
    const { backend, children } = createHarness();
    backend.onControlStateChange = (state) => states.push(state);
    const child = await startReady(backend, children);

    await waitFor(() => backend.getOmpControlState().availableCommands[0]?.name === 'stats');
    expect(backend.getOmpControlState().availableCommands.map((command) => command.name)).toEqual(['stats']);
    expect(backend.getOmpControlState().queue).toEqual({
      isStreaming: false,
      isCompacting: false,
      steeringMode: 'all',
      followUpMode: 'all',
      interruptMode: 'immediate',
      queuedMessageCount: 0,
    });

    child.emitFrame({
      type: 'available_commands_update',
      commands: [{ name: 'skill-runner', source: 'skill', description: 'Run skill' }],
    });
    await waitFor(() => backend.getCachedAvailableCommands()[0]?.name === 'skill-runner');

    expect(backend.getCachedAvailableCommands()).toEqual([{
      name: 'skill-runner',
      aliases: undefined,
      description: 'Run skill',
      input: undefined,
      subcommands: undefined,
      source: 'skill',
    }]);
    expect(states.length).toBeGreaterThan(0);
    backend.destroy();
  });

  it('sends OMP native follow-up and abort-and-prompt with image attachments', async () => {
    const { backend, children } = createHarness();
    const child = await startReady(backend, children);
    (backend as any)._isProcessing = true;

    await expect(backend.followUp('later', [{
      type: 'image',
      path: 'later.png',
      name: 'later.png',
      mimeType: 'image/png',
      base64: 'AQID',
      size: 3,
    }])).resolves.toBe(true);

    await expect(backend.abortAndPrompt('now', [{
      type: 'image',
      path: 'now.png',
      name: 'now.png',
      mimeType: 'image/png',
      base64: 'BAUG',
      size: 3,
    }])).resolves.toBe(true);

    const followUp = child.frames.find((frame) => frame.type === 'follow_up')!;
    const abortAndPrompt = child.frames.find((frame) => frame.type === 'abort_and_prompt')!;
    expect(followUp.message).toBe('later');
    expect(followUp.images).toEqual([{ type: 'image', data: 'AQID', mimeType: 'image/png' }]);
    expect(abortAndPrompt.message).toBe('now');
    expect(abortAndPrompt.images).toEqual([{ type: 'image', data: 'BAUG', mimeType: 'image/png' }]);
    backend.destroy();
  });

  it('updates queue mode state after native setters and config_update frames', async () => {
    const { backend, children } = createHarness();
    const child = await startReady(backend, children);

    await backend.setSteeringMode('one-at-a-time');
    await backend.setFollowUpMode('one-at-a-time');
    await backend.setInterruptMode('wait');
    expect(backend.getOmpControlState().queue).toMatchObject({
      steeringMode: 'one-at-a-time',
      followUpMode: 'one-at-a-time',
      interruptMode: 'wait',
    });

    child.emitFrame({
      type: 'config_update',
      config: {
        steeringMode: 'all',
        followUpMode: 'all',
        interruptMode: 'immediate',
        queuedMessageCount: 4,
      },
    });
    await waitFor(() => backend.getOmpControlState().queue.queuedMessageCount === 4);
    expect(backend.getOmpControlState().queue).toMatchObject({
      steeringMode: 'all',
      followUpMode: 'all',
      interruptMode: 'immediate',
      queuedMessageCount: 4,
    });
    backend.destroy();
  });

  it('applies and restores a one-turn thinking override around the prompt', async () => {
    const { backend, children } = createHarness();
    const eventsPromise = (async () => {
      const events = [];
      for await (const event of backend.chat('think', undefined, { thinkingOverride: 'high' })) events.push(event);
      return events;
    })();

    await waitFor(() => children.length === 1);
    const child = children[0]!;
    await respondReady(child, 'session-thinking');
    await waitFor(() => child.frames.some((frame) => frame.type === 'prompt'));
    const prompt = child.frames.find((frame) => frame.type === 'prompt')!;
    child.emitFrame({
      type: 'response',
      id: prompt.id,
      command: 'prompt',
      success: true,
      data: { agentInvoked: false },
    });
    await eventsPromise;
    await waitFor(() => child.frames.filter((frame) => frame.type === 'set_thinking_level').length === 3);

    expect(child.frames
      .filter((frame) => frame.type === 'set_thinking_level')
      .map((frame) => frame.level)).toEqual(['medium', 'high', 'medium']);
    backend.destroy();
  });

  it('maps a pre-start Craft max level to OMP xhigh', async () => {
    const { backend, children } = createHarness();
    backend.setThinkingLevel('max');
    const eventsPromise = (async () => {
      const events = [];
      for await (const event of backend.chat('max thinking')) events.push(event);
      return events;
    })();

    await waitFor(() => children.length === 1);
    const child = children[0]!;
    await respondReady(child, 'session-max');
    await waitFor(() => child.frames.some((frame) => frame.type === 'prompt'));
    const prompt = child.frames.find((frame) => frame.type === 'prompt')!;
    expect(child.frames.find((frame) => frame.type === 'set_thinking_level')?.level).toBe('xhigh');
    child.emitFrame({
      type: 'response',
      id: prompt.id,
      command: 'prompt',
      success: true,
      data: { agentInvoked: false },
    });
    await eventsPromise;
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

describe('OmpRpcBackend Todo bridge', () => {
  it('hydrates Todo phases from get_state and writes complete set_todos snapshots', async () => {
    const { backend, children } = createHarness();
    const child = await startReady(backend, children);
    const initial = backend.getOmpTodoState();
    expect(initial.available).toBe(true);
    expect(initial.phases).toEqual([]);

    await backend.mutateOmpTodos(initial.revision, {
      type: 'replace',
      phases: [
        {
          name: 'Desktop',
          tasks: [
            { content: 'Show Todo card', status: 'pending' },
          ],
        },
      ],
    });

    const setTodos = child.frames.findLast((frame) => frame.type === 'set_todos')!;
    expect(setTodos.phases).toEqual([
      {
        name: 'Desktop',
        tasks: [
          { content: 'Show Todo card', status: 'pending' },
        ],
      },
    ]);
    expect(backend.getOmpTodoState().phases).toEqual(setTodos.phases as OmpTodoPhase[]);
    backend.destroy();
  });

  it('rejects stale Todo revisions before writing to OMP', async () => {
    const { backend, children } = createHarness();
    const child = await startReady(backend, children);
    const revision = backend.getOmpTodoState().revision;

    await expect(backend.mutateOmpTodos(revision + 1, {
      type: 'addPhase',
      name: 'Stale',
    })).rejects.toThrow('OMP Todo state changed');
    expect(child.frames.some((frame) => frame.type === 'set_todos')).toBe(false);
    backend.destroy();
  });

  it('updates reminder metadata from Todo frames and suppresses unknown-frame logging', async () => {
    const { backend, children } = createHarness();
    const child = await startReady(backend, children);
    child.emitFrame({
      type: 'todo_reminder',
      todos: [{ content: 'finish', status: 'pending' }],
      attempt: 1,
      maxAttempts: 3,
    });

    await waitFor(() => backend.getOmpTodoState().reminder?.attempt === 1);
    expect(backend.getOmpTodoState().reminder?.todos).toEqual([{ content: 'finish', status: 'pending' }]);
    backend.destroy();
  });
});

describe('OmpRpcBackend runtime controls', () => {
  const stats = {
    sessionId: 'session-1',
    userMessages: 2,
    assistantMessages: 2,
    toolCalls: 3,
    toolResults: 3,
    totalMessages: 10,
    tokens: {
      input: 100,
      output: 50,
      reasoning: 25,
      cacheRead: 30,
      cacheWrite: 10,
      total: 215,
    },
    premiumRequests: 1,
    cost: 0.125,
  };

  it('refreshes context and session statistics as one runtime snapshot', async () => {
    const { backend, children } = createHarness();
    const child = await startReady(backend, children);
    const refresh = backend.refreshOmpRuntimeState();

    await waitFor(() => child.frames.some((frame) => frame.type === 'get_session_stats'));
    const stateRequest = child.frames.findLast((frame) => frame.type === 'get_state')!;
    const statsRequest = child.frames.findLast((frame) => frame.type === 'get_session_stats')!;
    child.emitFrame({
      type: 'response',
      id: stateRequest.id,
      command: 'get_state',
      success: true,
      data: sessionState('session-1', {
        contextUsage: { tokens: 5000, contextWindow: 10000, percent: 50 },
      }),
    });
    child.emitFrame({
      type: 'response',
      id: statsRequest.id,
      command: 'get_session_stats',
      success: true,
      data: stats,
    });

    const runtime = await refresh;
    expect(runtime.contextUsage).toEqual({ tokens: 5000, contextWindow: 10000, percent: 50 });
    expect(runtime.stats).toEqual(stats);
    expect(runtime.pendingAction).toBeUndefined();
    backend.destroy();
  });

  it('runs manual compaction and refreshes context afterwards', async () => {
    const { backend, children } = createHarness();
    const child = await startReady(backend, children);
    const compact = backend.compactOmpSession();

    await waitFor(() => child.frames.some((frame) => frame.type === 'compact'));
    const compactRequest = child.frames.findLast((frame) => frame.type === 'compact')!;
    child.emitFrame({
      type: 'response',
      id: compactRequest.id,
      command: 'compact',
      success: true,
      data: {
        summary: 'summary',
        firstKeptEntryId: 'entry-2',
        tokensBefore: 9000,
      },
    });

    await waitFor(() => child.frames.some((frame) => frame.type === 'get_session_stats'));
    const stateRequest = child.frames.findLast((frame) => frame.type === 'get_state')!;
    const statsRequest = child.frames.findLast((frame) => frame.type === 'get_session_stats')!;
    child.emitFrame({
      type: 'response',
      id: stateRequest.id,
      command: 'get_state',
      success: true,
      data: sessionState('session-1', {
        contextUsage: { tokens: 3000, contextWindow: 10000, percent: 30 },
      }),
    });
    child.emitFrame({
      type: 'response',
      id: statsRequest.id,
      command: 'get_session_stats',
      success: true,
      data: stats,
    });

    const runtime = await compact;
    expect(runtime.compaction.phase).toBe('succeeded');
    expect(runtime.compaction.manual).toBe(true);
    expect(runtime.contextUsage?.tokens).toBe(3000);
    backend.destroy();
  });

  it('tracks retry and fallback lifecycle events without emitting chat errors', async () => {
    const { backend, children } = createHarness();
    const child = await startReady(backend, children);

    child.emitFrame({
      type: 'auto_retry_start',
      attempt: 2,
      maxAttempts: 4,
      delayMs: 1500,
      errorMessage: 'rate limited',
    });
    child.emitFrame({
      type: 'retry_fallback_applied',
      from: 'provider/a',
      to: 'provider/b',
      role: 'default',
    });
    child.emitFrame({
      type: 'retry_fallback_succeeded',
      model: 'provider/b',
      role: 'default',
    });
    await waitFor(() => backend.getOmpControlState().runtime.fallback?.phase === 'succeeded');

    const runtime = backend.getOmpControlState().runtime;
    expect(runtime.retry.phase).toBe('waiting');
    expect(runtime.retry.attempt).toBe(2);
    expect(runtime.fallback).toEqual({
      phase: 'succeeded',
      from: 'provider/a',
      to: 'provider/b',
      role: 'default',
    });
    expect(backend.getModel()).toBe('provider/b');
    expect(backend.getDiagnostics().unknownFrames).toBe(0);
    backend.destroy();
  });

  it('updates automatic settings and aborts a waiting retry after correlated responses', async () => {
    const { backend, children } = createHarness();
    const child = await startReady(backend, children);

    const autoCompaction = backend.setAutoCompaction(false);
    await waitFor(() => child.frames.some((frame) => frame.type === 'set_auto_compaction'));
    const compactionRequest = child.frames.findLast((frame) => frame.type === 'set_auto_compaction')!;
    child.emitFrame({ type: 'response', id: compactionRequest.id, command: 'set_auto_compaction', success: true });
    await autoCompaction;

    const autoRetry = backend.setAutoRetry(true);
    await waitFor(() => child.frames.some((frame) => frame.type === 'set_auto_retry'));
    const retryRequest = child.frames.findLast((frame) => frame.type === 'set_auto_retry')!;
    child.emitFrame({ type: 'response', id: retryRequest.id, command: 'set_auto_retry', success: true });
    await autoRetry;

    child.emitFrame({
      type: 'auto_retry_start',
      attempt: 1,
      maxAttempts: 3,
      delayMs: 1000,
      errorMessage: 'temporary',
    });
    const abort = backend.abortRetry();
    await waitFor(() => child.frames.some((frame) => frame.type === 'abort_retry'));
    const abortRequest = child.frames.findLast((frame) => frame.type === 'abort_retry')!;
    child.emitFrame({ type: 'response', id: abortRequest.id, command: 'abort_retry', success: true });
    const runtime = await abort;

    expect(runtime.autoCompactionEnabled).toBe(false);
    expect(runtime.autoRetryEnabled).toBe(true);
    expect(runtime.retry.phase).toBe('cancelled');
    backend.destroy();
  });

  it('clears context and statistics when OMP switches to a different session', () => {
    const { backend } = createHarness();
    (backend as any).applySessionState(sessionState('session-a', {
      contextUsage: { tokens: 5000, contextWindow: 10000, percent: 50 },
    }));
    (backend as any).updateRuntimeState({ type: 'stats', stats });

    (backend as any).applySessionState(sessionState('session-b'));

    const runtime = backend.getOmpControlState().runtime;
    expect(runtime.contextUsage).toBeUndefined();
    expect(runtime.stats).toBeUndefined();
    expect(runtime.available).toBe(true);
  });
});
