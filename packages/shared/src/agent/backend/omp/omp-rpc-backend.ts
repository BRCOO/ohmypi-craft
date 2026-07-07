import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import readline from 'node:readline';

import type { AgentEvent, ExtensionUiResponse } from '@craft-agent/core/types';

import { BaseAgent } from '../../base-agent.ts';
import type { LLMQueryRequest, LLMQueryResult } from '../../llm-tool.ts';
import type { ThinkingLevel } from '../../thinking-levels.ts';
import type { FileAttachment } from '../../../utils/files.ts';
import type { ChatOptions, BackendConfig } from '../types.ts';
import { AbortReason } from '../types.ts';
import { EventQueue } from '../event-queue.ts';
import { prepareOmpPrompt } from './omp-rpc-attachments.ts';
import { resolveOmpRuntimeCommand } from './omp-command.ts';
import { OmpRpcEventAdapter } from './omp-rpc-adapter.ts';
import {
  OmpRpcDiagnostics,
  type OmpRpcDiagnosticsSnapshot,
} from './omp-rpc-diagnostics.ts';
import {
  craftThinkingLevelToOmp,
  ompThinkingLevelToCraft,
  parseOmpPromptResponseData,
  parseOmpSessionState,
  type OmpRpcCommand,
  type OmpRpcExtensionUiResponse,
  type OmpRpcSessionState,
  type OmpThinkingLevel,
} from './omp-rpc-protocol.ts';

export const DEFAULT_OMP_MODEL = 'omp/default';

export interface OmpModelSelection {
  provider: string;
  modelId: string;
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
  command: string;
  startedAt: number;
}

interface ActiveTurn {
  requestId: string;
  processGeneration: number;
  finished: boolean;
}

export interface OmpRpcBackendOptions {
  /** Test seam for deterministic subprocess lifecycle coverage. */
  spawnProcess?: typeof spawn;
  /** Override the startup timeout without changing the production default. */
  readyTimeoutMs?: number;
  /** Override correlated RPC response timeout for deterministic tests. */
  requestTimeoutMs?: number;
  /** Test seam for path-only image attachments. */
  attachmentReadFile?: (path: string) => Buffer;
}

export function resolveOmpModelSelection(model: string | undefined): OmpModelSelection | null {
  const trimmed = model?.trim();
  if (!trimmed || trimmed === DEFAULT_OMP_MODEL) return null;

  const separator = trimmed.includes('/') ? '/' : trimmed.includes(':') ? ':' : null;
  if (!separator) return null;

  const [provider, ...modelParts] = trimmed.split(separator);
  const modelId = modelParts.join(separator);
  if (!provider || !modelId) return null;
  if (provider === 'omp' && modelId === 'default') return null;

  return { provider, modelId };
}

export function buildOmpExtensionUiResponseFrame(
  requestId: string,
  response: ExtensionUiResponse,
): OmpRpcExtensionUiResponse {
  if ('value' in response) {
    return {
      type: 'extension_ui_response',
      id: requestId,
      value: response.value,
    };
  }

  if ('cancelled' in response) {
    return {
      type: 'extension_ui_response',
      id: requestId,
      cancelled: true,
      ...(response.timedOut ? { timedOut: true } : {}),
    };
  }

  return {
    type: 'extension_ui_response',
    id: requestId,
    confirmed: response.confirmed,
  };
}

export class OmpRpcBackend extends BaseAgent {
  protected backendName = 'OMP';

