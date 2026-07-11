import type { ExtensionUiRequest, ExtensionUiResponse } from '../../shared/types'
import type { ExtensionUiHostState } from '@/context/AppShellContext'

const BLOCKING_METHODS = new Set(['select', 'confirm', 'input', 'editor', 'plan_review'])
const IMMEDIATE_METHODS = new Set(['notify', 'setStatus', 'setWidget', 'setTitle', 'set_editor_text'])

export function isBlockingExtensionUiMethod(method: string): boolean {
  return BLOCKING_METHODS.has(method)
}

export function shouldQueueExtensionUiRequest(request: ExtensionUiRequest): boolean {
  return request.method === 'open_url'
    || isBlockingExtensionUiMethod(request.method)
    || !IMMEDIATE_METHODS.has(request.method)
}

export function getExtensionUiTimeoutMs(request: ExtensionUiRequest): number | undefined {
  if (!isBlockingExtensionUiMethod(request.method)) return undefined
  if (typeof request.timeoutMs !== 'number' || !Number.isFinite(request.timeoutMs) || request.timeoutMs <= 0) {
    return undefined
  }
  return request.timeoutMs
}

export function createExtensionUiResponseGate(
  deliver: (response: ExtensionUiResponse) => void,
): {
  respond(response: ExtensionUiResponse): boolean
  reset(): void
} {
  let responded = false
  return {
    respond(response) {
      if (responded) return false
      responded = true
      deliver(response)
      return true
    },
    reset() {
      responded = false
    },
  }
}

export function updateExtensionUiHostStates(
  states: Map<string, ExtensionUiHostState>,
  sessionId: string,
  request: ExtensionUiRequest,
): Map<string, ExtensionUiHostState> {
  if (request.method !== 'setStatus' && request.method !== 'setWidget') return states

  const next = new Map(states)
  const current = next.get(sessionId) ?? { statuses: {}, widgets: {} }
  const statuses = { ...current.statuses }
  const widgets = { ...current.widgets }

  if (request.method === 'setStatus') {
    const key = request.statusKey || 'status'
    if (request.statusText === undefined) delete statuses[key]
    else statuses[key] = request.statusText
  } else {
    const key = request.widgetKey || 'widget'
    if (request.widgetLines === undefined) delete widgets[key]
    else widgets[key] = { lines: [...request.widgetLines], placement: request.widgetPlacement }
  }

  if (Object.keys(statuses).length === 0 && Object.keys(widgets).length === 0) {
    next.delete(sessionId)
  } else {
    next.set(sessionId, { statuses, widgets })
  }
  return next
}

export function enqueueExtensionUiRequest(
  queues: Map<string, ExtensionUiRequest[]>,
  sessionId: string,
  request: ExtensionUiRequest,
): Map<string, ExtensionUiRequest[]> {
  const next = new Map(queues)
  next.set(sessionId, [...(next.get(sessionId) ?? []), request])
  return next
}

export function removeExtensionUiRequest(
  queues: Map<string, ExtensionUiRequest[]>,
  sessionId: string,
  requestId: string,
): Map<string, ExtensionUiRequest[]> {
  const queue = queues.get(sessionId)
  if (!queue?.some((request) => request.requestId === requestId)) return queues

  const next = new Map(queues)
  const remaining = queue.filter((request) => request.requestId !== requestId)
  if (remaining.length === 0) next.delete(sessionId)
  else next.set(sessionId, remaining)
  return next
}
