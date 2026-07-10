import { beforeAll, describe, expect, it, mock } from 'bun:test'
import * as React from 'react'
import * as ReactDOMServer from 'react-dom/server'
import { Sparkles } from 'lucide-react'
import type {
  LlmConnectionWithStatus,
  OmpFeatureCapabilityDto,
  OmpFeatureCenterStateDto,
  OmpFeatureModelRoleDto,
  OmpFeatureUnavailableCommandDto,
} from '../../../../shared/types'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))

let CapabilityCard: typeof import('../OmpFeatureCenterSettingsPage').CapabilityCard
let AdvisorRosterEditor: typeof import('../OmpFeatureCenterSettingsPage').AdvisorRosterEditor
let buildOmpModelRoleOptions: typeof import('../OmpFeatureCenterSettingsPage').buildOmpModelRoleOptions
let buildOmpFeatureCenterSavePayload: typeof import('../OmpFeatureCenterSettingsPage').buildOmpFeatureCenterSavePayload
let RoleRow: typeof import('../OmpFeatureCenterSettingsPage').RoleRow
let UsageGuideCard: typeof import('../OmpFeatureCenterSettingsPage').UsageGuideCard
let UnavailableCommandList: typeof import('../OmpFeatureCenterSettingsPage').UnavailableCommandList
let capabilityUsageCopy: typeof import('../OmpFeatureCenterSettingsPage').capabilityUsageCopy

function normalizeReactServerHtml(html: string): string {
  return html.replace(/<!-- -->/g, '')
}

beforeAll(async () => {
  const mod = await import('../OmpFeatureCenterSettingsPage')
  CapabilityCard = mod.CapabilityCard
  AdvisorRosterEditor = mod.AdvisorRosterEditor
  buildOmpModelRoleOptions = mod.buildOmpModelRoleOptions
  buildOmpFeatureCenterSavePayload = mod.buildOmpFeatureCenterSavePayload
  RoleRow = mod.RoleRow
  UsageGuideCard = mod.UsageGuideCard
  UnavailableCommandList = mod.UnavailableCommandList
  capabilityUsageCopy = mod.capabilityUsageCopy
})

