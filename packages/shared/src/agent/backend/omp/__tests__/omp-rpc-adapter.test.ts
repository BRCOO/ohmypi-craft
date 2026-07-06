import { describe, expect, it } from 'bun:test';

import { OmpRpcEventAdapter } from '../omp-rpc-adapter.ts';
import { buildOmpExtensionUiResponseFrame } from '../omp-rpc-backend.ts';

describe('OmpRpcEventAdapter', () => {
  it('maps ready and response frames as control data', () => {
    const adapter = new OmpRpcEventAdapter();

    expect(adapter.adaptFrame({ type: 'ready', sessionId: 's1' })).toEqual({
      events: [],
      ready: true,
      sessionId: 's1',
    });

    expect(adapter.adaptFrame({ type: 'response', id: 'r1', command: 'prompt', success: true, data: { ok: true } })).toEqual({
      events: [],
      response: {
        type: 'response',
        id: 'r1',
        command: 'prompt',
        success: true,
        error: undefined,
        data: { ok: true },
      },
    });

    expect(adapter.adaptFrame({ type: 'prompt_result', id: 'r1', agentInvoked: false })).toEqual({
      events: [],
      promptResult: {
        type: 'prompt_result',
        id: 'r1',
        agentInvoked: false,
      },
    });
  });

  it('maps assistant deltas and final assistant text', () => {
    const adapter = new OmpRpcEventAdapter();
    adapter.startTurn();

    expect(adapter.adaptFrame({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'Hel' },
    }).events).toEqual([
      { type: 'text_delta', text: 'Hel', turnId: 'omp-turn-0' },
    ]);

    expect(adapter.adaptFrame({
      type: 'message_update',
      assistant_message_event: { type: 'text_delta', delta: 'lo' },
    }).events).toEqual([
      { type: 'text_delta', text: 'lo', turnId: 'omp-turn-0' },
    ]);

    expect(adapter.adaptFrame({
      type: 'message_end',
      message: { role: 'assistant', id: 'msg-1', content: [{ type: 'text', text: 'Hello' }] },
    }).events).toEqual([
      { type: 'text_complete', text: 'Hello', turnId: 'omp-turn-0', sdkMessageId: 'msg-1' },
    ]);
  });

  it('falls back to accumulated deltas when message_end has no content', () => {
    const adapter = new OmpRpcEventAdapter();
    adapter.startTurn();

    adapter.adaptFrame({ type: 'message_update', delta: 'partial' });

    expect(adapter.adaptFrame({ type: 'message_end' }).events).toEqual([
      { type: 'text_complete', text: 'partial', turnId: 'omp-turn-0', sdkMessageId: undefined },
    ]);
  });

  it('maps tool start and end frames', () => {
    const adapter = new OmpRpcEventAdapter();
    adapter.startTurn();

    expect(adapter.adaptFrame({
      type: 'tool_execution_start',
      toolCallId: 'tool-1',
      toolName: 'bash',
      args: { command: 'pwd' },
      intent: 'Check cwd',
    }).events).toEqual([
      {
        type: 'tool_start',
        toolName: 'Bash',
        toolUseId: 'tool-1',
        input: { command: 'pwd' },
        intent: 'Check cwd',
        displayName: undefined,
        turnId: 'omp-turn-0',
      },
    ]);

    expect(adapter.adaptFrame({
      type: 'tool_execution_end',
      toolCallId: 'tool-1',
      result: { content: [{ type: 'text', text: '/repo' }] },
      isError: false,
    }).events).toEqual([
      {
        type: 'tool_result',
        toolName: 'Bash',
        toolUseId: 'tool-1',
        result: '/repo',
        isError: false,
        input: { command: 'pwd' },
        turnId: 'omp-turn-0',
      },
    ]);
  });

  it('maps permission and lifecycle frames', () => {
    const adapter = new OmpRpcEventAdapter();

    expect(adapter.adaptFrame({
      type: 'permission_request',
      id: 'p1',
      title: 'Run command',
      command: 'rm file',
      reason: 'Needs cleanup',
    }).events).toEqual([
      {
        type: 'permission_request',
        requestId: 'p1',
        toolName: 'Run command',
        command: 'rm file',
        description: 'Needs cleanup',
        permissionType: 'bash',
        reason: 'Needs cleanup',
      },
    ]);

    expect(adapter.adaptFrame({ type: 'agent_end' })).toEqual({
      events: [],
      complete: true,
    });
  });

  it('maps extension UI request frames', () => {
    const adapter = new OmpRpcEventAdapter();

    expect(adapter.adaptFrame({
      type: 'extension_ui_request',
      id: 'ui-1',
      method: 'select',
      title: 'Pick one',
      options: ['A', 'B'],
      timeout: 1000,
    }).events).toEqual([
      {
        type: 'extension_ui_request',
        request: {
          requestId: 'ui-1',
          method: 'select',
          title: 'Pick one',
          message: undefined,
          options: ['A', 'B'],
          placeholder: undefined,
          prefill: undefined,
          promptStyle: undefined,
          timeoutMs: 1000,
          targetId: undefined,
          notifyType: undefined,
          statusKey: undefined,
          statusText: undefined,
          widgetKey: undefined,
          widgetLines: undefined,
          widgetPlacement: undefined,
          text: undefined,
          url: undefined,
          launchUrl: undefined,
          instructions: undefined,
          raw: {
            type: 'extension_ui_request',
            id: 'ui-1',
            method: 'select',
            title: 'Pick one',
            options: ['A', 'B'],
            timeout: 1000,
          },
        },
      },
    ]);
  });

  it('maps extension UI cancel frames', () => {
    const adapter = new OmpRpcEventAdapter();

    expect(adapter.adaptFrame({
      type: 'extension_ui_request',
      id: 'cancel-1',
      method: 'cancel',
      targetId: 'ui-1',
    }).events).toEqual([
      {
        type: 'extension_ui_cancel',
        requestId: 'cancel-1',
        targetId: 'ui-1',
      },
    ]);
  });

  it('builds OMP extension UI response frames without host correlation ids', () => {
    expect(buildOmpExtensionUiResponseFrame('ui-1', { value: 'choice' })).toEqual({
      type: 'extension_ui_response',
      id: 'ui-1',
      value: 'choice',
    });
    expect(buildOmpExtensionUiResponseFrame('ui-2', { confirmed: true })).toEqual({
      type: 'extension_ui_response',
      id: 'ui-2',
      confirmed: true,
    });
    expect(buildOmpExtensionUiResponseFrame('ui-3', { cancelled: true, timedOut: true })).toEqual({
      type: 'extension_ui_response',
      id: 'ui-3',
      cancelled: true,
      timedOut: true,
    });
  });
});
