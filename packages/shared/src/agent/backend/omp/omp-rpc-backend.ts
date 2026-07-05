import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import readline from 'node:readline';

import type { AgentEvent, ExtensionUiResponse } from '@craft-agent/core/types';

import { BaseAgent } from '../../base-agent.ts';
import type { LLMQueryRequest, LLMQueryResult } from '../../llm-tool.ts';
import type { FileAttachment } from '../../../utils/files.ts';
import type { ChatOptions, BackendConfig } from '../types.ts';
import { AbortReason } from '../types.ts';
import { EventQueue } from '../event-queue.ts';
import { resolveOmpCommand } from './omp-command.ts';
import { OmpRpcEventAdapter } from './omp-rpc-adapter.ts';

export const DEFAULT_OMP_MODEL = 'omp/default';

export interface OmpModelSelection {
  provider: string;
  modelId: string;
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export interface OmpRpcBackendOptions {
  /** Test seam for deterministic subprocess lifecycle coverage. */
  spawnProcess?: typeof spawn;
  /** Override the startup timeout without changing the production default. */
  readyTimeoutMs?: number;
  /** Override correlated RPC response timeout for deterministic tests. */
  requestTimeoutMs?: number;
}

function attachmentText(attachments?: FileAttachment[]): string {
  if (!attachments?.length) return '';

  const parts: string[] = [];
  for (const attachment of attachments) {
    if (attachment.text) {
      parts.push([
        `[Attached text file: ${attachment.name}]`,
        attachment.text,
      ].join('\n'));
      continue;
    }

    const storedPath = attachment.storedPath ?? attachment.markdownPath ?? attachment.path;
    if (storedPath) {
      parts.push(`[Attached file: ${attachment.name}]\n[Path: ${storedPath}]`);
    }
  }

  return parts.join('\n\n');
}

function formatPrompt(message: string, attachments?: FileAttachment[]): string {
  const attachmentsBlock = attachmentText(attachments);
  return [attachmentsBlock, message].filter(Boolean).join('\n\n');
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
): Record<string, unknown> {
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
  private readonly spawnProcess: typeof spawn;
  private readonly readyTimeoutMs: number;
  private readonly requestTimeoutMs: number;

  constructor(config: BackendConfig, options: OmpRpcBackendOptions = {}) {
    super(config, DEFAULT_OMP_MODEL);
    this._supportsBranching = false;
    this.spawnProcess = options.spawnProcess ?? spawn;
    this.readyTimeoutMs = options.readyTimeoutMs ?? 15_000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
  }

  protected override debug(message: string): void {
    this.onDebug?.(`[omp] ${message}`);
  }

  protected async *chatImpl(
    message: string,
    attachments?: FileAttachment[],
    _options?: ChatOptions,
  ): AsyncGenerator<AgentEvent> {
    this._isProcessing = true;
    this.abortReason = undefined;
    this.eventQueue.reset();
    this.adapter.startTurn();

    this.emitAutomationEvent('UserPromptSubmit', {
      hook_event_name: 'UserPromptSubmit',
      prompt: message,
    });

    try {
      await this.ensureSubprocess();
      await this.ensureModelSelected();

      this.send({
        type: 'prompt',
        message: formatPrompt(message, attachments),
      }).catch((error) => {
        // Child failure already owns turn termination. Its pending rejection reaches
        // this catch on a later microtask; do not emit a duplicate error/complete pair.
        if (this.eventQueue.isComplete) return;
        const msg = error instanceof Error ? error.message : String(error);
        this.eventQueue.enqueue({ type: 'error', message: `OMP prompt failed: ${msg}` });
        this.eventQueue.enqueue({ type: 'complete' });
        this.eventQueue.complete();
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
      this._isProcessing = false;
    }
  }

  async abort(reason?: string): Promise<void> {
    this.debug(`Abort requested${reason ? `: ${reason}` : ''}`);
    this.emitAutomationEvent('Stop', { hook_event_name: 'Stop' });
    this._isProcessing = false;
    this.send({ type: 'abort' }).catch((error) => {
      this.debug(`Abort command failed: ${error instanceof Error ? error.message : String(error)}`);
    });
    this.eventQueue.complete();
  }

  forceAbort(reason: AbortReason): void {
    this.abortReason = reason;
    this._isProcessing = false;
    this.emitAutomationEvent('Stop', { hook_event_name: 'Stop' });
    this.eventQueue.complete();

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

  private spawnSubprocess(): void {
    const generation = ++this.processGeneration;
    const runtime = this.config.runtime ?? {};
    const resolved = resolveOmpCommand(runtime.ompCommand ?? process.env.OMP_COMMAND);
    const cwd = this.workingDirectory || this.config.workspace.rootPath || process.cwd();
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...this.config.envOverrides,
    };

    this.debug(`Starting OMP RPC: ${resolved.command} ${[...resolved.args, '--mode', 'rpc'].join(' ')}`);

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
      this.debug(`Ignoring non-JSON stdout: ${line.slice(0, 200)}`);
      return;
    }

    const adapted = this.adapter.adaptFrame(raw);

    if (adapted.ready) {
      if (adapted.sessionId) {
        this.config.onSdkSessionIdUpdate?.(adapted.sessionId);
      }
      this.resolveReady();
    }

    if (adapted.response?.id) {
      const pending = this.pending.get(adapted.response.id);
      if (pending) {
        this.pending.delete(adapted.response.id);
        clearTimeout(pending.timer);
        if (adapted.response.success) {
          pending.resolve(adapted.response.data ?? raw);
        } else {
          pending.reject(new Error(adapted.response.error ?? 'OMP RPC command failed'));
        }
      }
    }

    for (const event of adapted.events) {
      this.eventQueue.enqueue(event);
    }

    if (adapted.complete) {
      this.eventQueue.complete();
    }
  }

  private send(command: Record<string, unknown>): Promise<unknown> {
    const child = this.child;
    const stdin = child?.stdin;
    const generation = this.processGeneration;
    if (!stdin?.writable) {
      return Promise.reject(new Error('OMP RPC is not connected'));
    }

    const id = `omp-${++this.requestCounter}`;
    const frame = { id, ...command };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        pending.reject(new Error(`OMP RPC command timed out: ${String(command.type ?? 'unknown')}`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      stdin.write(`${JSON.stringify(frame)}\n`, (error) => {
        if (error) {
          if (generation === this.processGeneration && child === this.child) {
            const pending = this.pending.get(id);
            if (pending) clearTimeout(pending.timer);
            this.pending.delete(id);
          }
          reject(error);
        }
      });
    });
  }

  private writeSideChannel(frame: Record<string, unknown>): Promise<void> {
    const stdin = this.child?.stdin;
    if (!stdin?.writable) {
      return Promise.reject(new Error('OMP RPC is not connected'));
    }

    return new Promise((resolve, reject) => {
      stdin.write(`${JSON.stringify(frame)}\n`, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  private resolveReady(): void {
    if (this.readyTimer) {
      clearTimeout(this.readyTimer);
      this.readyTimer = null;
    }
    this.readyResolve?.();
    this.readyResolve = null;
    this.readyReject = null;
  }

  private rejectReady(error: Error): void {
    if (this.readyTimer) {
      clearTimeout(this.readyTimer);
      this.readyTimer = null;
    }
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
    this.cleanupChildHandles();

    if (this._isProcessing && this.abortReason === undefined) {
      this.eventQueue.enqueue({ type: 'error', message: error.message });
      this.eventQueue.enqueue({ type: 'complete' });
      this.eventQueue.complete();
    }
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
    if (this.readyTimer) {
      clearTimeout(this.readyTimer);
      this.readyTimer = null;
    }
    this.stdoutReader?.close();
    this.stdoutReader = null;

    const child = this.child;
    this.child = null;
    this.readyPromise = null;
    this.readyResolve = null;
    this.readyReject = null;

    if (child && !child.killed) {
      child.kill();
    }
  }

  private appendRecentStderr(text: string): void {
    this.recentStderr = (this.recentStderr + text).slice(-8192);
  }
}
