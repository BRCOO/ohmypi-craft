import { describe, expect, it } from 'bun:test'
import { handleTextComplete, handleTextDelta } from '../text'
import type { SessionState, TextCompleteEvent, TextDeltaEvent } from '../../types'

function makeState(messages: any[]): SessionState {
  return {
    session: {
      id: 'session-1',
      messages,
      lastMessageAt: Date.now(),
    } as any,
    streaming: null,
  }
}

describe('handleTextComplete messageId synchronization', () => {
  it('overwrites existing streaming message id with authoritative messageId', () => {
    const state = makeState([
      {
        id: 'msg-local-temp-1',
        role: 'assistant',
        content: 'partial',
        isStreaming: true,
        isPending: true,
        turnId: 'turn-1',
        timestamp: 100,
      },
    ])

    const event: TextCompleteEvent = {
      type: 'text_complete',
      sessionId: 'session-1',
      text: 'final response',
      turnId: 'turn-1',
      messageId: 'msg-main-1',
      timestamp: 200,
    }

    const next = handleTextComplete(state, event)
    const msg = next.session.messages[0] as any

    expect(msg.id).toBe('msg-main-1')
    expect(msg.content).toBe('final response')
    expect(msg.isStreaming).toBe(false)
    expect(msg.isPending).toBe(false)
    expect(msg.timestamp).toBe(200)
  })

  it('uses authoritative messageId when creating message in race path', () => {
    const state = makeState([])

    const event: TextCompleteEvent = {
      type: 'text_complete',
      sessionId: 'session-1',
      text: 'created from complete',
      turnId: 'turn-race',
      messageId: 'msg-main-race',
      timestamp: 300,
    }

    const next = handleTextComplete(state, event)
    expect(next.session.messages).toHaveLength(1)
    expect((next.session.messages[0] as any).id).toBe('msg-main-race')
  })

  it('keeps backward compatibility when messageId is missing', () => {
    const state = makeState([])

    const event: TextCompleteEvent = {
      type: 'text_complete',
      sessionId: 'session-1',
      text: 'legacy payload',
      turnId: 'turn-legacy',
      timestamp: 400,
    }

    const next = handleTextComplete(state, event)
    const id = (next.session.messages[0] as any).id as string

    expect(id.startsWith('msg-')).toBe(true)
    expect(id).not.toBe('')
  })

  it('keeps thinking streaming separate from final answer streaming', () => {
    let state = makeState([])
    const thinkingDelta: TextDeltaEvent = {
      type: 'text_delta',
      sessionId: 'session-1',
      delta: 'Reason',
      turnId: 'turn-thinking',
      isThinking: true,
    }
    state = handleTextDelta(state, thinkingDelta)
    expect(state.session.messages[0]).toMatchObject({
      content: 'Reason',
      isThinking: true,
      isIntermediate: true,
    })

    state = handleTextComplete(state, {
      type: 'text_complete',
      sessionId: 'session-1',
      text: 'Reasoning',
      turnId: 'turn-thinking',
      isIntermediate: true,
      isThinking: true,
      messageId: 'thinking-main',
    })
    state = handleTextDelta(state, {
      type: 'text_delta',
      sessionId: 'session-1',
      delta: 'Answer',
      turnId: 'turn-thinking',
    })

    expect(state.session.messages).toHaveLength(2)
    expect(state.session.messages[0]).toMatchObject({
      id: 'thinking-main',
      content: 'Reasoning',
      isThinking: true,
      isStreaming: false,
    })
    expect(state.session.messages[1]).toMatchObject({
      content: 'Answer',
      isThinking: undefined,
      isStreaming: true,
    })
  })
})
