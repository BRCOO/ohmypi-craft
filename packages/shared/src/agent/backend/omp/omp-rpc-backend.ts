import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  win32,
} from 'node:path';
import readline from 'node:readline';

import type { AgentEvent, ExtensionUiResponse } from '@craft-agent/core/types';
import {
  getSessionToolDefs,
  getToolDefsAsJsonSchema,
  SESSION_TOOL_REGISTRY,
  type SessionToolContext,
  type ToolResult,
} from '@craft-agent/session-tools-core';
import type { OmpSessionLink, OmpSessionMismatchReason } from '../../../sessions/types.ts';

import { BaseAgent } from '../../base-agent.ts';
import { executeBrowserToolCommand } from '../../browser-tool-runtime.ts';
import { createClaudeContext } from '../../claude-context.ts';
import { FEATURE_FLAGS } from '../../../feature-flags.ts';
import type { LLMQueryRequest, LLMQueryResult } from '../../llm-tool.ts';
import { attachSessionSelfManagementBindings } from '../../session-self-management-bindings.ts';
import {
  getSessionScopedToolCallbacks,
  setLastPlanFilePath,
  type AuthRequest,
} from '../../session-scoped-tools.ts';
import { runPreToolUseChecks } from '../../core/pre-tool-use.ts';
import { SourceActivationDrainController } from '../../source-activation-drain.ts';
import type { ThinkingLevel } from '../../thinking-levels.ts';
import { saveBinaryResponse } from '../../../utils/binary-detection.ts';
import type { FileAttachment } from '../../../utils/files.ts';
import type { LoadedSource } from '../../../sources/types.ts';
import {
  getSessionDataPath,
  getSessionPath,
  getSessionPlansPath,
} from '../../../sessions/storage.ts';
import { extractWorkspaceSlug } from '../../../utils/workspace.ts';
import type { ChatOptions, BackendConfig, PermissionRequestType } from '../types.ts';
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
  cloneOmpSubagentState,
  createOmpSubagentState,
  reduceOmpSubagentState,
  type OmpSubagentState,
  type OmpSubagentStateAction,
  type OmpSubagentStateItem,
  type OmpSubagentTranscriptCursor,
} from './omp-subagent-state.ts';
import {
  type OmpControlState,
  type OmpPlanControlState,
  DEFAULT_OMP_RPC_LONG_REQUEST_TIMEOUT_MS,
  DEFAULT_OMP_RPC_REQUEST_TIMEOUT_MS,
  getOmpRpcCommandTimeout,
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
  parseOmpConfigUpdateFrame,
  parseOmpExportHtmlResponseData,
  parseOmpExtensionErrorFrame,
  parseOmpHandoffResult,
  parseOmpLoginProvidersResponseData,
  parseOmpLoginResult,
  parseOmpReadyFrame,
  parseOmpSetHostToolsResponseData,
  parseOmpSetHostUriSchemesResponseData,
  parseOmpLastAssistantTextResponseData,
  parseOmpMessagesResponseData,
  parseOmpPlanModeState,
  parseOmpPromptResponseData,
  parseOmpRuntimeEvent,
  parseOmpSessionShutdownFrame,
  parseOmpSetTodosResponseData,
  parseOmpSessionState,
  parseOmpSessionStats,
  parseOmpStderrFrame,
  parseOmpSubagentFrame,
  parseOmpSubagentMessagesResponseData,
  parseOmpSubagentsResponseData,
  parseOmpTodoEvent,
  parseOmpToolExecutionUpdateFrame,
  extractOmpTodoPhasesFromTranscriptEntries,
  type OmpSubagentFrame,
  type OmpSubagentSnapshot,
  type OmpTodoPhase,
  type OmpRpcAgentToolContent,
  type OmpRpcAvailableSlashCommand,
  type OmpRpcAgentToolResult,
  type OmpRpcBranchMessage,
  type OmpRpcBranchResult,
  type OmpRpcCancellationResult,
  type OmpRpcCommand,
  type OmpRpcConfigUpdateFrame,
  type OmpRpcExportHtmlResponseData,
  type OmpRpcExtensionErrorFrame,
  type OmpRpcExtensionUiResponse,
  type OmpRpcHandoffResult,
  type OmpRpcHostToolCallFrame,
  type OmpRpcHostToolDefinition,
  type OmpRpcHostToolResultFrame,
  type OmpRpcHostToolUpdateFrame,
  type OmpRpcHostUriCancelFrame,
  type OmpRpcHostUriRequestFrame,
  type OmpRpcHostUriResultFrame,
  type OmpRpcLoginProvider,
  type OmpRpcLoginResult,
  type OmpRpcPlanModeState,
  type OmpRpcPlanReviewRequestFrame,
  type OmpRpcReadyFrame,
  type OmpRpcSessionShutdownFrame,
  type OmpRpcSessionState,
  type OmpRpcSessionInfoUpdateFrame,
  type OmpRpcStderrFrame,
  type OmpRuntimeConfig,
  type OmpRuntimeState,
  type OmpStderrLevel,
  type OmpThinkingLevel,
} from './omp-rpc-protocol.ts';
import { checkOmpVersionCompatibility } from './omp-version-check.ts';
import type { OmpTodoMutationDto } from '../../../protocol/dto.ts';

export const DEFAULT_OMP_MODEL = 'omp/default';
export const DEFAULT_OMP_HOST_TOOL_MAX_CONCURRENT_EXECUTIONS = 4;
const OMP_HOST_URI_SCHEME = 'craft-session';
const OMP_HOST_WORKSPACE_URI_SCHEME = 'craft-workspace';
const OMP_HOST_URI_ARTIFACTS_PATH = 'artifacts';
const OMP_HOST_URI_ARTIFACTS_DIR = 'omp-artifacts';
const OMP_HOST_URI_AUDIT_FILE = 'omp-host-uri-audit.jsonl';

