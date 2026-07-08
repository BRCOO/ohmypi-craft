import { describe, expect, it } from 'bun:test'
import type { Message } from '@craft-agent/core/types'

import { SessionManager } from './SessionManager.ts'

function message(
  id: string,
  role: Message['role'],
  content: string,
  extras: Partial<Message> = {},
): Message {
  return {
    id,
    role,
    content,
    timestamp: 1,
    ...extras,
  }
}

function createOmpAgent(overrides: Record<string, unknown> = {}) {
  const link = {
    provider: 'omp' as const,
    sessionId: 'omp-session-1',
    sessionFile: 'C:\\sessions\\omp-session-1.jsonl',
    messageCount: 4,
    lastSyncedAt: 100,
  }

  return {
    getOmpSessionLink: () => link,
    getOmpMessages: async () => [],
    getOmpBranchMessages: async () => [],
    branchOmpSession: async () => ({ text: '', cancelled: false }),
    handoffOmpSession: async () => null,
    exportOmpSessionHtml: async () => ({ path: 'C:\\sessions\\session.html' }),
    setOmpSessionName: async () => {},
    ...overrides,
  }
}

function createOmpRuntimeAgent(calls: string[]) {
  const runtime = {
    compaction: { phase: 'idle' as const },
    retry: { phase: 'idle' as const },
    available: true,
    updatedAt: 1,
  }
  const controlState = {
    availableCommands: [],
    queue: {
      isStreaming: false,
      isCompacting: false,
      steeringMode: 'all' as const,
      followUpMode: 'all' as const,
      interruptMode: 'immediate' as const,
      queuedMessageCount: 0,
    },
    runtime,
    updatedAt: 1,
  }
  return {
    onControlStateChange: null,
    getOmpControlState: () => controlState,
    steer: async () => true,
    followUp: async () => true,
    abortAndPrompt: async () => true,
    setSteeringMode: async () => {},
    setFollowUpMode: async () => {},
    setInterruptMode: async () => {},
    refreshOmpRuntimeState: async () => { calls.push('refresh'); return runtime },
    compactOmpSession: async () => { calls.push('compact'); return runtime },
    setAutoCompaction: async (enabled: boolean) => { calls.push(`auto-compaction:${enabled}`); return runtime },
    setAutoRetry: async (enabled: boolean) => { calls.push(`auto-retry:${enabled}`); return runtime },
    abortRetry: async () => { calls.push('abort-retry'); return runtime },
  }
}

function createOmpTodoAgent(calls: string[]) {
  let state: any = {
    available: true,
    sessionId: 'omp-session-1',
    phases: [],
    revision: 1,
    updatedAt: 1,
  }
  return {
    isProcessing: () => false,
    onTodoStateChange: null,
    getOmpTodoState: () => state,
    refreshOmpTodos: async () => {
      calls.push('refresh')
      state = { ...state, revision: state.revision + 1, updatedAt: state.updatedAt + 1 }
      return state
    },
    mutateOmpTodos: async (_expectedRevision: number, mutation: unknown) => {
      calls.push(`mutate:${(mutation as { type?: string }).type}`)
      state = {
        ...state,
        phases: [{ name: 'Desktop', tasks: [{ content: 'Task', status: 'pending' as const }] }],
        revision: state.revision + 1,
        updatedAt: state.updatedAt + 1,
      }
      return state
    },
    importOmpTodosMarkdown: async (_expectedRevision: number, markdown: string) => {
      calls.push(`import:${markdown.length}`)
      state = {
        ...state,
        phases: [{ name: 'Imported', tasks: [{ content: 'Task', status: 'completed' as const }] }],
        revision: state.revision + 1,
        updatedAt: state.updatedAt + 1,
      }
      return state
    },
    exportOmpTodosMarkdown: () => '# Desktop\n- [ ] Task',
  }
}

