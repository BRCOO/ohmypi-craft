import type { AgentEvent } from '@craft-agent/core/types';
import type { PermissionRequestType } from '../types.ts';

export interface OmpRpcResponseFrame {
  id?: string;
  command?: string;
  success: boolean;
  error?: string;
  data?: Record<string, unknown>;
}

export interface OmpRpcAdaptedFrame {
  events: AgentEvent[];
  ready?: boolean;
  complete?: boolean;
  response?: OmpRpcResponseFrame;
  sessionId?: string;
}

const TOOL_NAME_MAP: Record<string, string> = {
  bash: 'Bash',
  read: 'Read',
  write: 'Write',
  edit: 'Edit',
  grep: 'Grep',
  glob: 'Glob',
  find: 'Find',
  ls: 'Ls',
};

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : undefined;
}

function stableJson(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function parseArguments(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return asObject(parsed) ?? { arguments: value };
    } catch {
      return { arguments: value };
    }
  }
  return asObject(value) ?? {};
}

function extractTextFromContent(content: unknown): string | undefined {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return undefined;

  const chunks = content
    .map((part) => {
      const p = asObject(part);
      if (!p) return undefined;
      return p.type === 'text' ? asString(p.text) : undefined;
    })
    .filter((part): part is string => !!part);

  return chunks.length > 0 ? chunks.join('') : undefined;
}

function extractMessageText(message: unknown): string | undefined {
  const msg = asObject(message);
  if (!msg) return undefined;
  return extractTextFromContent(msg.content) ?? asString(msg.text);
}

function extractAssistantDelta(raw: Record<string, unknown>): string | undefined {
  const assistantEvent =
    asObject(raw.assistantMessageEvent)
    ?? asObject(raw.assistant_message_event)
    ?? {};

  return asString(assistantEvent.delta)
    ?? asString(assistantEvent.text)
    ?? asString(raw.delta)
    ?? asString(raw.text);
}

function resolveToolName(rawName: unknown): string {
  const name = asString(rawName) ?? 'tool';
  return TOOL_NAME_MAP[name] ?? name;
}

function resolveToolUseId(raw: Record<string, unknown>, fallbackPrefix: string): string {
  return asString(raw.toolCallId)
    ?? asString(raw.tool_call_id)
    ?? asString(raw.toolUseId)
    ?? asString(raw.id)
    ?? `${fallbackPrefix}-${Date.now().toString(36)}`;
}

function extractToolResult(result: unknown, isError: boolean): string {
  if (result == null) return isError ? 'Tool execution failed' : 'Success';
  if (typeof result === 'string') return result;

  const obj = asObject(result);
  const text = obj
    ? extractTextFromContent(obj.content)
      ?? asString(obj.text)
      ?? asString(obj.output)
      ?? asString(obj.error)
    : undefined;

  return text ?? stableJson(result);
}

function permissionTypeFor(raw: Record<string, unknown>): PermissionRequestType | undefined {
  const explicit = raw.permissionType ?? raw.permission_type ?? raw.type;
  if (
    explicit === 'bash'
    || explicit === 'file_write'
    || explicit === 'mcp_mutation'
    || explicit === 'api_mutation'
    || explicit === 'admin_approval'
  ) {
    return explicit;
  }
  if (typeof raw.command === 'string') return 'bash';
  if (typeof raw.path === 'string' || typeof raw.filePath === 'string') return 'file_write';
  return undefined;
}

/**
 * Pure-ish OMP RPC frame adapter.
 *
 * The adapter keeps only turn-local correlation state: accumulated assistant text
 * and tool metadata needed to produce Craft-compatible tool_result events.
 */
export class OmpRpcEventAdapter {
  private currentTurnId: string | undefined;
  private turnIndex = 0;
  private textBuffer = '';
  private hasEmittedFinalText = false;
  private toolNames = new Map<string, string>();
  private toolInputs = new Map<string, Record<string, unknown>>();

  startTurn(): void {
    this.currentTurnId = `omp-turn-${this.turnIndex++}`;
    this.textBuffer = '';
    this.hasEmittedFinalText = false;
    this.toolNames.clear();
    this.toolInputs.clear();
  }