  private child: ChildProcessWithoutNullStreams | null = null;
  private stdoutReader: readline.Interface | null = null;
  private eventQueue = new EventQueue();
  private adapter = new OmpRpcEventAdapter();
  private diagnostics = new OmpRpcDiagnostics();
  private pending = new Map<string, PendingRequest>();
  private requestCounter = 0;
  private readyPromise: Promise<void> | null = null;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((error: Error) => void) | null = null;
  private readyTimer: ReturnType<typeof setTimeout> | null = null;
  private _isProcessing = false;
  private abortReason: AbortReason | undefined;
  private recentStderr = '';
  private selectedModelKey: string | null = null;
  private processGeneration = 0;
  private readySyncGeneration: number | null = null;
  private sessionState: OmpRpcSessionState | null = null;
  private remoteThinkingLevel: OmpThinkingLevel | null = null;
  private thinkingLevelUpdate: Promise<void> | null = null;
  private activeTurn: ActiveTurn | null = null;
  private readonly spawnProcess: typeof spawn;
  private readonly readyTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly attachmentReadFile?: (path: string) => Buffer;

  constructor(config: BackendConfig, options: OmpRpcBackendOptions = {}) {
    super(config, DEFAULT_OMP_MODEL);
    this._supportsBranching = false;
    this.spawnProcess = options.spawnProcess ?? spawn;
    this.readyTimeoutMs = options.readyTimeoutMs ?? 15_000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.attachmentReadFile = options.attachmentReadFile;
  }

  protected override debug(message: string): void {
    this.onDebug?.(`[omp] ${message}`);
  }

