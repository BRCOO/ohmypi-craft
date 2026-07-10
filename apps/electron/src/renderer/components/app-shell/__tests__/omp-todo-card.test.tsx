import { describe, expect, it } from 'bun:test'
import * as React from 'react'
import * as ReactDOMServer from 'react-dom/server'
import { OmpTodoCard, shouldShowOmpTodoCard } from '../OmpTodoCard'
import type { OmpTodoStateDto } from '../../../../shared/types'

function makeState(overrides: Partial<OmpTodoStateDto> = {}): OmpTodoStateDto {
  return {
    available: true,
    sessionId: 'session-1',
    phases: [
      {
        name: 'Phase 1',
        tasks: [
          { content: 'Task A', status: 'in_progress' },
          { content: 'Task B', status: 'pending' },
          { content: 'Task C', status: 'completed' },
        ],
      },
    ],
    subagents: [],
    revision: 1,
    updatedAt: Date.now(),
    ...overrides,
  }
}

describe('OmpTodoCard', () => {
  it('renders collapsed summary with current task', () => {
    const html = ReactDOMServer.renderToString(
      <OmpTodoCard sessionId="session-1" state={makeState()} isProcessing={false} />,
    )
    expect(html).toContain('OMP Todos')
    expect(html).toContain('Now: Task A')
  })

  it('renders empty state when no todos are available', () => {
    const html = ReactDOMServer.renderToString(
      <OmpTodoCard
        sessionId="session-1"
        state={makeState({ phases: [] })}
        isProcessing={false}
      />,
    )
    expect(html).toContain('No OMP Todo items yet')
  })

  it('hides the chat card host for an empty available OMP Todo state', () => {
    expect(shouldShowOmpTodoCard(makeState({ phases: [] }))).toBe(false)
    expect(shouldShowOmpTodoCard(makeState({ phases: [], pendingAction: 'refresh' }))).toBe(true)
    expect(shouldShowOmpTodoCard(makeState())).toBe(true)
  })

  it('renders waiting message when state is not available', () => {
    const html = ReactDOMServer.renderToString(
      <OmpTodoCard
        sessionId="session-1"
        state={makeState({ available: false, phases: [] })}
        isProcessing={false}
      />,
    )
    expect(html).toContain('Waiting for OMP Todo state')
  })

  it('renders subagent summary when only subagents have todos', () => {
    const html = ReactDOMServer.renderToString(
      <OmpTodoCard
        sessionId="session-1"
        state={makeState({
          phases: [],
          subagents: [
            {
              id: 'sub-1',
              index: 0,
              agent: 'reviewer',
              agentSource: 'bundled',
              description: 'Reviewer',
              status: 'running',
              lastUpdate: Date.now(),
              todoPhases: [
                {
                  name: 'Subagent phase',
                  tasks: [
                    { content: 'Subtask 1', status: 'completed' },
                    { content: 'Subtask 2', status: 'pending' },
                  ],
                },
              ],
            },
          ],
        })}
        isProcessing={false}
      />,
    )
    expect(html).toContain('1 OMP subagent active')
  })

  it('shows pending action badge', () => {
    const html = ReactDOMServer.renderToString(
      <OmpTodoCard
        sessionId="session-1"
        state={makeState({ pendingAction: 'refresh' })}
        isProcessing={false}
      />,
    )
    expect(html).toContain('refresh')
  })


})
