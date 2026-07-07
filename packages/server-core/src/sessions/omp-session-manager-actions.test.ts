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
