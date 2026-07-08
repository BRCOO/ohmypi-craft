/**
 * Minimal repository-local snapshot of the OMP RPC protocol used by Craft.
 *
 * Upstream source:
 *   oh-my-pi-upstream/packages/coding-agent/src/modes/rpc/rpc-types.ts
 * Snapshot date: 2026-07-06
 *
 * Keep this intentionally narrow. It is a compatibility boundary, not a copy of
 * the full OMP protocol. Add shapes only when the Craft backend consumes them.
 */

import type { ThinkingLevel } from '../../thinking-levels.ts';

export type OmpThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
export type OmpQueueMode = 'all' | 'one-at-a-time';
export type OmpInterruptMode = 'immediate' | 'wait';
export type OmpRpcAvailableSlashCommandSource =
  | 'builtin'
  | 'skill'
  | 'extension'
  | 'custom'
  | 'mcp_prompt'
  | 'file';

export interface OmpRpcImageContent {
  type: 'image';
  data: string;
  mimeType: string;
}

export interface OmpRpcAvailableSlashSubcommand {
  name: string;
  description?: string;
  usage?: string;
}

export interface OmpRpcAvailableSlashCommand {
  name: string;
  aliases?: string[];
  description?: string;
  input?: { hint?: string };
  subcommands?: OmpRpcAvailableSlashSubcommand[];
  source: OmpRpcAvailableSlashCommandSource;
}

export interface OmpRpcAvailableCommandsResponseData {
  commands: OmpRpcAvailableSlashCommand[];
}

export interface OmpRpcCancellationResult {
  cancelled: boolean;
}

export interface OmpRpcBranchMessage {
  entryId: string;
  text: string;
}

export interface OmpRpcBranchMessagesResponseData {
  messages: OmpRpcBranchMessage[];
}

export interface OmpRpcBranchResult {
  text: string;
  cancelled: boolean;
}

export interface OmpRpcExportHtmlResponseData {
  path: string;
}

export interface OmpRpcHandoffResult {
  savedPath?: string;
}

export interface OmpRpcMessagesResponseData {
  messages: unknown[];
}

export interface OmpContextUsage {
  tokens: number;
  contextWindow: number;
  percent: number;
}