function positiveIntegerOrDefault(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

export function dedupeOmpHostToolDefinitions(
  tools: OmpRpcHostToolDefinition[],
): { tools: OmpRpcHostToolDefinition[]; skippedNames: string[] } {
  const seen = new Set<string>();
  const deduped: OmpRpcHostToolDefinition[] = [];
  const skippedNames: string[] = [];
  for (const tool of tools) {
    if (seen.has(tool.name)) {
      skippedNames.push(tool.name);
      continue;
    }
    seen.add(tool.name);
    deduped.push(tool);
  }
  return { tools: deduped, skippedNames };
}

function mapBrowserToolErrorCode(code: string): string | null {
  switch (code) {
    case 'BROWSER_NO_CAPABLE_CLIENT':
    case 'CAPABILITY_UNAVAILABLE':
      return 'No connected desktop client supports browser tools, or no client is currently connected. ' +
        'Ask the user to open this workspace from the Craft Agent desktop app.';
    case 'CLIENT_DISCONNECTED':
      return 'The desktop client that owned this browser session disconnected. ' +
        'Ask the user to reconnect and retry.';
    case 'CLIENT_REQUEST_TIMEOUT':
      return 'Browser operation timed out (>30s). The desktop client may be unresponsive.';
    case 'BROWSER_INSTANCE_NOT_OWNED':
      return 'That browser instance ID does not belong to this session. ' +
        'Use `windows` to list owned instances, or `open` to create a new one.';
    case 'BROWSER_REMOTE_UPLOAD_NOT_SUPPORTED':
      return 'File upload from a remote agent is not supported. ' +
        'Ask the user to attach the file to the session.';
    case 'BROWSER_REMOTE_EVALUATE_BLOCKED':
      return 'JavaScript evaluation is disabled on this desktop client. ' +
        'Ask the user to enable it in settings.';
    default:
      return null;
  }
}

function createHostToolAbortError(message: string): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

export interface OmpModelSelection {
  provider: string;
  modelId: string;
}

export interface OmpLoginOptions {
  onOpenUrl?: (payload: { url?: string; launchUrl?: string; instructions?: string }) => void;
  signal?: AbortSignal;
}

export interface OmpLoginResult {
  providerId: string;
  openUrl?: string;
  launchUrl?: string;
  instructions?: string;
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
  command: string;
  startedAt: number;
}

interface PendingLogin {
  requestId: string;
  onOpenUrl?: (payload: { url?: string; launchUrl?: string; instructions?: string }) => void;
  openUrlPayload?: { url?: string; launchUrl?: string; instructions?: string };
  resolve(result: OmpLoginResult): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
  onAbort?: () => void;
}

interface ActiveTurn {
  requestId: string;
  processGeneration: number;
  finished: boolean;
}

interface PendingHostToolExecution {
  requestId: string;
  toolName: string;
  startedAt: number;
  controller: AbortController;
  timer: ReturnType<typeof setTimeout>;
  settled: boolean;
  cooperativelyCancellable: boolean;
  updateTimer: ReturnType<typeof setTimeout> | null;
  pendingUpdateText?: string;
  lastSentUpdateText?: string;
}

interface PendingHostToolPermission {
  resolve(allowed: boolean): void;
  toolName: string;
  command?: string;
  hostRequestId: string;
}

interface PendingHostUriRequest {
  url: string;
  operation: 'read' | 'write';
  cancelled: boolean;
  startedAt: number;
}

interface HostUriArtifactTarget {
  relativePath: string;
  rootPath: string;
  filePath: string;
}

interface HostUriAuditRecord {
  timestamp: number;
  operation: 'read' | 'write';
  url: string;
  contentType?: string;
  bytes?: number;
  allowed: boolean;
  relativePath?: string;
  resultPath?: string;
  error?: string;
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
  /** Override host bridge registration timeout for deterministic tests. */
  hostBridgeRequestTimeoutMs?: number;
  /** Override the maximum lifetime of one OMP host tool call. */
  hostToolExecutionTimeoutMs?: number;
  /** Override host tool progress coalescing for deterministic tests. */
  hostToolUpdateThrottleMs?: number;
  /** Maximum concurrent OMP host tool executions per backend instance. */
  hostToolMaxConcurrentExecutions?: number;
  /** Disable the host bridge for isolated utility completions. */
  hostBridgeEnabled?: boolean;
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

  if ('action' in response) {
    throw new Error('OMP Plan review responses must use plan_review_result, not extension_ui_response');
  }

  return {
    type: 'extension_ui_response',
    id: requestId,
    confirmed: response.confirmed,
  };
}

function createOmpPlanControlState(): OmpPlanControlState {
  return {
    supported: false,
    state: { enabled: false, phase: 'inactive' },
    updatedAt: Date.now(),
  };
}

function cloneOmpPlanControlState(state: OmpPlanControlState): OmpPlanControlState {
  return {
    ...state,
    state: { ...state.state },
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
  private planState: OmpPlanControlState = createOmpPlanControlState();
  private todoState: OmpTodoState = createOmpTodoState();
  private todoRefresh: Promise<OmpTodoState> | null = null;
  private todoWrite: Promise<OmpTodoState> | null = null;
  private subagentState: OmpSubagentState = createOmpSubagentState();
  private subagentRefresh: Promise<void> | null = null;
  private subagentRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private hostBridgeRegistration: Promise<void> | null = null;
  private sessionToolContext: SessionToolContext | null = null;
  private registeredHostToolNames = new Set<string>();
  private pendingHostToolExecutions = new Map<string, PendingHostToolExecution>();
  private pendingHostToolPermissions = new Map<string, PendingHostToolPermission>();
  private ignoredHostToolPermissionIds = new Set<string>();
  private pendingHostUriRequests = new Map<string, PendingHostUriRequest>();
  private pendingLogin: PendingLogin | null = null;
  private availableCommands: OmpRpcAvailableSlashCommand[] = [];
  private controlStateUpdatedAt = Date.now();
  private remoteThinkingLevel: OmpThinkingLevel | null = null;
  private thinkingLevelUpdate: Promise<void> | null = null;
  private activeTurn: ActiveTurn | null = null;
  private sessionLink: OmpSessionLink | null = null;
  private readonly spawnProcess: typeof spawn;
  private readonly readyTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly requestTimeoutOverrideMs?: number;
  private readonly longRequestTimeoutMs: number;
  private readonly hostBridgeRequestTimeoutMs: number;
  private readonly hostToolExecutionTimeoutMs: number;
  private readonly hostToolUpdateThrottleMs: number;
  private readonly hostToolMaxConcurrentExecutions: number;
  private readonly hostBridgeEnabled: boolean;
  private readonly attachmentReadFile?: (path: string) => Buffer;
  onControlStateChange: ((state: OmpControlState) => void) | null = null;
  onTodoStateChange: ((state: OmpTodoState) => void) | null = null;
  onSubagentStateChange: ((state: OmpSubagentState) => void) | null = null;

  constructor(config: BackendConfig, options: OmpRpcBackendOptions = {}) {
    super(config, DEFAULT_OMP_MODEL);
    this._supportsBranching = false;
    this.sessionLink = config.session?.ompSessionLink ?? null;
    this.spawnProcess = options.spawnProcess ?? spawn;
    this.readyTimeoutMs = options.readyTimeoutMs ?? 15_000;
    this.requestTimeoutOverrideMs = options.requestTimeoutMs;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_OMP_RPC_REQUEST_TIMEOUT_MS;
    this.longRequestTimeoutMs = options.longRequestTimeoutMs ?? DEFAULT_OMP_RPC_LONG_REQUEST_TIMEOUT_MS;
    this.hostBridgeRequestTimeoutMs = options.hostBridgeRequestTimeoutMs ?? 3_000;
    this.hostToolExecutionTimeoutMs = options.hostToolExecutionTimeoutMs ?? 120_000;
    this.hostToolUpdateThrottleMs = options.hostToolUpdateThrottleMs ?? 100;
    this.hostToolMaxConcurrentExecutions = positiveIntegerOrDefault(
      options.hostToolMaxConcurrentExecutions,
      DEFAULT_OMP_HOST_TOOL_MAX_CONCURRENT_EXECUTIONS,
    );
    this.hostBridgeEnabled = options.hostBridgeEnabled ?? true;
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
      await this.waitForHostBridgeRegistration();
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

      const sourceActivationDrain = new SourceActivationDrainController('fire-on-non-tool-result');
      for await (const event of this.eventQueue.drain()) {
        const preFire = sourceActivationDrain.shouldFireBeforeEvent(event);
        if (preFire) {
          this.debug(`source_test activated "${preFire.sourceSlug}", drained sibling OMP tool_results, restarting turn`);
          yield preFire;
          this.forceAbort(AbortReason.SourceActivated);
          return;
        }

        if (sourceActivationDrain.observe(event, () => this.consumePendingSourceActivationRestart())) {
          yield event;
          continue;
        }

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

      const sourceActivationFireAtEnd = sourceActivationDrain.shouldFireAtBoundary();
      if (sourceActivationFireAtEnd) {
        this.debug(`source_test activated "${sourceActivationFireAtEnd.sourceSlug}", OMP stream ended with pending restart, restarting turn`);
        yield sourceActivationFireAtEnd;
        this.forceAbort(AbortReason.SourceActivated);
        return;
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
    this.resolvePendingHostToolPermissions(false);
    this.send({ type: 'abort' }).catch((error) => {
      this.debug(`Abort command failed: ${error instanceof Error ? error.message : String(error)}`);
    });
    this.finishTurnOrIdle();
  }

  forceAbort(reason: AbortReason): void {
    this.abortReason = reason;
    this._isProcessing = false;
    this.resolvePendingHostToolPermissions(false);
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

  respondToPermission(requestId: string, allowed: boolean, alwaysAllow?: boolean): void {
    if (this.ignoredHostToolPermissionIds.delete(requestId)) return;
    const pendingHostPermission = this.pendingHostToolPermissions.get(requestId);
    if (pendingHostPermission) {
      this.pendingHostToolPermissions.delete(requestId);
      if (allowed && alwaysAllow && pendingHostPermission.command) {
        this.permissionManager.whitelistCommand(pendingHostPermission.command);
      }
      pendingHostPermission.resolve(allowed);
      return;
    }

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

  private async collectMiniCompletion(
    events: AsyncIterable<AgentEvent>,
    onTextUpdate?: (text: string) => void,
  ): Promise<string | null> {
    let streamed = '';
    let completed = '';
    for await (const event of events) {
      if (event.type === 'text_delta' && !event.isThinking) {
        streamed += event.text;
        onTextUpdate?.(streamed);
      }
      if (event.type === 'text_complete' && !event.isIntermediate) {
        completed = event.text;
        onTextUpdate?.(completed);
      }
      if (event.type === 'error') {
        this.debug(`runMiniCompletion stream error: ${event.message}`);
      }
    }

    const text = (completed || streamed).trim();
    return text || null;
  }

  private async runIsolatedMiniCompletion(
    prompt: string,
    model: string | undefined = this._model,
    lifecycle?: {
      signal?: AbortSignal;
      onTextUpdate?: (text: string) => void;
    },
  ): Promise<string | null> {
    if (lifecycle?.signal?.aborted) {
      throw createHostToolAbortError('OMP mini completion was cancelled');
    }

    const session = this.config.session;
    const isolatedSessionId = `${session?.id ?? this._sessionId}-omp-query-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const isolatedConfig: BackendConfig = {
      ...this.config,
      model,
      skipConfigWatcher: true,
      automationSystem: undefined,
      onSdkSessionIdUpdate: undefined,
      onSdkSessionIdCleared: undefined,
      onOmpSessionLinkUpdate: undefined,
      session: session
        ? {
            ...session,
            id: isolatedSessionId,
            sdkSessionId: undefined,
            ompSessionLink: undefined,
          }
        : undefined,
    };
    const isolated = new OmpRpcBackend(isolatedConfig, {
      spawnProcess: this.spawnProcess,
      readyTimeoutMs: this.readyTimeoutMs,
      requestTimeoutMs: this.requestTimeoutMs,
      longRequestTimeoutMs: this.longRequestTimeoutMs,
      hostBridgeRequestTimeoutMs: this.hostBridgeRequestTimeoutMs,
      hostToolExecutionTimeoutMs: this.hostToolExecutionTimeoutMs,
      hostToolUpdateThrottleMs: this.hostToolUpdateThrottleMs,
      hostToolMaxConcurrentExecutions: this.hostToolMaxConcurrentExecutions,
      hostBridgeEnabled: false,
      attachmentReadFile: this.attachmentReadFile,
    });
    isolated.setThinkingLevel(this.getThinkingLevel());
    isolated.onDebug = (message) => this.debug(`[call_llm] ${message}`);

    let rejectAbort: ((error: Error) => void) | null = null;
    const abortPromise = new Promise<never>((_resolve, reject) => {
      rejectAbort = reject;
    });
    const onAbort = () => {
      isolated.destroy();
      rejectAbort?.(createHostToolAbortError('OMP mini completion was cancelled'));
    };
    lifecycle?.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      return await Promise.race([
        isolated.collectMiniCompletion(isolated.chatImpl(prompt), lifecycle?.onTextUpdate),
        abortPromise,
      ]);
    } finally {
      lifecycle?.signal?.removeEventListener('abort', onAbort);
      isolated.destroy();
    }
  }

  async runMiniCompletion(prompt: string): Promise<string | null> {
    if (this._isProcessing) {
      this.debug('runMiniCompletion is using an isolated OMP process while the main turn is active');
      return this.runIsolatedMiniCompletion(prompt);
    }
    return this.collectMiniCompletion(this.chat(prompt));
  }

  async queryLlm(request: LLMQueryRequest): Promise<LLMQueryResult> {
    const prompt = [
      request.systemPrompt ? `System: ${request.systemPrompt}` : '',
      request.prompt,
    ].filter(Boolean).join('\n\n');

    const text = this._isProcessing
      ? await this.runIsolatedMiniCompletion(prompt, request.model)
      : await this.collectMiniCompletion(this.chat(prompt));
    return {
      text: text ?? '',
      model: request.model ?? this._model,
    };
  }

  private async queryLlmForHostTool(
    request: LLMQueryRequest,
    execution: PendingHostToolExecution,
  ): Promise<LLMQueryResult> {
    const prompt = [
      request.systemPrompt ? `System: ${request.systemPrompt}` : '',
      request.prompt,
    ].filter(Boolean).join('\n\n');
    execution.cooperativelyCancellable = true;
    const text = await this.runIsolatedMiniCompletion(prompt, request.model, {
      signal: execution.controller.signal,
      onTextUpdate: update => this.queueHostToolTextUpdate(execution, update),
    });
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
      plan: cloneOmpPlanControlState(this.planState),
      updatedAt: this.controlStateUpdatedAt,
    };
  }

  async setOmpPlanMode(enabled: boolean): Promise<OmpPlanControlState> {
    await this.ensureSubprocess();
    if (!this.planState.supported) {
      throw new Error('This OMP runtime does not expose native Plan Mode over RPC');
    }
    const data = await this.send({ type: 'set_plan_mode', enabled });
    const state = parseOmpPlanModeState(data);
    if (!state) throw new Error('OMP set_plan_mode returned an invalid Plan Mode state');
    this.applyPlanState(state, true);
    return cloneOmpPlanControlState(this.planState);
  }

  async respondToOmpPlanReview(
    requestId: string,
    response: Extract<ExtensionUiResponse, { action: 'approve' | 'refine' | 'cancel' }>,
  ): Promise<void> {
    if (!this.child) throw new Error('OMP session is not running');
    await this.send({
      type: 'plan_review_result',
      requestId,
      action: response.action,
      ...(response.feedback?.trim() ? { feedback: response.feedback.trim() } : {}),
    });
  }

  getOmpTodoState(): OmpTodoState {
    return cloneOmpTodoState(this.todoState);
  }

  getOmpSubagentState(): OmpSubagentState {
    return cloneOmpSubagentState(this.subagentState);
  }

  async getOmpLoginProviders(): Promise<OmpRpcLoginProvider[]> {
    await this.ensureSubprocess();
    const data = await this.send({ type: 'get_login_providers' });
    const parsed = parseOmpLoginProvidersResponseData(data);
    if (!parsed) throw new Error('OMP get_login_providers returned an invalid provider list');
    return parsed.providers;
  }

  async loginOmpProvider(providerId: string, options: OmpLoginOptions = {}): Promise<OmpLoginResult> {
    await this.ensureSubprocess();
    if (this.pendingLogin) {
      throw new Error('An OMP login flow is already in progress');
    }

    const { id: requestId, promise: requestPromise } = this.createRequest({ type: 'login', providerId });

    return new Promise<OmpLoginResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingLogin = null;
        reject(new Error(`OMP login for ${providerId} timed out`));
      }, DEFAULT_OMP_RPC_LONG_REQUEST_TIMEOUT_MS);

      const onAbort = () => {
        this.pendingLogin = null;
        clearTimeout(timer);
        reject(new Error(`OMP login for ${providerId} was cancelled`));
      };

      this.pendingLogin = {
        requestId,
        onOpenUrl: options.onOpenUrl,
        resolve: (result) => {
          this.pendingLogin = null;
          clearTimeout(timer);
          options.signal?.removeEventListener('abort', onAbort);
          resolve(result);
        },
        reject: (error) => {
          this.pendingLogin = null;
          clearTimeout(timer);
          options.signal?.removeEventListener('abort', onAbort);
          reject(error);
        },
        timer,
        onAbort,
      };

      options.signal?.addEventListener('abort', onAbort, { once: true });

      requestPromise.then((data) => {
        const parsed = parseOmpLoginResult(data);
        if (!parsed) {
          this.pendingLogin?.reject(new Error('OMP login returned an invalid result'));
          return;
        }
        const openUrlPayload = this.pendingLogin?.openUrlPayload;
        this.pendingLogin?.resolve({
          providerId: parsed.providerId,
          ...(openUrlPayload
            ? {
                openUrl: openUrlPayload.url,
                launchUrl: openUrlPayload.launchUrl,
                instructions: openUrlPayload.instructions,
              }
            : {}),
        });
      }).catch((error) => {
        this.pendingLogin?.reject(error);
      });
    });
  }

  async refreshOmpSubagents(): Promise<OmpSubagentState> {
    await this.ensureSubprocess();
    await this.refreshOmpSubagentsInternal();
    return this.getOmpSubagentState();
  }

  async loadOmpSubagentMessages(subagentId: string, fromByte?: number): Promise<OmpSubagentState> {
    await this.ensureSubprocess();
    await this.loadSubagentMessagesInternal(subagentId, fromByte);
    return this.getOmpSubagentState();
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

  async getOmpLastAssistantText(): Promise<string | null> {
    await this.ensureSubprocess();
    const data = await this.send({ type: 'get_last_assistant_text' });
    const parsed = parseOmpLastAssistantTextResponseData(data);
    if (!parsed) throw new Error('OMP get_last_assistant_text returned an invalid result');
    return parsed.text;
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
    const ompHome = env.CRAFT_OMP_HOME;
    if (ompHome) {
      // Keep OMP's user/config directory isolated when the host explicitly
      // requests it (release smoke tests use this to provide a model catalog).
      // Do not alter the Electron host process environment itself.
      env.HOME = ompHome;
      env.USERPROFILE = ompHome;
    }

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

    if (this.pendingLogin && raw.type === 'extension_ui_request' && raw.method === 'open_url') {
      const pending = this.pendingLogin;
      pending.openUrlPayload = {
        url: typeof raw.url === 'string' ? raw.url : undefined,
        launchUrl: typeof raw.launchUrl === 'string' ? raw.launchUrl : undefined,
        instructions: typeof raw.instructions === 'string' ? raw.instructions : undefined,
      };
      try {
        pending.onOpenUrl?.(pending.openUrlPayload);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        pending.reject(new Error(`Host open-url callback failed: ${message}`));
      }
      return;
    }

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

    if (adapted.readyFrame) {
      this.handleReadyFrame(adapted.readyFrame);
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
      this.updateRuntimeState({
        type: 'config_update',
        config: { thinkingLevel: adapted.thinkingLevel },
      });
      this.touchControlState();
    }

    if (adapted.queueState) {
      this.patchQueueState(adapted.queueState);
    }

    if (adapted.configUpdate?.config) {
      const config = adapted.configUpdate.config;
      const runtimeConfig: OmpRuntimeConfig = {};
      if (config.model && typeof config.model === 'string') {
        runtimeConfig.model = config.model;
        super.setModel(config.model);
        this.selectedModelKey = config.model;
      }
      const level = config.thinkingLevel ?? config.thinking_level;
      if (
        level === 'off'
        || level === 'minimal'
        || level === 'low'
        || level === 'medium'
        || level === 'high'
        || level === 'xhigh'
      ) {
        runtimeConfig.thinkingLevel = level;
      }
      if (typeof config.autoCompactionEnabled === 'boolean') runtimeConfig.autoCompactionEnabled = config.autoCompactionEnabled;
      if (typeof config.autoRetryEnabled === 'boolean') runtimeConfig.autoRetryEnabled = config.autoRetryEnabled;
      const steeringMode = config.steeringMode ?? config.steering_mode;
      if (steeringMode === 'all' || steeringMode === 'one-at-a-time') runtimeConfig.steeringMode = steeringMode;
      const followUpMode = config.followUpMode ?? config.follow_up_mode;
      if (followUpMode === 'all' || followUpMode === 'one-at-a-time') runtimeConfig.followUpMode = followUpMode;
      const interruptMode = config.interruptMode ?? config.interrupt_mode;
      if (interruptMode === 'immediate' || interruptMode === 'wait') runtimeConfig.interruptMode = interruptMode;

      this.updateRuntimeState({ type: 'config_update', config: runtimeConfig });
    }

    if (adapted.availableCommands) {
      this.applyAvailableCommands(adapted.availableCommands);
    }

    if (adapted.planModeState) {
      this.applyPlanState(adapted.planModeState.state, true);
    }

    if (adapted.planReviewRequest) {
      this.enqueuePlanReviewRequest(adapted.planReviewRequest);
    }

    if (adapted.sessionInfoUpdate) {
      this.applySessionInfoUpdate(adapted.sessionInfoUpdate);
      this.updateRuntimeState({
        type: 'session_info_update',
        sessionId: adapted.sessionInfoUpdate.sessionId,
      });
    }

    if (adapted.sessionShutdown) {
      this.updateRuntimeState({
        type: 'session_shutdown',
        reason: adapted.sessionShutdown.reason ?? 'normal',
        errorMessage: adapted.sessionShutdown.errorMessage,
      });
    }

    if (adapted.extensionError) {
      this.updateRuntimeState({
        type: 'extension_error',
        error: {
          extensionId: adapted.extensionError.extensionId,
          source: adapted.extensionError.source,
          message: adapted.extensionError.message ?? 'Unknown extension error',
        },
      });
    }

    if (adapted.stderr) {
      const level = this.classifyStderrLevel(adapted.stderr);
      this.updateRuntimeState({
        type: 'stderr',
        level,
        text: adapted.stderr.text ?? '',
      });
      if (level === 'fatal') {
        this.eventQueue.enqueue({
          type: 'error',
          message: adapted.stderr.text ?? 'OMP fatal error',
        });
      }
    }

    if (adapted.hostToolCall) {
      void this.handleHostToolCall(adapted.hostToolCall).catch((error) => {
        this.debug(`OMP host tool call handling failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }

    if (adapted.hostToolCancel) {
      this.handleHostToolCancel(adapted.hostToolCancel.targetId);
    }

    if (adapted.hostUriRequest) {
      void this.handleHostUriRequest(adapted.hostUriRequest).catch((error) => {
        this.debug(`OMP host URI request handling failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }

    if (adapted.hostUriCancel) {
      this.handleHostUriCancel(adapted.hostUriCancel);
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

  private send<T = unknown>(command: OmpRpcCommand, timeoutMs?: number): Promise<T> {
    return this.createRequest<T>(command, timeoutMs).promise;
  }

  private createRequest<T = unknown>(command: OmpRpcCommand, timeoutMsOverride?: number): { id: string; promise: Promise<T> } {
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
    const timeoutMs = timeoutMsOverride
      ?? this.requestTimeoutOverrideMs
      ?? getOmpRpcCommandTimeout(commandName, this.requestTimeoutMs, this.longRequestTimeoutMs);
    const startedAt = this.diagnostics.recordRequest(commandName);

    const promise = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        this.diagnostics.recordTimeout(commandName);
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

  private writeSideChannel(
    frame:
      | OmpRpcExtensionUiResponse
      | OmpRpcHostToolResultFrame
      | OmpRpcHostToolUpdateFrame
      | OmpRpcHostUriResultFrame,
  ): Promise<void> {
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

    if (this.pendingLogin) {
      const pending = this.pendingLogin;
      this.pendingLogin = null;
      clearTimeout(pending.timer);
      pending.reject(error);
    }
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
    this.planState = createOmpPlanControlState();
    this.subagentRefresh = null;
    this.hostBridgeRegistration = null;
    this.registeredHostToolNames.clear();
    this.abortAllPendingHostToolExecutions('OMP RPC backend disconnected');
    this.resolvePendingHostToolPermissions(false);
    this.pendingHostUriRequests.clear();
    if (this.pendingLogin) {
      const pending = this.pendingLogin;
      this.pendingLogin = null;
      clearTimeout(pending.timer);
    }
    this.updateRuntimeState({ type: 'unavailable', error: 'OMP runtime is not connected' });
    this.updateTodoState({ type: 'unavailable', error: 'OMP runtime is not connected' });
    this.updateSubagentState({ type: 'unavailable', error: 'OMP runtime is not connected' });
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
      if (this.hostBridgeEnabled) {
        this.startHostBridgeRegistrationForReady(generation, child);
      }
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

  private startHostBridgeRegistrationForReady(
    generation: number,
    child: ChildProcessWithoutNullStreams,
  ): void {
    const registration = this.registerHostBridgeForReady(generation, child);
    this.hostBridgeRegistration = registration;
    registration.finally(() => {
      if (this.hostBridgeRegistration === registration) this.hostBridgeRegistration = null;
    }).catch(() => {
      // Registration is best-effort; individual failures are logged by the
      // registration methods and must not surface as unhandled rejections.
    });
  }

  private async waitForHostBridgeRegistration(): Promise<void> {
    const registration = this.hostBridgeRegistration;
    if (!registration) return;
    try {
      await registration;
    } catch {
      // Registration is best-effort and logs its own failures.
    }
  }

  private async registerHostBridgeForReady(
    generation: number,
    child: ChildProcessWithoutNullStreams,
  ): Promise<void> {
    await Promise.all([
      this.registerHostToolsForReady(generation, child),
      this.registerHostUriSchemesForReady(generation, child),
    ]);
  }

  private buildHostToolDefinitions(): OmpRpcHostToolDefinition[] {
    const hostToolNames = new Set(
      getSessionToolDefs({ includeDeveloperFeedback: FEATURE_FLAGS.developerFeedback })
        .map(def => def.name),
    );

    const definitions = getToolDefsAsJsonSchema({
      includeDeveloperFeedback: FEATURE_FLAGS.developerFeedback,
    })
      .filter(def => hostToolNames.has(def.name))
      .map(def => ({
        name: def.name,
        description: def.description,
        parameters: def.inputSchema,
      }));
    const deduped = dedupeOmpHostToolDefinitions(definitions);
    if (deduped.skippedNames.length > 0) {
      this.debug(`Skipped duplicate OMP host tool definitions: ${deduped.skippedNames.join(', ')}`);
    }
    return deduped.tools;
  }

  private async registerHostToolsForReady(
    generation: number,
    child: ChildProcessWithoutNullStreams,
  ): Promise<void> {
    if (generation !== this.processGeneration || child !== this.child) return;
    const tools = this.buildHostToolDefinitions();
    if (tools.length === 0) return;

    try {
      const data = await this.send(
        { type: 'set_host_tools', tools },
        this.hostBridgeRequestTimeoutMs,
      );
      if (generation !== this.processGeneration || child !== this.child) return;

      const parsed = parseOmpSetHostToolsResponseData(data);
      if (!parsed) {
        this.registeredHostToolNames = new Set(tools.map(tool => tool.name));
        this.debug('OMP set_host_tools returned an invalid acknowledgement; keeping local host tool registry');
        return;
      }

      this.registeredHostToolNames = new Set(parsed.toolNames);
      this.debug(`Registered ${parsed.toolNames.length} OMP host tools`);
    } catch (error) {
      if (generation !== this.processGeneration || child !== this.child) return;
      this.registeredHostToolNames.clear();
      this.debug(`OMP host tool registration failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async registerHostUriSchemesForReady(
    generation: number,
    child: ChildProcessWithoutNullStreams,
  ): Promise<void> {
    if (generation !== this.processGeneration || child !== this.child) return;

    try {
      const data = await this.send(
        {
          type: 'set_host_uri_schemes',
          schemes: [
            {
              scheme: OMP_HOST_URI_SCHEME,
              description: 'Read session snapshots and write scoped session artifacts.',
              writable: true,
              immutable: false,
            },
            {
              scheme: OMP_HOST_WORKSPACE_URI_SCHEME,
              description: 'Read sanitized workspace-level Craft metadata.',
              writable: false,
              immutable: false,
            },
          ],
        },
        this.hostBridgeRequestTimeoutMs,
      );
      if (generation !== this.processGeneration || child !== this.child) return;

      const parsed = parseOmpSetHostUriSchemesResponseData(data);
      if (!parsed) {
        this.debug('OMP set_host_uri_schemes returned an invalid acknowledgement');
        return;
      }
      this.debug(`Registered ${parsed.schemes.length} OMP host URI schemes`);
    } catch (error) {
      if (generation !== this.processGeneration || child !== this.child) return;
      this.debug(`OMP host URI scheme registration failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private getHostSessionToolContext(execution?: PendingHostToolExecution): SessionToolContext {
    let baseContext = this.sessionToolContext;
    if (!baseContext) {
      const sessionId = this.config.session?.id || this._sessionId;
      const workspacePath = this.config.workspace.rootPath;
      const workspaceId = this.config.workspace.id;
      baseContext = createClaudeContext({
        sessionId,
        workspacePath,
        workspaceId,
        onPlanSubmitted: (planPath: string) => {
          setLastPlanFilePath(sessionId, planPath);
          this.onPlanSubmitted?.(planPath);
        },
        onAuthRequest: (request: unknown) => {
          this.onAuthRequest?.(request as AuthRequest);
        },
      });
      attachSessionSelfManagementBindings(baseContext, sessionId);
      this.sessionToolContext = baseContext;
    }

    if (!execution) return baseContext;

    const context = Object.create(Object.getPrototypeOf(baseContext)) as SessionToolContext;
    Object.defineProperties(context, Object.getOwnPropertyDescriptors(baseContext));
    context.abortSignal = execution.controller.signal;
    return context;
  }

  private createPendingHostToolExecution(
    request: OmpRpcHostToolCallFrame,
  ): PendingHostToolExecution {
    const controller = new AbortController();
    const execution: PendingHostToolExecution = {
      requestId: request.id,
      toolName: request.toolName,
      startedAt: Date.now(),
      controller,
      timer: setTimeout(() => {
        this.handleHostToolTimeout(execution);
      }, this.hostToolExecutionTimeoutMs),
      settled: false,
      cooperativelyCancellable: false,
      updateTimer: null,
    };
    this.pendingHostToolExecutions.set(request.id, execution);
    return execution;
  }

  private isHostToolExecutionActive(execution: PendingHostToolExecution): boolean {
    return !execution.settled
      && this.pendingHostToolExecutions.get(execution.requestId) === execution;
  }

  private async awaitHostToolExecution<T>(
    execution: PendingHostToolExecution,
    operation: Promise<T>,
  ): Promise<T> {
    if (execution.controller.signal.aborted) {
      throw execution.controller.signal.reason
        ?? createHostToolAbortError(`Host tool "${execution.toolName}" was cancelled`);
    }

    let rejectAbort: ((reason: unknown) => void) | null = null;
    const abortPromise = new Promise<never>((_resolve, reject) => {
      rejectAbort = reject;
    });
    const onAbort = () => {
      rejectAbort?.(
        execution.controller.signal.reason
          ?? createHostToolAbortError(`Host tool "${execution.toolName}" was cancelled`),
      );
    };
    execution.controller.signal.addEventListener('abort', onAbort, { once: true });
    try {
      return await Promise.race([operation, abortPromise]);
    } finally {
      execution.controller.signal.removeEventListener('abort', onAbort);
    }
  }

  private settleHostToolExecution(
    execution: PendingHostToolExecution,
    options: { abort?: boolean; reason?: string } = {},
  ): boolean {
    if (!this.isHostToolExecutionActive(execution)) return false;
    execution.settled = true;
    clearTimeout(execution.timer);
    if (execution.updateTimer) {
      clearTimeout(execution.updateTimer);
      execution.updateTimer = null;
    }
    execution.pendingUpdateText = undefined;
    this.pendingHostToolExecutions.delete(execution.requestId);
    if (options.abort && !execution.controller.signal.aborted) {
      execution.controller.abort(
        createHostToolAbortError(options.reason ?? `Host tool "${execution.toolName}" was cancelled`),
      );
    }
    return true;
  }

  private abortAllPendingHostToolExecutions(reason: string): void {
    for (const execution of Array.from(this.pendingHostToolExecutions.values())) {
      this.settleHostToolExecution(execution, { abort: true, reason });
    }
  }

  private handleHostToolTimeout(execution: PendingHostToolExecution): void {
    const elapsedSeconds = Math.max(1, Math.ceil(this.hostToolExecutionTimeoutMs / 1000));
    if (!this.settleHostToolExecution(execution, {
      abort: true,
      reason: `Host tool "${execution.toolName}" timed out`,
    })) {
      return;
    }

    this.writeSideChannel({
      type: 'host_tool_result',
      id: execution.requestId,
      result: this.hostToolTextResult(
        `Host tool "${execution.toolName}" timed out after ${elapsedSeconds}s`,
      ),
      isError: true,
    }).catch((error) => {
      this.debug(`OMP host tool timeout response failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  private queueHostToolTextUpdate(
    execution: PendingHostToolExecution,
    text: string,
  ): void {
    const normalized = text.trim();
    if (
      !normalized
      || !this.isHostToolExecutionActive(execution)
      || normalized === execution.pendingUpdateText
      || normalized === execution.lastSentUpdateText
    ) {
      return;
    }

    execution.pendingUpdateText = normalized;
    if (execution.lastSentUpdateText === undefined) {
      void this.flushHostToolTextUpdate(execution);
      return;
    }
    if (execution.updateTimer) return;
    execution.updateTimer = setTimeout(() => {
      execution.updateTimer = null;
      void this.flushHostToolTextUpdate(execution);
    }, this.hostToolUpdateThrottleMs);
  }

  private async flushHostToolTextUpdate(
    execution: PendingHostToolExecution,
  ): Promise<void> {
    if (!this.isHostToolExecutionActive(execution)) return;
    if (execution.updateTimer) {
      clearTimeout(execution.updateTimer);
      execution.updateTimer = null;
    }
    const text = execution.pendingUpdateText;
    if (!text || text === execution.lastSentUpdateText) return;
    execution.pendingUpdateText = undefined;
    execution.lastSentUpdateText = text;

    try {
      await this.writeSideChannel({
        type: 'host_tool_update',
        id: execution.requestId,
        partialResult: this.hostToolTextResult(text),
      });
    } catch (error) {
      this.debug(`OMP host tool update failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private resolvePendingHostToolPermissions(allowed: boolean): void {
    const pending = Array.from(this.pendingHostToolPermissions.values());
    this.pendingHostToolPermissions.clear();
    for (const request of pending) {
      request.resolve(allowed);
    }
  }

  private ignoreLateHostToolPermissionResponse(requestId: string): void {
    this.ignoredHostToolPermissionIds.add(requestId);
    if (this.ignoredHostToolPermissionIds.size <= 100) return;
    const oldest = this.ignoredHostToolPermissionIds.values().next().value;
    if (typeof oldest === 'string') this.ignoredHostToolPermissionIds.delete(oldest);
  }

  private hostToolPermissionName(toolName: string): string {
    return `mcp__session__${toolName}`;
  }

  private async requestHostToolPermission(request: {
    toolName: string;
    command?: string;
    description: string;
    type?: PermissionRequestType;
    appName?: string;
    reason?: string;
    impact?: string;
    requiresSystemPrompt?: boolean;
    rememberForMinutes?: number;
    commandHash?: string;
    approvalTtlSeconds?: number;
  }, execution: PendingHostToolExecution): Promise<boolean> {
    if (!this.onPermissionRequest) return false;
    if (execution.controller.signal.aborted) return false;

    const requestId = `omp-host-perm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (allowed: boolean) => {
        if (settled) return;
        settled = true;
        execution.controller.signal.removeEventListener('abort', onAbort);
        this.pendingHostToolPermissions.delete(requestId);
        resolve(allowed);
      };
      const onAbort = () => {
        this.ignoreLateHostToolPermissionResponse(requestId);
        finish(false);
      };
      execution.controller.signal.addEventListener('abort', onAbort, { once: true });
      this.pendingHostToolPermissions.set(requestId, {
        resolve: finish,
        toolName: request.toolName,
        command: request.command,
        hostRequestId: execution.requestId,
      });
      try {
        this.onPermissionRequest?.({
          requestId,
          ...request,
        });
      } catch (error) {
        this.debug(`OMP host tool permission request failed: ${error instanceof Error ? error.message : String(error)}`);
        finish(false);
      }
    });
  }

  private async authorizeHostTool(
    toolName: string,
    args: Record<string, unknown>,
    execution: PendingHostToolExecution,
  ): Promise<{ ok: true; args: Record<string, unknown> } | { ok: false; message: string }> {
    const permissionToolName = this.hostToolPermissionName(toolName);
    const sessionId = this.config.session?.id || this._sessionId;
    const workspaceRootPath = this.config.workspace.rootPath;

    await this.emitAutomationEvent('PreToolUse', {
      hook_event_name: 'PreToolUse',
      tool_name: permissionToolName,
      tool_input: args,
    });
    if (execution.controller.signal.aborted) {
      return { ok: false, message: `Host tool "${toolName}" was cancelled.` };
    }

    const checkResult = runPreToolUseChecks({
      toolName: permissionToolName,
      input: args,
      sessionId,
      permissionMode: this.permissionManager.getPermissionMode(),
      workspaceRootPath,
      workspaceId: extractWorkspaceSlug(workspaceRootPath, this.config.workspace.id),
      plansFolderPath: getSessionPlansPath(workspaceRootPath, sessionId),
      dataFolderPath: getSessionDataPath(workspaceRootPath, sessionId),
      workingDirectory: this.config.session?.workingDirectory,
      activeSourceSlugs: Array.from(this.sourceManager.getActiveSlugs()),
      allSourceSlugs: this.sourceManager.getAllSources().map(source => source.config.slug),
      hasSourceActivation: !!this.onSourceActivationRequest,
      permissionManager: this.permissionManager,
      prerequisiteManager: this.prerequisiteManager,
      onDebug: (message) => this.debug(`PreToolUse(sessionId=${sessionId}): ${message}`),
    });

    switch (checkResult.type) {
      case 'allow':
        return { ok: true, args };
      case 'modify':
        return { ok: true, args: checkResult.input };
      case 'block':
        return { ok: false, message: checkResult.reason };
      case 'prompt': {
        const allowed = await this.requestHostToolPermission({
          toolName: permissionToolName,
          command: checkResult.command,
          description: checkResult.description,
          type: checkResult.promptType,
          appName: checkResult.appName,
          reason: checkResult.reason,
          impact: checkResult.impact,
          requiresSystemPrompt: checkResult.requiresSystemPrompt,
          rememberForMinutes: checkResult.rememberForMinutes,
          commandHash: checkResult.commandHash,
          approvalTtlSeconds: checkResult.approvalTtlSeconds,
        }, execution);
        if (!allowed) {
          return { ok: false, message: 'Permission denied by user.' };
        }
        return { ok: true, args: checkResult.modifiedInput ?? args };
      }
      case 'source_activation_needed':
        return {
          ok: false,
          message: `Source "${checkResult.sourceSlug}" is not active for this OMP host tool call.`,
        };
      case 'call_llm_intercept':
      case 'spawn_session_intercept':
        return { ok: true, args };
    }
  }

  private hostToolTextResult(text: string): OmpRpcAgentToolResult {
    return {
      content: [{ type: 'text', text }],
    };
  }

  private hostToolContentResult(
    content: OmpRpcAgentToolContent[],
    options: { details?: unknown; isError?: boolean } = {},
  ): OmpRpcAgentToolResult {
    const safeContent = content.filter((item): item is OmpRpcAgentToolContent => {
      if (item.type === 'text') return item.text.length > 0;
      return item.type === 'image' && item.data.length > 0 && item.mimeType.startsWith('image/');
    });
    return {
      content: safeContent.length > 0 ? safeContent : [{ type: 'text', text: 'Tool completed' }],
      ...(options.details !== undefined ? { details: options.details } : {}),
      ...(options.isError ? { isError: true } : {}),
    };
  }

  private sessionToolResultToHostToolResult(result: ToolResult): OmpRpcAgentToolResult {
    const content = result.content
      .map(item => ({ type: 'text' as const, text: item.text }))
      .filter(item => item.text.length > 0);
    return this.hostToolContentResult(content, {
      details: result.structuredContent,
      isError: result.isError,
    });
  }

  private formatHostToolValidationError(error: unknown): string {
    const issues = (error as { issues?: Array<{ path?: Array<string | number>; message?: string }> } | null)?.issues;
    if (!issues?.length) return error instanceof Error ? error.message : String(error);
    return issues
      .slice(0, 5)
      .map((issue) => {
        const path = issue.path?.length ? issue.path.join('.') : 'input';
        return `${path}: ${issue.message ?? 'invalid value'}`;
      })
      .join('; ');
  }

  private async executeBackendHostTool(
    toolName: string,
    args: Record<string, unknown>,
    execution: PendingHostToolExecution,
  ): Promise<{ result: OmpRpcAgentToolResult; isError?: boolean } | null> {
    if (toolName === 'call_llm') {
      execution.cooperativelyCancellable = true;
      const result = await this.preExecuteCallLlm(
        args,
        request => this.queryLlmForHostTool(request, execution),
      );
      return {
        result: this.hostToolTextResult(result.text || '(Model returned empty response)'),
      };
    }

    if (toolName === 'spawn_session') {
      const result = await this.preExecuteSpawnSession(args);
      return {
        result: this.hostToolTextResult(JSON.stringify(result, null, 2)),
      };
    }

    if (toolName !== 'browser_tool') return null;

    execution.cooperativelyCancellable = true;
    const sessionId = this.config.session?.id || this._sessionId;
    const browserFns = getSessionScopedToolCallbacks(sessionId)?.browserPaneFns;
    if (!browserFns) {
      return {
        result: this.hostToolTextResult(
          'Browser window controls are not available. This tool requires the desktop app.',
        ),
        isError: true,
      };
    }

    try {
      const browserResult = await executeBrowserToolCommand({
        command: (args.command as string | string[]) ?? '',
        fns: browserFns,
        sessionId,
        signal: execution.controller.signal,
      });
      let content = browserResult.output;

      if (browserResult.image) {
        const sessionPath = getSessionPath(this.config.workspace.rootPath, sessionId);
        const imageBuffer = Buffer.from(browserResult.image.data, 'base64');
        const extension = browserResult.image.mimeType === 'image/jpeg' ? 'jpg' : 'png';
        const saved = saveBinaryResponse(
          sessionPath,
          `browser-screenshot.${extension}`,
          imageBuffer,
          browserResult.image.mimeType,
        );

        if (saved.type === 'file_download') {
          content += [
            '',
            `Saved screenshot: ${saved.path}`,
            '',
            '```image-preview',
            JSON.stringify({
              src: saved.path,
              title: 'Browser Screenshot',
            }, null, 2),
            '```',
          ].join('\n');
        } else {
          content += `\n\n[Screenshot captured (${Math.round(browserResult.image.sizeBytes / 1024)}KB ${browserResult.image.mimeType}) but failed to save: ${saved.error}]`;
        }
      }

      const resultContent: OmpRpcAgentToolContent[] = [{ type: 'text', text: content }];
      if (browserResult.image) {
        resultContent.push({
          type: 'image',
          data: browserResult.image.data,
          mimeType: browserResult.image.mimeType,
        });
      }

      return { result: this.hostToolContentResult(resultContent) };
    } catch (error) {
      const rawCode = (error as { code?: unknown } | null)?.code;
      const code = typeof rawCode === 'string' ? rawCode : '';
      const message = mapBrowserToolErrorCode(code)
        ?? (error instanceof Error ? error.message : String(error));
      return {
        result: this.hostToolTextResult(message),
        isError: true,
      };
    }
  }

  private async executeHostTool(
    toolName: string,
    args: Record<string, unknown>,
    execution: PendingHostToolExecution,
  ): Promise<{ result: OmpRpcAgentToolResult; isError?: boolean }> {
    if (!this.registeredHostToolNames.has(toolName)) {
      return {
        result: this.hostToolTextResult(`Unknown or unregistered OMP host tool: ${toolName}`),
        isError: true,
      };
    }

    const def = SESSION_TOOL_REGISTRY.get(toolName);
    if (!def) {
      return {
        result: this.hostToolTextResult(`Unknown session tool: ${toolName}`),
        isError: true,
      };
    }

    const authorization = await this.authorizeHostTool(toolName, args, execution);
    if (!authorization.ok) {
      return {
        result: this.hostToolTextResult(authorization.message),
        isError: true,
      };
    }
    if (execution.controller.signal.aborted) {
      throw createHostToolAbortError(`Host tool "${toolName}" was cancelled`);
    }

    const parsed = def.inputSchema.safeParse(authorization.args);
    if (!parsed.success) {
      return {
        result: this.hostToolTextResult(`Invalid arguments for ${toolName}: ${this.formatHostToolValidationError(parsed.error)}`),
        isError: true,
      };
    }

    const backendResult = await this.executeBackendHostTool(toolName, parsed.data, execution);
    if (backendResult) return backendResult;

    if (!def.handler) {
      return {
        result: this.hostToolTextResult(
          `Session tool '${toolName}' is backend-executed (${def.executionMode}) but has no OMP host adapter implementation.`,
        ),
        isError: true,
      };
    }

    if (execution.controller.signal.aborted) {
      throw createHostToolAbortError(`Host tool "${toolName}" was cancelled`);
    }
    const result = await def.handler(this.getHostSessionToolContext(execution), parsed.data);
    return {
      result: this.sessionToolResultToHostToolResult(result),
      isError: !!result.isError,
    };
  }

  private async handleHostToolCall(request: OmpRpcHostToolCallFrame): Promise<void> {
    if (this.pendingHostToolExecutions.size >= this.hostToolMaxConcurrentExecutions) {
      await this.writeSideChannel({
        type: 'host_tool_result',
        id: request.id,
        result: this.hostToolTextResult(
          `Host tool quota is full (${this.hostToolMaxConcurrentExecutions} active). Try again after another host tool finishes.`,
        ),
        isError: true,
      });
      return;
    }

    const execution = this.createPendingHostToolExecution(request);

    try {
      const result = await this.awaitHostToolExecution(
        execution,
        this.executeHostTool(
          request.toolName,
          request.arguments,
          execution,
        ),
      );
      if (!this.isHostToolExecutionActive(execution)) return;
      await this.flushHostToolTextUpdate(execution);
      if (!this.settleHostToolExecution(execution)) return;
      await this.writeSideChannel({
        type: 'host_tool_result',
        id: request.id,
        result: result.result,
        ...(result.isError ? { isError: true } : {}),
      });
    } catch (error) {
      if (!this.settleHostToolExecution(execution)) return;
      const message = error instanceof Error ? error.message : String(error);
      await this.writeSideChannel({
        type: 'host_tool_result',
        id: request.id,
        result: this.hostToolTextResult(`Host tool ${request.toolName} failed: ${message}`),
        isError: true,
      });
    }
  }

  private handleHostToolCancel(targetId: string): void {
    const execution = this.pendingHostToolExecutions.get(targetId);
    if (!execution) return;
    if (!this.settleHostToolExecution(execution, {
      abort: true,
      reason: `Host tool "${execution.toolName}" was cancelled by OMP`,
    })) {
      return;
    }
    if (!execution.cooperativelyCancellable) {
      this.debug(`Cancelled non-cooperative host tool "${execution.toolName}"; late output will be ignored`);
    }
  }

  private hostUriError(
    request: OmpRpcHostUriRequestFrame,
    message: string,
  ): OmpRpcHostUriResultFrame {
    return {
      type: 'host_uri_result',
      id: request.id,
      isError: true,
      error: message,
      content: message,
      contentType: 'text/plain',
    };
  }

  private hostUriJsonResult(
    request: OmpRpcHostUriRequestFrame,
    value: unknown,
    notes?: string[],
  ): OmpRpcHostUriResultFrame {
    return {
      type: 'host_uri_result',
      id: request.id,
      content: JSON.stringify(value, null, 2),
      contentType: 'application/json',
      immutable: false,
      ...(notes?.length ? { notes } : {}),
    };
  }

  private decodeHostUriPath(url: URL): string {
    return decodeURIComponent(url.pathname).replace(/^\/+|\/+$/g, '');
  }

  private parseHostUriUrl(request: OmpRpcHostUriRequestFrame): URL | OmpRpcHostUriResultFrame {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return this.hostUriError(request, `Invalid OMP host URI: ${request.url}`);
    }
    return url;
  }

  private isHostUriRequestActive(requestId: string): boolean {
    const pending = this.pendingHostUriRequests.get(requestId);
    return !!pending && !pending.cancelled;
  }

  private normalizeHostUriArtifactPath(rawRelativePath: string): { relativePath: string; segments: string[] } | { error: string } {
    const trimmed = rawRelativePath.trim();
    if (!trimmed) return { error: 'Artifact path is required after /artifacts/' };
    if (trimmed.length > 240) return { error: 'Artifact path is too long' };
    if (/[\x00-\x1F\x7F]/.test(trimmed)) return { error: 'Artifact path contains control characters' };
    if (trimmed.includes('\\')) return { error: 'Artifact path must use forward slashes, not backslashes' };
    if (isAbsolute(trimmed) || win32.isAbsolute(trimmed) || /^[a-zA-Z]:/.test(trimmed)) {
      return { error: 'Artifact path must be relative' };
    }

    const segments = trimmed.split('/');
    const reservedWindowsName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
    for (const segment of segments) {
      if (!segment) return { error: 'Artifact path cannot contain empty segments' };
      if (segment === '.' || segment === '..') return { error: 'Artifact path cannot contain . or .. segments' };
      if (segment.includes(':')) return { error: 'Artifact path segments cannot contain colons' };
      if (segment !== segment.trim()) return { error: 'Artifact path segments cannot start or end with whitespace' };
      if (segment.endsWith('.')) return { error: 'Artifact path segments cannot end with a dot' };
      if (reservedWindowsName.test(segment)) return { error: `Artifact path segment "${segment}" is reserved on Windows` };
    }

    return {
      relativePath: segments.join('/'),
      segments,
    };
  }

  private resolveHostUriArtifactTarget(request: OmpRpcHostUriRequestFrame, path: string): HostUriArtifactTarget | { error: string } {
    if (path === OMP_HOST_URI_ARTIFACTS_PATH) {
      return { error: 'Artifact path is required after /artifacts/' };
    }
    if (!path.startsWith(`${OMP_HOST_URI_ARTIFACTS_PATH}/`)) {
      return {
        error: `Only ${OMP_HOST_URI_SCHEME}://current/${OMP_HOST_URI_ARTIFACTS_PATH}/<name> supports write operations`,
      };
    }

    const normalized = this.normalizeHostUriArtifactPath(path.slice(OMP_HOST_URI_ARTIFACTS_PATH.length + 1));
    if ('error' in normalized) return normalized;

    const sessionId = this.config.session?.id || this._sessionId;
    const rootPath = resolve(
      getSessionDataPath(this.config.workspace.rootPath, sessionId),
      OMP_HOST_URI_ARTIFACTS_DIR,
    );
    const filePath = resolve(rootPath, ...normalized.segments);
    const relativePathFromRoot = relative(rootPath, filePath);
    if (
      !relativePathFromRoot
      || relativePathFromRoot.startsWith('..')
      || isAbsolute(relativePathFromRoot)
      || win32.isAbsolute(relativePathFromRoot)
    ) {
      return { error: 'Artifact path escapes the session artifact directory' };
    }

    return {
      relativePath: normalized.relativePath,
      rootPath,
      filePath,
    };
  }

  private inferHostUriContentType(content: string): 'application/json' | 'text/plain' {
    const trimmed = content.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        JSON.parse(trimmed);
        return 'application/json';
      } catch {
        return 'text/plain';
      }
    }
    return 'text/plain';
  }

  private async appendHostUriAudit(record: HostUriAuditRecord): Promise<void> {
    try {
      const sessionId = this.config.session?.id || this._sessionId;
      const dataPath = getSessionDataPath(this.config.workspace.rootPath, sessionId);
      await mkdir(dataPath, { recursive: true });
      await appendFile(
        join(dataPath, OMP_HOST_URI_AUDIT_FILE),
        `${JSON.stringify(record)}\n`,
        'utf-8',
      );
    } catch (error) {
      this.debug(`OMP host URI audit write failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private resolvePendingHostUriPermission(hostRequestId: string, allowed: boolean): void {
    for (const [requestId, pending] of Array.from(this.pendingHostToolPermissions.entries())) {
      if (pending.hostRequestId !== hostRequestId || pending.toolName !== 'omp_host_uri_write') continue;
      this.pendingHostToolPermissions.delete(requestId);
      this.ignoreLateHostToolPermissionResponse(requestId);
      pending.resolve(allowed);
    }
  }

  private async requestHostUriWritePermission(
    request: OmpRpcHostUriRequestFrame,
    target: HostUriArtifactTarget,
    contentType: string,
    bytes: number,
  ): Promise<boolean> {
    const mode = this.permissionManager.getPermissionMode();
    if (mode === 'safe') return false;
    if (mode === 'allow-all') return true;
    if (!this.onPermissionRequest) return false;
    if (!this.isHostUriRequestActive(request.id)) return false;

    const requestId = `omp-host-uri-perm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return new Promise<boolean>((resolvePermission) => {
      let settled = false;
      const finish = (allowed: boolean) => {
        if (settled) return;
        settled = true;
        this.pendingHostToolPermissions.delete(requestId);
        resolvePermission(allowed);
      };
      this.pendingHostToolPermissions.set(requestId, {
        resolve: finish,
        toolName: 'omp_host_uri_write',
        hostRequestId: request.id,
      });
      try {
        this.onPermissionRequest?.({
          requestId,
          toolName: 'omp_host_uri_write',
          description: `OMP wants to write a session artifact: ${target.relativePath}`,
          type: 'file_write' as PermissionRequestType,
          appName: 'Oh My Pi',
          reason: `Host URI write to ${request.url}`,
          impact: [
            `Destination: ${target.filePath}`,
            `Content type: ${contentType}`,
            `Size: ${bytes} bytes`,
          ].join('\n'),
        });
      } catch (error) {
        this.debug(`OMP host URI permission request failed: ${error instanceof Error ? error.message : String(error)}`);
        finish(false);
      }
    });
  }

  private sanitizeWorkspaceSource(source: LoadedSource): Record<string, unknown> {
    const { config } = source;
    const active = this.sourceManager.isSourceActive(config.slug);
    const requiresAuthentication = config.type === 'mcp'
      ? !!config.mcp?.authType && config.mcp.authType !== 'none'
      : config.type === 'api'
        ? !!config.api?.authType && config.api.authType !== 'none'
        : false;
    const service = config.type === 'api'
      ? (
        config.api?.googleService
        ?? config.api?.slackService
        ?? config.api?.microsoftService
        ?? config.provider
      )
      : config.type === 'mcp'
        ? config.mcp?.transport ?? 'mcp'
        : config.local?.format ?? 'local';

    return {
      slug: config.slug,
      name: config.name,
      type: config.type,
      enabled: !!config.enabled,
      active,
      hasCredentials: config.isAuthenticated === true || config.connectionStatus === 'connected',
      requiresAuthentication,
      service,
      ...(config.tagline ? { summary: config.tagline } : {}),
    };
  }

  private workspaceSourcesSnapshot(): Record<string, unknown> {
    const activeSourceSlugs = Array.from(this.sourceManager.getActiveSlugs());
    return {
      workspaceId: this.config.workspace.id,
      workspaceRootPath: this.config.workspace.rootPath,
      activeSourceSlugs,
      sources: this.sourceManager.getAllSources().map(source => this.sanitizeWorkspaceSource(source)),
      updatedAt: Date.now(),
    };
  }

  private async writeHostUriArtifact(
    request: OmpRpcHostUriRequestFrame,
    path: string,
  ): Promise<OmpRpcHostUriResultFrame> {
    const target = this.resolveHostUriArtifactTarget(request, path);
    const content = request.content ?? '';
    const contentType = this.inferHostUriContentType(content);
    const bytes = Buffer.byteLength(content, 'utf-8');

    if ('error' in target) {
      await this.appendHostUriAudit({
        timestamp: Date.now(),
        operation: 'write',
        url: request.url,
        contentType,
        bytes,
        allowed: false,
        error: target.error,
      });
      return this.hostUriError(request, target.error);
    }

    if (!this.isHostUriRequestActive(request.id)) {
      await this.appendHostUriAudit({
        timestamp: Date.now(),
        operation: 'write',
        url: request.url,
        contentType,
        bytes,
        allowed: false,
        relativePath: target.relativePath,
        error: 'cancelled',
      });
      return this.hostUriError(request, `Host URI write for ${request.url} was cancelled`);
    }

    const allowed = await this.requestHostUriWritePermission(request, target, contentType, bytes);
    if (!allowed) {
      if (!this.isHostUriRequestActive(request.id)) {
        await this.appendHostUriAudit({
          timestamp: Date.now(),
          operation: 'write',
          url: request.url,
          contentType,
          bytes,
          allowed: false,
          relativePath: target.relativePath,
          error: 'cancelled',
        });
        return this.hostUriError(request, `Host URI write for ${request.url} was cancelled`);
      }
      await this.appendHostUriAudit({
        timestamp: Date.now(),
        operation: 'write',
        url: request.url,
        contentType,
        bytes,
        allowed: false,
        relativePath: target.relativePath,
        error: 'permission_denied',
      });
      return this.hostUriError(request, 'Host URI write denied by permission policy.');
    }

    if (!this.isHostUriRequestActive(request.id)) {
      await this.appendHostUriAudit({
        timestamp: Date.now(),
        operation: 'write',
        url: request.url,
        contentType,
        bytes,
        allowed: false,
        relativePath: target.relativePath,
        error: 'cancelled',
      });
      return this.hostUriError(request, `Host URI write for ${request.url} was cancelled`);
    }

    try {
      await mkdir(dirname(target.filePath), { recursive: true });
      await writeFile(target.filePath, content, 'utf-8');
      const writtenAt = Date.now();
      await this.appendHostUriAudit({
        timestamp: writtenAt,
        operation: 'write',
        url: request.url,
        contentType,
        bytes,
        allowed: true,
        relativePath: target.relativePath,
        resultPath: target.filePath,
      });
      return this.hostUriJsonResult(request, {
        path: target.filePath,
        relativePath: target.relativePath,
        bytes,
        contentType,
        updatedAt: writtenAt,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.appendHostUriAudit({
        timestamp: Date.now(),
        operation: 'write',
        url: request.url,
        contentType,
        bytes,
        allowed: true,
        relativePath: target.relativePath,
        error: message,
      });
      return this.hostUriError(request, `Host URI artifact write failed: ${message}`);
    }
  }

  private async resolveSessionHostUriRequest(
    request: OmpRpcHostUriRequestFrame,
    url: URL,
  ): Promise<OmpRpcHostUriResultFrame> {
    if (url.hostname !== 'current') {
      return this.hostUriError(
        request,
        `Unsupported ${OMP_HOST_URI_SCHEME} authority: ${url.hostname || '(empty)'}`,
      );
    }

    let path: string;
    try {
      path = this.decodeHostUriPath(url);
    } catch {
      return this.hostUriError(request, `Invalid encoded ${OMP_HOST_URI_SCHEME} path`);
    }

    if (request.operation === 'write') {
      return this.writeHostUriArtifact(request, path);
    }

    switch (path) {
      case 'summary':
        return this.hostUriJsonResult(request, {
          provider: 'omp',
          craftSessionId: this.config.session?.id || this._sessionId,
          ompSessionId: this.sessionState?.sessionId ?? this.sessionLink?.sessionId ?? null,
          sessionName: this.sessionState?.sessionName ?? this.sessionLink?.sessionName ?? null,
          messageCount: this.sessionState?.messageCount ?? this.sessionLink?.messageCount ?? 0,
          model: this.getModel(),
          thinkingLevel: this.getThinkingLevel(),
          isProcessing: this._isProcessing,
          runtimeAvailable: this.runtimeState.available,
          todoAvailable: this.todoState.available,
          updatedAt: Date.now(),
        });

      case 'todos': {
        const todo = this.getOmpTodoState();
        return this.hostUriJsonResult(request, {
          available: todo.available,
          sessionId: todo.sessionId,
          phases: todo.phases,
          revision: todo.revision,
          pendingAction: todo.pendingAction,
          error: todo.error,
          reminder: todo.reminder,
          updatedAt: todo.updatedAt,
        });
      }

      case 'runtime':
        return this.hostUriJsonResult(request, {
          runtime: cloneOmpRuntimeState(this.runtimeState),
          queue: this.currentQueueControlState(),
          model: this.getModel(),
          thinkingLevel: this.getThinkingLevel(),
          isProcessing: this._isProcessing,
        });

      default:
        return this.hostUriError(
          request,
          `Unknown ${OMP_HOST_URI_SCHEME} path: /${path || '(empty)'}. Supported paths: /summary, /todos, /runtime, /artifacts/<name> (write only)`,
        );
    }
  }

  private async resolveWorkspaceHostUriRequest(
    request: OmpRpcHostUriRequestFrame,
    url: URL,
  ): Promise<OmpRpcHostUriResultFrame> {
    if (request.operation !== 'read') {
      return this.hostUriError(
        request,
        `${OMP_HOST_WORKSPACE_URI_SCHEME} is read-only; write operations are not supported`,
      );
    }
    if (url.hostname !== 'current') {
      return this.hostUriError(
        request,
        `Unsupported ${OMP_HOST_WORKSPACE_URI_SCHEME} authority: ${url.hostname || '(empty)'}`,
      );
    }

    let path: string;
    try {
      path = this.decodeHostUriPath(url);
    } catch {
      return this.hostUriError(request, `Invalid encoded ${OMP_HOST_WORKSPACE_URI_SCHEME} path`);
    }

    if (path === 'sources') {
      return this.hostUriJsonResult(request, this.workspaceSourcesSnapshot());
    }

    return this.hostUriError(
      request,
      `Unknown ${OMP_HOST_WORKSPACE_URI_SCHEME} path: /${path || '(empty)'}. Supported paths: /sources`,
    );
  }

  private async resolveHostUriRequest(request: OmpRpcHostUriRequestFrame): Promise<OmpRpcHostUriResultFrame> {
    const parsed = this.parseHostUriUrl(request);
    if (!(parsed instanceof URL)) return parsed;

    const scheme = parsed.protocol.replace(/:$/, '');
    if (scheme === OMP_HOST_URI_SCHEME) {
      return this.resolveSessionHostUriRequest(request, parsed);
    }
    if (scheme === OMP_HOST_WORKSPACE_URI_SCHEME) {
      return this.resolveWorkspaceHostUriRequest(request, parsed);
    }

    return this.hostUriError(
      request,
      `Unsupported OMP host URI scheme: ${scheme || '(empty)'}`,
    );
  }

  private async handleHostUriRequest(request: OmpRpcHostUriRequestFrame): Promise<void> {
    this.pendingHostUriRequests.set(request.id, {
      url: request.url,
      operation: request.operation,
      cancelled: false,
      startedAt: Date.now(),
    });

    try {
      const pending = this.pendingHostUriRequests.get(request.id);
      if (!pending || pending.cancelled) return;
      const result = await this.resolveHostUriRequest(request);
      if (!this.isHostUriRequestActive(request.id)) return;
      await this.writeSideChannel(result);
    } finally {
      this.pendingHostUriRequests.delete(request.id);
    }
  }

  private handleHostUriCancel(frame: OmpRpcHostUriCancelFrame): void {
    const pending = this.pendingHostUriRequests.get(frame.targetId);
    if (!pending) return;
    pending.cancelled = true;
    this.pendingHostUriRequests.delete(frame.targetId);
    this.resolvePendingHostUriPermission(frame.targetId, false);
    this.writeSideChannel({
      type: 'host_uri_result',
      id: frame.targetId,
      isError: true,
      error: `Host URI ${pending.operation} for ${pending.url} was cancelled`,
      contentType: 'text/plain',
    }).catch((error) => {
      this.debug(`OMP host URI cancel response failed: ${error instanceof Error ? error.message : String(error)}`);
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

  private applySessionInfoUpdate(update: OmpRpcSessionInfoUpdateFrame): void {
    const previousState = this.sessionState;
    const previousLink = this.sessionLink;
    const sessionId = update.sessionId ?? previousState?.sessionId ?? previousLink?.sessionId;
    if (!sessionId) return;

    const sessionName = update.title ?? previousState?.sessionName ?? previousLink?.sessionName;

    if (previousState) {
      this.sessionState = {
        ...previousState,
        sessionId,
        sessionName,
      };
      this.diagnostics.setSessionState(this.sessionState);
      this.touchControlState();
    }

    const link: OmpSessionLink = {
      provider: 'omp',
      sessionId,
      sessionFile: previousState?.sessionFile ?? previousLink?.sessionFile,
      sessionName,
      messageCount: previousState?.messageCount ?? previousLink?.messageCount,
      lastSyncedAt: Date.now(),
      lastCheckedAt: previousLink?.lastCheckedAt,
      lastMismatch: previousLink?.lastMismatch ? { ...previousLink.lastMismatch } : undefined,
    };
    this.sessionLink = link;
    this.config.onOmpSessionLinkUpdate?.(this.cloneSessionLink(link));
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
      await this.subscribeOmpSubagentEventsForReady(generation, child);
      if (generation !== this.processGeneration || child !== this.child) return;
      await this.refreshOmpSubagentsInternal(generation, child);
    } catch (error) {
      if (generation !== this.processGeneration || child !== this.child) return;
      this.debug(`OMP subagent discovery failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async subscribeOmpSubagentEventsForReady(
    generation: number,
    child: ChildProcessWithoutNullStreams,
  ): Promise<void> {
    try {
      await this.send({ type: 'set_subagent_subscription', level: 'events' });
      return;
    } catch (error) {
      if (generation !== this.processGeneration || child !== this.child) return;
      this.debug(`OMP subagent event subscription failed; falling back to progress: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      await this.send({ type: 'set_subagent_subscription', level: 'progress' });
    } catch (error) {
      if (generation !== this.processGeneration || child !== this.child) return;
      this.debug(`OMP subagent progress subscription failed; continuing with snapshot refresh only: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async refreshOmpSubagentsInternal(
    generation = this.processGeneration,
    child = this.child,
  ): Promise<void> {
    if (!child || generation !== this.processGeneration || child !== this.child) return;
    if (this.subagentRefresh) return this.subagentRefresh;

    let refresh!: Promise<void>;
    refresh = (async () => {
      this.updateSubagentState({ type: 'pending', action: 'refresh' });
      try {
        const data = await this.send({ type: 'get_subagents' });
        if (generation !== this.processGeneration || child !== this.child) return;
        const parsed = parseOmpSubagentsResponseData(data);
        if (!parsed) {
          this.updateSubagentState({ type: 'failed', action: 'refresh', error: 'OMP get_subagents returned an invalid subagent list' });
          return;
        }

        const hydrated = await Promise.all(parsed.subagents.map((subagent) => (
          this.hydrateSubagentTodos(subagent, generation, child)
        )));
        if (generation !== this.processGeneration || child !== this.child) return;
        this.applySubagentSnapshot(hydrated);
      } catch (error) {
        if (generation !== this.processGeneration || child !== this.child) return;
        const message = error instanceof Error ? error.message : String(error);
        this.updateSubagentState({ type: 'failed', action: 'refresh', error: message });
        this.debug(`OMP subagent refresh failed: ${message}`);
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
    if (!subagent.sessionFile) return subagent;

    try {
      const data = await this.send({
        type: 'get_subagent_messages',
        subagentId: subagent.id,
      });
      if (generation !== this.processGeneration || child !== this.child) return subagent;
      const parsed = parseOmpSubagentMessagesResponseData(data);
      if (!parsed) return subagent;
      const todoPhases = extractOmpTodoPhasesFromTranscriptEntries(parsed.entries);
      return {
        ...subagent,
        ...(todoPhases ? { todoPhases } : {}),
      };
    } catch (error) {
      if (generation === this.processGeneration && child === this.child) {
        this.debug(`OMP subagent Todo transcript read failed for ${subagent.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
      return subagent;
    }
  }

  private async loadSubagentMessagesInternal(
    subagentId: string,
    fromByte?: number,
  ): Promise<void> {
    const subagent = this.subagentState.subagents.find((s) => s.id === subagentId);
    if (!subagent) throw new Error(`OMP subagent ${subagentId} not found`);

    const cursorFromByte = fromByte ?? subagent.cursor?.nextByte ?? 0;
    this.updateSubagentState({ type: 'transcript_pending', id: subagentId });
    try {
      const data = await this.send({
        type: 'get_subagent_messages',
        subagentId,
        sessionFile: subagent.sessionFile,
        fromByte: cursorFromByte,
      });
      const parsed = parseOmpSubagentMessagesResponseData(data);
      if (!parsed) {
        this.updateSubagentState({
          type: 'transcript_failed',
          id: subagentId,
          error: 'OMP get_subagent_messages returned an invalid result',
        });
        return;
      }
      const cursor: OmpSubagentTranscriptCursor = {
        fromByte: parsed.fromByte,
        nextByte: parsed.nextByte,
        // OMP returns the complete available transcript tail for the requested
        // byte offset. It does not expose file size or an explicit hasMore flag,
        // so a successful read should be treated as drained to the current EOF.
        hasMore: false,
      };
      this.updateSubagentState({
        type: 'transcript_loaded',
        id: subagentId,
        entries: parsed.entries,
        messages: parsed.messages,
        cursor,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.updateSubagentState({ type: 'transcript_failed', id: subagentId, error: message });
      throw error;
    }
  }

  private applySubagentSnapshot(subagents: OmpSubagentSnapshot[]): void {
    this.updateSubagentState({ type: 'snapshot', subagents });
    // Keep the legacy Todo state in sync so older renderers keep working.
    this.updateTodoState({ type: 'subagents_snapshot', subagents });
  }

  private applySubagentFrame(frame: OmpSubagentFrame): void {
    if (frame.type === 'subagent_event') {
      this.updateSubagentState({ type: 'event', id: frame.payload.id, event: frame.payload.event });
      return;
    }

    if (frame.type === 'subagent_lifecycle') {
      if (frame.payload.status !== 'started') {
        this.updateSubagentState({ type: 'remove', id: frame.payload.id });
        this.updateTodoState({ type: 'subagent_remove', id: frame.payload.id });
        return;
      }

      const snapshot: OmpSubagentSnapshot = {
        id: frame.payload.id,
        index: frame.payload.index,
        agent: frame.payload.agent,
        agentSource: frame.payload.agentSource,
        description: frame.payload.description,
        status: 'running',
        sessionFile: frame.payload.sessionFile,
        parentToolCallId: frame.payload.parentToolCallId,
        lastUpdate: Date.now(),
      };
      this.updateSubagentState({ type: 'upsert', subagent: snapshot });
      this.updateTodoState({ type: 'subagent_upsert', subagent: snapshot });
      return;
    }

    const progress = frame.payload.progress;
    const snapshot: OmpSubagentSnapshot = {
      id: progress.id,
      index: frame.payload.index,
      agent: frame.payload.agent,
      agentSource: frame.payload.agentSource,
      description: progress.description,
      status: progress.status,
      task: frame.payload.task,
      assignment: frame.payload.assignment,
      sessionFile: frame.payload.sessionFile,
      parentToolCallId: frame.payload.parentToolCallId,
      lastUpdate: Date.now(),
      progress,
    };
    this.updateSubagentState({ type: 'upsert', subagent: snapshot });
    this.updateTodoState({ type: 'subagent_upsert', subagent: snapshot });
  }

  private scheduleSubagentRefresh(reason: string): void {
    if (!this.child || this.subagentRefresh || this.subagentRefreshTimer) return;
    const generation = this.processGeneration;
    const child = this.child;
    this.subagentRefreshTimer = setTimeout(() => {
      this.subagentRefreshTimer = null;
      void this.refreshOmpSubagentsInternal(generation, child).catch((error) => {
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

  private applyPlanState(state: OmpRpcPlanModeState, supported: boolean): void {
    this.planState = {
      supported,
      state: { ...state },
      updatedAt: Date.now(),
    };
    this.touchControlState();
  }

  private enqueuePlanReviewRequest(frame: OmpRpcPlanReviewRequestFrame): void {
    this.planState = {
      ...this.planState,
      supported: true,
      state: {
        enabled: true,
        phase: 'awaiting_review',
        planFilePath: frame.planFilePath,
      },
      updatedAt: Date.now(),
    };
    this.touchControlState();
    if (!this.eventQueue.isComplete) {
      this.eventQueue.enqueue({
        type: 'extension_ui_request',
        request: {
          requestId: frame.requestId,
          method: 'plan_review',
          title: frame.title,
          message: 'OMP generated a native plan and is waiting for your decision.',
          planMarkdown: frame.planMarkdown,
          planFilePath: frame.planFilePath,
          planOptions: [...frame.options],
          raw: { ...frame },
        },
      });
    }
  }

  private applySessionState(state: OmpRpcSessionState): void {
    if (this.sessionState && this.sessionState.sessionId !== state.sessionId) {
      this.runtimeState = createOmpRuntimeState();
      this.planState = createOmpPlanControlState();
      this.todoState = createOmpTodoState();
      this.subagentState = createOmpSubagentState();
    }
    this.sessionState = state;
    this.planState = {
      ...this.planState,
      supported: state.capabilities?.planMode === true,
      ...(state.capabilities?.planMode === true
        ? {}
        : { state: { enabled: false, phase: 'inactive' as const } }),
      updatedAt: Date.now(),
    };
    if (typeof state.model === 'string' && state.model.trim().length > 0) {
      super.setModel(state.model);
      this.selectedModelKey = state.model;
    }
    this.runtimeState = reduceOmpRuntimeState(this.runtimeState, { type: 'session_state', state });
    this.touchControlState();
    this.applyTodoSessionState(state.sessionId, state.todoPhases);
    this.updateSubagentState({ type: 'session_state', sessionId: state.sessionId });
  }

  private updateRuntimeState(action: OmpRuntimeStateAction): void {
    this.runtimeState = reduceOmpRuntimeState(this.runtimeState, action);
    this.touchControlState();
  }

  private handleReadyFrame(frame: OmpRpcReadyFrame): void {
    const check = checkOmpVersionCompatibility(frame.ompVersion, frame.protocolVersion);
    this.diagnostics.setVersionInfo(frame.ompVersion, frame.protocolVersion, check.warning);
    this.updateRuntimeState({
      type: 'version_info',
      ompVersion: frame.ompVersion,
      protocolVersion: frame.protocolVersion,
      versionWarning: check.warning,
    });
  }

  private classifyStderrLevel(frame: OmpRpcStderrFrame): OmpStderrLevel {
    if (frame.level) return frame.level;
    const text = frame.text ?? '';
    const lower = text.toLowerCase();
    if (lower.includes('fatal') || lower.includes('panic') || lower.includes('uncaught exception')) return 'fatal';
    if (lower.includes('error') || lower.includes('failed') || lower.includes('exception')) return 'warn';
    if (lower.includes('warn')) return 'warn';
    return 'noise';
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

  private updateSubagentState(action: OmpSubagentStateAction): void {
    this.subagentState = reduceOmpSubagentState(this.subagentState, action);
    this.onSubagentStateChange?.(this.getOmpSubagentState());
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
