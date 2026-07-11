import { describe, expect, it } from 'bun:test'

import { SessionManager } from './SessionManager.ts'

function createManager(): any {
  const manager = Object.create(SessionManager.prototype)
  manager.sessions = new Map()
  manager.pendingExtensionUiRequests = new Map()
  return manager
}

describe('SessionManager extension UI responses', () => {
  it('returns false for a missing or stale request', () => {
    const manager = createManager()
    manager.sessions.set('session-a', {
      agent: { respondToExtensionUiRequest: () => { throw new Error('must not be called') } },
    })

    expect(manager.respondToExtensionUiRequest('session-a', 'missing', { value: 'x' })).toBe(false)
  })

  it('delivers a registered response once and removes its metadata', () => {
    const manager = createManager()
    const calls: unknown[][] = []
    const agent = {
      respondToExtensionUiRequest(this: unknown, ...args: unknown[]) {
        expect(this).toBe(agent)
        calls.push(args)
      },
    }
    manager.sessions.set('session-a', { agent })
    manager.pendingExtensionUiRequests.set('session-a:request-1', {
      sessionId: 'session-a',
      method: 'input',
    })

    expect(manager.respondToExtensionUiRequest('session-a', 'request-1', { value: 'answer' })).toBe(true)
    expect(calls).toEqual([['request-1', { value: 'answer' }]])
    expect(manager.pendingExtensionUiRequests.has('session-a:request-1')).toBe(false)
    expect(manager.respondToExtensionUiRequest('session-a', 'request-1', { value: 'again' })).toBe(false)
    expect(calls).toHaveLength(1)
  })

  it('does not cross-deliver identical request ids between sessions', () => {
    const manager = createManager()
    const callsA: unknown[][] = []
    const callsB: unknown[][] = []
    manager.sessions.set('session-a', {
      agent: { respondToExtensionUiRequest: (...args: unknown[]) => callsA.push(args) },
    })
    manager.sessions.set('session-b', {
      agent: { respondToExtensionUiRequest: (...args: unknown[]) => callsB.push(args) },
    })
    manager.pendingExtensionUiRequests.set('session-a:shared', { sessionId: 'session-a', method: 'confirm' })
    manager.pendingExtensionUiRequests.set('session-b:shared', { sessionId: 'session-b', method: 'confirm' })

    expect(manager.respondToExtensionUiRequest('session-a', 'shared', { confirmed: true })).toBe(true)
    expect(callsA).toHaveLength(1)
    expect(callsB).toHaveLength(0)
    expect(manager.pendingExtensionUiRequests.has('session-b:shared')).toBe(true)
  })

  it('routes a Plan review decision through the OMP-native response command', async () => {
    const manager = createManager()
    const calls: unknown[][] = []
    const agent = {
      getOmpControlState: () => ({}),
      steer: () => {},
      followUp: () => {},
      abortAndPrompt: () => {},
      setSteeringMode: () => {},
      setFollowUpMode: () => {},
      setInterruptMode: () => {},
      setOmpPlanMode: () => Promise.resolve({}),
      respondToOmpPlanReview(this: unknown, ...args: unknown[]) {
        expect(this).toBe(agent)
        calls.push(args)
      },
    }
    manager.sessions.set('session-a', { agent })
    manager.pendingExtensionUiRequests.set('session-a:plan-review-1', {
      sessionId: 'session-a',
      method: 'plan_review',
    })

    expect(manager.respondToExtensionUiRequest('session-a', 'plan-review-1', {
      action: 'refine',
      feedback: 'Please split the migration into two steps.',
    })).toBe(true)
    await Promise.resolve()

    expect(calls).toEqual([[
      'plan-review-1',
      { action: 'refine', feedback: 'Please split the migration into two steps.' },
    ]])
    expect(manager.pendingExtensionUiRequests.has('session-a:plan-review-1')).toBe(false)
  })

  it('creates the lazy OMP backend before enabling Plan Mode for a new session', async () => {
    const manager = createManager()
    const calls: unknown[] = []
    const agent = {
      getOmpControlState: () => ({ plan: { supported: true } }),
      steer: () => {},
      followUp: () => {},
      abortAndPrompt: () => {},
      setSteeringMode: () => {},
      setFollowUpMode: () => {},
      setInterruptMode: () => {},
      setOmpPlanMode: async (enabled: boolean) => { calls.push(enabled) },
      respondToOmpPlanReview: () => {},
    }
    const managed = { agent: null }
    manager.sessions.set('session-a', managed)
    manager.getOrCreateAgent = async (value: unknown) => {
      expect(value).toBe(managed)
      return agent
    }
    manager.publishOmpControlState = (value: unknown, state: unknown) => calls.push(value, state)

    await manager.setOmpPlanMode('session-a', true)

    expect(calls).toEqual([true, managed, { plan: { supported: true } }])
  })

  it('returns false and clears metadata when the backend cannot respond', () => {
    const manager = createManager()
    manager.sessions.set('session-a', { agent: {} })
    manager.pendingExtensionUiRequests.set('session-a:request-1', {
      sessionId: 'session-a',
      method: 'editor',
    })

    expect(manager.respondToExtensionUiRequest('session-a', 'request-1', { cancelled: true })).toBe(false)
    expect(manager.pendingExtensionUiRequests.has('session-a:request-1')).toBe(false)
  })
})
