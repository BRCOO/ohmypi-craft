import { describe, expect, it } from 'bun:test'
import type { ExtensionUiRequest } from '../../../shared/types'
import {
  enqueueExtensionUiRequest,
  createExtensionUiResponseGate,
  getExtensionUiTimeoutMs,
  removeExtensionUiRequest,
  shouldQueueExtensionUiRequest,
  updateExtensionUiHostStates,
} from '../extension-ui-state'

function request(method: string, overrides: Partial<ExtensionUiRequest> = {}): ExtensionUiRequest {
  return {
    requestId: `${method}-1`,
    method,
    raw: {},
    ...overrides,
  }
}

describe('extension UI state', () => {
  it('queues blocking, link, and unknown requests but not immediate host actions', () => {
    for (const method of ['select', 'confirm', 'input', 'editor', 'open_url', 'custom']) {
      expect(shouldQueueExtensionUiRequest(request(method))).toBe(true)
    }
    for (const method of ['notify', 'setStatus', 'setWidget', 'setTitle', 'set_editor_text']) {
      expect(shouldQueueExtensionUiRequest(request(method))).toBe(false)
    }
  })

  it('only schedules positive timeouts for blocking requests', () => {
    expect(getExtensionUiTimeoutMs(request('select', { timeoutMs: 250 }))).toBe(250)
    expect(getExtensionUiTimeoutMs(request('notify', { timeoutMs: 250 }))).toBeUndefined()
    expect(getExtensionUiTimeoutMs(request('input', { timeoutMs: 0 }))).toBeUndefined()
  })

  it('delivers timeout or user response at most once until reset', () => {
    const delivered: unknown[] = []
    const gate = createExtensionUiResponseGate((response) => delivered.push(response))

    expect(gate.respond({ cancelled: true, timedOut: true })).toBe(true)
    expect(gate.respond({ value: 'late answer' })).toBe(false)
    expect(delivered).toEqual([{ cancelled: true, timedOut: true }])

    gate.reset()
    expect(gate.respond({ confirmed: true })).toBe(true)
    expect(delivered.at(-1)).toEqual({ confirmed: true })
  })

  it('updates and clears status without removing widgets in the same session', () => {
    let states = updateExtensionUiHostStates(new Map(), 'session-a', request('setWidget', {
      widgetKey: 'progress',
      widgetLines: ['step 1'],
    }))
    states = updateExtensionUiHostStates(states, 'session-a', request('setStatus', {
      statusKey: 'phase',
      statusText: 'running',
    }))
    states = updateExtensionUiHostStates(states, 'session-a', request('setStatus', {
      statusKey: 'phase',
      statusText: undefined,
    }))

    expect(states.get('session-a')).toEqual({
      statuses: {},
      widgets: { progress: { lines: ['step 1'], placement: undefined } },
    })
  })

  it('clears an empty widget session without touching another session', () => {
    let states = updateExtensionUiHostStates(new Map(), 'session-a', request('setWidget', {
      widgetKey: 'progress',
      widgetLines: ['step 1'],
    }))
    states = updateExtensionUiHostStates(states, 'session-b', request('setStatus', {
      statusKey: 'phase',
      statusText: 'waiting',
    }))
    states = updateExtensionUiHostStates(states, 'session-a', request('setWidget', {
      widgetKey: 'progress',
      widgetLines: undefined,
    }))

    expect(states.has('session-a')).toBe(false)
    expect(states.get('session-b')?.statuses.phase).toBe('waiting')
  })

  it('removes only the matching request in the matching session', () => {
    const sharedIdA = request('select', { requestId: 'shared' })
    const sharedIdB = request('confirm', { requestId: 'shared' })
    const other = request('input', { requestId: 'other' })
    let queues = enqueueExtensionUiRequest(new Map(), 'session-a', sharedIdA)
    queues = enqueueExtensionUiRequest(queues, 'session-a', other)
    queues = enqueueExtensionUiRequest(queues, 'session-b', sharedIdB)
    queues = removeExtensionUiRequest(queues, 'session-a', 'shared')

    expect(queues.get('session-a')?.map((item) => item.requestId)).toEqual(['other'])
    expect(queues.get('session-b')?.map((item) => item.requestId)).toEqual(['shared'])
  })
})
