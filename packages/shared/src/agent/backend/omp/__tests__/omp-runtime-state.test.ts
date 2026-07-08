import { describe, expect, it } from 'bun:test';

import {
  createOmpRuntimeState,
  reduceOmpRuntimeState,
} from '../omp-runtime-state.ts';

const sessionState = {
  sessionId: 'session-1',
  isStreaming: false,
  isCompacting: false,
  steeringMode: 'all' as const,
  followUpMode: 'all' as const,
  interruptMode: 'immediate' as const,
  autoCompactionEnabled: true,
  messageCount: 4,
  queuedMessageCount: 0,
  todoPhases: [],
  contextUsage: { tokens: 5000, contextWindow: 10000, percent: 50 },
};

describe('OMP runtime state reducer', () => {
  it('hydrates authoritative context and preserves it across refresh failures', () => {
    const hydrated = reduceOmpRuntimeState(
      createOmpRuntimeState(1),
      { type: 'session_state', state: sessionState },
      2,
    );
    const pending = reduceOmpRuntimeState(hydrated, { type: 'pending', action: 'refresh' }, 3);
    const failed = reduceOmpRuntimeState(
      pending,
      { type: 'failed', action: 'refresh', error: 'offline' },
      4,
    );

    expect(failed.contextUsage).toEqual(sessionState.contextUsage);
    expect(failed.autoCompactionEnabled).toBe(true);
    expect(failed.pendingAction).toBeUndefined();
    expect(failed.error).toBe('offline');
  });

  it('tracks manual compaction without confusing it with automatic compaction', () => {
    const started = reduceOmpRuntimeState(
      createOmpRuntimeState(),
      { type: 'manual_compaction_started' },
    );
    expect(started.compaction).toEqual({ phase: 'running', manual: true });

    const result = {
      summary: 'done',
      firstKeptEntryId: 'entry-2',
      tokensBefore: 9000,
    };
    const complete = reduceOmpRuntimeState(
      started,
      { type: 'manual_compaction_succeeded', result },
    );
    expect(complete.compaction).toEqual({ phase: 'succeeded', manual: true, result });
    expect(complete.pendingAction).toBeUndefined();
  });

  it('reduces automatic compaction outcomes', () => {
    const running = reduceOmpRuntimeState(createOmpRuntimeState(), {
      type: 'runtime_event',
      event: { type: 'auto_compaction_start', reason: 'overflow', action: 'context-full' },
    });
    expect(running.compaction).toEqual({
      phase: 'running',
      manual: false,
      reason: 'overflow',
      action: 'context-full',
    });

    const skipped = reduceOmpRuntimeState(running, {
      type: 'runtime_event',
      event: {
        type: 'auto_compaction_end',
        action: 'context-full',
        aborted: false,
        willRetry: false,
        skipped: true,
      },
    });
    expect(skipped.compaction.phase).toBe('skipped');
  });

  it('tracks retry progress, cancellation, and model fallback', () => {
    const waiting = reduceOmpRuntimeState(createOmpRuntimeState(), {
      type: 'runtime_event',
      event: {
        type: 'auto_retry_start',
        attempt: 2,
        maxAttempts: 5,
        delayMs: 2000,
        errorMessage: 'rate limited',
      },
    });
    expect(waiting.retry).toEqual({
      phase: 'waiting',
      attempt: 2,
      maxAttempts: 5,
      delayMs: 2000,
      error: 'rate limited',
    });

    const applied = reduceOmpRuntimeState(waiting, {
      type: 'runtime_event',
      event: {
        type: 'retry_fallback_applied',
        from: 'provider/a',
        to: 'provider/b',
        role: 'default',
      },
    });
    const succeeded = reduceOmpRuntimeState(applied, {
      type: 'runtime_event',
      event: { type: 'retry_fallback_succeeded', model: 'provider/b', role: 'default' },
    });
    expect(succeeded.fallback).toEqual({
      phase: 'succeeded',
      from: 'provider/a',
      to: 'provider/b',
      role: 'default',
    });

    const cancelled = reduceOmpRuntimeState(
      { ...succeeded, pendingAction: 'abort-retry' },
      { type: 'retry_aborted' },
    );
    expect(cancelled.retry.phase).toBe('cancelled');
    expect(cancelled.pendingAction).toBeUndefined();
  });

  it('records mutation values only after successful responses', () => {
    const pending = reduceOmpRuntimeState(
      createOmpRuntimeState(),
      { type: 'pending', action: 'set-auto-retry' },
    );
    expect(pending.autoRetryEnabled).toBeUndefined();
    const enabled = reduceOmpRuntimeState(pending, { type: 'auto_retry_set', enabled: true });
    expect(enabled.autoRetryEnabled).toBe(true);
    expect(enabled.pendingAction).toBeUndefined();
  });
});