  adaptFrame(raw: Record<string, unknown>): OmpRpcAdaptedFrame {
    const type = asString(raw.type) ?? 'unknown';

    switch (type) {
      case 'ready':
        return {
          events: [],
          ready: true,
          sessionId: asString(raw.sessionId) ?? asString(raw.session_id),
        };

      case 'response': {
        const {
          type: _type,
          id,
          command,
          success,
          error,
          ...rest
        } = raw;
        return {
          events: [],
          response: {
            id: asString(id),
            command: asString(command),
            success: success !== false,
            error: asString(error),
            data: rest as Record<string, unknown>,
          },
        };
      }

      case 'agent_start':
        return { events: [] };

      case 'agent_end':
        return { events: [{ type: 'complete' }], complete: true };

      case 'turn_start':
        this.currentTurnId = `omp-turn-${this.turnIndex++}`;
        return { events: [] };

      case 'turn_end':
        this.textBuffer = '';
        this.hasEmittedFinalText = false;
        return { events: [] };

      case 'message_update': {
        const delta = extractAssistantDelta(raw);
        if (!delta) return { events: [] };
        this.textBuffer += delta;
        return {
          events: [{
            type: 'text_delta',
            text: delta,
            turnId: this.currentTurnId,
          }],
        };
      }

      case 'message_end': {
        const message = asObject(raw.message);
        const role = asString(message?.role);
        if (role && role !== 'assistant') return { events: [] };

        const stopReason = asString(message?.stopReason) ?? asString(message?.stop_reason);
        const errorMessage = asString(message?.errorMessage) ?? asString(message?.error_message);
        if (stopReason === 'error' && errorMessage) {
          return { events: [{ type: 'error', message: errorMessage }] };
        }

        const text = extractMessageText(raw.message) ?? this.textBuffer;
        if (!text || this.hasEmittedFinalText) return { events: [] };
        this.hasEmittedFinalText = true;
        this.textBuffer = '';
        return {
          events: [{
            type: 'text_complete',
            text,
            turnId: this.currentTurnId,
            sdkMessageId: asString(raw.sdkMessageId) ?? asString(raw.sdk_message_id) ?? asString(message?.id),
          }],
        };
      }

      case 'tool_execution_start': {
        const toolUseId = resolveToolUseId(raw, 'omp-tool');
        const toolName = resolveToolName(raw.toolName ?? raw.tool_name ?? raw.name);
        const input = parseArguments(raw.args ?? raw.arguments ?? raw.input);
        const intent = asString(raw.intent) ?? asString(raw.description);

        this.toolNames.set(toolUseId, toolName);
        this.toolInputs.set(toolUseId, input);
        this.hasEmittedFinalText = false;

        return {
          events: [{
            type: 'tool_start',
            toolName,
            toolUseId,
            input,
            intent,
            displayName: asString(raw.displayName) ?? asString(raw.display_name),
            turnId: this.currentTurnId,
          }],
        };
      }

      case 'tool_execution_update':
        return { events: [] };

      case 'tool_execution_end': {
        const toolUseId = resolveToolUseId(raw, 'omp-tool');
        const rawToolName = raw.toolName ?? raw.tool_name;
        const toolName = rawToolName ? resolveToolName(rawToolName) : this.toolNames.get(toolUseId) || 'tool';
        const isError = asBoolean(raw.isError) ?? asBoolean(raw.is_error) ?? raw.error != null;
        const result = raw.error ?? raw.result;
        const input = this.toolInputs.get(toolUseId);

        this.toolNames.delete(toolUseId);
        this.toolInputs.delete(toolUseId);
        this.hasEmittedFinalText = false;

        return {
          events: [{
            type: 'tool_result',
            toolUseId,
            toolName,
            result: extractToolResult(result, isError),
            isError,
            input,
            turnId: this.currentTurnId,
          }],
        };
      }

      case 'permission_request': {
        const requestId = asString(raw.requestId) ?? asString(raw.request_id) ?? asString(raw.id) ?? 'omp-permission';
        const toolName = asString(raw.toolName) ?? asString(raw.tool_name) ?? asString(raw.title) ?? 'Permission';
        const command = asString(raw.command);
        const path = asString(raw.path) ?? asString(raw.filePath) ?? asString(raw.file_path);
        const description =
          asString(raw.description)
          ?? asString(raw.reason)
          ?? asString(raw.title)
          ?? (command ? `Allow command: ${command}` : undefined)
          ?? (path ? `Allow file operation: ${path}` : 'OMP requests permission');

        return {
          events: [{
            type: 'permission_request',
            requestId,
            toolName,
            command,
            description,
            permissionType: permissionTypeFor(raw),
            reason: asString(raw.reason),
          }],
        };
      }

      case 'permission_resolved':
      case 'available_commands_update':
      case 'message_start':
        return { events: [] };

      case 'stderr':
        return {
          events: asString(raw.text)
            ? [{ type: 'error', message: asString(raw.text)! }]
            : [],
        };

      case 'command_output':
        return {
          events: [{
            type: 'info',
            message: asString(raw.content) ?? asString(raw.text) ?? asString(raw.output) ?? '',
          }],
        };

      case 'extension_ui_request': {
        const method = asString(raw.method) ?? 'unknown';
        const title = asString(raw.title) ?? asString(raw.message) ?? asString(raw.widgetKey) ?? '';
        return {
          events: [{
            type: 'info',
            message: `OMP extension UI request is not supported yet: ${method}${title ? ` (${title})` : ''}`,
          }],
        };
      }

      case 'auto_compaction_start':
      case 'compaction_start':
        return { events: [{ type: 'status', message: 'Compacting context...' }] };

      case 'auto_compaction_end':
      case 'compaction_end': {
        const errorMessage = asString(raw.errorMessage) ?? asString(raw.error_message);
        if (errorMessage) {
          return { events: [{ type: 'error', message: `Context compaction failed: ${errorMessage}` }] };
        }
        return { events: [{ type: 'info', message: 'Compacted context to fit within limits' }] };
      }

      case 'notice': {
        const level = asString(raw.level);
        const message = asString(raw.message) ?? '';
        if (!message) return { events: [] };
        return { events: [{ type: level === 'error' ? 'error' : 'info', message }] as AgentEvent[] };
      }

      default:
        return { events: [] };
    }
  }
}