export interface OmpSessionTokenUsage {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

export interface OmpSessionStats {
  sessionFile?: string;
  sessionId: string;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  toolResults: number;
  totalMessages: number;
  tokens: OmpSessionTokenUsage;
  premiumRequests: number;
  cost: number;
}

export interface OmpCompactionResult {
  summary: string;
  shortSummary?: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  details?: unknown;
  preserveData?: Record<string, unknown>;
}

export type OmpCompactionReason = 'threshold' | 'overflow' | 'idle' | 'incomplete';
export type OmpCompactionAction = 'context-full' | 'handoff' | 'shake' | 'snapcompact';

export type OmpRuntimeEvent =
  | {
      type: 'auto_compaction_start';
      reason: OmpCompactionReason;
      action: OmpCompactionAction;
    }
  | {
      type: 'auto_compaction_end';
      action: OmpCompactionAction;
      result?: OmpCompactionResult;
      aborted: boolean;
      willRetry: boolean;
      errorMessage?: string;
      skipped?: boolean;
    }
  | {
      type: 'auto_retry_start';
      attempt: number;
      maxAttempts: number;
      delayMs: number;
      errorMessage: string;
      errorId?: number;
    }
  | {
      type: 'auto_retry_end';
      success: boolean;
      attempt: number;
      finalError?: string;
    }
  | { type: 'retry_fallback_applied'; from: string; to: string; role: string }
  | { type: 'retry_fallback_succeeded'; model: string; role: string };

export type OmpCompactionPhase = 'idle' | 'running' | 'succeeded' | 'failed' | 'aborted' | 'skipped';
export type OmpRetryPhase = 'idle' | 'waiting' | 'succeeded' | 'failed' | 'cancelled';
export type OmpRuntimePendingAction =
  | 'refresh'
  | 'compact'
  | 'set-auto-compaction'
  | 'set-auto-retry'
  | 'abort-retry';

export interface OmpRuntimeState {
  contextUsage?: OmpContextUsage;
  stats?: OmpSessionStats;
  autoCompactionEnabled?: boolean;
  autoRetryEnabled?: boolean;
  compaction: {
    phase: OmpCompactionPhase;
    manual?: boolean;
    reason?: OmpCompactionReason;
    action?: OmpCompactionAction;
    result?: OmpCompactionResult;
    willRetry?: boolean;
    error?: string;
  };
  retry: {
    phase: OmpRetryPhase;
    attempt?: number;
    maxAttempts?: number;
    delayMs?: number;
    error?: string;
  };
  fallback?: {
    phase: 'applied' | 'succeeded';
    from?: string;
    to: string;
    role: string;
  };
  pendingAction?: OmpRuntimePendingAction;
  error?: string;
  available: boolean;
  updatedAt: number;
}

export interface OmpRpcAvailableCommandsUpdateFrame {
  type: 'available_commands_update';
  commands: OmpRpcAvailableSlashCommand[];
}

export interface OmpQueueControlState {
  isStreaming: boolean;
  isCompacting: boolean;
  steeringMode: OmpQueueMode;
  followUpMode: OmpQueueMode;
  interruptMode: OmpInterruptMode;
  queuedMessageCount: number;
}

export interface OmpControlState {
  availableCommands: OmpRpcAvailableSlashCommand[];
  queue: OmpQueueControlState;
  runtime: OmpRuntimeState;
  updatedAt: number;
}

export type OmpRpcCommand =
  | {
      type: 'prompt';
      message: string;
      images?: OmpRpcImageContent[];
      streamingBehavior?: 'steer' | 'followUp';
    }
  | { type: 'steer'; message: string; images?: OmpRpcImageContent[] }
  | { type: 'follow_up'; message: string; images?: OmpRpcImageContent[] }
  | { type: 'abort_and_prompt'; message: string; images?: OmpRpcImageContent[] }
  | { type: 'abort' }
  | { type: 'new_session'; parentSession?: string }
  | { type: 'get_state' }
  | { type: 'get_available_commands' }
  | { type: 'get_messages' }
  | { type: 'get_branch_messages' }
  | { type: 'switch_session'; sessionPath: string }
  | { type: 'branch'; entryId: string }
  | { type: 'set_session_name'; name: string }
  | { type: 'handoff'; customInstructions?: string }
  | { type: 'export_html'; outputPath?: string }
  | { type: 'get_session_stats' }
  | { type: 'compact'; customInstructions?: string }
  | { type: 'set_auto_compaction'; enabled: boolean }
  | { type: 'set_auto_retry'; enabled: boolean }
  | { type: 'abort_retry' }
  | { type: 'set_model'; provider: string; modelId: string }
  | { type: 'set_thinking_level'; level: OmpThinkingLevel }
  | { type: 'set_steering_mode'; mode: OmpQueueMode }
  | { type: 'set_follow_up_mode'; mode: OmpQueueMode }
  | { type: 'set_interrupt_mode'; mode: OmpInterruptMode }
  | { type: 'permission_response'; requestId: string; decision: 'approved' | 'denied' };

export type OmpRpcExtensionUiResponse =
  | { type: 'extension_ui_response'; id: string; value: string }
  | { type: 'extension_ui_response'; id: string; confirmed: boolean }
  | { type: 'extension_ui_response'; id: string; cancelled: true; timedOut?: boolean };

export interface OmpRpcResponseFrame<T = unknown> {
  type: 'response';
  id?: string;
  command: string;
  success: boolean;
  error?: string;
  data?: T;
  raw?: Record<string, unknown>;
}

export interface OmpRpcPromptResultFrame {
  type: 'prompt_result';
  id?: string;
  agentInvoked: boolean;
}

export interface OmpRpcPromptResponseData {
  agentInvoked: boolean;
}

export interface OmpRpcSessionState {
  sessionId: string;
  sessionFile?: string;
  sessionName?: string;
  thinkingLevel?: unknown;
  isStreaming: boolean;
  isCompacting: boolean;
  steeringMode: OmpQueueMode;
  followUpMode: OmpQueueMode;
  interruptMode: OmpInterruptMode;
  autoCompactionEnabled: boolean;
  messageCount: number;
  queuedMessageCount: number;
  todoPhases: unknown[];
  contextUsage?: OmpContextUsage;
  [key: string]: unknown;
}

export function craftThinkingLevelToOmp(level: ThinkingLevel): OmpThinkingLevel {
  return level === 'max' ? 'xhigh' : level;
}

export function ompThinkingLevelToCraft(level: unknown): ThinkingLevel | undefined {
  if (level === 'minimal') return 'low';
  if (
    level === 'off'
    || level === 'low'
    || level === 'medium'
    || level === 'high'
    || level === 'xhigh'
  ) {
    return level;
  }
  return undefined;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isQueueMode(value: unknown): value is OmpQueueMode {
  return value === 'all' || value === 'one-at-a-time';
}

function isInterruptMode(value: unknown): value is OmpInterruptMode {
  return value === 'immediate' || value === 'wait';
}

function isCompactionReason(value: unknown): value is OmpCompactionReason {
  return value === 'threshold' || value === 'overflow' || value === 'idle' || value === 'incomplete';
}

function isCompactionAction(value: unknown): value is OmpCompactionAction {
  return value === 'context-full' || value === 'handoff' || value === 'shake' || value === 'snapcompact';
}

function isAvailableSlashCommandSource(value: unknown): value is OmpRpcAvailableSlashCommandSource {
  return value === 'builtin'
    || value === 'skill'
    || value === 'extension'
    || value === 'custom'
    || value === 'mcp_prompt'
    || value === 'file';
}

function isCommandName(value: unknown): value is string {
  return isString(value) && value.trim().length > 0 && !/\s/.test(value);
}

function optionalString(value: unknown): string | undefined {
  return isString(value) ? value : undefined;
}

function parseAliases(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const aliases = value.filter(isCommandName);
  return aliases.length > 0 ? aliases : undefined;
}

function parseInputHint(value: unknown): { hint?: string } | undefined {
  const input = asObject(value);
  if (!input) return undefined;
  const hint = optionalString(input.hint);
  return hint !== undefined ? { hint } : {};
}

function parseSubcommands(value: unknown): OmpRpcAvailableSlashSubcommand[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const subcommands = value
    .map((item): OmpRpcAvailableSlashSubcommand | null => {
      const raw = asObject(item);
      if (!raw || !isCommandName(raw.name)) return null;
      return {
        name: raw.name,
        description: optionalString(raw.description),
        usage: optionalString(raw.usage),
      };
    })
    .filter((item): item is OmpRpcAvailableSlashSubcommand => item !== null);
  return subcommands.length > 0 ? subcommands : undefined;
}

export function parseOmpAvailableSlashCommand(value: unknown): OmpRpcAvailableSlashCommand | null {
  const raw = asObject(value);
  if (!raw || !isCommandName(raw.name) || !isAvailableSlashCommandSource(raw.source)) return null;

  return {
    name: raw.name,
    aliases: parseAliases(raw.aliases),
    description: optionalString(raw.description),
    input: parseInputHint(raw.input),
    subcommands: parseSubcommands(raw.subcommands),
    source: raw.source,
  };
}

export function parseOmpAvailableCommandsResponseData(value: unknown): OmpRpcAvailableCommandsResponseData | null {
  const raw = asObject(value);
  if (!raw || !Array.isArray(raw.commands)) return null;
  return {
    commands: raw.commands
      .map(parseOmpAvailableSlashCommand)
      .filter((command): command is OmpRpcAvailableSlashCommand => command !== null),
  };
}

export function parseOmpCancellationResult(value: unknown): OmpRpcCancellationResult | null {
  const raw = asObject(value);
  if (!raw || typeof raw.cancelled !== 'boolean') return null;
  return { cancelled: raw.cancelled };
}

export function parseOmpBranchMessagesResponseData(value: unknown): OmpRpcBranchMessagesResponseData | null {
  const raw = asObject(value);
  if (!raw || !Array.isArray(raw.messages)) return null;
  const messages = raw.messages
    .map((item): OmpRpcBranchMessage | null => {
      const message = asObject(item);
      if (!message || !isString(message.entryId) || !isString(message.text)) return null;
      return {
        entryId: message.entryId,
        text: message.text,
      };
    })
    .filter((message): message is OmpRpcBranchMessage => message !== null);
  if (messages.length !== raw.messages.length) return null;
  return { messages };
}

export function parseOmpBranchResult(value: unknown): OmpRpcBranchResult | null {
  const raw = asObject(value);
  if (!raw || typeof raw.cancelled !== 'boolean' || !isString(raw.text)) return null;
  return {
    text: raw.text,
    cancelled: raw.cancelled,
  };
}

export function parseOmpExportHtmlResponseData(value: unknown): OmpRpcExportHtmlResponseData | null {
  const raw = asObject(value);
  if (!raw || !isString(raw.path) || raw.path.trim().length === 0) return null;
  return { path: raw.path };
}

export function parseOmpHandoffResult(value: unknown): OmpRpcHandoffResult | null {
  if (value === null || value === undefined) return null;
  const raw = asObject(value);
  if (!raw || (raw.savedPath !== undefined && !isString(raw.savedPath))) return null;
  return {
    savedPath: raw.savedPath as string | undefined,
  };
}

export function parseOmpMessagesResponseData(value: unknown): OmpRpcMessagesResponseData | null {
  const raw = asObject(value);
  if (!raw || !Array.isArray(raw.messages)) return null;
  return { messages: raw.messages };
}

export function parseOmpContextUsage(value: unknown): OmpContextUsage | null {
  const raw = asObject(value);
  if (
    !raw
    || !isNonNegativeNumber(raw.tokens)
    || !isNonNegativeNumber(raw.contextWindow)
    || !isNonNegativeNumber(raw.percent)
  ) {
    return null;
  }
  return {
    tokens: raw.tokens,
    contextWindow: raw.contextWindow,
    percent: raw.percent,
  };
}

export function parseOmpSessionStats(value: unknown): OmpSessionStats | null {
  const raw = asObject(value);
  const tokens = asObject(raw?.tokens);
  if (
    !raw
    || !tokens
    || !isString(raw.sessionId)
    || raw.sessionId.trim().length === 0
    || (raw.sessionFile !== undefined && !isString(raw.sessionFile))
    || !isNonNegativeNumber(raw.userMessages)
    || !isNonNegativeNumber(raw.assistantMessages)
    || !isNonNegativeNumber(raw.toolCalls)
    || !isNonNegativeNumber(raw.toolResults)
    || !isNonNegativeNumber(raw.totalMessages)
    || !isNonNegativeNumber(tokens.input)
    || !isNonNegativeNumber(tokens.output)
    || !isNonNegativeNumber(tokens.reasoning)
    || !isNonNegativeNumber(tokens.cacheRead)
    || !isNonNegativeNumber(tokens.cacheWrite)
    || !isNonNegativeNumber(tokens.total)
    || !isNonNegativeNumber(raw.premiumRequests)
    || !isNonNegativeNumber(raw.cost)
  ) {
    return null;
  }
  return {
    sessionFile: raw.sessionFile as string | undefined,
    sessionId: raw.sessionId,
    userMessages: raw.userMessages,
    assistantMessages: raw.assistantMessages,
    toolCalls: raw.toolCalls,
    toolResults: raw.toolResults,
    totalMessages: raw.totalMessages,
    tokens: {
      input: tokens.input,
      output: tokens.output,
      reasoning: tokens.reasoning,
      cacheRead: tokens.cacheRead,
      cacheWrite: tokens.cacheWrite,
      total: tokens.total,
    },
    premiumRequests: raw.premiumRequests,
    cost: raw.cost,
  };
}

export function parseOmpCompactionResult(value: unknown): OmpCompactionResult | null {
  const raw = asObject(value);
  if (
    !raw
    || !isString(raw.summary)
    || !isString(raw.firstKeptEntryId)
    || !isNonNegativeNumber(raw.tokensBefore)
    || (raw.shortSummary !== undefined && !isString(raw.shortSummary))
    || (raw.preserveData !== undefined && !asObject(raw.preserveData))
  ) {
    return null;
  }
  return {
    summary: raw.summary,
    shortSummary: raw.shortSummary as string | undefined,
    firstKeptEntryId: raw.firstKeptEntryId,
    tokensBefore: raw.tokensBefore,
    details: raw.details,
    preserveData: raw.preserveData as Record<string, unknown> | undefined,
  };
}

export function parseOmpRuntimeEvent(value: unknown): OmpRuntimeEvent | null {
  const raw = asObject(value);
  if (!raw || !isString(raw.type)) return null;

  switch (raw.type) {
    case 'auto_compaction_start':
      return isCompactionReason(raw.reason) && isCompactionAction(raw.action)
        ? { type: raw.type, reason: raw.reason, action: raw.action }
        : null;

    case 'auto_compaction_end': {
      if (
        !isCompactionAction(raw.action)
        || typeof raw.aborted !== 'boolean'
        || typeof raw.willRetry !== 'boolean'
        || (raw.errorMessage !== undefined && !isString(raw.errorMessage))
        || (raw.skipped !== undefined && typeof raw.skipped !== 'boolean')
      ) {
        return null;
      }
      const result = raw.result === undefined ? undefined : parseOmpCompactionResult(raw.result);
      if (raw.result !== undefined && !result) return null;
      return {
        type: raw.type,
        action: raw.action,
        result: result ?? undefined,
        aborted: raw.aborted,
        willRetry: raw.willRetry,
        errorMessage: raw.errorMessage as string | undefined,
        skipped: raw.skipped as boolean | undefined,
      };
    }

    case 'auto_retry_start':
      return isNonNegativeNumber(raw.attempt)
        && isNonNegativeNumber(raw.maxAttempts)
        && isNonNegativeNumber(raw.delayMs)
        && isString(raw.errorMessage)
        && (raw.errorId === undefined || isFiniteNumber(raw.errorId))
        ? {
            type: raw.type,
            attempt: raw.attempt,
            maxAttempts: raw.maxAttempts,
            delayMs: raw.delayMs,
            errorMessage: raw.errorMessage,
            errorId: raw.errorId as number | undefined,
          }
        : null;

    case 'auto_retry_end':
      return typeof raw.success === 'boolean'
        && isNonNegativeNumber(raw.attempt)
        && (raw.finalError === undefined || isString(raw.finalError))
        ? {
            type: raw.type,
            success: raw.success,
            attempt: raw.attempt,
            finalError: raw.finalError as string | undefined,
          }
        : null;

    case 'retry_fallback_applied':
      return isString(raw.from) && isString(raw.to) && isString(raw.role)
        ? { type: raw.type, from: raw.from, to: raw.to, role: raw.role }
        : null;

    case 'retry_fallback_succeeded':
      return isString(raw.model) && isString(raw.role)
        ? { type: raw.type, model: raw.model, role: raw.role }
        : null;

    default:
      return null;
  }
}

export function parseOmpAvailableCommandsUpdate(value: unknown): OmpRpcAvailableCommandsUpdateFrame | null {
  const raw = asObject(value);
  if (raw?.type !== 'available_commands_update') return null;
  const parsed = parseOmpAvailableCommandsResponseData(raw);
  if (!parsed) return null;
  return {
    type: 'available_commands_update',
    commands: parsed.commands,
  };
}

export function parseOmpQueueControlState(value: unknown): Partial<OmpQueueControlState> | null {
  const raw = asObject(value);
  if (!raw) return null;

  const state: Partial<OmpQueueControlState> = {};
  if (typeof raw.isStreaming === 'boolean') state.isStreaming = raw.isStreaming;
  if (typeof raw.isCompacting === 'boolean') state.isCompacting = raw.isCompacting;
  if (isQueueMode(raw.steeringMode)) state.steeringMode = raw.steeringMode;
  if (isQueueMode(raw.followUpMode)) state.followUpMode = raw.followUpMode;
  if (isInterruptMode(raw.interruptMode)) state.interruptMode = raw.interruptMode;
  if (isFiniteNumber(raw.queuedMessageCount)) state.queuedMessageCount = raw.queuedMessageCount;

  return Object.keys(state).length > 0 ? state : null;
}

export function parseOmpRpcResponse(value: unknown): OmpRpcResponseFrame | null {
  const raw = asObject(value);
  if (
    raw?.type !== 'response'
    || !isString(raw.command)
    || typeof raw.success !== 'boolean'
    || (raw.id !== undefined && !isString(raw.id))
    || (raw.error !== undefined && !isString(raw.error))
  ) {
    return null;
  }

  return {
    type: 'response',
    id: raw.id as string | undefined,
    command: raw.command,
    success: raw.success,
    error: raw.error as string | undefined,
    data: raw.data,
    raw: { ...raw },
  };
}

export function parseOmpPromptResult(value: unknown): OmpRpcPromptResultFrame | null {
  const raw = asObject(value);
  if (
    raw?.type !== 'prompt_result'
    || typeof raw.agentInvoked !== 'boolean'
    || (raw.id !== undefined && !isString(raw.id))
  ) {
    return null;
  }

  return {
    type: 'prompt_result',
    id: raw.id as string | undefined,
    agentInvoked: raw.agentInvoked,
  };
}

export function parseOmpPromptResponseData(value: unknown): OmpRpcPromptResponseData | null {
  const raw = asObject(value);
  if (!raw || typeof raw.agentInvoked !== 'boolean') return null;
  return { agentInvoked: raw.agentInvoked };
}

export function parseOmpSessionState(value: unknown): OmpRpcSessionState | null {
  const raw = asObject(value);
  const contextUsage = raw?.contextUsage === undefined
    ? undefined
    : parseOmpContextUsage(raw.contextUsage);
  if (
    !raw
    || !isString(raw.sessionId)
    || raw.sessionId.trim().length === 0
    || typeof raw.isStreaming !== 'boolean'
    || typeof raw.isCompacting !== 'boolean'
    || !isQueueMode(raw.steeringMode)
    || !isQueueMode(raw.followUpMode)
    || !isInterruptMode(raw.interruptMode)
    || typeof raw.autoCompactionEnabled !== 'boolean'
    || !isFiniteNumber(raw.messageCount)
    || !isFiniteNumber(raw.queuedMessageCount)
    || !Array.isArray(raw.todoPhases)
    || (raw.contextUsage !== undefined && !contextUsage)
    || (raw.sessionFile !== undefined && !isString(raw.sessionFile))
    || (raw.sessionName !== undefined && !isString(raw.sessionName))
  ) {
    return null;
  }

  return {
    ...raw,
    sessionId: raw.sessionId,
    sessionFile: raw.sessionFile as string | undefined,
    sessionName: raw.sessionName as string | undefined,
    isStreaming: raw.isStreaming,
    isCompacting: raw.isCompacting,
    steeringMode: raw.steeringMode,
    followUpMode: raw.followUpMode,
    interruptMode: raw.interruptMode,
    autoCompactionEnabled: raw.autoCompactionEnabled,
    messageCount: raw.messageCount,
    queuedMessageCount: raw.queuedMessageCount,
    todoPhases: raw.todoPhases,
    contextUsage: contextUsage ?? undefined,
  };
}
