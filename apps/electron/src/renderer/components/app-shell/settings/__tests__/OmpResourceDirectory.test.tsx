import { beforeAll, describe, expect, it, mock } from 'bun:test'
import * as React from 'react'
import * as ReactDOMServer from 'react-dom/server'
import { initReactI18next } from 'react-i18next'
import { i18n, setupI18n } from '@craft-agent/shared/i18n'
import { Bot, ServerCog, Sparkles } from 'lucide-react'
import type { OmpResourceSnapshot } from '../../../../../shared/types'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))
setupI18n([initReactI18next])
i18n.changeLanguage('en')

let OmpResourceDirectory: typeof import('../OmpResourceDirectory').OmpResourceDirectory
let withOmpResourceWorkspace: typeof import('../OmpResourceDirectory').withOmpResourceWorkspace

beforeAll(async () => {
  const mod = await import('../OmpResourceDirectory')
  OmpResourceDirectory = mod.OmpResourceDirectory
  withOmpResourceWorkspace = mod.withOmpResourceWorkspace
})

function normalizeReactServerHtml(html: string): string {
  return html.replace(/<!-- -->/g, '')
}

function makeSnapshot(): OmpResourceSnapshot {
  return {
    mcp: {
      entries: [
        {
          id: 'fetch-mcp',
          type: 'mcp',
          name: 'fetch',
          source: 'user',
          scope: 'user',
          enabled: true,
          effectiveEnabled: true,
          path: 'C:/Users/User/.omp/mcp/fetch.yml',
          description: 'HTTP fetch MCP server',
          toolCount: 3,
          diagnostics: [],
          revision: 'rev-1',
          lastRefreshedAt: Date.now(),
        },
      ],
      sourcePaths: [{ path: 'C:/Users/User/.omp/mcp', exists: true }],
    },
    skills: {
      entries: [
        {
          id: 'commit-helper',
          type: 'skill',
          name: 'commit-helper',
          source: 'user',
          scope: 'project',
          enabled: true,
          effectiveEnabled: true,
          path: 'C:/Users/User/.omp/skills/commit-helper/SKILL.md',
          description: 'Commit helper skill',
          diagnostics: [],
          revision: 'rev-2',
          lastRefreshedAt: Date.now(),
        },
      ],
      sourcePaths: [{ path: 'C:/Users/User/.omp/skills', exists: true }],
    },
    agents: {
      entries: [
        {
          id: 'security-agent',
          type: 'agent',
          name: 'security-agent',
          source: 'bundled',
          scope: 'user',
          enabled: false,
          effectiveEnabled: false,
          path: 'C:/Program Files/OhMyPi/agents/security-agent.yml',
          description: 'Security advisor agent',
          diagnostics: [],
          revision: 'rev-3',
          lastRefreshedAt: Date.now(),
        },
      ],
      sourcePaths: [{ path: 'C:/Program Files/OhMyPi/agents', exists: true }],
    },
    diagnostics: [],
    refreshedAt: Date.now(),
  }
}

describe('OmpResourceDirectory', () => {
  it('renders resource entries with source, scope, and enabled status', () => {
    const snapshot = makeSnapshot()
    const html = normalizeReactServerHtml(ReactDOMServer.renderToString(
      <OmpResourceDirectory
        workspaceId="ws-1"
        type="skill"
        title="Skills"
        icon={Sparkles}
        snapshot={snapshot}
        onChange={() => {}}
      />,
    ))

    expect(html).toContain('Skills')
    expect(html).toContain('commit-helper')
    expect(html).toContain('user')
    expect(html).toContain('Project')
  })

  it('shows a test connection button only for MCP entries', () => {
    const snapshot = makeSnapshot()
    const skillHtml = normalizeReactServerHtml(ReactDOMServer.renderToString(
      <OmpResourceDirectory
        workspaceId="ws-1"
        type="skill"
        title="Skills"
        icon={Sparkles}
        snapshot={snapshot}
        onChange={() => {}}
      />,
    ))

    expect(skillHtml).not.toContain('Test connection')

    const mcpHtml = normalizeReactServerHtml(ReactDOMServer.renderToString(
      <OmpResourceDirectory
        workspaceId="ws-1"
        type="mcp"
        title="MCP"
        icon={ServerCog}
        snapshot={snapshot}
        onChange={() => {}}
      />,
    ))

    expect(mcpHtml).toContain('Test connection')
    expect(mcpHtml).toContain('fetch')
  })

  it('does not render a remove button for bundled resources', () => {
    const snapshot = makeSnapshot()
    const html = normalizeReactServerHtml(ReactDOMServer.renderToString(
      <OmpResourceDirectory
        workspaceId="ws-1"
        type="agent"
        title="Agents"
        icon={Bot}
        snapshot={snapshot}
        onChange={() => {}}
      />,
    ))

    expect(html).toContain('security-agent')
    expect(html).toContain('bundled')
    expect(html).not.toContain('Remove')
  })

  it('renders a remove button for user-created resources', () => {
    const snapshot = makeSnapshot()
    const html = normalizeReactServerHtml(ReactDOMServer.renderToString(
      <OmpResourceDirectory
        workspaceId="ws-1"
        type="skill"
        title="Skills"
        icon={Sparkles}
        snapshot={snapshot}
        onChange={() => {}}
      />,
    ))

    expect(html).toContain('Remove')
  })

  it('attaches active workspaceId to every resource mutation payload', () => {
    const workspaceId = 'ws-active-1'

    const create = withOmpResourceWorkspace(
      { type: 'mcp' as const, scope: 'project' as const, draft: { name: 'fetch' } },
      workspaceId,
    )
    const update = withOmpResourceWorkspace(
      {
        type: 'skill' as const,
        id: 'commit-helper',
        scope: 'project' as const,
        expectedRevision: 'rev-2',
        patch: { description: 'updated' },
      },
      workspaceId,
    )
    const setEnabled = withOmpResourceWorkspace(
      {
        type: 'skill' as const,
        id: 'commit-helper',
        scope: 'project' as const,
        expectedRevision: 'rev-2',
        enabled: false,
      },
      workspaceId,
    )
    const remove = withOmpResourceWorkspace(
      {
        type: 'skill' as const,
        id: 'commit-helper',
        scope: 'project' as const,
        expectedRevision: 'rev-2',
      },
      workspaceId,
    )
    const testMcp = withOmpResourceWorkspace(
      { id: 'fetch-mcp', scope: 'project' as const },
      workspaceId,
    )
    const refresh = withOmpResourceWorkspace({}, workspaceId)

    for (const payload of [create, update, setEnabled, remove, testMcp, refresh]) {
      expect(payload.workspaceId).toBe(workspaceId)
    }
  })

  it('omits workspaceId when no active workspace is selected', () => {
    const payload = withOmpResourceWorkspace(
      { type: 'mcp' as const, scope: 'user' as const, draft: { name: 'local' } },
      null,
    )
    expect(payload.workspaceId).toBeUndefined()
  })
})
