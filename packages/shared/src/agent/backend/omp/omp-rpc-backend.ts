import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import readline from 'node:readline';

import type { AgentEvent, ExtensionUiResponse } from '@craft-agent/core/types';
import type { OmpSessionLink, OmpSessionMismatchReason } from '../../../sessions/types.ts';

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
  cloneOmpRuntimeState,
  createOmpRuntimeState,
  reduceOmpRuntimeState,
  type OmpRuntimeStateAction,
} from './omp-runtime-state.ts';
import {
  OmpRpcDiagnostics,
  type OmpRpcDiagnosticsSnapshot,
} from './omp-rpc-diagnostics.ts';
import {
  applyOmpTodoMutation,
  parseOmpTodoMarkdown,
  serializeOmpTodoMarkdown,
  normalizeOmpTodoPhases,
  type OmpTodoMarkdownParseIssue,
} from './omp-todo.ts';
import {
  cloneOmpTodoState,
  createOmpTodoState,
  reduceOmpTodoState,
  type OmpTodoState,
  type OmpTodoStateAction,
} from './omp-todo-state.ts';
import {
  type OmpControlState,
  type OmpInterruptMode,
  type OmpQueueMode,
  type OmpQueueControlState,
  craftThinkingLevelToOmp,
  ompThinkingLevelToCraft,
  parseOmpAvailableCommandsResponseData,
  parseOmpBranchMessagesResponseData,
  parseOmpBranchResult,
  parseOmpCancellationResult,
  parseOmpCompactionResult,
  parseOmpExportHtmlResponseData,
  parseOmpHandoffResult,
  parseOmpMessagesResponseData,
  parseOmpPromptResponseData,
  parseOmpRuntimeEvent,
  parseOmpSetTodosResponseData,
  parseOmpSessionState,
  parseOmpSessionStats,
  parseOmpSubagentFrame,
  parseOmpSubagentMessagesResponseData,
  parseOmpSubagentsResponseData,
  parseOmpTodoEvent,
  extractOmpTodoPhasesFromTranscriptEntries,
  type OmpSubagentFrame,
  type OmpSubagentSnapshot,
  type OmpTodoPhase,
  type OmpRpcAvailableSlashCommand,
  type OmpRpcBranchMessage,
  type OmpRpcBranchResult,
  type OmpRpcCancellationResult,
  type OmpRpcCommand,
  type OmpRpcExportHtmlResponseData,
  type OmpRpcExtensionUiResponse,
  type OmpRpcHandoffResult,
  type OmpRpcSessionState,
  type OmpRuntimeState,
  type OmpThinkingLevel,
} from './omp-rpc-protocol.ts';
import type { OmpTodoMutationDto } from '../../../protocol/dto.ts';

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
  /** Override long-running compact/statistics timeout for deterministic tests. */
  longRequestTimeoutMs?: number;
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

function extractSlashCommandLabel(message: string): string | undefined {
  const match = message.trimStart().match(/^\/([A-Za-z0-9:_-]+)/);
  return match ? `/${match[1]}` : undefined;
}

