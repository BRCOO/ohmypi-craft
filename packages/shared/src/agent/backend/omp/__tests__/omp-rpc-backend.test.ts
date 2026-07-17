import { describe, expect, it } from 'bun:test';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { getSessionDataPath } from '../../../../sessions/storage.ts';
import type { OmpSessionLink } from '../../../../sessions/types.ts';
import type { ThinkingLevel } from '../../../thinking-levels.ts';

import { createMockBackendConfig, createMockSource } from '../../../__tests__/test-utils.ts';
import { executeBrowserToolCommand } from '../../../browser-tool-runtime.ts';
import type { BrowserPaneFns } from '../../../browser-tools.ts';
import {
  mergeSessionScopedToolCallbacks,
  unregisterSessionScopedToolCallbacks,
} from '../../../session-scoped-tools.ts';
import {
  DEFAULT_OMP_MODEL,
  dedupeOmpHostToolDefinitions,
  OmpRpcBackend,
  resolveOmpModelSelection,
} from '../omp-rpc-backend.ts';
import type { OmpTodoPhase } from '../omp-rpc-protocol.ts';

class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly writes: string[] = [];
  subagents: Array<Record<string, unknown>> = [];
  subagentEntries = new Map<string, unknown[]>();
  lastAssistantText: string | null = null;
  loginProviders: Array<Record<string, unknown>> = [];
  failSubagentEventSubscription = false;
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
        if (frame.type === 'set_host_tools') {
          const tools = Array.isArray(frame.tools) ? frame.tools : [];
          queueMicrotask(() => this.emitFrame({
            type: 'response',
            id: frame.id,
            command: 'set_host_tools',
            success: true,
            data: {
              toolNames: tools
                .map((tool) => (
                  tool && typeof tool === 'object' && 'name' in tool
                    ? (tool as { name?: unknown }).name
                    : undefined
                ))
                .filter((name): name is string => typeof name === 'string'),
            },
          }));
        }
        if (frame.type === 'set_host_uri_schemes') {
          const schemes = Array.isArray(frame.schemes) ? frame.schemes : [];
          queueMicrotask(() => this.emitFrame({
            type: 'response',
            id: frame.id,
            command: 'set_host_uri_schemes',
            success: true,
            data: {
              schemes: schemes
                .map((scheme) => (
                  scheme && typeof scheme === 'object' && 'scheme' in scheme
                    ? (scheme as { scheme?: unknown }).scheme
                    : undefined
                ))
                .filter((scheme): scheme is string => typeof scheme === 'string'),
            },
          }));
        }
        if (frame.type === 'set_subagent_subscription') {
          queueMicrotask(() => this.emitFrame({
            type: 'response',
            id: frame.id,
            command: 'set_subagent_subscription',
            success: !(this.failSubagentEventSubscription && frame.level === 'events'),
            error: this.failSubagentEventSubscription && frame.level === 'events'
              ? 'unsupported subscription level'
              : undefined,
            data: this.failSubagentEventSubscription && frame.level === 'events'
              ? undefined
              : { level: frame.level },
          }));
        }
        if (frame.type === 'get_subagents') {
          queueMicrotask(() => this.emitFrame({
            type: 'response',
            id: frame.id,
            command: 'get_subagents',
            success: true,
            data: { subagents: this.subagents },
          }));
        }
        if (frame.type === 'get_subagent_messages') {
          const subagentId = typeof frame.subagentId === 'string' ? frame.subagentId : 'unknown';
          queueMicrotask(() => this.emitFrame({
            type: 'response',
            id: frame.id,
            command: 'get_subagent_messages',
            success: true,
            data: {
              sessionFile: typeof frame.sessionFile === 'string' ? frame.sessionFile : `D:/sessions/${subagentId}.jsonl`,
              fromByte: typeof frame.fromByte === 'number' ? frame.fromByte : 0,
              nextByte: 100,
              reset: false,
              entries: this.subagentEntries.get(subagentId) ?? [],
              messages: [],
            },
          }));
        }
        if (frame.type === 'get_last_assistant_text') {
          queueMicrotask(() => this.emitFrame({
            type: 'response',
            id: frame.id,
            command: 'get_last_assistant_text',
            success: true,
            data: { text: this.lastAssistantText },
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
        if (frame.type === 'get_login_providers') {
          queueMicrotask(() => this.emitFrame({
            type: 'response',
            id: frame.id,
            command: 'get_login_providers',
            success: true,
            data: {
              providers: this.loginProviders,
            },
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
  longRequestTimeoutMs?: number;
  hostToolExecutionTimeoutMs?: number;
  hostToolUpdateThrottleMs?: number;
  hostToolMaxConcurrentExecutions?: number;
  model?: string;
  onSessionId?: (id: string) => void;
  sessionLink?: OmpSessionLink;
  onSessionLink?: (link: OmpSessionLink) => void;
  onModelUpdate?: (model: string) => void;
  onThinkingLevelUpdate?: (level: ThinkingLevel) => void;
  attachmentReadFile?: (path: string) => Buffer;
  workspaceRootPath?: string;
} = {}) {
  const children: FakeChild[] = [];
  const spawnCalls: Array<{ command: string; args: string[] }> = [];
  const spawnProcess = ((command: string, args: string[]) => {
    spawnCalls.push({ command, args: [...args] });
    const child = new FakeChild();
    children.push(child);
    return child as unknown as ChildProcessWithoutNullStreams;
  }) as unknown as typeof spawn;

  const config = createMockBackendConfig({
    provider: 'omp',
    model: options.model ?? DEFAULT_OMP_MODEL,
    runtime: { ompCommand: 'omp' },
    onSdkSessionIdUpdate: options.onSessionId,
    onOmpSessionLinkUpdate: options.onSessionLink,
    onModelUpdate: options.onModelUpdate,
    onThinkingLevelUpdate: options.onThinkingLevelUpdate,
  });
  if (options.workspaceRootPath) {
    config.workspace = {
      ...config.workspace,
      rootPath: options.workspaceRootPath,
    };
    if (config.session) {
      config.session = {
        ...config.session,
        workspaceRootPath: options.workspaceRootPath,
      };
    }
  }
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
    longRequestTimeoutMs: options.longRequestTimeoutMs,
    hostToolExecutionTimeoutMs: options.hostToolExecutionTimeoutMs,
    hostToolUpdateThrottleMs: options.hostToolUpdateThrottleMs,
    hostToolMaxConcurrentExecutions: options.hostToolMaxConcurrentExecutions,
    attachmentReadFile: options.attachmentReadFile,
  });

  return { backend, children, config, spawnCalls };
}

function readHostUriAuditRecords(backend: OmpRpcBackend): Array<Record<string, unknown>> {
  const sessionId = backend.getSessionId() ?? 'test-session-id';
  const auditPath = join(
    getSessionDataPath(backend.getWorkspace().rootPath, sessionId),
    'omp-host-uri-audit.jsonl',
  );
  if (!existsSync(auditPath)) return [];
  return readFileSync(auditPath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as Record<string, unknown>);
}

async function startReady(
  backend: OmpRpcBackend,
  children: FakeChild[],
  overrides: Record<string, unknown> = {},
): Promise<FakeChild> {
  const ready = (backend as any).ensureSubprocess() as Promise<void>;
  const child = children.at(-1);
  if (!child) throw new Error('Expected OMP child to spawn');
  await respondReady(child, `session-${children.length}`, overrides);
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

describe('dedupeOmpHostToolDefinitions', () => {
  it('keeps the first host tool definition and reports later duplicate names', () => {
    const result = dedupeOmpHostToolDefinitions([
      { name: 'config_validate', description: 'first', parameters: { type: 'object' } },
      { name: 'mermaid_validate', description: 'valid', parameters: { type: 'object' } },
      { name: 'config_validate', description: 'duplicate', parameters: { type: 'object' } },
    ]);

    expect(result.tools.map(tool => tool.description)).toEqual(['first', 'valid']);
    expect(result.skippedNames).toEqual(['config_validate']);
  });
});

describe('executeBrowserToolCommand cancellation', () => {
  it('does not start later batch commands after the signal is aborted', async () => {
    const controller = new AbortController();
    const calls: string[] = [];
    const fns = {
      setClipboard: async () => {
        calls.push('setClipboard');
        controller.abort(new Error('browser batch cancelled'));
      },
      getClipboard: async () => {
        calls.push('getClipboard');
        return 'should not be read';
      },
    } as unknown as BrowserPaneFns;

    await expect(executeBrowserToolCommand({
      command: 'set-clipboard first; get-clipboard',
      fns,
      sessionId: 'browser-cancel-test',
      signal: controller.signal,
    })).rejects.toThrow('browser batch cancelled');
    expect(calls).toEqual(['setClipboard']);
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
    expect(backend.getDiagnostics().requestTimeoutsByCommand.get_state).toBe(1);
    backend.destroy();
  });

  it('uses command metadata for long-running timeouts when no test override is provided', async () => {
    const { backend, children } = createHarness({ longRequestTimeoutMs: 10 });
    await startReady(backend, children);

    const request = (backend as any).send({
      type: 'login',
      providerId: 'deepseek',
    }) as Promise<unknown>;
    await expect(request).rejects.toThrow('OMP RPC command timed out: login');

    const diagnostics = backend.getDiagnostics();
    expect(diagnostics.requestTimeouts).toBe(1);
    expect(diagnostics.requestTimeoutsByCommand.login).toBe(1);
    expect(diagnostics.commandDefinitions.login.longRunning).toBe(true);
    expect(diagnostics.commandDefinitions.get_state.sideEffect).toBe(false);
    backend.destroy();
  });

  it('lets requestTimeoutMs override command metadata for deterministic tests', async () => {
    const { backend, children } = createHarness({
      requestTimeoutMs: 10,
      longRequestTimeoutMs: 5_000,
    });
    await startReady(backend, children);

    const started = Date.now();
    await expect((backend as any).send({
      type: 'login',
      providerId: 'deepseek',
    })).rejects.toThrow('OMP RPC command timed out: login');
    expect(Date.now() - started).toBeLessThan(500);
    expect(backend.getDiagnostics().requestTimeoutsByCommand.login).toBe(1);
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

    expect(leftId).toBe(rightId);
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
      data: sessionState('real-session-id', {
        model: 'deepseek/deepseek-v4-flash',
      }),
    });
    await ready;

    expect(sessionIds).toEqual(['real-session-id']);
    expect((backend as any).sessionState.sessionId).toBe('real-session-id');
    expect(backend.getModel()).toBe('deepseek/deepseek-v4-flash');
    expect((backend as any).selectedModelKey).toBe('deepseek/deepseek-v4-flash');
    await waitFor(() => backend.getCachedAvailableCommands()[0]?.name === 'stats');
    expect(backend.getCachedAvailableCommands().map((command) => command.name)).toEqual(['stats']);
    backend.destroy();
  });

  it('keeps an explicit Craft model instead of adopting OMP persisted state', async () => {
    const { backend, children, spawnCalls } = createHarness({ model: 'kimi-code/kimi-for-coding' });
    const ready = (backend as any).ensureSubprocess() as Promise<void>;
    const child = children[0]!;

    expect(spawnCalls[0]).toMatchObject({
      command: 'omp',
      args: ['--mode', 'rpc', '--model=kimi-code/kimi-for-coding'],
    });

    child.emitFrame({ type: 'ready' });
    await waitFor(() => child.frames.some((frame) => frame.type === 'get_state'));
    const stateRequest = child.frames.findLast((frame) => frame.type === 'get_state')!;
    child.emitFrame({
      type: 'response',
      id: stateRequest.id,
      command: 'get_state',
      success: true,
      data: sessionState('session-explicit-model', {
        model: {
          provider: 'opencode-go',
          id: 'glm-5.1',
        },
      }),
    });

    await ready;

    expect(backend.getModel()).toBe('kimi-code/kimi-for-coding');
    expect((backend as any).selectedModelKey).toBeNull();

    const selection = (backend as any).ensureModelSelected() as Promise<void>;
    await waitFor(() => child.frames.some((frame) => frame.type === 'set_model'));
    const setModelRequest = child.frames.findLast((frame) => frame.type === 'set_model')!;
    expect(setModelRequest).toMatchObject({
      type: 'set_model',
      provider: 'kimi-code',
      modelId: 'kimi-for-coding',
    });
    child.emitFrame({
      type: 'response',
      id: setModelRequest.id,
      command: 'set_model',
      success: true,
    });
    await selection;

    backend.destroy();
  });

  it('fetches the last assistant text through the OMP RPC command', async () => {
    const { backend, children } = createHarness();
    const child = await startReady(backend, children);
    child.lastAssistantText = 'Latest assistant answer';

    await expect(backend.getOmpLastAssistantText()).resolves.toBe('Latest assistant answer');
    expect(child.frames.findLast((frame) => frame.type === 'get_last_assistant_text')).toMatchObject({
      type: 'get_last_assistant_text',
    });
    backend.destroy();
  });

  it('applies OMP session_info_update frames to the persisted session link', async () => {
    const links: OmpSessionLink[] = [];
    const { backend, children } = createHarness({
      onSessionLink: (link) => links.push(link),
    });
    const child = await startReady(backend, children, {
      sessionFile: 'C:\\sessions\\initial.jsonl',
      sessionName: 'Initial OMP title',
      messageCount: 2,
    });

    child.emitFrame({
      type: 'session_info_update',
      sessionId: 'session-renamed',
      title: 'Renamed by OMP',
    });

    await waitFor(() => links.at(-1)?.sessionName === 'Renamed by OMP');
    expect(backend.getOmpSessionLink()).toMatchObject({
      sessionId: 'session-renamed',
      sessionFile: 'C:\\sessions\\initial.jsonl',
      sessionName: 'Renamed by OMP',
      messageCount: 2,
    });
    expect((backend as any).sessionState).toMatchObject({
      sessionId: 'session-renamed',
      sessionName: 'Renamed by OMP',
    });
    expect(backend.getDiagnostics().unknownFramesByType.session_info_update).toBeUndefined();
    backend.destroy();
  });

  it('registers Craft registry session tools as OMP host tools on startup', async () => {
    const { backend, children } = createHarness();
    const child = await startReady(backend, children);

    await waitFor(() => child.frames.some((frame) => frame.type === 'set_host_tools'));
    await waitFor(() => child.frames.some((frame) => frame.type === 'set_host_uri_schemes'));

    const hostToolsFrame = child.frames.find((frame) => frame.type === 'set_host_tools')!;
    const toolNames = (hostToolsFrame.tools as Array<{ name: string }>).map(tool => tool.name);
    expect(toolNames).toContain('SubmitPlan');
    expect(toolNames).toContain('config_validate');
    expect(toolNames).toContain('mermaid_validate');
    expect(toolNames).toContain('call_llm');
    expect(toolNames).toContain('spawn_session');
    expect(toolNames).toContain('browser_tool');
    expect((hostToolsFrame.tools as Array<{ name: string; parameters: Record<string, unknown> }>)
      .find(tool => tool.name === 'mermaid_validate')?.parameters).toMatchObject({
      type: 'object',
    });

    const uriFrame = child.frames.find((frame) => frame.type === 'set_host_uri_schemes')!;
    expect(uriFrame.schemes).toEqual([
      expect.objectContaining({
        scheme: 'craft-session',
        writable: true,
        immutable: false,
      }),
      expect.objectContaining({
        scheme: 'craft-workspace',
        writable: false,
        immutable: false,
      }),
    ]);
    backend.destroy();
  });

  it('executes an OMP host tool call and sends an AgentToolResult-shaped response', async () => {
    const { backend, children } = createHarness();
    const child = await startReady(backend, children);
    await waitFor(() => (backend as any).registeredHostToolNames.has('mermaid_validate'));

    child.emitFrame({
      type: 'host_tool_call',
      id: 'host-tool-1',
      toolCallId: 'tool-use-1',
      toolName: 'mermaid_validate',
      arguments: { code: 'flowchart TD\nA-->B' },
    });

    await waitFor(() => child.frames.some((frame) => frame.type === 'host_tool_result' && frame.id === 'host-tool-1'));
    const resultFrame = child.frames.find((frame) => frame.type === 'host_tool_result' && frame.id === 'host-tool-1')!;
    expect(resultFrame.isError).toBeUndefined();
    expect(resultFrame.result).toMatchObject({
      content: [{ type: 'text' }],
    });
    expect(JSON.stringify(resultFrame.result)).toContain('Diagram syntax is valid');
    expect(backend.getDiagnostics().unknownFramesByType.host_tool_call).toBeUndefined();
    backend.destroy();
  });

  it('passes a per-call AbortSignal to registry host tool context without mutating the cached base context', () => {
    const { backend } = createHarness();
    const execution = (backend as any).createPendingHostToolExecution({
      id: 'host-tool-context-signal',
      toolName: 'mermaid_validate',
    });

    const baseContext = (backend as any).getHostSessionToolContext() as { abortSignal?: AbortSignal };
    const callContext = (backend as any).getHostSessionToolContext(execution) as { abortSignal?: AbortSignal };

    expect(callContext).not.toBe(baseContext);
    expect(baseContext.abortSignal).toBeUndefined();
    expect(callContext.abortSignal).toBe(execution.controller.signal);

    expect((backend as any).settleHostToolExecution(execution, {
      abort: true,
      reason: 'test abort',
    })).toBe(true);
    expect(callContext.abortSignal?.aborted).toBe(true);
    expect(baseContext.abortSignal).toBeUndefined();
    backend.destroy();
  });

  it('preserves structured session tool content as OMP host tool details', async () => {
    const { backend } = createHarness();

    const converted = (backend as any).sessionToolResultToHostToolResult({
      content: [{ type: 'text', text: 'Structured result ready' }],
      structuredContent: {
        valid: true,
        warnings: ['minor'],
      },
      isError: false,
    });

    expect(converted).toEqual({
      content: [{ type: 'text', text: 'Structured result ready' }],
      details: {
        valid: true,
        warnings: ['minor'],
      },
    });
    backend.destroy();
  });

  it('executes call_llm in an isolated OMP process while the main turn is active', async () => {
    const { backend, children } = createHarness();
    const eventsPromise = (async () => {
      const events = [];
      for await (const event of backend.chat('Main OMP task')) events.push(event);
      return events;
    })();

    await waitFor(() => children.length === 1);
    const mainChild = children[0]!;
    await respondReady(mainChild, 'session-main-call-llm');
    await waitFor(() => mainChild.frames.some((frame) => frame.type === 'prompt'));
    const mainPrompt = mainChild.frames.find((frame) => frame.type === 'prompt')!;
    mainChild.emitFrame({
      type: 'response',
      id: mainPrompt.id,
      command: 'prompt',
      success: true,
      data: { agentInvoked: true },
    });

    mainChild.emitFrame({
      type: 'host_tool_call',
      id: 'host-tool-call-llm',
      toolCallId: 'tool-use-call-llm',
      toolName: 'call_llm',
      arguments: { prompt: 'Return the isolated answer.' },
    });

    await waitFor(() => children.length === 2);
    const isolatedChild = children[1]!;
    await respondReady(isolatedChild, 'session-isolated-call-llm');
    await waitFor(() => isolatedChild.frames.some((frame) => frame.type === 'prompt'));
    const isolatedPrompt = isolatedChild.frames.find((frame) => frame.type === 'prompt')!;
    isolatedChild.emitFrame({
      type: 'response',
      id: isolatedPrompt.id,
      command: 'prompt',
      success: true,
      data: { agentInvoked: true },
    });
    isolatedChild.emitFrame({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'Isolated ' },
    });
    isolatedChild.emitFrame({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'answer' },
    });
    isolatedChild.emitFrame({
      type: 'message_end',
      message: {
        role: 'assistant',
        id: 'isolated-message',
        content: [{ type: 'text', text: 'Isolated answer' }],
      },
    });
    isolatedChild.emitFrame({ type: 'agent_end' });

    await waitFor(() => mainChild.frames.some(
      (frame) => frame.type === 'host_tool_result' && frame.id === 'host-tool-call-llm',
    ));
    const resultFrame = mainChild.frames.find(
      (frame) => frame.type === 'host_tool_result' && frame.id === 'host-tool-call-llm',
    )!;
    expect(resultFrame.isError).toBeUndefined();
    expect(JSON.stringify(resultFrame.result)).toContain('Isolated answer');
    const updates = mainChild.frames.filter(
      (frame) => frame.type === 'host_tool_update' && frame.id === 'host-tool-call-llm',
    );
    expect(updates).toHaveLength(2);
    expect(JSON.stringify(updates[0]?.partialResult)).toContain('Isolated');
    expect(JSON.stringify(updates[1]?.partialResult)).toContain('Isolated answer');
    expect(isolatedChild.frames.some((frame) => frame.type === 'set_host_tools')).toBe(false);
    expect(isolatedChild.killed).toBe(true);

    mainChild.emitFrame({ type: 'agent_end' });
    await eventsPromise;
    backend.destroy();
  });

  it('cancels an active call_llm by killing its isolated OMP process without an orphan result', async () => {
    const { backend, children } = createHarness({ hostToolMaxConcurrentExecutions: 1 });
    const eventsPromise = (async () => {
      const events = [];
      for await (const event of backend.chat('Main cancellation task')) events.push(event);
      return events;
    })();

    await waitFor(() => children.length === 1);
    const mainChild = children[0]!;
    await respondReady(mainChild, 'session-main-cancel');
    await waitFor(() => mainChild.frames.some((frame) => frame.type === 'prompt'));
    const mainPrompt = mainChild.frames.find((frame) => frame.type === 'prompt')!;
    mainChild.emitFrame({
      type: 'response',
      id: mainPrompt.id,
      command: 'prompt',
      success: true,
      data: { agentInvoked: true },
    });
    mainChild.emitFrame({
      type: 'host_tool_call',
      id: 'host-tool-call-llm-cancel',
      toolCallId: 'tool-use-call-llm-cancel',
      toolName: 'call_llm',
      arguments: { prompt: 'Wait for cancellation.' },
    });

    await waitFor(() => children.length === 2);
    const isolatedChild = children[1]!;
    await respondReady(isolatedChild, 'session-isolated-cancel');
    await waitFor(() => isolatedChild.frames.some((frame) => frame.type === 'prompt'));
    mainChild.emitFrame({
      type: 'host_tool_cancel',
      id: 'host-tool-cancel-command',
      targetId: 'host-tool-call-llm-cancel',
    });
    mainChild.emitFrame({
      type: 'host_tool_cancel',
      id: 'host-tool-cancel-command-duplicate',
      targetId: 'host-tool-call-llm-cancel',
    });

    await waitFor(() => isolatedChild.killed);
    await waitFor(() => (backend as any).pendingHostToolExecutions.size === 0);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mainChild.frames.filter(
      (frame) => frame.type === 'host_tool_result' && frame.id === 'host-tool-call-llm-cancel',
    )).toHaveLength(0);

    mainChild.emitFrame({
      type: 'host_tool_call',
      id: 'host-tool-after-cancel',
      toolCallId: 'tool-use-after-cancel',
      toolName: 'mermaid_validate',
      arguments: { code: 'flowchart TD\nA-->B' },
    });
    await waitFor(() => mainChild.frames.some(
      (frame) => frame.type === 'host_tool_result' && frame.id === 'host-tool-after-cancel',
    ));
    const afterCancel = mainChild.frames.find(
      (frame) => frame.type === 'host_tool_result' && frame.id === 'host-tool-after-cancel',
    )!;
    expect(afterCancel.isError).toBeUndefined();
    expect(JSON.stringify(afterCancel.result)).toContain('Diagram syntax is valid');

    mainChild.emitFrame({ type: 'agent_end' });
    await eventsPromise;
    backend.destroy();
  });

  it('cancels a pending host-tool permission without returning an orphan result', async () => {
    const permissionRequests: Array<{ requestId: string }> = [];
    const { backend, children } = createHarness();
    backend.setPermissionMode('ask');
    backend.onPermissionRequest = (request) => {
      permissionRequests.push(request);
    };
    const child = await startReady(backend, children);

    child.emitFrame({
      type: 'host_tool_call',
      id: 'host-tool-permission-cancel',
      toolCallId: 'tool-use-permission-cancel',
      toolName: 'update_user_preferences',
      arguments: { preferences: 'Use compact answers.' },
    });
    await waitFor(() => permissionRequests.length === 1);
    expect((backend as any).pendingHostToolPermissions.size).toBe(1);

    child.emitFrame({
      type: 'host_tool_cancel',
      id: 'host-tool-permission-cancel-command',
      targetId: 'host-tool-permission-cancel',
    });
    await waitFor(() => (backend as any).pendingHostToolPermissions.size === 0);
    await new Promise((resolve) => setTimeout(resolve, 0));
    backend.respondToPermission(permissionRequests[0]!.requestId, true, false);
    expect(child.frames.filter(
      (frame) => frame.type === 'host_tool_result' && frame.id === 'host-tool-permission-cancel',
    )).toHaveLength(0);
    expect(child.frames.some(
      (frame) => frame.type === 'permission_response' && frame.requestId === permissionRequests[0]!.requestId,
    )).toBe(false);
    backend.destroy();
  });

  it('times out a non-cooperative host tool once and ignores its late result', async () => {
    type BrowserWindowInfo = Awaited<ReturnType<BrowserPaneFns['listWindows']>>[number];
    let resolveWindows!: (windows: BrowserWindowInfo[]) => void;
    const windowsPromise = new Promise<BrowserWindowInfo[]>((resolve) => {
      resolveWindows = resolve;
    });
    const { backend, children } = createHarness({
      hostToolExecutionTimeoutMs: 10,
      hostToolUpdateThrottleMs: 1,
      hostToolMaxConcurrentExecutions: 1,
    });
    mergeSessionScopedToolCallbacks('test-session-id', {
      browserPaneFns: {
        listWindows: () => windowsPromise,
      } as unknown as BrowserPaneFns,
    });
    (backend as any).prerequisiteManager.trackReadTool({
      file_path: resolve(join(homedir(), '.craft-agent', 'docs', 'browser-tools.md')),
    });
    const child = await startReady(backend, children);

    child.emitFrame({
      type: 'host_tool_call',
      id: 'host-tool-timeout',
      toolCallId: 'tool-use-timeout',
      toolName: 'browser_tool',
      arguments: { command: 'windows' },
    });

    await waitFor(() => child.frames.some(
      (frame) => frame.type === 'host_tool_result' && frame.id === 'host-tool-timeout',
    ));
    const timeoutResults = () => child.frames.filter(
      (frame) => frame.type === 'host_tool_result' && frame.id === 'host-tool-timeout',
    );
    expect(timeoutResults()).toHaveLength(1);
    expect(timeoutResults()[0]?.isError).toBe(true);
    expect(JSON.stringify(timeoutResults()[0]?.result)).toContain('timed out');
    expect((backend as any).pendingHostToolExecutions.size).toBe(0);

    child.emitFrame({
      type: 'host_tool_call',
      id: 'host-tool-after-timeout',
      toolCallId: 'tool-use-after-timeout',
      toolName: 'mermaid_validate',
      arguments: { code: 'flowchart TD\nA-->B' },
    });
    await waitFor(() => child.frames.some(
      (frame) => frame.type === 'host_tool_result' && frame.id === 'host-tool-after-timeout',
    ));
    const afterTimeout = child.frames.find(
      (frame) => frame.type === 'host_tool_result' && frame.id === 'host-tool-after-timeout',
    )!;
    expect(afterTimeout.isError).toBeUndefined();
    expect(JSON.stringify(afterTimeout.result)).toContain('Diagram syntax is valid');

    resolveWindows([]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(timeoutResults()).toHaveLength(1);
    expect((backend as any).pendingHostToolExecutions.size).toBe(0);
    backend.destroy();
    unregisterSessionScopedToolCallbacks('test-session-id');
  });

  it('executes spawn_session through the backend callback', async () => {
    const { backend, children } = createHarness();
    backend.onSpawnSession = async (request) => ({
      sessionId: 'spawned-session',
      name: request.name ?? 'Spawned session',
      status: 'started',
      model: request.model,
    });
    const child = await startReady(backend, children);
    await waitFor(() => (backend as any).registeredHostToolNames.has('spawn_session'));

    child.emitFrame({
      type: 'host_tool_call',
      id: 'host-tool-spawn',
      toolCallId: 'tool-use-spawn',
      toolName: 'spawn_session',
      arguments: {
        prompt: 'Complete the delegated work.',
        name: 'Delegated OMP work',
        model: 'deepseek/deepseek-v4-flash',
      },
    });

    await waitFor(() => child.frames.some(
      (frame) => frame.type === 'host_tool_result' && frame.id === 'host-tool-spawn',
    ));
    const resultFrame = child.frames.find(
      (frame) => frame.type === 'host_tool_result' && frame.id === 'host-tool-spawn',
    )!;
    expect(resultFrame.isError).toBeUndefined();
    expect(JSON.stringify(resultFrame.result)).toContain('spawned-session');
    expect(JSON.stringify(resultFrame.result)).toContain('Delegated OMP work');
    backend.destroy();
  });

  it('executes browser_tool through the session-scoped desktop callbacks', async () => {
    const { backend, children } = createHarness();
    mergeSessionScopedToolCallbacks('test-session-id', {
      browserPaneFns: {
        listWindows: async () => [{
          id: 'browser-omp-1',
          title: 'OMP Browser',
          url: 'https://example.com/',
          isVisible: true,
          ownerType: 'session',
          ownerSessionId: 'test-session-id',
          boundSessionId: 'test-session-id',
          agentControlActive: true,
        }],
      } as unknown as BrowserPaneFns,
    });
    (backend as any).prerequisiteManager.trackReadTool({
      file_path: resolve(join(homedir(), '.craft-agent', 'docs', 'browser-tools.md')),
    });
    const child = await startReady(backend, children);
    await waitFor(() => (backend as any).registeredHostToolNames.has('browser_tool'));

    child.emitFrame({
      type: 'host_tool_call',
      id: 'host-tool-browser',
      toolCallId: 'tool-use-browser',
      toolName: 'browser_tool',
      arguments: { command: 'windows' },
    });

    await waitFor(() => child.frames.some(
      (frame) => frame.type === 'host_tool_result' && frame.id === 'host-tool-browser',
    ));
    const resultFrame = child.frames.find(
      (frame) => frame.type === 'host_tool_result' && frame.id === 'host-tool-browser',
    )!;
    expect(resultFrame.isError).toBeUndefined();
    expect(JSON.stringify(resultFrame.result)).toContain('browser-omp-1');
    expect(JSON.stringify(resultFrame.result)).toContain('OMP Browser');
    backend.destroy();
    unregisterSessionScopedToolCallbacks('test-session-id');
  });

  it('stops browser_tool select polling after OMP cancels the host tool call', async () => {
    let snapshotCalls = 0;
    const metrics = {
      url: 'https://example.com/form',
      title: 'Example form',
      viewportWidth: 800,
      viewportHeight: 600,
      documentWidth: 800,
      documentHeight: 1200,
      scrollX: 0,
      scrollY: 0,
      maxScrollX: 0,
      maxScrollY: 600,
      activeElementTag: 'select',
      activeElementRole: 'combobox',
      activeElementName: 'Country',
    };
    const { backend, children } = createHarness({ hostToolUpdateThrottleMs: 1 });
    mergeSessionScopedToolCallbacks('test-session-id', {
      browserPaneFns: {
        select: async () => {},
        evaluate: async () => metrics,
        snapshot: async () => {
          snapshotCalls += 1;
          return {
            url: metrics.url,
            title: metrics.title,
            nodes: [{
              ref: '@e1',
              role: 'combobox',
              name: 'Country',
              value: 'old-value',
              description: 'country selector',
            }],
          };
        },
      } as unknown as BrowserPaneFns,
    });
    (backend as any).prerequisiteManager.trackReadTool({
      file_path: resolve(join(homedir(), '.craft-agent', 'docs', 'browser-tools.md')),
    });
    const child = await startReady(backend, children);
    await waitFor(() => (backend as any).registeredHostToolNames.has('browser_tool'));

    child.emitFrame({
      type: 'host_tool_call',
      id: 'host-tool-browser-select-cancel',
      toolCallId: 'tool-use-browser-select-cancel',
      toolName: 'browser_tool',
      arguments: {
        command: 'select @e1 new-value --assert-text Done --timeout 1000',
      },
    });
    await waitFor(() => snapshotCalls > 0);

    child.emitFrame({
      type: 'host_tool_cancel',
      id: 'host-tool-browser-select-cancel-command',
      targetId: 'host-tool-browser-select-cancel',
    });
    await waitFor(() => (backend as any).pendingHostToolExecutions.size === 0);
    const callsAfterCancel = snapshotCalls;
    await new Promise((resolve) => setTimeout(resolve, 160));

    expect(snapshotCalls).toBe(callsAfterCancel);
    expect(child.frames.filter(
      (frame) => frame.type === 'host_tool_result' && frame.id === 'host-tool-browser-select-cancel',
    )).toHaveLength(0);
    backend.destroy();
    unregisterSessionScopedToolCallbacks('test-session-id');
  });

  it('returns browser screenshots as native OMP host tool image content', async () => {
    const { backend, children } = createHarness();
    const imageBuffer = Buffer.from('fake-png-bytes');
    mergeSessionScopedToolCallbacks('test-session-id', {
      browserPaneFns: {
        screenshot: async () => ({
          imageBuffer,
          imageFormat: 'png',
          metadata: {
            viewport: { width: 800, height: 600, dpr: 1 },
          },
        }),
      } as unknown as BrowserPaneFns,
    });
    (backend as any).prerequisiteManager.trackReadTool({
      file_path: resolve(join(homedir(), '.craft-agent', 'docs', 'browser-tools.md')),
    });
    const child = await startReady(backend, children);
    await waitFor(() => (backend as any).registeredHostToolNames.has('browser_tool'));

    child.emitFrame({
      type: 'host_tool_call',
      id: 'host-tool-browser-screenshot',
      toolCallId: 'tool-use-browser-screenshot',
      toolName: 'browser_tool',
      arguments: { command: 'screenshot --png' },
    });

    await waitFor(() => child.frames.some(
      (frame) => frame.type === 'host_tool_result' && frame.id === 'host-tool-browser-screenshot',
    ));
    const resultFrame = child.frames.find(
      (frame) => frame.type === 'host_tool_result' && frame.id === 'host-tool-browser-screenshot',
    )!;
    expect(resultFrame.isError).toBeUndefined();
    expect(resultFrame.result).toMatchObject({
      content: [
        expect.objectContaining({
          type: 'text',
          text: expect.stringContaining('Screenshot captured'),
        }),
        {
          type: 'image',
          data: imageBuffer.toString('base64'),
          mimeType: 'image/png',
        },
      ],
    });
    backend.destroy();
    unregisterSessionScopedToolCallbacks('test-session-id');
  });

  it('rejects over-quota OMP host tool calls without starting another handler', async () => {
    type BrowserWindowInfo = Awaited<ReturnType<BrowserPaneFns['listWindows']>>[number];
    let resolveWindows!: (windows: BrowserWindowInfo[]) => void;
    const windowsPromise = new Promise<BrowserWindowInfo[]>((resolve) => {
      resolveWindows = resolve;
    });
    const { backend, children } = createHarness({
      hostToolMaxConcurrentExecutions: 1,
    });
    mergeSessionScopedToolCallbacks('test-session-id', {
      browserPaneFns: {
        listWindows: () => windowsPromise,
      } as BrowserPaneFns,
    });
    (backend as any).prerequisiteManager.trackReadTool({
      file_path: resolve(join(homedir(), '.craft-agent', 'docs', 'browser-tools.md')),
    });
    const child = await startReady(backend, children);

    child.emitFrame({
      type: 'host_tool_call',
      id: 'host-tool-quota-holder',
      toolCallId: 'tool-use-quota-holder',
      toolName: 'browser_tool',
      arguments: { command: 'windows' },
    });
    await waitFor(() => (backend as any).pendingHostToolExecutions.size === 1);

    child.emitFrame({
      type: 'host_tool_call',
      id: 'host-tool-over-quota',
      toolCallId: 'tool-use-over-quota',
      toolName: 'mermaid_validate',
      arguments: { code: 'flowchart TD\nA-->B' },
    });

    await waitFor(() => child.frames.some(
      (frame) => frame.type === 'host_tool_result' && frame.id === 'host-tool-over-quota',
    ));
    const quotaResult = child.frames.find(
      (frame) => frame.type === 'host_tool_result' && frame.id === 'host-tool-over-quota',
    )!;
    expect(quotaResult.isError).toBe(true);
    expect(JSON.stringify(quotaResult.result)).toContain('Host tool quota is full');
    expect((backend as any).pendingHostToolExecutions.size).toBe(1);

    resolveWindows([]);
    await waitFor(() => child.frames.some(
      (frame) => frame.type === 'host_tool_result' && frame.id === 'host-tool-quota-holder',
    ));
    expect((backend as any).pendingHostToolExecutions.size).toBe(0);
    backend.destroy();
    unregisterSessionScopedToolCallbacks('test-session-id');
  });

  it('prompts before executing blocked OMP host session tools in ask mode', async () => {
    const permissionRequests: Array<{ requestId: string; toolName: string; command?: string }> = [];
    const { backend, children } = createHarness();
    backend.setPermissionMode('ask');
    backend.onPermissionRequest = (request) => {
      permissionRequests.push(request);
      backend.respondToPermission(request.requestId, false, false);
    };
    const child = await startReady(backend, children);
    await waitFor(() => (backend as any).registeredHostToolNames.has('update_user_preferences'));

    child.emitFrame({
      type: 'host_tool_call',
      id: 'host-tool-permission',
      toolCallId: 'tool-use-permission',
      toolName: 'update_user_preferences',
      arguments: { preferences: 'Prefer concise answers.' },
    });

    await waitFor(() => child.frames.some((frame) => frame.type === 'host_tool_result' && frame.id === 'host-tool-permission'));
    const resultFrame = child.frames.find((frame) => frame.type === 'host_tool_result' && frame.id === 'host-tool-permission')!;
    expect(permissionRequests).toHaveLength(1);
    expect(permissionRequests[0]).toMatchObject({
      toolName: 'mcp__session__update_user_preferences',
      command: 'mcp__session__update_user_preferences',
    });
    expect(resultFrame.isError).toBe(true);
    expect(JSON.stringify(resultFrame.result)).toContain('Permission denied by user');
    backend.destroy();
  });

  it('denies mutating OMP host session tools in ask mode when no permission handler is available', async () => {
    const { backend, children } = createHarness();
    backend.setPermissionMode('ask');
    const child = await startReady(backend, children);
    await waitFor(() => (backend as any).registeredHostToolNames.has('update_user_preferences'));

    child.emitFrame({
      type: 'host_tool_call',
      id: 'host-tool-no-permission-handler',
      toolCallId: 'tool-use-no-permission-handler',
      toolName: 'update_user_preferences',
      arguments: { preferences: 'Prefer silent approval.' },
    });

    await waitFor(() => child.frames.some((frame) => frame.type === 'host_tool_result' && frame.id === 'host-tool-no-permission-handler'));
    const resultFrame = child.frames.find((frame) => frame.type === 'host_tool_result' && frame.id === 'host-tool-no-permission-handler')!;
    expect(resultFrame.isError).toBe(true);
    expect(JSON.stringify(resultFrame.result)).toContain('Permission denied by user');
    backend.destroy();
  });

  it('blocks mutating OMP host session tools in safe mode without executing them', async () => {
    const permissionRequests: unknown[] = [];
    const { backend, children } = createHarness();
    backend.setPermissionMode('safe');
    backend.onPermissionRequest = (request) => {
      permissionRequests.push(request);
    };
    const child = await startReady(backend, children);
    await waitFor(() => (backend as any).registeredHostToolNames.has('update_user_preferences'));

    child.emitFrame({
      type: 'host_tool_call',
      id: 'host-tool-safe-block',
      toolCallId: 'tool-use-safe-block',
      toolName: 'update_user_preferences',
      arguments: { preferences: 'Prefer verbose answers.' },
    });

    await waitFor(() => child.frames.some((frame) => frame.type === 'host_tool_result' && frame.id === 'host-tool-safe-block'));
    const resultFrame = child.frames.find((frame) => frame.type === 'host_tool_result' && frame.id === 'host-tool-safe-block')!;
    expect(permissionRequests).toHaveLength(0);
    expect(resultFrame.isError).toBe(true);
    expect(JSON.stringify(resultFrame.result)).toContain('Session configuration changes are blocked');
    backend.destroy();
  });

  it('emits source_activated and aborts after an OMP host tool triggers source activation', async () => {
    const { backend, children } = createHarness();
    const eventsPromise = (async () => {
      const events = [];
      for await (const event of backend.chat('Use the GitHub source')) events.push(event);
      return events;
    })();

    await waitFor(() => children.length === 1);
    const child = children[0]!;
    await respondReady(child, 'session-source-activation');
    await waitFor(() => child.frames.some((frame) => frame.type === 'prompt'));

    backend.setPendingSourceActivationRestart({
      sourceSlug: 'github',
      userMessage: 'Use the GitHub source',
    });
    child.emitFrame({
      type: 'tool_execution_start',
      toolCallId: 'tool-source-1',
      toolName: 'source_test',
      args: { sourceSlug: 'github' },
    });
    child.emitFrame({
      type: 'tool_execution_end',
      toolCallId: 'tool-source-1',
      result: { content: [{ type: 'text', text: 'Source activated' }] },
      isError: false,
    });
    child.emitFrame({ type: 'agent_end' });

    const events = await eventsPromise;
    expect(events.map((event) => event.type)).toContain('tool_result');
    expect(events).toContainEqual({
      type: 'source_activated',
      sourceSlug: 'github',
      originalMessage: 'Use the GitHub source',
    });
    expect(child.frames.some((frame) => frame.type === 'abort')).toBe(true);
    backend.destroy();
  });

  it('returns an OMP host tool error for unregistered tools', async () => {
    const { backend, children } = createHarness();
    const child = await startReady(backend, children);
    await waitFor(() => (backend as any).registeredHostToolNames.size > 0);

    child.emitFrame({
      type: 'host_tool_call',
      id: 'host-tool-unknown',
      toolCallId: 'tool-use-unknown',
      toolName: 'not_a_session_tool',
      arguments: {},
    });

    await waitFor(() => child.frames.some((frame) => frame.type === 'host_tool_result' && frame.id === 'host-tool-unknown'));
    const resultFrame = child.frames.find((frame) => frame.type === 'host_tool_result' && frame.id === 'host-tool-unknown')!;
    expect(resultFrame.isError).toBe(true);
    expect(JSON.stringify(resultFrame.result)).toContain('Unknown or unregistered OMP host tool: not_a_session_tool');
    backend.destroy();
  });

  it('resolves read-only Craft session Todo snapshots through OMP host URIs', async () => {
    const { backend, children } = createHarness();
    const child = await startReady(backend, children);

    child.emitFrame({
      type: 'host_uri_request',
      id: 'host-uri-1',
      operation: 'read',
      url: 'craft-session://current/todos',
    });

    await waitFor(() => child.frames.some((frame) => frame.type === 'host_uri_result' && frame.id === 'host-uri-1'));
    const resultFrame = child.frames.find((frame) => frame.type === 'host_uri_result' && frame.id === 'host-uri-1')!;
    expect(resultFrame.isError).toBeUndefined();
    expect(resultFrame.contentType).toBe('application/json');
    expect(JSON.parse(resultFrame.content as string)).toMatchObject({
      available: true,
      sessionId: 'session-1',
      phases: [],
    });
    expect(backend.getDiagnostics().unknownFramesByType.host_uri_request).toBeUndefined();
    backend.destroy();
  });

  it('resolves Craft session summary and runtime snapshots through OMP host URIs', async () => {
    const { backend, children } = createHarness();
    const child = await startReady(backend, children);

    child.emitFrame({
      type: 'host_uri_request',
      id: 'host-uri-summary',
      operation: 'read',
      url: 'craft-session://current/summary',
    });
    child.emitFrame({
      type: 'host_uri_request',
      id: 'host-uri-runtime',
      operation: 'read',
      url: 'craft-session://current/runtime',
    });

    await waitFor(() => child.frames.some((frame) => frame.type === 'host_uri_result' && frame.id === 'host-uri-summary'));
    await waitFor(() => child.frames.some((frame) => frame.type === 'host_uri_result' && frame.id === 'host-uri-runtime'));
    const summary = child.frames.find((frame) => frame.type === 'host_uri_result' && frame.id === 'host-uri-summary')!;
    const runtime = child.frames.find((frame) => frame.type === 'host_uri_result' && frame.id === 'host-uri-runtime')!;

    expect(JSON.parse(summary.content as string)).toMatchObject({
      provider: 'omp',
      craftSessionId: 'test-session-id',
      ompSessionId: 'session-1',
      messageCount: 0,
    });
    expect(JSON.parse(runtime.content as string)).toMatchObject({
      runtime: { available: true },
      queue: {
        steeringMode: 'all',
        followUpMode: 'all',
        interruptMode: 'immediate',
      },
    });
    backend.destroy();
  });

  it('resolves sanitized Craft workspace source snapshots through OMP host URIs', async () => {
    const { backend, children } = createHarness();
    backend.setAllSources([
      createMockSource({
        id: 'github-source',
        name: 'GitHub',
        slug: 'github',
        enabled: true,
        provider: 'github',
        type: 'mcp',
        tagline: 'Issue tracker',
        isAuthenticated: true,
        connectionStatus: 'connected',
        mcp: {
          transport: 'http',
          url: 'https://mcp.example.test/secret-url',
          authType: 'oauth',
          headers: { Authorization: 'Bearer secret-token' },
          env: { GITHUB_TOKEN: 'secret-token' },
        },
      } as any),
      createMockSource({
        id: 'local-source',
        name: 'Local Docs',
        slug: 'docs',
        enabled: false,
        provider: 'local',
        type: 'local',
        local: { format: 'markdown', path: 'D:\\secret\\docs' },
      } as any),
    ]);
    await backend.setSourceServers({ github: { command: 'github-mcp' } as any }, {}, ['github']);
    const child = await startReady(backend, children);

    child.emitFrame({
      type: 'host_uri_request',
      id: 'host-uri-sources',
      operation: 'read',
      url: 'craft-workspace://current/sources',
    });

    await waitFor(() => child.frames.some((frame) => frame.type === 'host_uri_result' && frame.id === 'host-uri-sources'));
    const resultFrame = child.frames.find((frame) => frame.type === 'host_uri_result' && frame.id === 'host-uri-sources')!;
    const content = resultFrame.content as string;
    const snapshot = JSON.parse(content);

    expect(resultFrame.isError).toBeUndefined();
    expect(resultFrame.contentType).toBe('application/json');
    expect(snapshot).toMatchObject({
      workspaceId: 'test-workspace-id',
      activeSourceSlugs: ['github'],
      sources: expect.arrayContaining([
        expect.objectContaining({
          slug: 'github',
          name: 'GitHub',
          type: 'mcp',
          active: true,
          hasCredentials: true,
          requiresAuthentication: true,
          service: 'http',
          summary: 'Issue tracker',
        }),
        expect.objectContaining({
          slug: 'docs',
          active: false,
          enabled: false,
          service: 'markdown',
        }),
      ]),
    });
    expect(content).not.toContain('Authorization');
    expect(content).not.toContain('secret-token');
    expect(content).not.toContain('secret-url');
    expect(content).not.toContain('GITHUB_TOKEN');
    expect(content).not.toContain('D:\\secret\\docs');
    backend.destroy();
  });

  it('writes scoped OMP host URI artifacts and audits the write', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'omp-rpc-host-uri-'));
    const { backend, children } = createHarness({ workspaceRootPath: tempRoot });
    try {
      backend.setPermissionMode('allow-all');
      const child = await startReady(backend, children);
      const content = JSON.stringify({ ok: true }, null, 2);

      child.emitFrame({
        type: 'host_uri_request',
        id: 'host-uri-artifact-write',
        operation: 'write',
        url: 'craft-session://current/artifacts/reports/result.json',
        content,
      });

      await waitFor(() => child.frames.some((frame) => frame.type === 'host_uri_result' && frame.id === 'host-uri-artifact-write'));
      const resultFrame = child.frames.find((frame) => frame.type === 'host_uri_result' && frame.id === 'host-uri-artifact-write')!;
      const payload = JSON.parse(resultFrame.content as string) as Record<string, unknown>;
      const expectedPath = resolve(
        getSessionDataPath(tempRoot, 'test-session-id'),
        'omp-artifacts',
        'reports',
        'result.json',
      );

      expect(resultFrame.isError).toBeUndefined();
      expect(payload).toMatchObject({
        path: expectedPath,
        relativePath: 'reports/result.json',
        bytes: Buffer.byteLength(content, 'utf-8'),
        contentType: 'application/json',
      });
      expect(readFileSync(expectedPath, 'utf-8')).toBe(content);
      expect(readHostUriAuditRecords(backend).at(-1)).toMatchObject({
        operation: 'write',
        url: 'craft-session://current/artifacts/reports/result.json',
        allowed: true,
        relativePath: 'reports/result.json',
        resultPath: expectedPath,
        contentType: 'application/json',
        bytes: Buffer.byteLength(content, 'utf-8'),
      });
    } finally {
      backend.destroy();
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('denies unsafe or non-artifact OMP host URI writes without writing payload content to audit', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'omp-rpc-host-uri-'));
    const { backend, children } = createHarness({ workspaceRootPath: tempRoot });
    try {
      backend.setPermissionMode('allow-all');
      const child = await startReady(backend, children);

      child.emitFrame({
        type: 'host_uri_request',
        id: 'host-uri-non-artifact-write',
        operation: 'write',
        url: 'craft-session://current/todos',
        content: '{"phases":[]}',
      });
      child.emitFrame({
        type: 'host_uri_request',
        id: 'host-uri-traversal-write',
        operation: 'write',
        url: 'craft-session://current/artifacts/report/..%2Fescape.txt',
        content: 'do not write me',
      });
      child.emitFrame({
        type: 'host_uri_request',
        id: 'host-uri-drive-segment-write',
        operation: 'write',
        url: 'craft-session://current/artifacts/reports/D%3A/escape.txt',
        content: 'do not write me either',
      });

      await waitFor(() => child.frames.some((frame) => frame.type === 'host_uri_result' && frame.id === 'host-uri-non-artifact-write'));
      await waitFor(() => child.frames.some((frame) => frame.type === 'host_uri_result' && frame.id === 'host-uri-traversal-write'));
      await waitFor(() => child.frames.some((frame) => frame.type === 'host_uri_result' && frame.id === 'host-uri-drive-segment-write'));
      const nonArtifactResult = child.frames.find((frame) => frame.type === 'host_uri_result' && frame.id === 'host-uri-non-artifact-write')!;
      const traversalResult = child.frames.find((frame) => frame.type === 'host_uri_result' && frame.id === 'host-uri-traversal-write')!;
      const driveSegmentResult = child.frames.find((frame) => frame.type === 'host_uri_result' && frame.id === 'host-uri-drive-segment-write')!;
      const auditJson = readHostUriAuditRecords(backend).map(record => JSON.stringify(record)).join('\n');

      expect(nonArtifactResult.isError).toBe(true);
      expect(nonArtifactResult.error).toContain('Only craft-session://current/artifacts/<name> supports write operations');
      expect(traversalResult.isError).toBe(true);
      expect(traversalResult.error).toContain('Artifact path cannot contain . or .. segments');
      expect(driveSegmentResult.isError).toBe(true);
      expect(driveSegmentResult.error).toContain('Artifact path segments cannot contain colons');
      expect(existsSync(resolve(getSessionDataPath(tempRoot, 'test-session-id'), 'omp-artifacts', 'escape.txt'))).toBe(false);
      expect(existsSync(resolve(getSessionDataPath(tempRoot, 'test-session-id'), 'omp-artifacts', 'reports', 'escape.txt'))).toBe(false);
      expect(auditJson).toContain('"allowed":false');
      expect(auditJson).not.toContain('do not write me');
      expect(auditJson).not.toContain('do not write me either');
    } finally {
      backend.destroy();
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('applies Craft permission decisions to OMP host URI artifact writes', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'omp-rpc-host-uri-'));
    const permissionRequests: Array<{ requestId: string; toolName: string; impact?: string }> = [];
    const { backend, children } = createHarness({ workspaceRootPath: tempRoot });
    try {
      backend.setPermissionMode('ask');
      backend.onPermissionRequest = (request) => {
        permissionRequests.push(request);
        backend.respondToPermission(request.requestId, false, false);
      };
      const child = await startReady(backend, children);

      child.emitFrame({
        type: 'host_uri_request',
        id: 'host-uri-denied-write',
        operation: 'write',
        url: 'craft-session://current/artifacts/denied.txt',
        content: 'denied content',
      });

      await waitFor(() => child.frames.some((frame) => frame.type === 'host_uri_result' && frame.id === 'host-uri-denied-write'));
      const resultFrame = child.frames.find((frame) => frame.type === 'host_uri_result' && frame.id === 'host-uri-denied-write')!;
      const expectedPath = resolve(getSessionDataPath(tempRoot, 'test-session-id'), 'omp-artifacts', 'denied.txt');

      expect(permissionRequests).toHaveLength(1);
      expect(permissionRequests[0]).toMatchObject({
        toolName: 'omp_host_uri_write',
      });
      expect(permissionRequests[0]?.impact).toContain('denied.txt');
      expect(resultFrame.isError).toBe(true);
      expect(resultFrame.error).toContain('Host URI write denied by permission policy');
      expect(existsSync(expectedPath)).toBe(false);
      expect(readHostUriAuditRecords(backend).at(-1)).toMatchObject({
        operation: 'write',
        allowed: false,
        relativePath: 'denied.txt',
        error: 'permission_denied',
      });
    } finally {
      backend.destroy();
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('denies OMP host URI artifact writes in ask mode when no permission handler is available', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'omp-rpc-host-uri-'));
    const { backend, children } = createHarness({ workspaceRootPath: tempRoot });
    try {
      backend.setPermissionMode('ask');
      const child = await startReady(backend, children);

      child.emitFrame({
        type: 'host_uri_request',
        id: 'host-uri-no-permission-handler',
        operation: 'write',
        url: 'craft-session://current/artifacts/no-handler.txt',
        content: 'should not write',
      });

      await waitFor(() => child.frames.some((frame) => frame.type === 'host_uri_result' && frame.id === 'host-uri-no-permission-handler'));
      const resultFrame = child.frames.find((frame) => frame.type === 'host_uri_result' && frame.id === 'host-uri-no-permission-handler')!;
      const expectedPath = resolve(getSessionDataPath(tempRoot, 'test-session-id'), 'omp-artifacts', 'no-handler.txt');

      expect(resultFrame.isError).toBe(true);
      expect(resultFrame.error).toContain('Host URI write denied by permission policy');
      expect(existsSync(expectedPath)).toBe(false);
      expect(readHostUriAuditRecords(backend).at(-1)).toMatchObject({
        operation: 'write',
        allowed: false,
        relativePath: 'no-handler.txt',
        error: 'permission_denied',
      });
    } finally {
      backend.destroy();
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('cancels pending OMP host URI artifact writes without writing files', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'omp-rpc-host-uri-'));
    const permissionRequests: Array<{ requestId: string; toolName: string }> = [];
    const { backend, children } = createHarness({ workspaceRootPath: tempRoot });
    try {
      backend.setPermissionMode('ask');
      backend.onPermissionRequest = (request) => {
        permissionRequests.push(request);
      };
      const child = await startReady(backend, children);

      child.emitFrame({
        type: 'host_uri_request',
        id: 'host-uri-cancel-write',
        operation: 'write',
        url: 'craft-session://current/artifacts/cancelled.txt',
        content: 'cancelled content',
      });
      await waitFor(() => permissionRequests.length === 1);

      child.emitFrame({
        type: 'host_uri_cancel',
        id: 'host-uri-cancel-frame',
        targetId: 'host-uri-cancel-write',
      });

      await waitFor(() => child.frames.some((frame) => frame.type === 'host_uri_result' && frame.id === 'host-uri-cancel-write'));
      await waitFor(() => readHostUriAuditRecords(backend).some(record => record.error === 'cancelled'));
      const resultFrame = child.frames.find((frame) => frame.type === 'host_uri_result' && frame.id === 'host-uri-cancel-write')!;
      const expectedPath = resolve(getSessionDataPath(tempRoot, 'test-session-id'), 'omp-artifacts', 'cancelled.txt');

      expect(resultFrame.isError).toBe(true);
      expect(resultFrame.error).toContain('cancelled');
      expect(existsSync(expectedPath)).toBe(false);
      expect((backend as any).pendingHostToolPermissions.size).toBe(0);
    } finally {
      backend.destroy();
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('returns explicit errors for unknown Craft session URI paths and writes', async () => {
    const { backend, children } = createHarness();
    const child = await startReady(backend, children);

    child.emitFrame({
      type: 'host_uri_request',
      id: 'host-uri-unknown',
      operation: 'read',
      url: 'craft-session://current/secrets',
    });
    child.emitFrame({
      type: 'host_uri_request',
      id: 'host-uri-write',
      operation: 'write',
      url: 'craft-session://current/todos',
      content: '{"phases":[]}',
    });

    await waitFor(() => child.frames.some((frame) => frame.type === 'host_uri_result' && frame.id === 'host-uri-unknown'));
    await waitFor(() => child.frames.some((frame) => frame.type === 'host_uri_result' && frame.id === 'host-uri-write'));
    const unknownResult = child.frames.find((frame) => frame.type === 'host_uri_result' && frame.id === 'host-uri-unknown')!;
    const writeResult = child.frames.find((frame) => frame.type === 'host_uri_result' && frame.id === 'host-uri-write')!;

    expect(unknownResult.isError).toBe(true);
    expect(unknownResult.error).toContain('Unknown craft-session path');
    expect(writeResult.isError).toBe(true);
    expect(writeResult.error).toContain('Only craft-session://current/artifacts/<name> supports write operations');
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

  it('negotiates native Plan Mode, applies pushed state, and returns correlated review decisions', async () => {
    const { backend, children } = createHarness();
    const child = await startReady(backend, children, { capabilities: { planMode: true } });

    expect(backend.getOmpControlState().plan).toMatchObject({
      supported: true,
      state: { enabled: false, phase: 'inactive' },
    });

    const enable = backend.setOmpPlanMode(true);
    await waitFor(() => child.frames.some((frame) => frame.type === 'set_plan_mode'));
    const enableFrame = child.frames.findLast((frame) => frame.type === 'set_plan_mode')!;
    expect(enableFrame.enabled).toBe(true);
    child.emitFrame({
      type: 'response',
      id: enableFrame.id,
      command: 'set_plan_mode',
      success: true,
      data: { enabled: true, phase: 'planning', planFilePath: 'local://PLAN.md' },
    });
    await enable;
    expect(backend.getOmpControlState().plan.state).toEqual({
      enabled: true,
      phase: 'planning',
      planFilePath: 'local://PLAN.md',
    });

    child.emitFrame({
      type: 'plan_mode_state_update',
      state: { enabled: true, phase: 'awaiting_review', planFilePath: 'local://ship-plan.md' },
    });
    await waitFor(() => backend.getOmpControlState().plan.state.phase === 'awaiting_review');

    const review = backend.respondToOmpPlanReview('review-1', {
      action: 'refine',
      feedback: 'Please add the release test.',
    });
    await waitFor(() => child.frames.some((frame) => frame.type === 'plan_review_result'));
    const reviewFrame = child.frames.findLast((frame) => frame.type === 'plan_review_result')!;
    expect(reviewFrame).toMatchObject({
      requestId: 'review-1',
      action: 'refine',
      feedback: 'Please add the release test.',
    });
    child.emitFrame({
      type: 'response',
      id: reviewFrame.id,
      command: 'plan_review_result',
      success: true,
      data: { requestId: 'review-1', accepted: true },
    });
    await review;
    backend.destroy();
  });

  it('publishes native Goal and Loop state and routes structured controls', async () => {
    const { backend, children } = createHarness();
    const child = await startReady(backend, children, { capabilities: { goalMode: true, loopMode: true } });

    expect(backend.getOmpControlState().goal).toMatchObject({
      supported: true,
      state: { enabled: false, paused: false },
    });
    expect(backend.getOmpControlState().loop).toMatchObject({
      supported: true,
      state: { enabled: false, status: 'disabled' },
    });

    const setGoal = backend.setOmpGoal('Finish desktop parity', 2000);
    await waitFor(() => child.frames.some((frame) => frame.type === 'set_goal'));
    const goalFrame = child.frames.findLast((frame) => frame.type === 'set_goal')!;
    expect(goalFrame).toMatchObject({ objective: 'Finish desktop parity', tokenBudget: 2000 });
    child.emitFrame({
      type: 'response',
      id: goalFrame.id,
      command: 'set_goal',
      success: true,
      data: {
        enabled: true,
        paused: false,
        goal: {
          id: 'goal-1',
          objective: 'Finish desktop parity',
          status: 'active',
          tokenBudget: 2000,
          tokensUsed: 0,
          timeUsedSeconds: 0,
          createdAt: 1,
          updatedAt: 1,
        },
      },
    });
    await setGoal;
    expect(backend.getOmpControlState().goal.state.goal?.objective).toBe('Finish desktop parity');

    const setLoop = backend.setOmpLoop(true);
    await waitFor(() => child.frames.some((frame) => frame.type === 'set_loop'));
    const loopFrame = child.frames.findLast((frame) => frame.type === 'set_loop')!;
    child.emitFrame({
      type: 'response',
      id: loopFrame.id,
      command: 'set_loop',
      success: true,
      data: { enabled: true, status: 'waiting_for_prompt' },
    });
    await setLoop;
    expect(backend.getOmpControlState().loop.state).toEqual({ enabled: true, status: 'waiting_for_prompt' });

    child.emitFrame({
      type: 'loop_mode_state_update',
      state: { enabled: true, status: 'running', prompt: 'check again', remaining: 3 },
    });
    await waitFor(() => backend.getOmpControlState().loop.state.status === 'running');
    expect(backend.getOmpControlState().loop.state.remaining).toBe(3);
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

  it('reconciles OMP-native model and thinking changes back to Craft callbacks', async () => {
    const models: string[] = [];
    const thinking: ThinkingLevel[] = [];
    const { backend, children } = createHarness({
      model: 'omp/default',
      onModelUpdate: (model) => models.push(model),
      onThinkingLevelUpdate: (level) => thinking.push(level),
    });
    const child = await startReady(backend, children);

    child.emitFrame({
      type: 'config_update',
      config: { model: 'kimi-code/kimi-for-coding', thinkingLevel: 'minimal' },
    });
    await waitFor(() => models.length === 1 && thinking.length === 1);

    expect(backend.getModel()).toBe('kimi-code/kimi-for-coding');
    expect(backend.getThinkingLevel()).toBe('minimal');
    expect(models).toEqual(['kimi-code/kimi-for-coding']);
    expect(thinking).toEqual(['minimal']);
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

  it('subscribes to OMP subagents and hydrates read-only subagent Todo phases from transcripts', async () => {
    const { backend, children } = createHarness();
    const child = await startReady(backend, children);
    const subagentTodo: OmpTodoPhase = {
      name: 'Worker',
      tasks: [{ content: 'Inspect protocol', status: 'completed' }],
    };
    child.subagents = [
      {
        id: 'sub-1',
        index: 0,
        agent: 'reviewer',
        agentSource: 'project',
        description: 'Protocol reviewer',
        status: 'running',
        task: 'Review subagent Todo bridge',
        assignment: 'Check protocol coverage',
        sessionFile: 'D:/sessions/sub-1.jsonl',
        lastUpdate: 123,
      },
    ];
    child.subagentEntries.set('sub-1', [
      {
        type: 'message',
        message: {
          role: 'toolResult',
          toolName: 'todo',
          details: { phases: [subagentTodo] },
        },
      },
    ]);

    child.emitFrame({
      type: 'subagent_progress',
      payload: {
        index: 0,
        agent: 'reviewer',
        agentSource: 'project',
        task: 'Review subagent Todo bridge',
        assignment: 'Check protocol coverage',
        sessionFile: 'D:/sessions/sub-1.jsonl',
        progress: {
          id: 'sub-1',
          status: 'running',
          currentTool: 'todo',
          requests: 2,
          tokens: 1500,
        },
      },
    });
    await waitFor(() => backend.getOmpTodoState().subagents[0]?.progress?.currentTool === 'todo');

    await (backend as any).refreshOmpSubagents();
    await waitFor(() => child.frames.some((frame) => frame.type === 'set_subagent_subscription'));
    expect(child.frames.some((frame) => frame.type === 'get_subagent_messages')).toBe(true);
    expect(backend.getOmpTodoState().subagents[0]?.todoPhases).toEqual([subagentTodo]);

    child.emitFrame({
      type: 'subagent_lifecycle',
      payload: {
        id: 'sub-1',
        index: 0,
        agent: 'reviewer',
        agentSource: 'project',
        status: 'completed',
      },
    });
    await waitFor(() => backend.getOmpTodoState().subagents.length === 0);
    backend.destroy();
  });

  it('refreshOmpSubagents populates subagentState and emits onSubagentStateChange', async () => {
    const { backend, children } = createHarness();
    const child = await startReady(backend, children);
    child.subagents = [
      {
        id: 'sub-2',
        index: 1,
        agent: 'explore',
        agentSource: 'bundled',
        description: 'Explore agent',
        status: 'running',
        task: 'Explore the codebase',
        sessionFile: 'D:/sessions/sub-2.jsonl',
        lastUpdate: 1,
      },
    ];

    const changes: unknown[] = [];
    backend.onSubagentStateChange = (state) => changes.push(state);
    await backend.refreshOmpSubagents();

    const state = backend.getOmpSubagentState();
    expect(state.available).toBe(true);
    expect(state.subagents).toHaveLength(1);
    expect(state.subagents[0]!.id).toBe('sub-2');
    expect(changes.length).toBeGreaterThanOrEqual(1);
    backend.destroy();
  });

  it('loadOmpSubagentMessages appends transcript entries and records cursor', async () => {
    const { backend, children } = createHarness();
    const child = await startReady(backend, children);
    child.subagents = [
      {
        id: 'sub-3',
        index: 0,
        agent: 'reviewer',
        agentSource: 'project',
        description: 'Reviewer',
        status: 'running',
        sessionFile: 'D:/sessions/sub-3.jsonl',
        lastUpdate: 1,
      },
    ];
    child.subagentEntries.set('sub-3', [
      { type: 'message', role: 'user' },
      { type: 'message', role: 'assistant' },
    ]);

    await backend.refreshOmpSubagents();
    await backend.loadOmpSubagentMessages('sub-3');

    const subagent = backend.getOmpSubagentState().subagents[0]!;
    expect(subagent.transcriptEntries).toHaveLength(2);
    expect(subagent.transcriptMessages).toHaveLength(0);
    expect(subagent.cursor).toBeDefined();
    expect(subagent.cursor!.fromByte).toBe(0);
    expect(subagent.cursor!.nextByte).toBe(100);
    expect(subagent.cursor!.hasMore).toBe(false);
    backend.destroy();
  });

  it('subagent_lifecycle frame adds a running subagent and completion removes it', async () => {
    const { backend, children } = createHarness();
    const child = await startReady(backend, children);

    backend.onSubagentStateChange = () => {};
    child.emitFrame({
      type: 'subagent_lifecycle',
      payload: {
        id: 'sub-4',
        index: 0,
        agent: 'fixer',
        agentSource: 'bundled',
        status: 'started',
        parentToolCallId: 'toolu-1',
      },
    });

    await waitFor(() => backend.getOmpSubagentState().subagents.length === 1);
    expect(backend.getOmpSubagentState().subagents[0]!.parentToolCallId).toBe('toolu-1');

    child.emitFrame({
      type: 'subagent_lifecycle',
      payload: {
        id: 'sub-4',
        index: 0,
        agent: 'fixer',
        agentSource: 'bundled',
        status: 'completed',
      },
    });
    await waitFor(() => backend.getOmpSubagentState().subagents.length === 0);
    backend.destroy();
  });

  it('subagent_progress frame upserts progress fields', async () => {
    const { backend, children } = createHarness();
    const child = await startReady(backend, children);
    backend.onSubagentStateChange = () => {};

    child.emitFrame({
      type: 'subagent_progress',
      payload: {
        index: 0,
        agent: 'writer',
        agentSource: 'project',
        task: 'Write docs',
        assignment: 'Draft API docs',
        sessionFile: 'D:/sessions/sub-5.jsonl',
        parentToolCallId: 'toolu-2',
        progress: {
          id: 'sub-5',
          status: 'running',
          currentTool: 'write',
          requests: 3,
          tokens: 900,
        },
      },
    });

    await waitFor(() => backend.getOmpSubagentState().subagents.length === 1);
    const subagent = backend.getOmpSubagentState().subagents[0]!;
    expect(subagent.id).toBe('sub-5');
    expect(subagent.progress?.currentTool).toBe('write');
    expect(subagent.progress?.requests).toBe(3);
    backend.destroy();
  });

  it('subscribes to raw subagent events and appends them to the detail transcript', async () => {
    const { backend, children } = createHarness();
    const child = await startReady(backend, children);

    await waitFor(() => child.frames.some((frame) => frame.type === 'set_subagent_subscription'));
    expect(child.frames.find((frame) => frame.type === 'set_subagent_subscription')?.level).toBe('events');

    child.emitFrame({
      type: 'subagent_lifecycle',
      payload: {
        id: 'sub-events',
        index: 0,
        agent: 'reviewer',
        agentSource: 'project',
        status: 'started',
      },
    });
    await waitFor(() => backend.getOmpSubagentState().subagents.some((subagent) => subagent.id === 'sub-events'));

    child.emitFrame({
      type: 'subagent_event',
      payload: {
        id: 'sub-events',
        event: {
          type: 'message_update',
          messageId: 'msg-1',
          assistant_message_event: { type: 'text_delta', delta: 'hi' },
        },
      },
    });

    await waitFor(() => backend.getOmpSubagentState().subagents[0]?.transcriptEntries.length === 1);
    expect(backend.getOmpSubagentState().subagents[0]?.transcriptEntries[0]).toMatchObject({
      type: 'message_update',
      messageId: 'msg-1',
    });
    backend.destroy();
  });

  it('falls back to progress subagent subscription when raw events are unavailable', async () => {
    const { backend, children } = createHarness();
    const ready = (backend as any).ensureSubprocess() as Promise<void>;
    const child = children[0]!;
    child.failSubagentEventSubscription = true;
    child.subagents = [
      {
        id: 'sub-fallback',
        index: 0,
        agent: 'reviewer',
        agentSource: 'project',
        description: 'Compatibility fallback reviewer',
        status: 'running',
        task: 'Review compatibility fallback',
        sessionFile: 'D:/sessions/sub-fallback.jsonl',
        lastUpdate: 1,
      },
    ];

    await respondReady(child, 'session-subagent-fallback');
    await ready;

    await waitFor(() => child.frames.some(
      (frame) => frame.type === 'set_subagent_subscription' && frame.level === 'progress',
    ));
    await waitFor(() => backend.getOmpSubagentState().subagents[0]?.id === 'sub-fallback');
    expect(child.frames.filter((frame) => frame.type === 'set_subagent_subscription').map((frame) => frame.level))
      .toEqual(['events', 'progress']);
    expect(backend.getOmpSubagentState().available).toBe(true);
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

describe('OmpRpcBackend login providers', () => {
  it('returns OMP login providers', async () => {
    const { backend, children } = createHarness();
    const child = await startReady(backend, children);
    child.loginProviders = [
      { id: 'deepseek', name: 'DeepSeek', available: true, authenticated: false },
      { id: 'anthropic', name: 'Anthropic', available: true, authenticated: true },
    ];

    const providers = await backend.getOmpLoginProviders();
    expect(providers).toHaveLength(2);
    expect(providers[0]?.id).toBe('deepseek');
    expect(providers[1]?.authenticated).toBe(true);
    backend.destroy();
  });

  it('starts a login flow and surfaces the open_url payload', async () => {
    const { backend, children } = createHarness();
    const child = await startReady(backend, children);
    const calls: Array<{ url?: string; launchUrl?: string; instructions?: string }> = [];

    const loginPromise = backend.loginOmpProvider('deepseek', {
      onOpenUrl: (payload) => calls.push(payload),
    });
    await waitFor(() => child.frames.some((frame) => frame.type === 'login'));
    const loginRequest = child.frames.findLast((frame) => frame.type === 'login')!;
    child.emitFrame({
      type: 'extension_ui_request',
      id: `${loginRequest.id}-url`,
      method: 'open_url',
      url: 'https://auth.example.com',
      instructions: 'Open the URL',
    });
    child.emitFrame({
      type: 'response',
      id: loginRequest.id,
      command: 'login',
      success: true,
      data: { providerId: 'deepseek' },
    });

    const result = await loginPromise;
    expect(result.providerId).toBe('deepseek');
    expect(result.openUrl).toBe('https://auth.example.com');
    expect(result.instructions).toBe('Open the URL');
    expect(calls).toHaveLength(1);
    backend.destroy();
  });

  it('rejects login when OMP returns an invalid result', async () => {
    const { backend, children } = createHarness({ requestTimeoutMs: 200 });
    const child = await startReady(backend, children);

    const loginPromise = backend.loginOmpProvider('deepseek');
    await waitFor(() => child.frames.some((frame) => frame.type === 'login'));
    const loginRequest = child.frames.findLast((frame) => frame.type === 'login')!;
    child.emitFrame({ type: 'response', id: loginRequest.id, command: 'login', success: true, data: {} });

    await expect(loginPromise).rejects.toThrow('invalid result');
    backend.destroy();
  });
});
