import { describe, expect, it } from 'bun:test'
import type { Message } from '@craft-agent/core'
import { messageToStored, storedToMessage } from '@craft-agent/core'

import {
  formatTurnAsMarkdown,
  groupMessagesByTurn,
} from '../turn-utils'

describe('OMP thinking turn grouping', () => {
  it('persists thinking as a distinct activity and never promotes it to the response', () => {
    const messages: Message[] = [
      { id: 'u1', role: 'user', content: 'Question', timestamp: 1 },
      {
        id: 'think1',
        role: 'assistant',
        content: 'Private reasoning',
        timestamp: 2,
        turnId: 'turn-1',
        isIntermediate: true,
        isThinking: true,
      },
      {
        id: 'a1',
        role: 'assistant',
        content: 'Final answer',
        timestamp: 3,
        turnId: 'turn-1',
      },
    ]

    const reloaded = messages.map((message) => storedToMessage(messageToStored(message)))
    expect(reloaded[1]?.isThinking).toBe(true)

    const turns = groupMessagesByTurn(reloaded, { isSessionProcessing: false })
    const assistant = turns.find((turn) => turn.type === 'assistant')
    expect(assistant?.type).toBe('assistant')
    if (!assistant || assistant.type !== 'assistant') throw new Error('assistant turn missing')
    expect(assistant.activities).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'thinking', content: 'Private reasoning' }),
    ]))
    expect(assistant.response?.text).toBe('Final answer')
    expect(formatTurnAsMarkdown(assistant)).toContain('### 💭 Thinking')
  })

  it('does not promote a completed thinking-only activity to final response', () => {
    const turns = groupMessagesByTurn([
      { id: 'u1', role: 'user', content: 'Question', timestamp: 1 },
      {
        id: 'think1',
        role: 'assistant',
        content: 'Reasoning only',
        timestamp: 2,
        isIntermediate: true,
        isThinking: true,
      },
    ], { isSessionProcessing: false })
    const assistant = turns.find((turn) => turn.type === 'assistant')
    if (!assistant || assistant.type !== 'assistant') throw new Error('assistant turn missing')
    expect(assistant.activities[0]?.type).toBe('thinking')
    expect(assistant.response).toBeUndefined()
  })
})
