import { describe, expect, it } from 'bun:test';
import type { AgentEvent } from '@craft-agent/core/types';
import { OmpRpcEventAdapter } from '../omp-rpc-adapter.ts';

function asTextDelta(event: AgentEvent | undefined): Extract<AgentEvent, { type: 'text_delta' }> {
  if (!event || event.type !== 'text_delta') throw new Error('expected text_delta');
  return event;
}

function asTextComplete(event: AgentEvent | undefined): Extract<AgentEvent, { type: 'text_complete' }> {
  if (!event || event.type !== 'text_complete') throw new Error('expected text_complete');
  return event;
}

describe('OmpRpcEventAdapter', () => {
  describe('message id mapping', () => {
    it('maps message_start/update/end to the same turn id', () => {
      const adapter = new OmpRpcEventAdapter();
      adapter.startTurn();

      const start = adapter.adaptFrame({
        type: 'message_start',
        messageId: 'msg-1',
        role: 'assistant',
      });
      expect(start.events).toEqual([]);

      const update = adapter.adaptFrame({
        type: 'message_update',
        messageId: 'msg-1',
        assistant_message_event: { type: 'text_delta', delta: 'Hello' },
      });
      expect(update.events).toHaveLength(1);
      const delta = asTextDelta(update.events[0]);
      expect(delta.text).toBe('Hello');
      const turnId = delta.turnId;
      expect(turnId).toBeDefined();

      const end = adapter.adaptFrame({
        type: 'message_end',
        messageId: 'msg-1',
        message: { role: 'assistant', text: 'Hello world' },
        sdkMessageId: 'sdk-msg-1',
      });
      expect(end.events).toHaveLength(1);
      const complete = asTextComplete(end.events[0]);
      expect(complete.text).toBe('Hello world');
      expect(complete.turnId).toBe(turnId);
      expect(complete.sdkMessageId).toBe('sdk-msg-1');
    });

    it('does not emit duplicate text_complete for the same message', () => {
      const adapter = new OmpRpcEventAdapter();
      adapter.startTurn();

      adapter.adaptFrame({ type: 'message_start', messageId: 'msg-1' });
      const firstEnd = adapter.adaptFrame({
        type: 'message_end',
        messageId: 'msg-1',
        message: { role: 'assistant', text: 'Done' },
      });
      expect(firstEnd.events).toHaveLength(1);

      const secondEnd = adapter.adaptFrame({
        type: 'message_end',
        messageId: 'msg-1',
        message: { role: 'assistant', text: 'Done' },
      });
      expect(secondEnd.events).toHaveLength(0);
    });

    it('shares turn id for messages inside the same turn', () => {
      const adapter = new OmpRpcEventAdapter();
      adapter.startTurn();

      adapter.adaptFrame({ type: 'message_start', messageId: 'msg-1' });
      const end1 = adapter.adaptFrame({
        type: 'message_end',
        messageId: 'msg-1',
        message: { role: 'assistant', text: 'First' },
      });

      adapter.adaptFrame({ type: 'message_start', messageId: 'msg-2' });
      const end2 = adapter.adaptFrame({
        type: 'message_end',
        messageId: 'msg-2',
        message: { role: 'assistant', text: 'Second' },
      });

      expect(asTextComplete(end1.events[0]).turnId).toBe(asTextComplete(end2.events[0]).turnId);
    });

    it('uses the upstream OMP turn id from turn_start for message and tool events', () => {
      const adapter = new OmpRpcEventAdapter();
      adapter.startTurn();

      adapter.adaptFrame({ type: 'turn_start', turnId: 'omp-upstream-turn-1' });
      adapter.adaptFrame({ type: 'message_start', messageId: 'msg-1' });
      const update = adapter.adaptFrame({
        type: 'message_update',
        messageId: 'msg-1',
        assistant_message_event: { type: 'text_delta', delta: 'Hello' },
      });
      const tool = adapter.adaptFrame({
        type: 'tool_execution_start',
        toolCallId: 'tc-1',
        toolName: 'read',
      });

      expect(asTextDelta(update.events[0]).turnId).toBe('omp-upstream-turn-1');
      expect(tool.events[0]).toMatchObject({
        type: 'tool_start',
        turnId: 'omp-upstream-turn-1',
      });
    });
  });

  describe('tool streaming', () => {
    it('emits tool_update events from tool_execution_update', () => {
      const adapter = new OmpRpcEventAdapter();
      adapter.startTurn();

      const start = adapter.adaptFrame({
        type: 'tool_execution_start',
        toolCallId: 'tc-1',
        toolName: 'bash',
        args: { command: 'echo hi' },
      });
      expect(start.events[0]).toMatchObject({ type: 'tool_start' });

      const update = adapter.adaptFrame({
        type: 'tool_execution_update',
        toolCallId: 'tc-1',
        stdout: 'line 1',
      });
      expect(update.events).toHaveLength(1);
      const [updateEvent] = update.events;
      expect(updateEvent).toMatchObject({
        type: 'tool_update',
        toolUseId: 'tc-1',
        content: 'line 1',
      });

      const end = adapter.adaptFrame({
        type: 'tool_execution_end',
        toolCallId: 'tc-1',
        result: 'line 1\nline 2',
      });
      expect(end.events[0]).toMatchObject({
        type: 'tool_result',
        toolUseId: 'tc-1',
      });
    });

    it('ignores tool_execution_update with no useful content', () => {
      const adapter = new OmpRpcEventAdapter();
      adapter.startTurn();
      const update = adapter.adaptFrame({
        type: 'tool_execution_update',
        toolCallId: 'tc-1',
      });
      expect(update.events).toHaveLength(0);
    });
  });

  describe('error/shutdown/extension_error frames', () => {
    it('emits error for fatal session_shutdown', () => {
      const adapter = new OmpRpcEventAdapter();
      adapter.startTurn();
      const result = adapter.adaptFrame({
        type: 'session_shutdown',
        reason: 'crash',
        errorMessage: 'OMP crashed',
      });
      expect(result.events).toHaveLength(1);
      expect(result.events[0]).toMatchObject({
        type: 'error',
        message: expect.stringContaining('crash'),
      });
    });

    it('does not emit chat error for normal session_shutdown', () => {
      const adapter = new OmpRpcEventAdapter();
      adapter.startTurn();
      const result = adapter.adaptFrame({ type: 'session_shutdown', reason: 'normal' });
      expect(result.events).toHaveLength(0);
    });

    it('emits info for recoverable extension_error', () => {
      const adapter = new OmpRpcEventAdapter();
      const result = adapter.adaptFrame({
        type: 'extension_error',
        extensionId: 'ext-1',
        message: 'Something went sideways',
        recoverable: true,
      });
      expect(result.events).toHaveLength(1);
      expect(result.events[0]).toMatchObject({
        type: 'info',
        message: expect.stringContaining('[ext-1]'),
      });
    });

    it('emits error for non-recoverable extension_error', () => {
      const adapter = new OmpRpcEventAdapter();
      const result = adapter.adaptFrame({
        type: 'extension_error',
        source: 'my-ext',
        message: 'Fatal',
        recoverable: false,
      });
      expect(result.events).toHaveLength(1);
      expect(result.events[0]).toMatchObject({ type: 'error' });
    });

    it('emits error for stderr frames', () => {
      const adapter = new OmpRpcEventAdapter();
      const result = adapter.adaptFrame({ type: 'stderr', text: 'bad things' });
      expect(result.events).toHaveLength(1);
      expect(result.events[0]).toMatchObject({ type: 'error' });
    });

    it('maps notice severity and preserves the source label', () => {
      const adapter = new OmpRpcEventAdapter();
      expect(adapter.adaptFrame({
        type: 'notice',
        level: 'warning',
        source: 'provider',
        message: 'Quota is low',
      }).events[0]).toMatchObject({
        type: 'info',
        level: 'warning',
        message: '[provider] Quota is low',
      });

      expect(adapter.adaptFrame({
        type: 'notice',
        level: 'error',
        source: 'runtime',
        message: 'Provider failed',
      }).events[0]).toMatchObject({
        type: 'error',
        message: '[runtime] Provider failed',
      });
    });
  });

  describe('ready frame', () => {
    it('captures version and session id from ready', () => {
      const adapter = new OmpRpcEventAdapter();
      const result = adapter.adaptFrame({
        type: 'ready',
        protocolVersion: '1',
        ompVersion: '1.2.3',
        sessionId: 'sess-1',
      });
      expect(result.ready).toBe(true);
      expect(result.readyFrame?.protocolVersion).toBe('1');
      expect(result.readyFrame?.ompVersion).toBe('1.2.3');
      expect(result.readyFrame?.sessionId).toBe('sess-1');
      expect(result.sessionId).toBe('sess-1');
    });
  });

  describe('user execution frames', () => {
    it('maps user_bash and user_python to recoverable command info cards', () => {
      const adapter = new OmpRpcEventAdapter();
      const bash = adapter.adaptFrame({
        type: 'user_bash',
        command: 'echo hi',
        output: 'hi',
      });
      expect(bash.unknownFrameType).toBeUndefined();
      expect(bash.events[0]).toMatchObject({
        type: 'info',
        level: 'info',
        ompCommand: {
          command: 'bash',
          title: 'Oh My Pi User Bash',
          format: 'markdown',
        },
      });
      expect(bash.events[0]).toMatchObject({
        message: expect.stringContaining('```bash\necho hi\n```'),
      });

      const python = adapter.adaptFrame({
        type: 'user_python',
        code: 'print("hi")',
        error: 'Traceback',
      });
      expect(python.unknownFrameType).toBeUndefined();
      expect(python.events[0]).toMatchObject({
        type: 'info',
        level: 'error',
        ompCommand: {
          command: 'python',
          title: 'Oh My Pi User Python',
          level: 'error',
        },
      });
    });
  });

  describe('TTSR frames', () => {
    it('renders triggered rule metadata as a warning info event', () => {
      const adapter = new OmpRpcEventAdapter();
      const result = adapter.adaptFrame({
        type: 'ttsr_triggered',
        rules: [{
          name: 'no-console',
          description: 'Avoid console logging',
          scope: ['tool:edit(*.ts)'],
          condition: ['console\\.log'],
          _source: { name: 'project rules' },
          content: 'Very long rule body should not be copied into the notice',
        }],
      });

      expect(result.unknownFrameType).toBeUndefined();
      expect(result.events[0]).toMatchObject({
        type: 'info',
        level: 'warning',
      });
      expect(result.events[0]?.type === 'info' ? result.events[0].message : '').toContain('no-console');
      expect(result.events[0]?.type === 'info' ? result.events[0].message : '').toContain('project rules');
      expect(result.events[0]?.type === 'info' ? result.events[0].message : '').not.toContain('Very long rule body');
    });
  });

  describe('goal frames', () => {
    it('renders goal_updated as a visible status summary', () => {
      const adapter = new OmpRpcEventAdapter();
      const result = adapter.adaptFrame({
        type: 'goal_updated',
        goal: {
          id: 'goal-1',
          objective: 'Ship OMP parity',
          status: 'budget-limited',
          tokensUsed: 120,
          tokenBudget: 100,
        },
        state: {
          enabled: true,
          mode: 'active',
        },
      });

      expect(result.unknownFrameType).toBeUndefined();
      expect(result.events[0]).toMatchObject({
        type: 'info',
        level: 'warning',
      });
      expect(result.events[0]?.type === 'info' ? result.events[0].message : '').toContain('Ship OMP parity');
      expect(result.events[0]?.type === 'info' ? result.events[0].message : '').toContain('tokens: 120/100');
    });
  });

  describe('IRC frames', () => {
    it('renders irc_message custom content instead of treating it as unknown', () => {
      const adapter = new OmpRpcEventAdapter();
      const result = adapter.adaptFrame({
        type: 'irc_message',
        message: {
          role: 'custom',
          customType: 'collab_note',
          content: [{ type: 'text', text: 'Background agent finished.' }],
          display: true,
          timestamp: 123,
        },
      });

      expect(result.unknownFrameType).toBeUndefined();
      const event = result.events[0];
      expect(event).toMatchObject({
        type: 'info',
        level: 'info',
      });
      const message = event?.type === 'info' ? event.message : '';
      expect(message).toContain('collab_note');
      expect(message).toContain('Background agent finished.');
    });
  });
});
