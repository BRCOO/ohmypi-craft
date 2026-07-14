import { beforeAll, describe, expect, it, jest } from 'bun:test'
import * as React from 'react'
import * as ReactDOMServer from 'react-dom/server'
import { initReactI18next } from 'react-i18next'
import { i18n, setupI18n } from '@craft-agent/shared/i18n'
import { OmpSubagentBar } from '../OmpSubagentBar'
import { OmpSubagentDetail } from '../OmpSubagentDetail'
import type { OmpSubagentStateDto } from '../../../../shared/types'

setupI18n([initReactI18next])

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

function makeState(overrides: Partial<OmpSubagentStateDto> = {}): OmpSubagentStateDto {
  return {
    available: true,
    sessionId: 'session-1',
    subagents: [
      {
        id: 'sub-1',
        index: 0,
        agent: 'reviewer',
        agentSource: 'bundled',
        description: 'Protocol reviewer',
        status: 'running',
        task: 'Review protocol',
        assignment: 'Check coverage',
        sessionFile: 'D:/sessions/sub-1.jsonl',
        lastUpdate: Date.now(),
        transcriptEntries: [],
        transcriptMessages: [],
        transcriptLoading: false,
      },
      {
        id: 'sub-2',
        index: 1,
        agent: 'writer',
        agentSource: 'project',
        description: 'Docs writer',
        status: 'completed',
        task: 'Write docs',
        lastUpdate: Date.now(),
        transcriptEntries: [{ type: 'text' }],
        transcriptMessages: [{ role: 'assistant' }],
        transcriptLoading: false,
        cursor: { fromByte: 0, nextByte: 100, hasMore: false },
      },
    ],
    revision: 1,
    updatedAt: Date.now(),
    ...overrides,
  }
}

describe('OmpSubagentBar', () => {
  it('renders nothing when there are no subagents', () => {
    const html = ReactDOMServer.renderToString(
      <OmpSubagentBar state={makeState({ subagents: [] })} isProcessing={false} onOpenDetail={() => {}} />,
    )
    expect(html).toBe('')
  })

  it('renders running and completed counts', () => {
    const html = ReactDOMServer.renderToString(
      <OmpSubagentBar state={makeState()} isProcessing={false} onOpenDetail={() => {}} />,
    )
    expect(html).toContain('OMP Subagents')
    expect(html).toContain('1')
    expect(html).toContain('running')
    expect(html).toContain('done')
    expect(/2.*subagent/.test(html)).toBe(true)
  })

  it('calls onOpenDetail when clicked', () => {
    const onOpenDetail = jest.fn()
    const html = ReactDOMServer.renderToString(
      <OmpSubagentBar state={makeState()} isProcessing={false} onOpenDetail={onOpenDetail} />,
    )
    expect(html).toContain('OMP Subagents')
    expect(onOpenDetail).not.toHaveBeenCalled()
  })
})

describe('OmpSubagentDetail', () => {
  it('renders the drawer with list and transcript', () => {
    const html = ReactDOMServer.renderToString(
      <OmpSubagentDetail sessionId="session-1" state={makeState()} onClose={() => {}} />,
    )
    expect(html).toContain('OMP Subagents')
    expect(html).toContain('Protocol reviewer')
    expect(html).toContain('Docs writer')
    expect(html).toContain('Load more')
  })

  it('selects the initial subagent when provided', () => {
    const html = ReactDOMServer.renderToString(
      <OmpSubagentDetail sessionId="session-1" state={makeState()} initialSubagentId="sub-2" onClose={() => {}} />,
    )
    expect(html).toContain('Docs writer')
    expect(html).toContain('Transcript loaded')
    expect(html).not.toContain('Load more')
  })
})
