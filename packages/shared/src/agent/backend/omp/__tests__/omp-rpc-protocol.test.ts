import { describe, expect, it } from 'bun:test';

import {
  DEFAULT_OMP_RPC_LONG_REQUEST_TIMEOUT_MS,
  DEFAULT_OMP_RPC_REQUEST_TIMEOUT_MS,
  OMP_RPC_COMMAND_DEFINITIONS,
  craftThinkingLevelToOmp,
  getOmpRpcCommandTimeout,
  ompThinkingLevelToCraft,
  parseOmpAvailableCommandsResponseData,
  parseOmpAvailableCommandsUpdate,
  parseOmpAvailableSlashCommand,
  parseOmpBranchMessagesResponseData,
  parseOmpBranchResult,
  parseOmpCancellationResult,
  parseOmpCompactionResult,
  parseOmpContextUsage,
  parseOmpExportHtmlResponseData,
  parseOmpHandoffResult,
  parseOmpHostToolCall,
  parseOmpHostToolCancel,
  parseOmpHostUriCancel,
  parseOmpHostUriRequest,
  parseOmpLastAssistantTextResponseData,
  parseOmpLoginProvider,
  parseOmpLoginProvidersResponseData,
  parseOmpLoginResult,
  parseOmpMessagesResponseData,
  parseOmpPromptResponseData,
  parseOmpPromptResult,
  parseOmpQueueControlState,
  parseOmpRpcResponse,
  parseOmpRuntimeEvent,
  parseOmpSetHostToolsResponseData,
  parseOmpSetHostUriSchemesResponseData,
  parseOmpSetTodosResponseData,
  parseOmpConfigUpdateFrame,
  parseOmpExtensionErrorFrame,
  parseOmpMessageEndFrame,
  parseOmpMessageStartFrame,
  parseOmpMessageUpdateFrame,
  parseOmpReadyFrame,
  parseOmpSessionInfoUpdate,
  parseOmpSessionShutdownFrame,
  parseOmpSessionState,
  parseOmpSessionStats,
  parseOmpStderrFrame,
  parseOmpToolExecutionUpdateFrame,
  parseOmpSubagentFrame,
  parseOmpSubagentMessagesResponseData,
  parseOmpSubagentSnapshot,
  parseOmpSubagentsResponseData,
  extractOmpTodoPhasesFromTranscriptEntries,
  parseOmpTodoEvent,
  parseOmpTodoItem,
  parseOmpTodoPhase,
  parseOmpTodoPhases,
} from '../omp-rpc-protocol.ts';

const validState = {
  sessionId: 'session-1',
  isStreaming: false,
  isCompacting: false,
  steeringMode: 'all' as const,
  followUpMode: 'one-at-a-time' as const,
  interruptMode: 'immediate' as const,
  autoCompactionEnabled: true,
  messageCount: 4,
  queuedMessageCount: 0,
  todoPhases: [],
};