function createManagedSession(agent: unknown, overrides: Record<string, unknown> = {}): any {
  return {
    id: 'session-1',
    workspace: {
      id: 'workspace-1',
      name: 'Workspace',
      rootPath: 'C:\\workspace',
      createdAt: 1,
    },
    agent,
    isProcessing: false,
    messagesLoaded: true,
    messages: [
      message('user-1', 'user', 'first prompt'),
      message('assistant-1', 'assistant', 'first answer'),
      message('user-2', 'user', 'second prompt'),
      message('assistant-2', 'assistant', 'second answer'),
    ],
    messageQueue: [message('queued-1', 'user', 'queued prompt')],
    lastSentMessage: 'second prompt',
    lastSentAttachments: [{ name: 'file.txt' }],
    lastSentStoredAttachments: [{ id: 'stored-file' }],
    lastSentOptions: { thinkingOverride: 'high' },
    hasUnread: true,
    ...overrides,
  }
}

function createManager(managed: Record<string, unknown>) {
  const manager = Object.create(SessionManager.prototype) as any
  manager.sessions = new Map([[managed.id, managed]])
  manager.ensureMessagesLoaded = async () => {
    managed.messagesLoaded = true
  }
  manager.getOrCreateAgent = async () => managed.agent
  manager.reconcileOmpSessionBeforePrompt = async () => {}
  manager.persisted = [] as unknown[]
  manager.flushed = [] as string[]
  manager.events = [] as unknown[]
  manager.persistSession = (session: Record<string, unknown>) => {
    manager.persisted.push((session.messages as Message[]).map(item => item.id))
  }
  manager.flushSession = async (sessionId: string) => {
    manager.flushed.push(sessionId)
  }
  manager.sendEvent = (event: unknown, workspaceId: string) => {
    manager.events.push({ event, workspaceId })
  }
  manager.getLastFinalAssistantMessageId = (messages: Message[]) =>
    messages.findLast(item => item.role === 'assistant' && !item.isIntermediate && !item.isThinking)?.id
  let tick = 1000
  manager.monotonic = () => {
    tick += 1
    return tick
  }
  return manager
}

