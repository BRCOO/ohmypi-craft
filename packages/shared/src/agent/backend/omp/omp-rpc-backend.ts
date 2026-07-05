import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import readline from 'node:readline';

import type { AgentEvent } from '@craft-agent/core/types';

import { BaseAgent } from '../../base-agent.ts';
import type { LLMQueryRequest, LLMQueryResult } from '../../llm-tool.ts';
import type { FileAttachment } from '../../../utils/files.ts';
import type { ChatOptions, BackendConfig } from '../types.ts';
import { AbortReason } from '../types.ts';
import { EventQueue } from '../event-queue.ts';
import { OmpRpcEventAdapter } from './omp-rpc-adapter.ts';

export const DEFAULT_OMP_MODEL = 'omp/default';

export interface OmpModelSelection {
  provider: string;
  modelId: string;
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

function resolveCommand(rawCommand: unknown): { command: string; args: string[] } {
  const command = typeof rawCommand === 'string' && rawCommand.trim()
    ? rawCommand.trim()
    : 'omp';

  const quoted = command.match(/^"([^"]+)"(?:\s+(.*))?$/);
  if (quoted?.[1]) {
    return {
      command: quoted[1],
      args: quoted[2] ? quoted[2].split(/\s+/).filter(Boolean) : [],
    };
  }

  const parts = command.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { command, args: [] };
  return { command: parts[0]!, args: parts.slice(1) };
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

  constructor(config: BackendConfig) {
    super(config, DEFAULT_OMP_MODEL);
    this._supportsBranching = false;
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
    const runtime = this.config.runtime ?? {};
    const resolved = resolveCommand(runtime.ompCommand ?? process.env.OMP_COMMAND);
    const cwd = this.workingDirectory || this.config.workspace.rootPath || process.cwd();
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...this.config.envOverrides,
    };

    this.debug(`Starting OMP RPC: ${resolved.command} ${[...resolved.args, '--mode', 'rpc'].join(' ')}`);

    const child = spawn(resolved.command, [...resolved.args, '--mode', 'rpc'], {
      cwd,
      env,
      windowsHide: true,
    });

    this.child = child;
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
      this.readyTimer = setTimeout(() => {
        this.rejectReady(new Error('Timed out waiting for OMP ready frame'));
      }, 15_000);
    });

    this.stdoutReader = readline.createInterface({ input: child.stdout });
    this.stdoutReader.on('line', (line) => this.handleLine(line));

    child.stderr.on('data', (chunk) => {
      const text = String(chunk);
      this.appendRecentStderr(text);
      this.debug(`stderr: ${text.trim().slice(0, 500)}`);
    });

    child.on('error', (error) => {
      this.handleChildFailure(error);
    });

    child.on('exit', (code, signal) => {
      const reason = signal ? `signal ${signal}` : `code ${code ?? 0}`;
      this.handleChildFailure(new Error(`OMP exited with ${reason}`));
    });
  }

  private handleLine(line: string): void {
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
    if (!this.child?.stdin?.writable) {
      return Promise.reject(new Error('OMP RPC is not connected'));
    }

    const id = `omp-${++this.requestCounter}`;
    const frame = { id, ...command };

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child?.stdin.write(`${JSON.stringify(frame)}\n`, (error) => {
        if (error) {
          this.pending.delete(id);
          reject(error);
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

  private handleChildFailure(error: Error): void {
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
      pending.reject(error);
    }
    this.pending.clear();
    this.selectedModelKey = null;
  }

  private killSubprocess(): void {
    this.rejectPending(new Error('OMP RPC backend destroyed'));
    this.cleanupChildHandles();
  }

  private cleanupChildHandles(): void {
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
