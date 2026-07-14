import { beforeAll, describe, expect, it, mock } from 'bun:test'
import * as React from 'react'
import * as ReactDOMServer from 'react-dom/server'
import { Bot, Sparkles } from 'lucide-react'
import type { OmpResourceSnapshot } from '../../../../../shared/types'

function installResourceDirectoryTestMocks(): void {
  mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
  mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))
  mock.module('react-i18next', () => ({
    useTranslation: () => ({
      t: (key: string, options?: { defaultValue?: string }) => {
        if (key === 'omp.featureCenter.resource.testConnection') return 'Test connection'
        if (key === 'omp.featureCenter.resource.remove') return 'Remove'
        if (key === 'omp.featureCenter.scope.project') return 'Project'
        return options?.defaultValue ?? key
      },
    }),
  }))
}

installResourceDirectoryTestMocks()

let OmpResourceDirectory: typeof import('../OmpResourceDirectory').OmpResourceDirectory
let canManageOmpResource: typeof import('../OmpResourceDirectory').canManageOmpResource
let canTestOmpResource: typeof import('../OmpResourceDirectory').canTestOmpResource
let withOmpResourceWorkspace: typeof import('../OmpResourceDirectory').withOmpResourceWorkspace

beforeAll(async () => {
  // Other renderer tests register module mocks in the shared Bun process.
  // Restore and reapply this file's own mocks before loading the component.
  mock.restore()
  installResourceDirectoryTestMocks()
  const mod = await import('../OmpResourceDirectory')
  OmpResourceDirectory = mod.OmpResourceDirectory
  canManageOmpResource = mod.canManageOmpResource
  canTestOmpResource = mod.canTestOmpResource
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
    expect(canTestOmpResource('mcp')).toBe(true)
    expect(canTestOmpResource('skill')).toBe(false)
    expect(canTestOmpResource('agent')).toBe(false)
    expect(snapshot.mcp.entries[0]?.name).toBe('fetch')
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
    expect(canManageOmpResource(snapshot.agents.entries[0]!)).toBe(false)
  })

  it('renders a remove button for user-created resources', () => {
    const snapshot = makeSnapshot()
    expect(canManageOmpResource(snapshot.skills.entries[0]!)).toBe(true)
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