function isOmpTodoToolName(name: string | undefined): boolean {
  if (!name) return false;
  const normalized = name.toLowerCase().replace(/[\s_-]+/g, '');
  return normalized === 'todo' || normalized === 'todowrite' || normalized === 'todolist';
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
  private runtimeState: OmpRuntimeState = createOmpRuntimeState();
  private todoState: OmpTodoState = createOmpTodoState();
  private todoRefresh: Promise<OmpTodoState> | null = null;
  private todoWrite: Promise<OmpTodoState> | null = null;
  private subagentRefresh: Promise<void> | null = null;
  private subagentRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private availableCommands: OmpRpcAvailableSlashCommand[] = [];
  private controlStateUpdatedAt = Date.now();
  private remoteThinkingLevel: OmpThinkingLevel | null = null;
  private thinkingLevelUpdate: Promise<void> | null = null;
  private activeTurn: ActiveTurn | null = null;
  private sessionLink: OmpSessionLink | null = null;
  private readonly spawnProcess: typeof spawn;
  private readonly readyTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly longRequestTimeoutMs: number;
  private readonly attachmentReadFile?: (path: string) => Buffer;
  onControlStateChange: ((state: OmpControlState) => void) | null = null;
  onTodoStateChange: ((state: OmpTodoState) => void) | null = null;

  constructor(config: BackendConfig, options: OmpRpcBackendOptions = {}) {
    super(config, DEFAULT_OMP_MODEL);
    this._supportsBranching = false;
    this.sessionLink = config.session?.ompSessionLink ?? null;
    this.spawnProcess = options.spawnProcess ?? spawn;
    this.readyTimeoutMs = options.readyTimeoutMs ?? 15_000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.longRequestTimeoutMs = options.longRequestTimeoutMs ?? 300_000;
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
    const commandContext = extractSlashCommandLabel(message);
    this.adapter.startTurn(commandContext);
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
        if (commandContext) {
          this.eventQueue.enqueue({
            type: 'info',
            message: msg,
            level: 'error',
            ompCommand: {
              command: commandContext,
              title: 'Oh My Pi Command',
              level: 'error',
              format: 'markdown',
              requestId: promptRequest.id,
              error: msg,
              details: 'RPC command: prompt',
            },
          });
        } else {
          this.eventQueue.enqueue({ type: 'error', message: `OMP prompt failed: ${msg}` });
        }
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
          if (!event.isError && isOmpTodoToolName(event.toolName)) {
            this.scheduleTodoRefresh('Todo tool result');
          }
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
      this.adapter.clearCommandContext();
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

  override redirect(message: string, attachments?: FileAttachment[]): boolean {
    if (!this._isProcessing || !this.child) {
      this.forceAbort(AbortReason.Redirect);
      return false;
    }

    let command: OmpRpcCommand;
    try {
      command = this.createUserControlCommand('steer', message, attachments);
    } catch (error) {
      this.debug(`Steer command preparation failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }

    this.send(command).catch((error) => {
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

  async getAvailableCommands(): Promise<OmpRpcAvailableSlashCommand[]> {
    await this.ensureSubprocess();
    const data = await this.send({ type: 'get_available_commands' });
    const parsed = parseOmpAvailableCommandsResponseData(data);
    if (!parsed) throw new Error('OMP get_available_commands returned an invalid command list');
    this.applyAvailableCommands(parsed.commands);
    return this.getCachedAvailableCommands();
  }

  getCachedAvailableCommands(): OmpRpcAvailableSlashCommand[] {
    return this.availableCommands.map((command) => ({
      ...command,
      aliases: command.aliases ? [...command.aliases] : undefined,
      input: command.input ? { ...command.input } : undefined,
      subcommands: command.subcommands?.map((subcommand) => ({ ...subcommand })),
    }));
  }

  getOmpControlState(): OmpControlState {
    return {
      availableCommands: this.getCachedAvailableCommands(),
      queue: this.currentQueueControlState(),
      runtime: cloneOmpRuntimeState(this.runtimeState),
      updatedAt: this.controlStateUpdatedAt,
    };
  }

  getOmpTodoState(): OmpTodoState {
    return cloneOmpTodoState(this.todoState);
  }

  async refreshOmpTodos(): Promise<OmpTodoState> {
    await this.ensureSubprocess();
    if (this.todoRefresh) return this.todoRefresh;

    let refresh!: Promise<OmpTodoState>;
    refresh = (async () => {
      this.updateTodoState({ type: 'pending', action: 'refresh' });
      try {
        const data = await this.send({ type: 'get_state' });
        const state = parseOmpSessionState(data);
        if (!state) throw new Error('OMP get_state returned an invalid session state');
        this.applySessionState(state);
        return cloneOmpTodoState(this.todoState);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.updateTodoState({ type: 'failed', action: 'refresh', error: message });
        throw error;
      } finally {
        if (this.todoRefresh === refresh) this.todoRefresh = null;
      }
    })();

    this.todoRefresh = refresh;
    return refresh;
  }

  async mutateOmpTodos(
    expectedRevision: number,
    mutation: OmpTodoMutationDto,
  ): Promise<OmpTodoState> {
    const candidate = applyOmpTodoMutation(this.todoState.phases, mutation);
    return this.replaceOmpTodos(expectedRevision, candidate);
  }

  async importOmpTodosMarkdown(
    expectedRevision: number,
    markdown: string,
  ): Promise<OmpTodoState> {
    const parsed = parseOmpTodoMarkdown(markdown);
    if (parsed.errors.length > 0) {
      throw new Error(this.formatTodoMarkdownErrors(parsed.errors));
    }
    return this.replaceOmpTodos(expectedRevision, parsed.phases);
  }

  exportOmpTodosMarkdown(): string {
    return serializeOmpTodoMarkdown(this.todoState.phases);
  }

  private async replaceOmpTodos(
    expectedRevision: number,
    phases: OmpTodoPhase[],
  ): Promise<OmpTodoState> {
    await this.ensureSubprocess();
    if (this._isProcessing || this.currentQueueControlState().isStreaming) {
      throw new Error('OMP Todos cannot be edited while the session is processing');
    }
    if (this.todoWrite) throw new Error('OMP Todo write already in progress');
    if (!this.todoState.available) throw new Error('OMP Todo state is not available yet');
    if (expectedRevision !== this.todoState.revision) {
      this.scheduleTodoRefresh('stale Todo revision');
      throw new Error('OMP Todo state changed. Refresh and try again.');
    }

    const candidate = normalizeOmpTodoPhases(phases);
    let write!: Promise<OmpTodoState>;
    write = (async () => {
      this.updateTodoState({ type: 'pending', action: 'write' });
      try {
        const data = await this.send({ type: 'set_todos', phases: candidate });
        const parsed = parseOmpSetTodosResponseData(data);
        if (!parsed) throw new Error('OMP set_todos returned an invalid Todo snapshot');
        if (this.sessionState) {
          this.sessionState = {
            ...this.sessionState,
            todoPhases: parsed.todoPhases,
          };
        }
        this.applyTodoSessionState(this.sessionState?.sessionId, parsed.todoPhases);
        return cloneOmpTodoState(this.todoState);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.updateTodoState({ type: 'failed', action: 'write', error: message });
        throw error;
      } finally {
        if (this.todoWrite === write) this.todoWrite = null;
      }
    })();

    this.todoWrite = write;
    return write;
  }

  async refreshOmpRuntimeState(): Promise<OmpRuntimeState> {
    await this.ensureSubprocess();
    if (this.runtimeState.pendingAction === 'refresh') {
      return cloneOmpRuntimeState(this.runtimeState);
    }
    this.assertRuntimeActionAvailable();
    this.updateRuntimeState({ type: 'pending', action: 'refresh' });
    try {
      const [stateData, statsData] = await Promise.all([
        this.send({ type: 'get_state' }),
        this.send({ type: 'get_session_stats' }),
      ]);
      const state = parseOmpSessionState(stateData);
      if (!state) throw new Error('OMP get_state returned an invalid session state');
      const stats = parseOmpSessionStats(statsData);
      if (!stats) throw new Error('OMP get_session_stats returned invalid statistics');
      this.applySessionState(state);
      this.updateRuntimeState({ type: 'stats', stats });
      return cloneOmpRuntimeState(this.runtimeState);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.updateRuntimeState({ type: 'failed', action: 'refresh', error: message });
      throw error;
    }
  }

  async compactOmpSession(customInstructions?: string): Promise<OmpRuntimeState> {
    await this.ensureSubprocess();
    this.assertRuntimeActionAvailable();
    const queue = this.currentQueueControlState();
    if (this._isProcessing || queue.isStreaming || queue.isCompacting) {
      throw new Error('OMP cannot compact while the session is processing');
    }
    this.updateRuntimeState({ type: 'manual_compaction_started' });
    try {
      const data = await this.send({ type: 'compact', customInstructions });
      const result = parseOmpCompactionResult(data);
      if (!result) throw new Error('OMP compact returned an invalid result');
      this.updateRuntimeState({ type: 'manual_compaction_succeeded', result });
      await this.refreshOmpRuntimeState();
      return cloneOmpRuntimeState(this.runtimeState);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.updateRuntimeState({ type: 'failed', action: 'compact', error: message });
      throw error;
    }
  }

  async setAutoCompaction(enabled: boolean): Promise<OmpRuntimeState> {
    await this.ensureSubprocess();
    this.assertRuntimeActionAvailable();
    this.updateRuntimeState({ type: 'pending', action: 'set-auto-compaction' });
    try {
      await this.send({ type: 'set_auto_compaction', enabled });
      if (this.sessionState) this.sessionState.autoCompactionEnabled = enabled;
      this.updateRuntimeState({ type: 'auto_compaction_set', enabled });
      return cloneOmpRuntimeState(this.runtimeState);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.updateRuntimeState({ type: 'failed', action: 'set-auto-compaction', error: message });
      throw error;
    }
  }

  async setAutoRetry(enabled: boolean): Promise<OmpRuntimeState> {
    await this.ensureSubprocess();
    this.assertRuntimeActionAvailable();
    this.updateRuntimeState({ type: 'pending', action: 'set-auto-retry' });
    try {
      await this.send({ type: 'set_auto_retry', enabled });
      this.updateRuntimeState({ type: 'auto_retry_set', enabled });
      return cloneOmpRuntimeState(this.runtimeState);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.updateRuntimeState({ type: 'failed', action: 'set-auto-retry', error: message });
      throw error;
    }
  }

  async abortRetry(): Promise<OmpRuntimeState> {
    await this.ensureSubprocess();
    this.assertRuntimeActionAvailable();
    this.updateRuntimeState({ type: 'pending', action: 'abort-retry' });
    try {
      await this.send({ type: 'abort_retry' });
      this.updateRuntimeState({ type: 'retry_aborted' });
      return cloneOmpRuntimeState(this.runtimeState);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.updateRuntimeState({ type: 'failed', action: 'abort-retry', error: message });
      throw error;
    }
  }

  getOmpSessionLink(): OmpSessionLink | null {
    return this.sessionLink ? this.cloneSessionLink(this.sessionLink) : null;
  }

  async refreshOmpSessionLink(): Promise<OmpSessionLink> {
    await this.ensureSubprocess();
    const data = await this.send({ type: 'get_state' });
    const state = parseOmpSessionState(data);
    if (!state) throw new Error('OMP get_state returned an invalid session state');
    this.applySessionState(state);
    return this.updateSessionLinkFromState(state);
  }

  async restoreOmpSession(link: OmpSessionLink): Promise<OmpRpcCancellationResult> {
    this.sessionLink = this.cloneSessionLink(link);
    await this.ensureSubprocess();
    if (!link.sessionFile) {
      throw new Error('Cannot restore OMP session without a session file');
    }

    const current = this.sessionState;
    if (current?.sessionFile === link.sessionFile) {
      this.updateSessionLinkFromState(current);
      return { cancelled: false };
    }

    const result = await this.switchSessionFile(link.sessionFile);
    if (result.cancelled) {
      this.publishSessionMismatch(link, 'restore-cancelled', 'OMP cancelled session restore');
      return result;
    }

    await this.refreshOmpSessionLink();
    return result;
  }

  async newOmpSession(parentSession?: string): Promise<OmpRpcCancellationResult> {
    await this.ensureSubprocess();
    const data = await this.send({ type: 'new_session', parentSession });
    const parsed = parseOmpCancellationResult(data);
    if (!parsed) throw new Error('OMP new_session returned an invalid result');
    if (!parsed.cancelled) await this.refreshOmpSessionLink();
    return parsed;
  }

  async switchOmpSession(sessionPath: string): Promise<OmpRpcCancellationResult> {
    await this.ensureSubprocess();
    const result = await this.switchSessionFile(sessionPath);
    if (!result.cancelled) await this.refreshOmpSessionLink();
    return result;
  }

  async getOmpMessages(): Promise<unknown[]> {
    await this.ensureSubprocess();
    const data = await this.send({ type: 'get_messages' });
    const parsed = parseOmpMessagesResponseData(data);
    if (!parsed) {
      if (this.sessionLink) {
        this.publishSessionMismatch(
          this.sessionLink,
          'invalid-response',
          'OMP get_messages returned an invalid message list',
        );
      }
      throw new Error('OMP get_messages returned an invalid message list');
    }
    return parsed.messages;
  }

  async getOmpBranchMessages(): Promise<OmpRpcBranchMessage[]> {
    await this.ensureSubprocess();
    const data = await this.send({ type: 'get_branch_messages' });
    const parsed = parseOmpBranchMessagesResponseData(data);
    if (!parsed) throw new Error('OMP get_branch_messages returned an invalid message list');
    return parsed.messages;
  }

  async branchOmpSession(entryId: string): Promise<OmpRpcBranchResult> {
    await this.ensureSubprocess();
    const data = await this.send({ type: 'branch', entryId });
    const parsed = parseOmpBranchResult(data);
    if (!parsed) throw new Error('OMP branch returned an invalid result');
    if (!parsed.cancelled) await this.refreshOmpSessionLink();
    return parsed;
  }

  async setOmpSessionName(name: string): Promise<void> {
    await this.ensureSubprocess();
    await this.send({ type: 'set_session_name', name });
    if (this.sessionLink) {
      this.sessionLink = {
        ...this.sessionLink,
        sessionName: name,
        lastSyncedAt: Date.now(),
      };
      this.config.onOmpSessionLinkUpdate?.(this.cloneSessionLink(this.sessionLink));
    }
  }

  async handoffOmpSession(customInstructions?: string): Promise<OmpRpcHandoffResult | null> {
    await this.ensureSubprocess();
    const data = await this.send({ type: 'handoff', customInstructions });
    const parsed = parseOmpHandoffResult(data);
    if (data !== null && data !== undefined && !parsed) {
      throw new Error('OMP handoff returned an invalid result');
    }
    if (parsed) await this.refreshOmpSessionLink();
    return parsed;
  }

  async exportOmpSessionHtml(outputPath?: string): Promise<OmpRpcExportHtmlResponseData> {
    await this.ensureSubprocess();
    const data = await this.send({ type: 'export_html', outputPath });
    const parsed = parseOmpExportHtmlResponseData(data);
    if (!parsed) throw new Error('OMP export_html returned an invalid result');
    return parsed;
  }

  async steer(message: string, attachments?: FileAttachment[]): Promise<boolean> {
    if (!this._isProcessing || !this.child) return false;
    this.send(this.createUserControlCommand('steer', message, attachments)).catch((error) => {
      this.debug(`Steer command failed: ${error instanceof Error ? error.message : String(error)}`);
    });
    return true;
  }

  async followUp(message: string, attachments?: FileAttachment[]): Promise<boolean> {
    if (!this._isProcessing || !this.child) return false;
    this.send(this.createUserControlCommand('follow_up', message, attachments)).catch((error) => {
      this.debug(`Follow-up command failed: ${error instanceof Error ? error.message : String(error)}`);
    });
    return true;
  }

  async abortAndPrompt(message: string, attachments?: FileAttachment[]): Promise<boolean> {
    if (!this.child) return false;
    this.send(this.createUserControlCommand('abort_and_prompt', message, attachments)).catch((error) => {
      this.debug(`Abort-and-prompt command failed: ${error instanceof Error ? error.message : String(error)}`);
    });
    this._isProcessing = true;
    this.touchControlState();
    return true;
  }

  async setSteeringMode(mode: OmpQueueMode): Promise<void> {
    await this.ensureSubprocess();
    await this.send({ type: 'set_steering_mode', mode });
    this.patchQueueState({ steeringMode: mode });
  }

  async setFollowUpMode(mode: OmpQueueMode): Promise<void> {
    await this.ensureSubprocess();
    await this.send({ type: 'set_follow_up_mode', mode });
    this.patchQueueState({ followUpMode: mode });
  }

  async setInterruptMode(mode: OmpInterruptMode): Promise<void> {
    await this.ensureSubprocess();
    await this.send({ type: 'set_interrupt_mode', mode });
    this.patchQueueState({ interruptMode: mode });
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
    const runtimeEvent = parseOmpRuntimeEvent(raw);
    if (runtimeEvent) {
      if (runtimeEvent.type === 'retry_fallback_succeeded' && runtimeEvent.role === 'default') {
        super.setModel(runtimeEvent.model);
        this.selectedModelKey = runtimeEvent.model;
      }
      this.updateRuntimeState({ type: 'runtime_event', event: runtimeEvent });
      if (runtimeEvent.type === 'auto_compaction_end') {
        setTimeout(() => {
          void this.refreshOmpRuntimeState().catch((error) => {
            this.debug(`OMP post-compaction refresh failed: ${error instanceof Error ? error.message : String(error)}`);
          });
        }, 0);
      }
    }
    const todoEvent = parseOmpTodoEvent(raw);
    if (todoEvent) {
      if (todoEvent.type === 'todo_reminder') {
        this.updateTodoState({
          type: 'reminder',
          todos: todoEvent.todos,
          attempt: todoEvent.attempt,
          maxAttempts: todoEvent.maxAttempts,
        });
        this.scheduleTodoRefresh('Todo reminder');
      } else {
        this.updateTodoState({ type: 'auto_clear' });
        this.scheduleTodoRefresh('Todo auto-clear');
      }
    }
    const subagentFrame = parseOmpSubagentFrame(raw);
    if (subagentFrame) {
      this.applySubagentFrame(subagentFrame);
      this.scheduleSubagentRefresh('subagent frame');
    }
    const adapted = this.adapter.adaptFrame(raw);
    if (adapted.unknownFrameType) {
      const shouldLog = !todoEvent && !subagentFrame && this.diagnostics.recordUnknownFrame(adapted.unknownFrameType, raw);
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
      this.touchControlState();
    }

    if (adapted.queueState) {
      this.patchQueueState(adapted.queueState);
    }

    if (adapted.availableCommands) {
      this.applyAvailableCommands(adapted.availableCommands);
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
    const timeoutMs = commandName === 'compact' || commandName === 'get_session_stats'
      ? this.longRequestTimeoutMs
      : this.requestTimeoutMs;
    const startedAt = this.diagnostics.recordRequest(commandName);

    const promise = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        this.diagnostics.recordTimeout();
        pending.reject(new Error(`OMP RPC command timed out: ${String(command.type ?? 'unknown')}`));
      }, timeoutMs);
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
    if (this.subagentRefreshTimer) {
      clearTimeout(this.subagentRefreshTimer);
      this.subagentRefreshTimer = null;
    }

    const child = this.child;
    this.child = null;
    this.readyPromise = null;
    this.readyResolve = null;
    this.readyReject = null;
    this.readySyncGeneration = null;
    this.sessionState = null;
    this.availableCommands = [];
    this.subagentRefresh = null;
    this.updateRuntimeState({ type: 'unavailable', error: 'OMP runtime is not connected' });
    this.updateTodoState({ type: 'unavailable', error: 'OMP runtime is not connected' });
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

    this.send({ type: 'get_state' }).then(async (data) => {
      if (generation !== this.processGeneration || child !== this.child) return;
      let state = parseOmpSessionState(data);
      if (!state) {
        throw new Error('OMP get_state returned an invalid session state');
      }

      state = await this.restorePersistedSessionIfNeeded(state, generation, child);
      if (generation !== this.processGeneration || child !== this.child) return;

      this.applySessionState(state);
      this.updateSessionLinkFromState(state);
      this.remoteThinkingLevel = ompThinkingLevelToCraft(state.thinkingLevel)
        ? state.thinkingLevel as OmpThinkingLevel
        : null;
      this.config.onSdkSessionIdUpdate?.(state.sessionId);
      this.diagnostics.setSessionState(state);
      this.diagnostics.markReady();
      this.debug(`Synchronized OMP session: ${state.sessionId}`);
      this.resolveReady();
      setTimeout(() => {
        void this.refreshAvailableCommandsForReady(generation, child);
      }, 0);
      setTimeout(() => {
        void this.refreshSubagentsForReady(generation, child);
      }, 0);
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

  private async restorePersistedSessionIfNeeded(
    startupState: OmpRpcSessionState,
    generation: number,
    child: ChildProcessWithoutNullStreams,
  ): Promise<OmpRpcSessionState> {
    const link = this.sessionLink ?? this.config.session?.ompSessionLink ?? null;
    if (!link?.sessionFile) return startupState;
    if (startupState.sessionFile === link.sessionFile) return startupState;

    try {
      const result = await this.switchSessionFile(link.sessionFile);
      if (generation !== this.processGeneration || child !== this.child) return startupState;
      if (result.cancelled) {
        this.publishSessionMismatch(link, 'restore-cancelled', 'OMP cancelled session restore');
        throw new Error(`OMP restore was cancelled for ${link.sessionFile}`);
      }

      const data = await this.send({ type: 'get_state' });
      if (generation !== this.processGeneration || child !== this.child) return startupState;
      const restored = parseOmpSessionState(data);
      if (!restored) {
        this.publishSessionMismatch(link, 'invalid-response', 'OMP get_state after restore returned an invalid session state');
        throw new Error('OMP get_state after restore returned an invalid session state');
      }
      this.debug(`Restored OMP session file: ${link.sessionFile}`);
      return restored;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const existingReason = this.sessionLink?.lastMismatch?.reason;
      if (existingReason !== 'restore-cancelled' && existingReason !== 'invalid-response') {
        const reason: OmpSessionMismatchReason = /not found|no such file|enoent/i.test(detail)
          ? 'missing-session-file'
          : 'restore-failed';
        this.publishSessionMismatch(link, reason, detail);
      }
      throw new Error(`Failed to restore OMP session ${link.sessionFile}: ${detail}`);
    }
  }

  private async switchSessionFile(sessionPath: string): Promise<OmpRpcCancellationResult> {
    const data = await this.send({ type: 'switch_session', sessionPath });
    const parsed = parseOmpCancellationResult(data);
    if (!parsed) throw new Error('OMP switch_session returned an invalid result');
    return parsed;
  }

  private updateSessionLinkFromState(state: OmpRpcSessionState): OmpSessionLink {
    const link: OmpSessionLink = {
      provider: 'omp',
      sessionId: state.sessionId,
      sessionFile: state.sessionFile,
      sessionName: state.sessionName,
      messageCount: state.messageCount,
      lastSyncedAt: Date.now(),
      lastCheckedAt: this.sessionLink?.lastCheckedAt,
    };
    this.sessionLink = link;
    this.config.onOmpSessionLinkUpdate?.(this.cloneSessionLink(link));
    return this.cloneSessionLink(link);
  }

  private publishSessionMismatch(
    baseLink: OmpSessionLink,
    reason: OmpSessionMismatchReason,
    detail: string,
  ): void {
    const link: OmpSessionLink = {
      ...this.cloneSessionLink(baseLink),
      lastMismatch: {
        reason,
        detail,
        detectedAt: Date.now(),
      },
    };
    this.sessionLink = link;
    this.config.onOmpSessionLinkUpdate?.(this.cloneSessionLink(link));
  }

  private cloneSessionLink(link: OmpSessionLink): OmpSessionLink {
    return {
      ...link,
      lastMismatch: link.lastMismatch ? { ...link.lastMismatch } : undefined,
    };
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
    this.scheduleTodoRefresh('turn complete');
    return true;
  }

  private finishTurnOrIdle(): void {
    if (this.finishTurn() || this.eventQueue.isComplete) return;
    this.eventQueue.enqueue({ type: 'complete' });
    this.eventQueue.complete();
  }

  private createUserControlCommand(
    type: 'steer' | 'follow_up' | 'abort_and_prompt',
    message: string,
    attachments?: FileAttachment[],
  ): OmpRpcCommand {
    const prepared = prepareOmpPrompt(message, attachments, {
      readFile: this.attachmentReadFile,
    });
    for (const warning of prepared.warnings) {
      if (!this.eventQueue.isComplete) this.eventQueue.enqueue({ type: 'info', message: warning });
    }
    return {
      type,
      message: prepared.message,
      ...(prepared.images ? { images: prepared.images } : {}),
    };
  }

  private async refreshSubagentsForReady(
    generation: number,
    child: ChildProcessWithoutNullStreams,
  ): Promise<void> {
    try {
      await this.send({ type: 'set_subagent_subscription', level: 'progress' });
      if (generation !== this.processGeneration || child !== this.child) return;
      await this.refreshOmpSubagents(generation, child);
    } catch (error) {
      if (generation !== this.processGeneration || child !== this.child) return;
      this.debug(`OMP subagent discovery failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async refreshOmpSubagents(
    generation = this.processGeneration,
    child = this.child,
  ): Promise<void> {
    if (!child || generation !== this.processGeneration || child !== this.child) return;
    if (this.subagentRefresh) return this.subagentRefresh;

    let refresh!: Promise<void>;
    refresh = (async () => {
      try {
        const data = await this.send({ type: 'get_subagents' });
        if (generation !== this.processGeneration || child !== this.child) return;
        const parsed = parseOmpSubagentsResponseData(data);
        if (!parsed) {
          this.debug('OMP get_subagents returned an invalid subagent list');
          return;
        }

        const hydrated = await Promise.all(parsed.subagents.map((subagent) => (
          this.hydrateSubagentTodos(subagent, generation, child)
        )));
        if (generation !== this.processGeneration || child !== this.child) return;
        this.updateTodoState({ type: 'subagents_snapshot', subagents: hydrated });
      } catch (error) {
        if (generation !== this.processGeneration || child !== this.child) return;
        this.debug(`OMP subagent refresh failed: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        if (this.subagentRefresh === refresh) this.subagentRefresh = null;
      }
    })();

    this.subagentRefresh = refresh;
    return refresh;
  }

  private async hydrateSubagentTodos(
    subagent: OmpSubagentSnapshot,
    generation: number,
    child: ChildProcessWithoutNullStreams,
  ): Promise<OmpSubagentSnapshot> {
    if (!subagent.sessionFile) return this.mergeSubagentSnapshot(subagent);

    try {
      const data = await this.send({
        type: 'get_subagent_messages',
        subagentId: subagent.id,
      });
      if (generation !== this.processGeneration || child !== this.child) return this.mergeSubagentSnapshot(subagent);
      const parsed = parseOmpSubagentMessagesResponseData(data);
      if (!parsed) return this.mergeSubagentSnapshot(subagent);
      const todoPhases = extractOmpTodoPhasesFromTranscriptEntries(parsed.entries);
      return this.mergeSubagentSnapshot({
        ...subagent,
        ...(todoPhases ? { todoPhases } : {}),
      });
    } catch (error) {
      if (generation === this.processGeneration && child === this.child) {
        this.debug(`OMP subagent Todo transcript read failed for ${subagent.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
      return this.mergeSubagentSnapshot(subagent);
    }
  }

  private mergeSubagentSnapshot(next: OmpSubagentSnapshot): OmpSubagentSnapshot {
    const existing = this.todoState.subagents.find((subagent) => subagent.id === next.id);
    return {
      ...next,
      todoPhases: next.todoPhases ?? existing?.todoPhases,
    };
  }

  private applySubagentFrame(frame: OmpSubagentFrame): void {
    if (frame.type === 'subagent_lifecycle') {
      if (frame.payload.status !== 'started') {
        this.updateTodoState({ type: 'subagent_remove', id: frame.payload.id });
        return;
      }

      const existing = this.todoState.subagents.find((subagent) => subagent.id === frame.payload.id);
      this.updateTodoState({
        type: 'subagent_upsert',
        subagent: this.mergeSubagentSnapshot({
          id: frame.payload.id,
          index: frame.payload.index,
          agent: frame.payload.agent,
          agentSource: frame.payload.agentSource,
          description: frame.payload.description ?? existing?.description,
          status: 'running',
          task: existing?.task,
          assignment: existing?.assignment,
          sessionFile: frame.payload.sessionFile ?? existing?.sessionFile,
          parentToolCallId: frame.payload.parentToolCallId ?? existing?.parentToolCallId,
          lastUpdate: Date.now(),
          progress: existing?.progress,
        }),
      });
      return;
    }

    const progress = frame.payload.progress;
    const existing = this.todoState.subagents.find((subagent) => subagent.id === progress.id);
    this.updateTodoState({
      type: 'subagent_upsert',
      subagent: this.mergeSubagentSnapshot({
        id: progress.id,
        index: frame.payload.index,
        agent: frame.payload.agent,
        agentSource: frame.payload.agentSource,
        description: progress.description ?? existing?.description,
        status: progress.status,
        task: frame.payload.task,
        assignment: frame.payload.assignment,
        sessionFile: frame.payload.sessionFile ?? existing?.sessionFile,
        parentToolCallId: frame.payload.parentToolCallId ?? existing?.parentToolCallId,
        lastUpdate: Date.now(),
        progress,
      }),
    });
  }

  private scheduleSubagentRefresh(reason: string): void {
    if (!this.child || this.subagentRefresh || this.subagentRefreshTimer) return;
    const generation = this.processGeneration;
    const child = this.child;
    this.subagentRefreshTimer = setTimeout(() => {
      this.subagentRefreshTimer = null;
      void this.refreshOmpSubagents(generation, child).catch((error) => {
        this.debug(`OMP subagent refresh failed after ${reason}: ${error instanceof Error ? error.message : String(error)}`);
      });
    }, 250);
  }

  private async refreshAvailableCommandsForReady(
    generation: number,
    child: ChildProcessWithoutNullStreams,
  ): Promise<void> {
    try {
      const data = await this.send({ type: 'get_available_commands' });
      if (generation !== this.processGeneration || child !== this.child) return;
      const parsed = parseOmpAvailableCommandsResponseData(data);
      if (!parsed) {
        this.debug('OMP get_available_commands returned an invalid command list');
        return;
      }
      this.applyAvailableCommands(parsed.commands);
    } catch (error) {
      if (generation !== this.processGeneration || child !== this.child) return;
      this.debug(`OMP command discovery failed: ${error instanceof Error ? error.message : String(error)}`);
      this.touchControlState();
    }
  }

  private applyAvailableCommands(commands: OmpRpcAvailableSlashCommand[]): void {
    this.availableCommands = commands.map((command) => ({
      ...command,
      aliases: command.aliases ? [...command.aliases] : undefined,
      input: command.input ? { ...command.input } : undefined,
      subcommands: command.subcommands?.map((subcommand) => ({ ...subcommand })),
    }));
    this.touchControlState();
  }

  private applySessionState(state: OmpRpcSessionState): void {
    if (this.sessionState && this.sessionState.sessionId !== state.sessionId) {
      this.runtimeState = createOmpRuntimeState();
      this.todoState = createOmpTodoState();
    }
    this.sessionState = state;
    this.runtimeState = reduceOmpRuntimeState(this.runtimeState, { type: 'session_state', state });
    this.touchControlState();
    this.applyTodoSessionState(state.sessionId, state.todoPhases);
  }

  private updateRuntimeState(action: OmpRuntimeStateAction): void {
    this.runtimeState = reduceOmpRuntimeState(this.runtimeState, action);
    this.touchControlState();
  }

  private applyTodoSessionState(sessionId: string | undefined, phases: OmpTodoPhase[]): void {
    if (!sessionId) {
      this.updateTodoState({ type: 'unavailable', error: 'OMP session is not synchronized' });
      return;
    }
    this.updateTodoState({ type: 'session_state', sessionId, phases });
  }

  private updateTodoState(action: OmpTodoStateAction): void {
    this.todoState = reduceOmpTodoState(this.todoState, action);
    this.onTodoStateChange?.(this.getOmpTodoState());
  }

  private scheduleTodoRefresh(reason: string): void {
    if (!this.child || this.todoRefresh || this.todoWrite) return;
    setTimeout(() => {
      void this.refreshOmpTodos().catch((error) => {
        this.debug(`OMP Todo refresh failed after ${reason}: ${error instanceof Error ? error.message : String(error)}`);
      });
    }, 0);
  }

  private formatTodoMarkdownErrors(errors: OmpTodoMarkdownParseIssue[]): string {
    return errors
      .slice(0, 5)
      .map(error => `line ${error.line}: ${error.message}`)
      .join('; ');
  }

  private assertRuntimeActionAvailable(): void {
    if (this.runtimeState.pendingAction) {
      throw new Error(`OMP runtime action already in progress: ${this.runtimeState.pendingAction}`);
    }
  }

  private patchQueueState(patch: Partial<OmpQueueControlState>): void {
    const current = this.sessionState;
    if (!current) {
      this.touchControlState();
      return;
    }
    this.sessionState = {
      ...current,
      ...patch,
    };
    this.touchControlState();
  }

  private currentQueueControlState(): OmpQueueControlState {
    return {
      isStreaming: this.sessionState?.isStreaming ?? this._isProcessing,
      isCompacting: this.sessionState?.isCompacting ?? false,
      steeringMode: this.sessionState?.steeringMode ?? 'all',
      followUpMode: this.sessionState?.followUpMode ?? 'all',
      interruptMode: this.sessionState?.interruptMode ?? 'immediate',
      queuedMessageCount: this.sessionState?.queuedMessageCount ?? 0,
    };
  }

  private touchControlState(): void {
    this.controlStateUpdatedAt = Date.now();
    this.onControlStateChange?.(this.getOmpControlState());
  }
}