describe('SessionManager OMP session actions', () => {
  it('returns branch options mapped to Craft user messages', async () => {
    const agent = createOmpAgent({
      getOmpBranchMessages: async () => [
        { entryId: 'entry-1', text: 'first prompt' },
        { entryId: 'entry-2', text: 'second prompt' },
      ],
    })
    const managed = createManagedSession(agent)
    const manager = createManager(managed)

    const result = await manager.getOmpBranchOptions('session-1')

    expect(result).toEqual({
      success: true,
      options: [
        {
          entryId: 'entry-1',
          craftMessageId: 'user-1',
          ordinal: 1,
          textPreview: 'first prompt',
        },
        {
          entryId: 'entry-2',
          craftMessageId: 'user-2',
          ordinal: 2,
          textPreview: 'second prompt',
        },
      ],
    })
  })

  it('branches by truncating Craft messages before the selected OMP user entry', async () => {
    const branchCalls: string[] = []
    const agent = createOmpAgent({
      getOmpBranchMessages: async () => [
        { entryId: 'entry-1', text: 'first prompt' },
        { entryId: 'entry-2', text: 'second prompt' },
      ],
      branchOmpSession: async (entryId: string) => {
        branchCalls.push(entryId)
        return { text: 'second prompt', cancelled: false }
      },
    })
    const managed = createManagedSession(agent)
    const manager = createManager(managed)

    const result = await manager.branchOmpSession('session-1', 'entry-2', 'user-2')

    expect(result).toMatchObject({
      success: true,
      selectedText: 'second prompt',
      sessionLink: {
        provider: 'omp',
        sessionId: 'omp-session-1',
      },
    })
    expect(branchCalls).toEqual(['entry-2'])
    expect((managed.messages as Message[]).map(item => item.id)).toEqual(['user-1', 'assistant-1'])
    expect(managed.messageQueue).toEqual([])
    expect(managed.lastSentMessage).toBeUndefined()
    expect(managed.lastSentAttachments).toBeUndefined()
    expect(managed.lastSentStoredAttachments).toBeUndefined()
    expect(managed.lastSentOptions).toBeUndefined()
    expect(managed.messageCount).toBe(2)
    expect(managed.preview).toBe('first prompt')
    expect(managed.lastMessageRole).toBe('assistant')
    expect(managed.lastFinalMessageId).toBe('assistant-1')
    expect(managed.lastReadMessageId).toBe('assistant-1')
    expect(managed.hasUnread).toBe(false)
    expect(manager.persisted).toEqual([['user-1', 'assistant-1']])
    expect(manager.flushed).toEqual(['session-1'])
    expect(manager.events).toEqual([{
      event: { type: 'session_created', sessionId: 'session-1' },
      workspaceId: 'workspace-1',
    }])
  })

  it('reloads Craft display messages after an OMP handoff', async () => {
    const handoffCalls: Array<string | undefined> = []
    const agent = createOmpAgent({
      handoffOmpSession: async (customInstructions?: string) => {
        handoffCalls.push(customInstructions)
        return { savedPath: 'C:\\sessions\\handoff.md' }
      },
      getOmpMessages: async () => [
        {
          id: 'omp-user-1',
          role: 'user',
          content: [{ type: 'text', text: 'handoff prompt' }],
        },
        {
          id: 'omp-assistant-1',
          role: 'assistant',
          content: [{ type: 'text', text: 'handoff answer' }],
        },
      ],
    })
    const managed = createManagedSession(agent)
    const manager = createManager(managed)

    const result = await manager.handoffOmpSession('session-1', '  preserve constraints  ')

    expect(result).toMatchObject({
      success: true,
      savedPath: 'C:\\sessions\\handoff.md',
      sessionLink: {
        provider: 'omp',
        sessionId: 'omp-session-1',
      },
    })
    expect(handoffCalls).toEqual(['preserve constraints'])
    expect((managed.messages as Message[]).map(item => ({
      role: item.role,
      content: item.content,
      timestamp: item.timestamp,
      turnId: item.turnId,
    }))).toEqual([
      {
        role: 'user',
        content: 'handoff prompt',
        timestamp: 1001,
        turnId: undefined,
      },
      {
        role: 'assistant',
        content: 'handoff answer',
        timestamp: 1002,
        turnId: 'omp-assistant-1',
      },
    ])
    expect(managed.messageQueue).toEqual([])
    expect(managed.messageCount).toBe(2)
    expect(managed.preview).toBe('handoff prompt')
    expect(managed.lastFinalMessageId).toBe((managed.messages as Message[])[1]?.id)
    expect(manager.persisted).toHaveLength(1)
    expect(manager.flushed).toEqual(['session-1'])
  })

  it('delegates OMP HTML export to the backend action', async () => {
    const exportCalls: Array<string | undefined> = []
    const agent = createOmpAgent({
      exportOmpSessionHtml: async (outputPath?: string) => {
        exportCalls.push(outputPath)
        return { path: 'C:\\sessions\\session.html' }
      },
    })
    const managed = createManagedSession(agent)
    const manager = createManager(managed)

    const result = await manager.exportOmpSessionHtml('session-1', 'C:\\exports\\custom.html')

    expect(result).toEqual({
      success: true,
      outputPath: 'C:\\sessions\\session.html',
    })
    expect(exportCalls).toEqual(['C:\\exports\\custom.html'])
  })

  it('rejects OMP actions while the session is processing', async () => {
    const agent = createOmpAgent({
      getOmpBranchMessages: async () => {
        throw new Error('must not call backend while processing')
      },
    })
    const managed = createManagedSession(agent, { isProcessing: true })
    const manager = createManager(managed)

    const result = await manager.getOmpBranchOptions('session-1')

    expect(result.success).toBe(false)
    expect(result.error).toContain('disabled while the session is processing')
  })
})

