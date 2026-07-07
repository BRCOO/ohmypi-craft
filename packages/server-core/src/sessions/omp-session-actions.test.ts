import { describe, expect, it } from 'bun:test'
import type { Message } from '@craft-agent/core/types'

import {
  createCraftMessagesFromOmpMessages,
  mapOmpBranchMessagesToCraftOptions,
  truncateMessagesBeforeBranch,
} from './omp-session-actions'

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

describe('OMP session action helpers', () => {
  it('maps OMP branch entries onto Craft user messages by stable ordinal', () => {
    const options = mapOmpBranchMessagesToCraftOptions([
      { entryId: 'entry-1', text: 'hello world' },
      {
        entryId: 'entry-2',
        text: 'please make this answer shorter but keep the important details',
      },
    ], [
      message('user-1', 'user', 'hello\n  world'),
      message('assistant-1', 'assistant', 'Sure.'),
      message('draft-user', 'user', 'skip me', { isIntermediate: true }),
      message('thinking-user', 'user', 'skip me too', { isThinking: true }),
      message('user-2', 'user', 'please make this answer shorter but keep the important details'),
    ])

    expect(options).toEqual([
      {
        entryId: 'entry-1',
        craftMessageId: 'user-1',
        ordinal: 1,
        textPreview: 'hello world',
      },
      {
        entryId: 'entry-2',
        craftMessageId: 'user-2',
        ordinal: 2,
        textPreview: 'please make this answer shorter but keep the important details',
      },
    ])
  })

  it('fails branch mapping when Craft and OMP user counts drift', () => {
    expect(() => mapOmpBranchMessagesToCraftOptions([
      { entryId: 'entry-1', text: 'one' },
    ], [
      message('user-1', 'user', 'one'),
      message('user-2', 'user', 'two'),
    ])).toThrow('Craft has 2 user messages while OMP returned 1')
  })

  it('fails branch mapping when the matched user texts diverge', () => {
    expect(() => mapOmpBranchMessagesToCraftOptions([
      { entryId: 'entry-1', text: 'different request' },
    ], [
      message('user-1', 'user', 'original request'),
    ])).toThrow('Craft and OMP user message text differ')
  })

  it('truncates messages before the selected branch point', () => {
    const before = [
      message('user-1', 'user', 'one'),
      message('assistant-1', 'assistant', 'reply'),
      message('user-2', 'user', 'two'),
      message('assistant-2', 'assistant', 'later reply'),
    ]

    expect(truncateMessagesBeforeBranch(before, 'user-2').map(item => item.id))
      .toEqual(['user-1', 'assistant-1'])
  })

  it('creates Craft display messages from OMP conversation messages', () => {
    const ids = ['craft-1', 'craft-2']
    const timestamps = [10, 11]
    const messages = createCraftMessagesFromOmpMessages([
      {
        id: 'omp-user-1',
        role: 'user',
        content: [{ type: 'text', text: 'Hi OMP' }],
      },
      {
        id: 'omp-tool-1',
        role: 'tool',
        content: [{ type: 'text', text: 'ignored' }],
      },
      {
        id: 'omp-assistant-1',
        role: 'assistant',
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'image', text: 'ignored' },
          { type: 'text', text: 'again' },
        ],
      },
    ], () => ids.shift()!, () => timestamps.shift()!)

    expect(messages).toEqual([
      {
        id: 'craft-1',
        role: 'user',
        content: 'Hi OMP',
        timestamp: 10,
      },
      {
        id: 'craft-2',
        role: 'assistant',
        content: 'Hello\nagain',
        timestamp: 11,
        turnId: 'omp-assistant-1',
      },
    ])
  })
})