describe('OmpFeatureCenterSettingsPage components', () => {
  it('renders an OMP capability card with discovered items and usage hint', () => {
    const capability: OmpFeatureCapabilityDto = {
      count: 1,
      sourcePaths: [{ path: 'C:/Users/User/.omp/agent/skills', exists: true }],
      items: [
        {
          name: 'commit-helper',
          path: 'C:/Users/User/.omp/agent/skills/commit-helper/SKILL.md',
          level: 'user',
          description: 'Commit helper',
        },
      ],
      usageHint: '/skill:<name>',
    }

    const html = normalizeReactServerHtml(ReactDOMServer.renderToString(
      <CapabilityCard icon={Sparkles} title="Skills" capability={capability} />,
    ))

    expect(html).toContain('Skills')
    expect(html).toContain('commit-helper')
    expect(html).toContain('/skill:&lt;name&gt;')
    expect(html).toContain('user')
    expect(html).toContain('Copy usage')
    expect(html).toContain('Reveal source')
  })

  it('renders project override warning on model role rows', () => {
    const role: OmpFeatureModelRoleDto = {
      role: 'plan',
      label: 'Architect',
      common: true,
      source: 'project',
      effectiveValue: 'project/architect',
      globalValue: 'global/architect',
      projectValue: 'project/architect',
      projectOverridden: true,
    }

    const html = normalizeReactServerHtml(ReactDOMServer.renderToString(
      <RoleRow
        role={role}
        value="global/architect"
        modelOptions={[{ value: 'global/architect', label: 'Global Architect', source: 'configured' }]}
        onChange={() => {}}
      />,
    ))

    expect(html).toContain('Architect')
    expect(html).toContain('Global Architect')
    expect(html).toContain('project override')
    expect(html).toContain('Saving global config will not change the effective value')
    expect(html).toContain('Global: global/architect')
  })

  it('builds selectable OMP model role options from synced models and configured values', () => {
    const connections: LlmConnectionWithStatus[] = [{
      slug: 'omp-local',
      name: 'Oh My Pi',
      providerType: 'omp',
      authType: 'none',
      models: [
        { id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek V4 Flash', costInput: 0, costOutput: 0, contextWindow: 128000, supportsImages: false, reasoning: true },
      ] as never,
      defaultModel: 'openrouter/qwen3',
      createdAt: 1,
      isAuthenticated: true,
    }]
    const state = {
      modelRoles: {
        common: [{
          role: 'advisor',
          label: 'Advisor',
          common: true,
          source: 'global',
          globalValue: 'openrouter/qwen3:high',
          effectiveValue: 'openrouter/qwen3:high',
          projectOverridden: false,
        }],
        advanced: [],
      },
      advisor: { roster: { advisors: [{ name: 'Security', model: 'anthropic/claude-sonnet-4-5:medium' }] } },
    } as unknown as OmpFeatureCenterStateDto

    const options = buildOmpModelRoleOptions(connections, state)

    expect(options.map(option => option.value)).toContain('deepseek/deepseek-v4-flash')
    expect(options.map(option => option.value)).toContain('openrouter/qwen3')
    expect(options.map(option => option.value)).toContain('openrouter/qwen3:high')
    expect(options.map(option => option.value)).toContain('anthropic/claude-sonnet-4-5:medium')
  })

  it('renders OMP usage guide cards with copyable commands', () => {
    const html = normalizeReactServerHtml(ReactDOMServer.renderToString(
      <UsageGuideCard
        title="Inspect MCP"
        description="Use OMP MCP commands to inspect servers."
        command="/mcp list"
      />,
    ))

    expect(html).toContain('Inspect MCP')
    expect(html).toContain('Use OMP MCP commands')
    expect(html).toContain('/mcp list')
  })

  it('renders the editable WATCHDOG advisor roster', () => {
    const html = normalizeReactServerHtml(ReactDOMServer.renderToString(
      <AdvisorRosterEditor
        draft={{
          instructions: 'Coordinate specialist advisors.',
          advisors: [{
            id: 'security',
            name: 'Security',
            model: 'openai/gpt-5',
            tools: 'Read, Grep',
            instructions: 'Focus on auth boundaries.',
          }],
        }}
        workspaceId="workspace-1"
        editablePath="C:/Users/User/.omp/WATCHDOG.yml"
        exists
        onInstructionsChange={() => {}}
        onAdvisorChange={() => {}}
        onAddAdvisor={() => {}}
        onRemoveAdvisor={() => {}}
      />,
    ))

    expect(html).toContain('WATCHDOG.yml editor')
    expect(html).toContain('Coordinate specialist advisors.')
    expect(html).toContain('Security')
    expect(html).toContain('Read, Grep')
    expect(html).toContain('Focus on auth boundaries.')
  })

  it('builds save payload without unchanged advisor toggles', () => {
    const state = {
      advisor: {
        enabled: { source: 'project', effectiveValue: true, projectValue: true, projectOverridden: true },
        subagents: { source: 'default', effectiveValue: false, projectOverridden: false },
        roster: {
          editable: {
            instructions: '',
            advisors: [{
              name: 'Security',
              model: 'openai/gpt-5',
              tools: ['Read'],
              instructions: 'Focus on auth boundaries.',
            }],
          },
        },
      },
    } as OmpFeatureCenterStateDto
    const role: OmpFeatureModelRoleDto = {
      role: 'default',
      label: 'Default',
      common: true,
      source: 'global',
      globalValue: 'old/default',
      effectiveValue: 'old/default',
      projectOverridden: false,
    }

    const payload = buildOmpFeatureCenterSavePayload({
      workspaceId: 'workspace-1',
      roles: [role],
      roleDraft: { default: 'new/default' },
      advisorEnabled: true,
      advisorSubagents: false,
      advisorRosterDraft: {
        instructions: '',
        advisors: [{
          id: 'security',
          name: 'Security',
          model: 'openai/gpt-5',
          tools: 'Read',
          instructions: 'Focus on auth boundaries.',
        }],
      },
      state,
    })

    expect(payload.modelRoles?.default).toBe('new/default')
    expect(payload.advisor).toBeUndefined()
    expect(payload.advisorRoster).toBeUndefined()
  })

  it('renders hidden TUI-only command reasons', () => {
    const commands: OmpFeatureUnavailableCommandDto[] = [
      {
        command: '/plan',
        label: 'Native Plan Mode',
        status: 'needs-upstream-rpc',
        reason: 'No stable RPC toggle is exposed yet.',
        alternative: 'Use modelRoles.plan.',
      },
    ]

    const html = normalizeReactServerHtml(ReactDOMServer.renderToString(
      <UnavailableCommandList commands={commands} />,
    ))

    expect(html).toContain('/plan')
    expect(html).toContain('Native Plan Mode')
    expect(html).toContain('No stable RPC toggle is exposed yet.')
    expect(html).toContain('Use modelRoles.plan.')
  })

  it('normalizes copy snippets for common OMP capability cards', () => {
    expect(capabilityUsageCopy('Skills', '/skill:<name>')).toBe('/skill:<name>')
    expect(capabilityUsageCopy('MCP', '/mcp list')).toContain('/mcp resources')
    expect(capabilityUsageCopy('Agents', 'Define Markdown agents')).toBe('Define Markdown agents')
  })
})