describe('OMP RPC protocol parsers', () => {
  it('defines metadata for all 39 standard OMP RPC commands', () => {
    const commandNames = Object.keys(OMP_RPC_COMMAND_DEFINITIONS);
    expect(commandNames).toHaveLength(39);
    expect(commandNames).toEqual(expect.arrayContaining([
      'prompt',
      'set_host_tools',
      'set_host_uri_schemes',
      'get_available_models',
      'cycle_thinking_level',
      'bash',
      'abort_bash',
      'get_login_providers',
      'login',
    ]));

    expect(OMP_RPC_COMMAND_DEFINITIONS.get_state).toMatchObject({
      category: 'state',
      responseKind: 'session_state',
      sideEffect: false,
      longRunning: false,
    });
    expect(OMP_RPC_COMMAND_DEFINITIONS.login).toMatchObject({
      category: 'login',
      responseKind: 'login_result',
      sideEffect: true,
      longRunning: true,
    });
    expect(getOmpRpcCommandTimeout('get_state')).toBe(DEFAULT_OMP_RPC_REQUEST_TIMEOUT_MS);
    expect(getOmpRpcCommandTimeout('login')).toBe(DEFAULT_OMP_RPC_LONG_REQUEST_TIMEOUT_MS);
    expect(getOmpRpcCommandTimeout('future_extension_command', 1234, 9999)).toBe(1234);
  });

  it('maps Craft and OMP thinking levels without overstating max support', () => {
    expect(craftThinkingLevelToOmp('off')).toBe('off');
    expect(craftThinkingLevelToOmp('medium')).toBe('medium');
    expect(craftThinkingLevelToOmp('max')).toBe('xhigh');
    expect(ompThinkingLevelToCraft('minimal')).toBe('low');
    expect(ompThinkingLevelToCraft('xhigh')).toBe('xhigh');
    expect(ompThinkingLevelToCraft('unknown')).toBeUndefined();
  });

  it('parses a response envelope without nesting its data payload', () => {
    expect(parseOmpRpcResponse({
      type: 'response',
      id: 'omp-1',
      command: 'get_state',
      success: true,
      data: { alive: true },
      futureField: 'ignored',
    })).toEqual({
      type: 'response',
      id: 'omp-1',
      command: 'get_state',
      success: true,
      error: undefined,
      data: { alive: true },
      raw: {
        type: 'response',
        id: 'omp-1',
        command: 'get_state',
        success: true,
        data: { alive: true },
        futureField: 'ignored',
      },
    });
  });

  it('rejects malformed response and prompt-result frames', () => {
    expect(parseOmpRpcResponse({ type: 'response', command: 'prompt', success: 'yes' })).toBeNull();
    expect(parseOmpPromptResult({ type: 'prompt_result', agentInvoked: 'no' })).toBeNull();
  });

  it('parses correlated prompt outcomes', () => {
    expect(parseOmpPromptResult({
      type: 'prompt_result',
      id: 'omp-2',
      agentInvoked: false,
    })).toEqual({
      type: 'prompt_result',
      id: 'omp-2',
      agentInvoked: false,
    });
    expect(parseOmpPromptResponseData({ agentInvoked: true, extra: 1 })).toEqual({
      agentInvoked: true,
    });
  });

  it('parses last assistant text responses and session info updates', () => {
    expect(parseOmpLastAssistantTextResponseData({ text: 'Final answer' })).toEqual({
      text: 'Final answer',
    });
    expect(parseOmpLastAssistantTextResponseData({ text: null })).toEqual({
      text: null,
    });
    expect(parseOmpLastAssistantTextResponseData({ text: 42 })).toBeNull();

    expect(parseOmpSessionInfoUpdate({
      type: 'session_info_update',
      sessionId: 'session-2',
      title: 'Updated OMP title',
    })).toEqual({
      type: 'session_info_update',
      sessionId: 'session-2',
      title: 'Updated OMP title',
    });
    expect(parseOmpSessionInfoUpdate({
      type: 'session_info_update',
      session_id: 'session-3',
    })).toEqual({
      type: 'session_info_update',
      sessionId: 'session-3',
      title: undefined,
    });
    expect(parseOmpSessionInfoUpdate({ type: 'session_info_update' })).toBeNull();
  });

  it('parses OMP host tool and host URI bridge frames', () => {
    expect(parseOmpSetHostToolsResponseData({ toolNames: ['config_validate', 'SubmitPlan'] })).toEqual({
      toolNames: ['config_validate', 'SubmitPlan'],
    });
    expect(parseOmpSetHostToolsResponseData({ toolNames: ['ok', 1] })).toBeNull();

    expect(parseOmpHostToolCall({
      type: 'host_tool_call',
      id: 'host-1',
      toolCallId: 'tool-use-1',
      toolName: 'config_validate',
      arguments: '{"target":"all"}',
    })).toEqual({
      type: 'host_tool_call',
      id: 'host-1',
      toolCallId: 'tool-use-1',
      toolName: 'config_validate',
      arguments: { target: 'all' },
    });
    expect(parseOmpHostToolCall({
      type: 'host_tool_call',
      id: 'host-1',
      toolName: 'config_validate',
      arguments: {},
    })).toBeNull();

    expect(parseOmpHostToolCancel({
      type: 'host_tool_cancel',
      id: 'cancel-1',
      targetId: 'host-1',
    })).toEqual({
      type: 'host_tool_cancel',
      id: 'cancel-1',
      targetId: 'host-1',
    });

    expect(parseOmpSetHostUriSchemesResponseData({ schemes: ['craft-session'] })).toEqual({
      schemes: ['craft-session'],
    });
    expect(parseOmpSetHostUriSchemesResponseData({ schemes: ['ok', 1] })).toBeNull();

    expect(parseOmpHostUriRequest({
      type: 'host_uri_request',
      id: 'uri-1',
      operation: 'read',
      url: 'craft-session://current/todos',
    })).toEqual({
      type: 'host_uri_request',
      id: 'uri-1',
      operation: 'read',
      url: 'craft-session://current/todos',
      content: undefined,
    });
    expect(parseOmpHostUriRequest({
      type: 'host_uri_request',
      id: 'uri-2',
      operation: 'delete',
      url: 'craft-session://current/todos',
    })).toBeNull();

    expect(parseOmpHostUriCancel({
      type: 'host_uri_cancel',
      id: 'cancel-uri-1',
      targetId: 'uri-1',
    })).toEqual({
      type: 'host_uri_cancel',
      id: 'cancel-uri-1',
      targetId: 'uri-1',
    });
  });

  it('validates session state while preserving future fields', () => {
    expect(parseOmpSessionState({
      ...validState,
      todoPhases: [
        {
          name: 'Build',
          tasks: [
            {
              content: 'Wire Todo bridge',
              status: 'in_progress',
              details: 'hidden detail',
              notes: 'legacy note',
            },
          ],
        },
      ],
      contextUsage: { tokens: 4000, contextWindow: 10000, percent: 40 },
      futureField: 'kept',
    })).toEqual({
      ...validState,
      todoPhases: [
        {
          name: 'Build',
          tasks: [
            {
              content: 'Wire Todo bridge',
              status: 'in_progress',
              details: 'hidden detail',
              notes: ['legacy note'],
            },
          ],
        },
      ],
      contextUsage: { tokens: 4000, contextWindow: 10000, percent: 40 },
      futureField: 'kept',
      sessionFile: undefined,
      sessionName: undefined,
    });
  });

  it('parses context usage, statistics, and compaction results', () => {
    expect(parseOmpContextUsage({ tokens: 4000, contextWindow: 10000, percent: 40 })).toEqual({
      tokens: 4000,
      contextWindow: 10000,
      percent: 40,
    });
    expect(parseOmpContextUsage({ tokens: -1, contextWindow: 10000, percent: 0 })).toBeNull();

    const stats = {
      sessionId: 'session-1',
      sessionFile: 'D:/sessions/one.jsonl',
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
    expect(parseOmpSessionStats(stats)).toEqual(stats);
    expect(parseOmpSessionStats({ ...stats, tokens: { ...stats.tokens, total: '215' } })).toBeNull();

    const compaction = {
      summary: 'summary',
      shortSummary: 'short',
      firstKeptEntryId: 'entry-2',
      tokensBefore: 9000,
      details: { strategy: 'snapcompact' },
      preserveData: { key: true },
    };
    expect(parseOmpCompactionResult(compaction)).toEqual(compaction);
    expect(parseOmpCompactionResult({ ...compaction, tokensBefore: -1 })).toBeNull();
  });

  it('parses compaction, retry, and fallback runtime events', () => {
    expect(parseOmpRuntimeEvent({
      type: 'auto_compaction_start',
      reason: 'threshold',
      action: 'snapcompact',
    })).toEqual({
      type: 'auto_compaction_start',
      reason: 'threshold',
      action: 'snapcompact',
    });
    expect(parseOmpRuntimeEvent({
      type: 'auto_retry_start',
      attempt: 2,
      maxAttempts: 4,
      delayMs: 1500,
      errorMessage: 'rate limited',
      errorId: 429,
    })).toEqual({
      type: 'auto_retry_start',
      attempt: 2,
      maxAttempts: 4,
      delayMs: 1500,
      errorMessage: 'rate limited',
      errorId: 429,
    });
    expect(parseOmpRuntimeEvent({
      type: 'retry_fallback_applied',
      from: 'provider/a',
      to: 'provider/b',
      role: 'default',
    })).toEqual({
      type: 'retry_fallback_applied',
      from: 'provider/a',
      to: 'provider/b',
      role: 'default',
    });
    expect(parseOmpRuntimeEvent({ type: 'auto_retry_start', attempt: '2' })).toBeNull();
  });

  it('rejects session state with a missing or empty session id', () => {
    const { sessionId: _sessionId, ...withoutSessionId } = validState;
    expect(parseOmpSessionState(withoutSessionId)).toBeNull();
    expect(parseOmpSessionState({ ...validState, sessionId: '   ' })).toBeNull();
  });

  it('parses OMP Todo phases, set_todos responses, and Todo events strictly', () => {
    const item = {
      content: 'Ship Todo card',
      status: 'pending' as const,
      details: 'preserve me',
      notes: ['note'],
    };
    const phase = { name: 'Desktop', tasks: [item] };
    expect(parseOmpTodoItem(item)).toEqual(item);
    expect(parseOmpTodoItem({ ...item, status: 'unknown' })).toBeNull();
    expect(parseOmpTodoPhase(phase)).toEqual(phase);
    expect(parseOmpTodoPhases([phase])).toEqual([phase]);
    expect(parseOmpSetTodosResponseData({ todoPhases: [phase] })).toEqual({ todoPhases: [phase] });
    expect(parseOmpSetTodosResponseData({ todoPhases: [{ name: 'bad', tasks: [{ content: 'x', status: 'new' }] }] })).toBeNull();
    expect(parseOmpTodoEvent({
      type: 'todo_reminder',
      todos: [item],
      attempt: 1,
      maxAttempts: 3,
    })).toEqual({
      type: 'todo_reminder',
      todos: [item],
      attempt: 1,
      maxAttempts: 3,
    });
    expect(parseOmpTodoEvent({ type: 'todo_auto_clear' })).toEqual({ type: 'todo_auto_clear' });
    expect(parseOmpTodoEvent({ type: 'todo_reminder', todos: [item], attempt: -1, maxAttempts: 3 })).toBeNull();
  });

  it('parses OMP subagent snapshots, progress frames, and transcript Todo snapshots', () => {
    const phase = {
      name: 'Subagent batch',
      tasks: [{ content: 'Inspect worker', status: 'completed' as const }],
    };
    const snapshot = {
      id: 'sub-1',
      index: 0,
      agent: 'reviewer',
      agentSource: 'project' as const,
      description: 'Reviewer',
      status: 'running' as const,
      task: 'Review Todo bridge',
      assignment: 'Look for missing protocol pieces',
      sessionFile: 'D:/sessions/sub-1.jsonl',
      lastUpdate: 123,
      progress: {
        id: 'sub-1',
        status: 'running' as const,
        currentTool: 'todo',
        recentOutput: ['checking'],
        requests: 2,
        tokens: 1500,
      },
      todoPhases: [phase],
    };
    expect(parseOmpSubagentSnapshot(snapshot)).toEqual(snapshot);
    expect(parseOmpSubagentsResponseData({ subagents: [snapshot] })).toEqual({ subagents: [snapshot] });
    expect(parseOmpSubagentSnapshot({ ...snapshot, status: 'started' })).toBeNull();

    expect(parseOmpSubagentFrame({
      type: 'subagent_progress',
      payload: {
        index: 0,
        agent: 'reviewer',
        agentSource: 'project',
        task: 'Review Todo bridge',
        assignment: 'Look for missing protocol pieces',
        sessionFile: 'D:/sessions/sub-1.jsonl',
        progress: {
          id: 'sub-1',
          status: 'running',
          currentTool: 'read',
        },
      },
    })).toEqual({
      type: 'subagent_progress',
      payload: {
        index: 0,
        agent: 'reviewer',
        agentSource: 'project',
        task: 'Review Todo bridge',
        assignment: 'Look for missing protocol pieces',
        sessionFile: 'D:/sessions/sub-1.jsonl',
        detached: undefined,
        parentToolCallId: undefined,
        progress: {
          id: 'sub-1',
          status: 'running',
          currentTool: 'read',
        },
      },
    });

    const transcript = {
      sessionFile: 'D:/sessions/sub-1.jsonl',
      fromByte: 0,
      nextByte: 12,
      reset: false,
      entries: [
        {
          type: 'message',
          message: {
            role: 'toolResult',
            toolName: 'todo',
            details: { phases: [phase] },
          },
        },
      ],
      messages: [],
    };
    expect(parseOmpSubagentMessagesResponseData(transcript)).toEqual(transcript);
    expect(extractOmpTodoPhasesFromTranscriptEntries(transcript.entries)).toEqual([phase]);
    expect(extractOmpTodoPhasesFromTranscriptEntries([
      {
        type: 'custom',
        customType: 'user_todo_edit',
        data: { phases: [{ name: 'Manual', tasks: [] }] },
      },
      ...transcript.entries,
    ])).toEqual([phase]);
  });

  it('parses available slash commands while preserving source metadata', () => {
    expect(parseOmpAvailableSlashCommand({
      name: 'model',
      aliases: ['m', 'bad alias'],
      description: 'Switch model',
      input: { hint: 'provider/model' },
      subcommands: [
        { name: 'list', description: 'List models', usage: '/model list' },
        { name: 'bad subcommand' },
      ],
      source: 'builtin',
    })).toEqual({
      name: 'model',
      aliases: ['m'],
      description: 'Switch model',
      input: { hint: 'provider/model' },
      subcommands: [{ name: 'list', description: 'List models', usage: '/model list' }],
      source: 'builtin',
    });
  });

  it('rejects invalid available slash commands and keeps valid siblings', () => {
    expect(parseOmpAvailableSlashCommand({ name: 'bad command', source: 'builtin' })).toBeNull();
    expect(parseOmpAvailableSlashCommand({ name: 'ok', source: 'unknown' })).toBeNull();
    expect(parseOmpAvailableCommandsResponseData({
      commands: [
        { name: 'stats', source: 'builtin' },
        { name: '', source: 'builtin' },
      ],
    })).toEqual({
      commands: [{ name: 'stats', aliases: undefined, description: undefined, input: undefined, subcommands: undefined, source: 'builtin' }],
    });
  });

  it('parses available commands update frames', () => {
    expect(parseOmpAvailableCommandsUpdate({
      type: 'available_commands_update',
      commands: [{ name: 'custom-task', source: 'custom' }],
    })).toEqual({
      type: 'available_commands_update',
      commands: [{ name: 'custom-task', aliases: undefined, description: undefined, input: undefined, subcommands: undefined, source: 'custom' }],
    });
    expect(parseOmpAvailableCommandsUpdate({ type: 'available_commands_update', commands: 'nope' })).toBeNull();
  });

  it('parses partial queue control state from config updates', () => {
    expect(parseOmpQueueControlState({
      isStreaming: true,
      steeringMode: 'one-at-a-time',
      followUpMode: 'all',
      interruptMode: 'wait',
      queuedMessageCount: 2,
      ignored: 'value',
    })).toEqual({
      isStreaming: true,
      steeringMode: 'one-at-a-time',
      followUpMode: 'all',
      interruptMode: 'wait',
      queuedMessageCount: 2,
    });
    expect(parseOmpQueueControlState({ steeringMode: 'bad' })).toBeNull();
  });

  it('parses session command responses', () => {
    expect(parseOmpCancellationResult({ cancelled: false })).toEqual({ cancelled: false });
    expect(parseOmpCancellationResult({ cancelled: 'no' })).toBeNull();

    expect(parseOmpBranchMessagesResponseData({
      messages: [
        { entryId: 'entry-1', text: 'First prompt' },
      ],
    })).toEqual({
      messages: [{ entryId: 'entry-1', text: 'First prompt' }],
    });
    expect(parseOmpBranchMessagesResponseData({
      messages: [
        { entryId: 'entry-1', text: 'First prompt' },
        { entryId: 2, text: 'bad' },
      ],
    })).toBeNull();

    expect(parseOmpBranchResult({ text: 'Selected prompt', cancelled: false })).toEqual({
      text: 'Selected prompt',
      cancelled: false,
    });
    expect(parseOmpBranchResult({ selectedText: 'wrong shape', cancelled: false })).toBeNull();

    expect(parseOmpExportHtmlResponseData({ path: 'D:/tmp/session.html' })).toEqual({
      path: 'D:/tmp/session.html',
    });
    expect(parseOmpExportHtmlResponseData({ path: '' })).toBeNull();

    expect(parseOmpHandoffResult({ savedPath: 'D:/tmp/handoff.md' })).toEqual({
      savedPath: 'D:/tmp/handoff.md',
    });
    expect(parseOmpHandoffResult(null)).toBeNull();

    const messages = [{ role: 'user', content: 'hello' }];
    expect(parseOmpMessagesResponseData({ messages })).toEqual({ messages });
    expect(parseOmpMessagesResponseData({ messages: 'nope' })).toBeNull();
  });

  it('parses OMP login providers and login results', () => {
    const provider = { id: 'deepseek', name: 'DeepSeek', available: true, authenticated: false };
    expect(parseOmpLoginProvider(provider)).toEqual(provider);
    expect(parseOmpLoginProvider({ ...provider, id: '' })).toBeNull();
    expect(parseOmpLoginProvider({ ...provider, name: '   ' })).toBeNull();
    expect(parseOmpLoginProvider({ ...provider, available: 'yes' })).toBeNull();
    expect(parseOmpLoginProvider({ ...provider, authenticated: 1 })).toBeNull();

    expect(parseOmpLoginProvidersResponseData({ providers: [provider] })).toEqual({ providers: [provider] });
    expect(parseOmpLoginProvidersResponseData({ providers: [provider, { id: 'bad' }] })).toBeNull();
    expect(parseOmpLoginProvidersResponseData({ providers: 'nope' })).toBeNull();

    expect(parseOmpLoginResult({ providerId: 'deepseek' })).toEqual({ providerId: 'deepseek' });
    expect(parseOmpLoginResult({ providerId: '' })).toBeNull();
    expect(parseOmpLoginResult({ providerId: 42 })).toBeNull();
  });

  it('parses Batch 04 event frames', () => {
    expect(parseOmpReadyFrame({ type: 'ready' })).toEqual({ type: 'ready' });
    expect(parseOmpReadyFrame({
      type: 'ready',
      protocolVersion: '1',
      ompVersion: '1.2.3',
      sessionId: 'sess-1',
    })).toEqual({
      type: 'ready',
      protocolVersion: '1',
      ompVersion: '1.2.3',
      sessionId: 'sess-1',
    });
    expect(parseOmpReadyFrame({ type: 'not-ready' })).toBeNull();

    expect(parseOmpMessageStartFrame({
      type: 'message_start',
      messageId: 'm1',
      role: 'assistant',
      turnId: 't1',
      index: 0,
    })).toEqual({
      type: 'message_start',
      messageId: 'm1',
      role: 'assistant',
      parentMessageId: undefined,
      turnId: 't1',
      index: 0,
    });
    expect(parseOmpMessageStartFrame({ type: 'message_start' })).toEqual({
      type: 'message_start',
      messageId: undefined,
      role: undefined,
      parentMessageId: undefined,
      turnId: undefined,
      index: undefined,
    });

    expect(parseOmpMessageUpdateFrame({
      type: 'message_update',
      messageId: 'm1',
      assistant_message_event: { type: 'text_delta', delta: 'hi' },
    })).toEqual({
      type: 'message_update',
      messageId: 'm1',
      delta: undefined,
      content: undefined,
      assistantMessageEvent: { type: 'text_delta', delta: 'hi' },
    });

    expect(parseOmpMessageEndFrame({
      type: 'message_end',
      messageId: 'm1',
      sdkMessageId: 'sdk-1',
      message: { role: 'assistant', text: 'hi' },
    })).toEqual({
      type: 'message_end',
      messageId: 'm1',
      sdkMessageId: 'sdk-1',
      message: { role: 'assistant', text: 'hi' },
    });

    expect(parseOmpToolExecutionUpdateFrame({
      type: 'tool_execution_update',
      toolCallId: 'tc-1',
      stdout: 'out',
      stderr: 'err',
    })).toEqual({
      type: 'tool_execution_update',
      toolCallId: 'tc-1',
      partialResult: undefined,
      stdout: 'out',
      stderr: 'err',
      progress: undefined,
      artifact: undefined,
      image: undefined,
    });

    expect(parseOmpConfigUpdateFrame({
      type: 'config_update',
      config: { thinkingLevel: 'high', model: 'deepseek/deepseek-v4' },
    })).toEqual({
      type: 'config_update',
      config: { thinkingLevel: 'high', model: 'deepseek/deepseek-v4' },
    });
    expect(parseOmpConfigUpdateFrame({ type: 'config_update', thinkingLevel: 'high' })).toEqual({
      type: 'config_update',
      config: undefined,
    });

    expect(parseOmpStderrFrame({ type: 'stderr', text: 'oops', level: 'warn' })).toEqual({
      type: 'stderr',
      text: 'oops',
      level: 'warn',
    });
    expect(parseOmpStderrFrame({ type: 'stderr', text: 'oops' })).toEqual({
      type: 'stderr',
      text: 'oops',
      level: undefined,
    });
    expect(parseOmpStderrFrame({ type: 'stderr', level: 'invalid' })).toEqual({
      type: 'stderr',
      text: undefined,
      level: undefined,
    });

    expect(parseOmpSessionShutdownFrame({
      type: 'session_shutdown',
      reason: 'crash',
      errorMessage: 'boom',
    })).toEqual({
      type: 'session_shutdown',
      reason: 'crash',
      errorMessage: 'boom',
    });
    expect(parseOmpSessionShutdownFrame({ type: 'session_shutdown', reason: 'invalid' })).toEqual({
      type: 'session_shutdown',
      reason: undefined,
      errorMessage: undefined,
    });

    expect(parseOmpExtensionErrorFrame({
      type: 'extension_error',
      extensionId: 'ext-1',
      source: 'src',
      message: 'oops',
      stackSummary: 'at foo',
      recoverable: true,
    })).toEqual({
      type: 'extension_error',
      extensionId: 'ext-1',
      source: 'src',
      message: 'oops',
      stackSummary: 'at foo',
      recoverable: true,
    });
    expect(parseOmpExtensionErrorFrame({ type: 'extension_error' })).toEqual({
      type: 'extension_error',
      extensionId: undefined,
      source: undefined,
      message: undefined,
      stackSummary: undefined,
      recoverable: undefined,
    });
  });
});
