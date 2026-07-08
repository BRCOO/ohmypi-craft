import type { AgentEvent } from '@craft-agent/core/types';
import type { PermissionRequestType } from '../types.ts';
import {
  parseOmpAvailableCommandsUpdate,
  parseOmpPromptResult,
  parseOmpQueueControlState,
  parseOmpRpcResponse,
  type OmpQueueControlState,
  type OmpRpcAvailableSlashCommand,
  type OmpRpcPromptResultFrame,
  type OmpRpcResponseFrame,
  type OmpThinkingLevel,
} from './omp-rpc-protocol.ts';

export interface OmpRpcAdaptedFrame {
  events: AgentEvent[];
  ready?: boolean;
  complete?: boolean;
  response?: OmpRpcResponseFrame;
  promptResult?: OmpRpcPromptResultFrame;
  thinkingLevel?: OmpThinkingLevel;
  queueState?: Partial<OmpQueueControlState>;
  availableCommands?: OmpRpcAvailableSlashCommand[];
  sessionId?: string;
  unknownFrameType?: string;
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

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
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

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function commandOutputContent(raw: Record<string, unknown>): { content: string; format: 'markdown' | 'text' | 'json' } {
  const direct = asString(raw.content) ?? asString(raw.text) ?? asString(raw.output);
  if (direct !== undefined) {
    return { content: direct.trim().length > 0 ? direct : 'Command completed', format: 'markdown' };
  }

  const structured = raw.content ?? raw.output ?? raw.data ?? raw.result;
  if (structured !== undefined) {
    return {
      content: `\`\`\`json\n${prettyJson(structured)}\n\`\`\``,
      format: 'json',
    };
  }

  return { content: 'Command completed', format: 'text' };
}

function commandOutputLevel(raw: Record<string, unknown>): 'info' | 'warning' | 'error' | 'success' {
  const level = asString(raw.level);
  return level === 'warning' || level === 'error' || level === 'success' ? level : 'info';
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

function assistantMessageEvent(raw: Record<string, unknown>): Record<string, unknown> {
  return asObject(raw.assistantMessageEvent)
    ?? asObject(raw.assistant_message_event)
    ?? {};
}

function contentIndex(event: Record<string, unknown>): number {
  return asNumber(event.contentIndex) ?? asNumber(event.content_index) ?? 0;
}

function extractThinkingBlocks(message: unknown): Array<{ index: number; text: string }> {
  const content = asObject(message)?.content;
  if (!Array.isArray(content)) return [];
  const blocks: Array<{ index: number; text: string }> = [];
  content.forEach((part, index) => {
    const block = asObject(part);
    if (block?.type !== 'thinking') return;
    const text = asString(block.thinking) ?? asString(block.text) ?? asString(block.content);
    if (text) blocks.push({ index, text });
  });
  return blocks;
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

function buildExtensionUiRequest(raw: Record<string, unknown>) {
  return {
    requestId: asString(raw.id) ?? asString(raw.requestId) ?? asString(raw.request_id) ?? 'omp-extension-ui',
    method: asString(raw.method) ?? 'unknown',
    title: asString(raw.title),
    message: asString(raw.message),
    options: asStringArray(raw.options),
    placeholder: asString(raw.placeholder),
    prefill: asString(raw.prefill),
    promptStyle: asBoolean(raw.promptStyle) ?? asBoolean(raw.prompt_style),
    timeoutMs: asNumber(raw.timeout) ?? asNumber(raw.timeoutMs) ?? asNumber(raw.timeout_ms),
    targetId: asString(raw.targetId) ?? asString(raw.target_id),
    notifyType: asString(raw.notifyType) ?? asString(raw.notify_type),
    statusKey: asString(raw.statusKey) ?? asString(raw.status_key),
    statusText: asString(raw.statusText) ?? asString(raw.status_text),
    widgetKey: asString(raw.widgetKey) ?? asString(raw.widget_key),
    widgetLines: asStringArray(raw.widgetLines) ?? asStringArray(raw.widget_lines),
    widgetPlacement: asString(raw.widgetPlacement) ?? asString(raw.widget_placement),
    text: asString(raw.text),
    url: asString(raw.url),
    launchUrl: asString(raw.launchUrl) ?? asString(raw.launch_url),
    instructions: asString(raw.instructions),
    raw: { ...raw },
  };
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
  private thinkingBuffers = new Map<number, string>();
  private completedThinkingBlocks = new Set<number>();
  private hasEmittedFinalText = false;
  private toolNames = new Map<string, string>();
  private toolInputs = new Map<string, Record<string, unknown>>();
  private commandContext: string | undefined;

  startTurn(commandContext?: string): void {
    this.currentTurnId = `omp-turn-${this.turnIndex++}`;
    this.textBuffer = '';
    this.thinkingBuffers.clear();
    this.completedThinkingBlocks.clear();
    this.hasEmittedFinalText = false;
    this.toolNames.clear();
    this.toolInputs.clear();
    this.commandContext = commandContext;
  }

  clearCommandContext(): void {
    this.commandContext = undefined;
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
        const response = parseOmpRpcResponse(raw);
        return {
          events: [],
          ...(response ? { response } : {}),
        };
      }

      case 'prompt_result': {
        const promptResult = parseOmpPromptResult(raw);
        return {
          events: [],
          ...(promptResult ? { promptResult } : {}),
        };
      }

      case 'agent_start':
        return { events: [] };

      case 'agent_end':
        return { events: [], complete: true };

      case 'auto_compaction_start':
      case 'auto_compaction_end':
      case 'auto_retry_start':
      case 'auto_retry_end':
      case 'retry_fallback_applied':
      case 'retry_fallback_succeeded':
        // OMP runtime lifecycle frames are reduced by OmpRpcBackend into the
        // session control snapshot. They are intentionally not chat events.
        return { events: [] };

      case 'thinking_level_changed': {
        const level = raw.level ?? raw.thinkingLevel ?? raw.thinking_level;
        if (
          level === 'off'
          || level === 'minimal'
          || level === 'low'
          || level === 'medium'
          || level === 'high'
          || level === 'xhigh'
        ) {
          return { events: [], thinkingLevel: level };
        }
        return { events: [] };
      }

      case 'config_update': {
        const config = asObject(raw.config) ?? raw;
        const level = config.thinkingLevel ?? config.thinking_level;
        const queueState = parseOmpQueueControlState(config);
        if (
          level === 'off'
          || level === 'minimal'
          || level === 'low'
          || level === 'medium'
          || level === 'high'
          || level === 'xhigh'
        ) {
          return { events: [], thinkingLevel: level, ...(queueState ? { queueState } : {}) };
        }
        return { events: [], ...(queueState ? { queueState } : {}) };
      }

      case 'turn_start':
        this.currentTurnId = `omp-turn-${this.turnIndex++}`;
        return { events: [] };

      case 'turn_end':
        this.textBuffer = '';
        this.hasEmittedFinalText = false;
        return { events: [] };

      case 'message_update': {
        const assistantEvent = assistantMessageEvent(raw);
        const assistantEventType = asString(assistantEvent.type);
        const index = contentIndex(assistantEvent);

        if (assistantEventType === 'thinking_start') {
          this.thinkingBuffers.set(index, '');
          this.completedThinkingBlocks.delete(index);
          return { events: [] };
        }

        if (assistantEventType === 'thinking_delta') {
          const delta = asString(assistantEvent.delta) ?? asString(raw.delta);
          if (!delta) return { events: [] };
          this.thinkingBuffers.set(index, (this.thinkingBuffers.get(index) ?? '') + delta);
          return {
            events: [{
              type: 'text_delta',
              text: delta,
              isThinking: true,
              turnId: this.currentTurnId,
            }],
          };
        }

        if (assistantEventType === 'thinking_end') {
          const text = asString(assistantEvent.content) ?? this.thinkingBuffers.get(index) ?? '';
          this.thinkingBuffers.delete(index);
          if (!text || this.completedThinkingBlocks.has(index)) return { events: [] };
          this.completedThinkingBlocks.add(index);
          return {
            events: [{
              type: 'text_complete',
              text,
              isIntermediate: true,
              isThinking: true,
              turnId: this.currentTurnId,
            }],
          };
        }

        if (assistantEventType && assistantEventType !== 'text_delta') {
          return { events: [] };
        }

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

        const events: AgentEvent[] = [];
        for (const block of extractThinkingBlocks(raw.message)) {
          if (this.completedThinkingBlocks.has(block.index)) continue;
          this.completedThinkingBlocks.add(block.index);
          events.push({
            type: 'text_complete',
            text: block.text,
            isIntermediate: true,
            isThinking: true,
            turnId: this.currentTurnId,
          });
        }

        const text = extractMessageText(raw.message) ?? this.textBuffer;
        if (text && !this.hasEmittedFinalText) {
          this.hasEmittedFinalText = true;
          this.textBuffer = '';
          events.push({
            type: 'text_complete',
            text,
            turnId: this.currentTurnId,
            sdkMessageId: asString(raw.sdkMessageId) ?? asString(raw.sdk_message_id) ?? asString(message?.id),
          });
        }
        return { events };
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

      case 'available_commands_update': {
        const update = parseOmpAvailableCommandsUpdate(raw);
        return {
          events: [],
          ...(update ? { availableCommands: update.commands } : {}),
        };
      }

      case 'permission_resolved':
        return { events: [] };

      case 'message_start':
        this.thinkingBuffers.clear();
        this.completedThinkingBlocks.clear();
        return { events: [] };

      case 'stderr':
        return {
          events: asString(raw.text)
            ? [{ type: 'error', message: asString(raw.text)! }]
            : [],
        };

      case 'command_output':
      {
        const output = commandOutputContent(raw);
        const level = commandOutputLevel(raw);
        return {
          events: [{
            type: 'info',
            message: output.content,
            level,
            ompCommand: {
              command: asString(raw.command) ?? this.commandContext,
              title: 'Oh My Pi Command',
              level,
              format: output.format,
            },
          }],
        };
      }

      case 'extension_ui_request': {
        const request = buildExtensionUiRequest(raw);
        if (request.method === 'cancel') {
          return {
            events: [{
              type: 'extension_ui_cancel',
              requestId: request.requestId,
              targetId: request.targetId ?? request.requestId,
            }],
          };
        }

        return {
          events: [{
            type: 'extension_ui_request',
            request,
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
        return { events: [], unknownFrameType: type };
    }
  }
}
