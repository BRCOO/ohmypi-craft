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
  | { type: 'get_state' }
  | { type: 'get_available_commands' }
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

function isQueueMode(value: unknown): value is OmpQueueMode {
  return value === 'all' || value === 'one-at-a-time';
}

function isInterruptMode(value: unknown): value is OmpInterruptMode {
  return value === 'immediate' || value === 'wait';
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
  };
}