  override setThinkingLevel(level: ThinkingLevel): void {
    super.setThinkingLevel(level);
    if (!this.child || this._isProcessing) return;
    const mapped = craftThinkingLevelToOmp(level);
    this.setRemoteThinkingLevel(mapped).catch((error) => {
      this.remoteThinkingLevel = null;
      this.debug(`Thinking level update failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  protected async *chatImpl(
    message: string,
    attachments?: FileAttachment[],
    options?: ChatOptions,
  ): AsyncGenerator<AgentEvent> {
    this._isProcessing = true;
    this.abortReason = undefined;
    this.eventQueue.reset();
    this.adapter.startTurn();
    let shouldRestoreThinkingLevel = false;

    this.emitAutomationEvent('UserPromptSubmit', {
      hook_event_name: 'UserPromptSubmit',
      prompt: message,
    });

    try {
      const prepared = prepareOmpPrompt(message, attachments, {
        readFile: this.attachmentReadFile,
      });
      for (const warning of prepared.warnings) {
        this.eventQueue.enqueue({ type: 'info', message: warning });
      }

      await this.ensureSubprocess();
      if (!this._isProcessing) {
        for await (const event of this.eventQueue.drain()) yield event;
        return;
      }
      await this.ensureModelSelected();
      if (!this._isProcessing) {
        for await (const event of this.eventQueue.drain()) yield event;
        return;
      }
      const persistentThinkingLevel = craftThinkingLevelToOmp(this.getThinkingLevel());
      await this.setRemoteThinkingLevel(persistentThinkingLevel);
      const overrideThinkingLevel = options?.thinkingOverride
        ? craftThinkingLevelToOmp(options.thinkingOverride)
        : undefined;
      shouldRestoreThinkingLevel = !!overrideThinkingLevel
        && overrideThinkingLevel !== persistentThinkingLevel;
      if (overrideThinkingLevel) {
        await this.setRemoteThinkingLevel(overrideThinkingLevel);
      }

      const promptRequest = this.createRequest({
        type: 'prompt',
        message: prepared.message,
        ...(prepared.images ? { images: prepared.images } : {}),
        ...(options?.streamingBehavior ? { streamingBehavior: options.streamingBehavior } : {}),
      });
      const activeTurn: ActiveTurn = {
        requestId: promptRequest.id,
        processGeneration: this.processGeneration,
        finished: false,
      };
      this.activeTurn = activeTurn;

      promptRequest.promise.then((data) => {
        const promptResult = parseOmpPromptResponseData(data);
        if (promptResult?.agentInvoked === false) {
          this.finishTurn(promptRequest.id);
        }
      }).catch((error) => {
        // Child failure already owns turn termination. Its pending rejection reaches
        // this catch on a later microtask; do not emit a duplicate error/complete pair.
        if (this.eventQueue.isComplete || activeTurn.finished) return;
        const msg = error instanceof Error ? error.message : String(error);
        this.eventQueue.enqueue({ type: 'error', message: `OMP prompt failed: ${msg}` });
        this.finishTurn(promptRequest.id);
      });

      for await (const event of this.eventQueue.drain()) {
        if (event.type === 'tool_start' && event.toolName === 'Read') {
          this.prerequisiteManager.trackReadTool(event.input as Record<string, unknown>);
        }

        if (event.type === 'tool_result') {
          const hookEvent = event.isError ? 'PostToolUseFailure' : 'PostToolUse';
          this.emitAutomationEvent(hookEvent, {
            hook_event_name: hookEvent,
            tool_name: event.toolName ?? 'unknown',
            tool_input: event.input,
            ...(event.isError
              ? { error: event.result }
              : { tool_response: event.result }),
          });
        }

        yield event;
      }

    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      yield { type: 'error', message: `OMP backend error: ${msg}` };
      yield { type: 'complete' };
    } finally {
      if (shouldRestoreThinkingLevel && this.child) {
        try {
          await this.setRemoteThinkingLevel(craftThinkingLevelToOmp(this.getThinkingLevel()));
        } catch (error) {
          this.remoteThinkingLevel = null;
          this.debug(`Thinking override restore failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      this._isProcessing = false;
      if (this.activeTurn?.finished) this.activeTurn = null;
    }
  }

  async abort(reason?: string): Promise<void> {
    this.debug(`Abort requested${reason ? `: ${reason}` : ''}`);
    this.emitAutomationEvent('Stop', { hook_event_name: 'Stop' });
    this._isProcessing = false;
    this.send({ type: 'abort' }).catch((error) => {
      this.debug(`Abort command failed: ${error instanceof Error ? error.message : String(error)}`);
    });
    this.finishTurnOrIdle();
  }

  forceAbort(reason: AbortReason): void {
    this.abortReason = reason;
    this._isProcessing = false;
    this.emitAutomationEvent('Stop', { hook_event_name: 'Stop' });
    this.finishTurnOrIdle();

    if (reason !== AbortReason.PlanSubmitted && reason !== AbortReason.AuthRequest) {
      this.send({ type: 'abort' }).catch((error) => {
        this.debug(`Force-abort command failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
  }

  override redirect(message: string): boolean {
    if (!this._isProcessing || !this.child) {
      this.forceAbort(AbortReason.Redirect);
      return false;
    }

    this.send({ type: 'steer', message }).catch((error) => {
      this.debug(`Steer command failed: ${error instanceof Error ? error.message : String(error)}`);
    });
    return true;
  }

  isProcessing(): boolean {
    return this._isProcessing;
  }

  respondToPermission(requestId: string, allowed: boolean, _alwaysAllow?: boolean): void {
    this.send({
      type: 'permission_response',
      requestId,
      decision: allowed ? 'approved' : 'denied',
    }).catch((error) => {
      this.debug(`Permission response failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  respondToExtensionUiRequest(requestId: string, response: ExtensionUiResponse): void {
    this.writeSideChannel(buildOmpExtensionUiResponseFrame(requestId, response)).catch((error) => {
      this.debug(`Extension UI response failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  async runMiniCompletion(prompt: string): Promise<string | null> {
    if (this._isProcessing) {
      this.debug('runMiniCompletion skipped while OMP is processing');
      return null;
    }

    let streamed = '';
    let completed = '';
    for await (const event of this.chat(prompt)) {
      if (event.type === 'text_delta') streamed += event.text;
      if (event.type === 'text_complete') completed = event.text;
      if (event.type === 'error') {
        this.debug(`runMiniCompletion stream error: ${event.message}`);
      }
    }

    const text = (completed || streamed).trim();
    return text || null;
  }

  async queryLlm(request: LLMQueryRequest): Promise<LLMQueryResult> {
    const prompt = [
      request.systemPrompt ? `System: ${request.systemPrompt}` : '',
      request.prompt,
    ].filter(Boolean).join('\n\n');

    const text = await this.runMiniCompletion(prompt);
    return {
      text: text ?? '',
      model: request.model ?? this._model,
    };
  }

  override destroy(): void {
    this.killSubprocess();
    super.destroy();
  }

  getRecentStderr(): string {
    return this.recentStderr;
  }

  getDiagnostics(): OmpRpcDiagnosticsSnapshot {
    return this.diagnostics.snapshot(this.recentStderr);
  }

  private async ensureSubprocess(): Promise<void> {
    if (this.child && this.readyPromise) {
      return this.readyPromise;
    }

    this.spawnSubprocess();
    return this.readyPromise!;
  }

  private async ensureModelSelected(): Promise<void> {
    const selection = resolveOmpModelSelection(this._model);
    if (!selection) return;

    const key = `${selection.provider}/${selection.modelId}`;
    if (this.selectedModelKey === key) return;

    await this.send({
      type: 'set_model',
      provider: selection.provider,
      modelId: selection.modelId,
    });
    this.selectedModelKey = key;
    this.debug(`Selected OMP model: ${key}`);
  }

  private async setRemoteThinkingLevel(level: OmpThinkingLevel): Promise<void> {
    if (this.thinkingLevelUpdate) await this.thinkingLevelUpdate;
    if (this.remoteThinkingLevel === level) return;
    const update = this.send({ type: 'set_thinking_level', level }).then(() => {
      this.remoteThinkingLevel = level;
      if (this.sessionState) this.sessionState.thinkingLevel = level;
      this.debug(`Selected OMP thinking level: ${level}`);
    });
    this.thinkingLevelUpdate = update;
    try {
      await update;
    } finally {
      if (this.thinkingLevelUpdate === update) this.thinkingLevelUpdate = null;
    }
  }

  private spawnSubprocess(): void {
    const generation = ++this.processGeneration;
    const runtime = this.config.runtime ?? {};
    const resolved = resolveOmpRuntimeCommand({
      configuredCommand: runtime.ompCommand,
      envCommand: process.env.OMP_COMMAND,
    });
    const cwd = this.workingDirectory || this.config.workspace.rootPath || process.cwd();
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...this.config.envOverrides,
    };

    this.debug(`Starting OMP RPC: ${resolved.command} ${[...resolved.args, '--mode', 'rpc'].join(' ')}`);
    this.diagnostics.startProcess(generation, {
      executable: resolved.command,
      source: resolved.source,
    });

    const child = this.spawnProcess(resolved.command, [...resolved.args, '--mode', 'rpc'], {
      cwd,
      env,
      windowsHide: true,
    });

    this.child = child;
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
      this.readyTimer = setTimeout(() => {
        this.handleChildFailure(
          new Error('Timed out waiting for OMP ready frame'),
          generation,
          child,
        );
      }, this.readyTimeoutMs);
    });

    this.stdoutReader = readline.createInterface({ input: child.stdout });
    this.stdoutReader.on('line', (line) => this.handleLine(line, generation));

    child.stderr.on('data', (chunk) => {
      if (generation !== this.processGeneration || child !== this.child) return;
      const text = String(chunk);
      this.appendRecentStderr(text);
      this.debug(`stderr: ${text.trim().slice(0, 500)}`);
    });

    child.on('error', (error) => {
      this.handleChildFailure(error, generation, child);
    });

    child.on('exit', (code, signal) => {
      if (generation !== this.processGeneration || child !== this.child) return;
      this.diagnostics.recordExit(code, signal);
      const reason = signal ? `signal ${signal}` : `code ${code ?? 0}`;
      this.handleChildFailure(new Error(`OMP exited with ${reason}`), generation, child);
    });
  }

  private handleLine(line: string, generation = this.processGeneration): void {
    if (generation !== this.processGeneration) return;
    if (!line.trim()) return;

    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(line) as Record<string, unknown>;
    } catch {
      this.diagnostics.recordMalformedLine();
      this.debug(`Ignoring non-JSON stdout: ${line.slice(0, 200)}`);
      return;
    }

    this.diagnostics.recordFrame(raw.type);
    const adapted = this.adapter.adaptFrame(raw);
    if (adapted.unknownFrameType) {
      const shouldLog = this.diagnostics.recordUnknownFrame(adapted.unknownFrameType, raw);
      if (shouldLog) {
        this.debug(
          `Ignoring unknown OMP frame ${adapted.unknownFrameType} with keys: ${Object.keys(raw).sort().join(', ')}`,
        );
      }
    }

    if (adapted.ready) {
      this.beginStateSynchronization(generation);
    }

    if (adapted.response) {
      const responseId = adapted.response.id;
      const pending = responseId ? this.pending.get(responseId) : undefined;
      if (pending) {
        this.pending.delete(responseId!);
        clearTimeout(pending.timer);
        this.diagnostics.recordResponse(responseId!, pending.command, pending.startedAt);
        if (adapted.response.success) {
          pending.resolve(adapted.response.data);
        } else {
          pending.reject(new Error(adapted.response.error ?? 'OMP RPC command failed'));
        }
      } else {
        this.diagnostics.recordUnmatchedResponse(responseId);
      }
    }

    if (adapted.thinkingLevel) {
      this.remoteThinkingLevel = adapted.thinkingLevel;
      if (this.sessionState) this.sessionState.thinkingLevel = adapted.thinkingLevel;
    }

    for (const event of adapted.events) {
      if (!this.eventQueue.isComplete) this.eventQueue.enqueue(event);
    }

    if (adapted.promptResult?.agentInvoked === false) {
      this.finishTurn(adapted.promptResult.id);
    }

    if (adapted.complete) {
      this.finishTurn();
    }
  }

  private send<T = unknown>(command: OmpRpcCommand): Promise<T> {
    return this.createRequest<T>(command).promise;
  }

  private createRequest<T = unknown>(command: OmpRpcCommand): { id: string; promise: Promise<T> } {
    const child = this.child;
    const stdin = child?.stdin;
    const generation = this.processGeneration;
    if (!stdin?.writable) {
      return {
        id: '',
        promise: Promise.reject(new Error('OMP RPC is not connected')),
      };
    }

    const id = `omp-${++this.requestCounter}`;
    const frame = { id, ...command };
    const commandName = command.type;
    const startedAt = this.diagnostics.recordRequest(commandName);

    const promise = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        this.diagnostics.recordTimeout();
        pending.reject(new Error(`OMP RPC command timed out: ${String(command.type ?? 'unknown')}`));
      }, this.requestTimeoutMs);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
        command: commandName,
        startedAt,
      });
      stdin.write(`${JSON.stringify(frame)}\n`, (error) => {
        if (error) {
          this.diagnostics.recordWriteFailure();
          if (generation === this.processGeneration && child === this.child) {
            const pending = this.pending.get(id);
            if (pending) clearTimeout(pending.timer);
            this.pending.delete(id);
          }
          reject(error);
        }
      });
    });
    return { id, promise };
  }

  private writeSideChannel(frame: OmpRpcExtensionUiResponse): Promise<void> {
    const stdin = this.child?.stdin;
    if (!stdin?.writable) {
      return Promise.reject(new Error('OMP RPC is not connected'));
    }

    return new Promise((resolve, reject) => {
      stdin.write(`${JSON.stringify(frame)}\n`, (error) => {
        if (error) {
          this.diagnostics.recordWriteFailure();
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  private resolveReady(): void {
    this.clearReadyTimer();
    this.readyResolve?.();
    this.readyResolve = null;
    this.readyReject = null;
  }

  private rejectReady(error: Error): void {
    this.clearReadyTimer();
    this.readyReject?.(error);
    this.readyResolve = null;
    this.readyReject = null;
  }

  private handleChildFailure(
    error: Error,
    generation = this.processGeneration,
    failedChild = this.child,
  ): void {
    if (generation !== this.processGeneration || failedChild !== this.child) return;
    this.debug(error.message);
    this.rejectReady(error);
    this.rejectPending(error);

    if (this._isProcessing && this.abortReason === undefined && this.activeTurn) {
      this.eventQueue.enqueue({ type: 'error', message: error.message });
      this.finishTurn();
    }
    this.cleanupChildHandles();
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.selectedModelKey = null;
  }

  private killSubprocess(): void {
    const error = new Error('OMP RPC backend destroyed');
    this.rejectReady(error);
    this.rejectPending(error);
    this.cleanupChildHandles();
  }

  private cleanupChildHandles(): void {
    // Invalidate stdout/error/exit callbacks captured by the old process.
    this.processGeneration += 1;
    this.clearReadyTimer();
    this.stdoutReader?.close();
    this.stdoutReader = null;

    const child = this.child;
    this.child = null;
    this.readyPromise = null;
    this.readyResolve = null;
    this.readyReject = null;
    this.readySyncGeneration = null;
    this.sessionState = null;
    this.remoteThinkingLevel = null;
    this.thinkingLevelUpdate = null;
    this.diagnostics.clearProcessState(this.processGeneration);

    if (child && !child.killed) {
      child.kill();
    }
  }

  private appendRecentStderr(text: string): void {
    this.recentStderr = (this.recentStderr + text).slice(-8192);
  }

  private clearReadyTimer(): void {
    if (!this.readyTimer) return;
    clearTimeout(this.readyTimer);
    this.readyTimer = null;
  }

  private beginStateSynchronization(generation: number): void {
    if (
      generation !== this.processGeneration
      || !this.child
      || this.readySyncGeneration === generation
      || !this.readyResolve
    ) {
      return;
    }

    const child = this.child;
    this.readySyncGeneration = generation;
    this.clearReadyTimer();

    this.send({ type: 'get_state' }).then((data) => {
      if (generation !== this.processGeneration || child !== this.child) return;
      const state = parseOmpSessionState(data);
      if (!state) {
        throw new Error('OMP get_state returned an invalid session state');
      }

      this.sessionState = state;
      this.remoteThinkingLevel = ompThinkingLevelToCraft(state.thinkingLevel)
        ? state.thinkingLevel as OmpThinkingLevel
        : null;
      this.config.onSdkSessionIdUpdate?.(state.sessionId);
      this.diagnostics.setSessionState(state);
      this.diagnostics.markReady();
      this.debug(`Synchronized OMP session: ${state.sessionId}`);
      this.resolveReady();
    }).catch((error) => {
      if (generation !== this.processGeneration || child !== this.child) return;
      const message = error instanceof Error ? error.message : String(error);
      this.handleChildFailure(
        new Error(`Failed to synchronize OMP state: ${message}`),
        generation,
        child,
      );
    });
  }

  private finishTurn(expectedRequestId?: string): boolean {
    const turn = this.activeTurn;
    if (
      !turn
      || turn.finished
      || turn.processGeneration !== this.processGeneration
      || (expectedRequestId !== undefined && expectedRequestId !== turn.requestId)
    ) {
      return false;
    }

    turn.finished = true;
    this.eventQueue.enqueue({ type: 'complete' });
    this.eventQueue.complete();
    return true;
  }

  private finishTurnOrIdle(): void {
    if (this.finishTurn() || this.eventQueue.isComplete) return;
    this.eventQueue.enqueue({ type: 'complete' });
    this.eventQueue.complete();
  }
}