describe('SessionManager OMP runtime controls', () => {
  it('delegates runtime commands and publishes the latest snapshot', async () => {
    const calls: string[] = []
    const agent = createOmpRuntimeAgent(calls)
    const managed = createManagedSession(agent)
    const manager = createManager(managed)

    await manager.refreshOmpRuntime('session-1')
    await manager.compactOmpRuntime('session-1')
    await manager.setOmpAutoCompaction('session-1', false)
    await manager.setOmpAutoRetry('session-1', true)
    await manager.abortOmpRetry('session-1')

    expect(calls).toEqual([
      'refresh',
      'compact',
      'auto-compaction:false',
      'auto-retry:true',
      'abort-retry',
    ])
    expect(manager.events).toHaveLength(5)
    expect(manager.events.at(-1)).toEqual({
      event: {
        type: 'omp_control_state_changed',
        sessionId: 'session-1',
        state: expect.objectContaining({
          runtime: expect.objectContaining({ available: true }),
        }),
      },
      workspaceId: 'workspace-1',
    })
    expect(managed.ompControlState.runtime.available).toBe(true)
  })

  it('rejects runtime commands for non-OMP agents', async () => {
    const managed = createManagedSession({})
    const manager = createManager(managed)

    await expect(manager.refreshOmpRuntime('session-1')).rejects.toThrow(
      'OMP runtime controls are only available for OMP sessions',
    )
  })

  it('synchronizes global automatic settings to other live OMP agents', async () => {
    const sourceCalls: string[] = []
    const targetCalls: string[] = []
    const managed = createManagedSession(createOmpRuntimeAgent(sourceCalls))
    const target = createManagedSession(createOmpRuntimeAgent(targetCalls), { id: 'session-2' })
    const manager = createManager(managed)
    manager.sessions.set('session-2', target)

    await manager.setOmpAutoRetry('session-1', false)

    expect(sourceCalls).toEqual(['auto-retry:false'])
    expect(targetCalls).toEqual(['auto-retry:false'])
    expect(manager.events.map((item: any) => item.event.sessionId)).toEqual(['session-1', 'session-2'])
  })

  it('synchronizes a successful default-role fallback into the Craft session model', async () => {
    const calls: string[] = []
    const agent = createOmpRuntimeAgent(calls)
    const base = agent.getOmpControlState()
    agent.getOmpControlState = () => ({
      ...base,
      runtime: {
        ...base.runtime,
        fallback: {
          phase: 'succeeded' as const,
          from: 'provider/a',
          to: 'provider/b',
          role: 'default',
        },
      },
    })
    const managed = createManagedSession(agent, { model: 'provider/a' })
    const manager = createManager(managed)

    await manager.refreshOmpRuntime('session-1')

    expect(managed.model).toBe('provider/b')
    expect(manager.events.map((item: any) => item.event.type)).toEqual([
      'omp_control_state_changed',
      'session_model_changed',
    ])
    expect(manager.persisted).toHaveLength(1)
  })
})

describe('SessionManager OMP Todo bridge', () => {
  it('delegates Todo commands and publishes Todo snapshots', async () => {
    const calls: string[] = []
    const managed = createManagedSession(createOmpTodoAgent(calls))
    const manager = createManager(managed)

    await manager.refreshOmpTodos('session-1')
    await manager.mutateOmpTodos('session-1', managed.ompTodoState?.revision ?? 2, { type: 'addPhase', name: 'Desktop' })
    const exportResult = await manager.exportOmpTodosMarkdown('session-1')

    expect(calls).toEqual(['refresh', 'mutate:addPhase'])
    expect(exportResult).toEqual({ success: true, markdown: '# Desktop\n- [ ] Task' })
    expect(manager.events.map((item: any) => item.event.type)).toEqual([
      'omp_todo_state_changed',
      'omp_todo_state_changed',
    ])
    expect(managed.ompTodoState.phases[0].name).toBe('Desktop')
  })

  it('rejects Todo mutations while the session is processing', async () => {
    const calls: string[] = []
    const managed = createManagedSession(createOmpTodoAgent(calls), { isProcessing: true })
    const manager = createManager(managed)

    await expect(manager.mutateOmpTodos('session-1', 1, { type: 'addPhase', name: 'Blocked' })).rejects.toThrow(
      'OMP Todos cannot be edited while the session is processing',
    )
    expect(calls).toEqual([])
  })
})
