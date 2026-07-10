import { beforeAll, describe, expect, it, mock } from 'bun:test'
import * as React from 'react'
import * as ReactDOMServer from 'react-dom/server'
import { initReactI18next } from 'react-i18next'
import { i18n, setupI18n } from '@craft-agent/shared/i18n'
import type { OmpFeatureCenterStateDto } from '../../../../shared/types'
import type { SlashCommand, SlashSection } from '../slash-command-menu'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))
setupI18n([initReactI18next])

let buildOmpCuratedSections: typeof import('../slash-command-menu').buildOmpCuratedSections
let filterAvailableOmpCommands: typeof import('../slash-command-menu').filterAvailableOmpCommands
let filterSlashSectionsForInput: typeof import('../slash-command-menu').filterSlashSectionsForInput
let InlineSlashCommand: typeof import('../slash-command-menu').InlineSlashCommand
let slashCommandIdKey: typeof import('../slash-command-menu').slashCommandIdKey
let useInlineSlashCommand: typeof import('../slash-command-menu').useInlineSlashCommand
type UseInlineSlashCommandOptions = import('../slash-command-menu').UseInlineSlashCommandOptions

function normalizeReactServerHtml(html: string): string {
  return html.replace(/<!-- -->/g, '')
}

function buildMockState(patches: Partial<OmpFeatureCenterStateDto> = {}): OmpFeatureCenterStateDto {
  return {
    runtime: {
      available: true,
      globalConfigPath: 'C:/Users/User/.omp/agent/config.yml',
      checkedAt: Date.now(),
    },
    config: {
      global: { path: 'C:/Users/User/.omp/agent/config.yml', exists: true },
    },
    modelRoles: {
      common: [
        { role: 'default', label: 'Default', common: true, source: 'default', effectiveValue: '', projectOverridden: false },
      ],
      advanced: [],
    },
    advisor: {
      enabled: { source: 'default', effectiveValue: false, projectOverridden: false },
      subagents: { source: 'default', effectiveValue: false, projectOverridden: false },
      modelRole: { source: 'default', effectiveValue: '', projectOverridden: false },
      roster: {
        paths: [],
        advisors: [],
        editable: { path: '', exists: false, instructions: '', advisors: [] },
        sharedInstructions: false,
        parseErrors: [],
      },
    },
    skills: { count: 2, sourcePaths: [], items: [], usageHint: '/skill:<name>' },
    mcp: { count: 1, sourcePaths: [], items: [], usageHint: '/mcp list' },
    agents: { count: 3, sourcePaths: [], items: [], usageHint: 'Define Markdown agents' },
    nativePlan: {
      supportStatus: 'rpc-unavailable',
      toggleAvailable: false,
      approvalUi: 'not-exposed',
      rpcCommands: [],
      message: 'Native plan controls are not exposed over RPC yet.',
    },
    unavailableCommands: [],
    lastRefreshedAt: Date.now(),
    ...patches,
  }
}

function isFolder(item: SlashCommand | { id: string | object; type?: 'folder' }): item is { id: string; type: 'folder' } {
  return 'type' in item && item.type === 'folder'
}

function commandKey(item: { id: string | object }): string {
  if (typeof item.id === 'string') return item.id
  return slashCommandIdKey(item.id as import('../slash-command-menu').SlashCommandId)
}

function getCommand(sections: SlashSection[], key: string): SlashCommand | undefined {
  for (const section of sections) {
    for (const item of section.items) {
      if (isFolder(item)) continue
      if (commandKey(item) === key) return item as SlashCommand
    }
  }
  return undefined
}

beforeAll(async () => {
  const mod = await import('../slash-command-menu')
  buildOmpCuratedSections = mod.buildOmpCuratedSections
  filterAvailableOmpCommands = mod.filterAvailableOmpCommands
  filterSlashSectionsForInput = mod.filterSlashSectionsForInput
  InlineSlashCommand = mod.InlineSlashCommand
  slashCommandIdKey = mod.slashCommandIdKey
  useInlineSlashCommand = mod.useInlineSlashCommand
})

describe('OMP curated slash menu', () => {
  it('returns OMP Controls and Tools & Context sections for a valid state', () => {
    const state = buildMockState()
    const sections = buildOmpCuratedSections(state, i18n.t, 4)

    expect(sections.map(s => s.id)).toEqual(['omp-controls', 'omp-tools'])
    expect(sections[0].items.map(item => commandKey(item))).toEqual(['omp-curated:plan', 'omp-curated:advisor'])
    expect(sections[1].items.map(item => commandKey(item))).toEqual([
      'omp-curated:mcp',
      'omp-curated:skills',
      'omp-curated:agents',
      'omp-curated:models',
    ])
  })

  it('marks Plan Mode as disabled while toggleAvailable is false', () => {
    const state = buildMockState({ nativePlan: { ...buildMockState().nativePlan, toggleAvailable: false } })
    const sections = buildOmpCuratedSections(state, i18n.t, 4)
    const plan = getCommand(sections, 'omp-curated:plan')

    expect(plan).toBeDefined()
    expect(plan?.disabled).toBe(true)
    expect(plan?.disabledReason).toContain('RPC unavailable')
  })

  it('shows Advisor metadata from the effective value', () => {
    const state = buildMockState({
      advisor: {
        ...buildMockState().advisor,
        enabled: { source: 'global', effectiveValue: true, globalValue: true, projectOverridden: false },
      },
    })
    const sections = buildOmpCuratedSections(state, i18n.t, 4)
    const advisor = getCommand(sections, 'omp-curated:advisor')

    expect(advisor).toBeDefined()
    expect(advisor?.meta).toBe('On')
    expect(advisor?.disabled).toBe(false)
  })

  it('marks Advisor as disabled when a project override controls it', () => {
    const state = buildMockState({
      advisor: {
        ...buildMockState().advisor,
        enabled: { source: 'project', effectiveValue: true, projectValue: true, projectOverridden: true },
      },
    })
    const sections = buildOmpCuratedSections(state, i18n.t, 4)
    const advisor = getCommand(sections, 'omp-curated:advisor')

    expect(advisor).toBeDefined()
    expect(advisor?.disabled).toBe(true)
    expect(advisor?.disabledReason).toContain('Project override')
  })

  it('shows capability counts in Tools & Context metadata', () => {
    const state = buildMockState({
      skills: { count: 5, sourcePaths: [], items: [], usageHint: '/skill:<name>' },
      mcp: { count: 2, sourcePaths: [], items: [], usageHint: '/mcp list' },
      agents: { count: 7, sourcePaths: [], items: [], usageHint: 'Define Markdown agents' },
    })
    const sections = buildOmpCuratedSections(state, i18n.t, 4)
    const tools = sections.find(s => s.id === 'omp-tools')?.items ?? []

    expect(getCommand([{ id: 'omp-tools', label: 'Tools & Context', items: tools }], 'omp-curated:mcp')?.meta).toBe('2 servers')
    expect(getCommand([{ id: 'omp-tools', label: 'Tools & Context', items: tools }], 'omp-curated:skills')?.meta).toBe('5 skills')
    expect(getCommand([{ id: 'omp-tools', label: 'Tools & Context', items: tools }], 'omp-curated:agents')?.meta).toBe('7 agents')
    expect(getCommand([{ id: 'omp-tools', label: 'Tools & Context', items: tools }], 'omp-curated:models')?.meta).toBe('4 models')
  })

  it('renders disabled rows with aria-disabled and without activation cursor', () => {
    const state = buildMockState()
    const sections = buildOmpCuratedSections(state, i18n.t, 4)
    const html = normalizeReactServerHtml(ReactDOMServer.renderToString(
      <InlineSlashCommand
        open
        onOpenChange={() => {}}
        sections={sections}
        onSelectCommand={() => {}}
        onSelectFolder={() => {}}
        position={{ x: 0, y: 0 }}
      />,
    ))

    expect(html).toContain('Plan Mode')
    expect(html).toContain('Advisor')
    expect(html).toContain('RPC unavailable')
    expect(html).toContain('data-disabled="true"')
    expect(html).toContain('aria-disabled="true"')
    expect(html).toContain('role="menuitemcheckbox"')
    expect(html).toContain('aria-checked="false"')
  })
})

describe('useInlineSlashCommand OMP runtime filtering', () => {
  function renderHook(options: UseInlineSlashCommandOptions): ReturnType<typeof useInlineSlashCommand> {
    let captured: ReturnType<typeof useInlineSlashCommand> | null = null
    function TestComponent() {
      captured = useInlineSlashCommand(options)
      return null
    }
    ReactDOMServer.renderToString(<TestComponent />)
    if (!captured) throw new Error('Hook did not capture result')
    return captured
  }

  it('does not show curated OMP sections for non-OMP sessions', () => {
    const hook = renderHook({
      inputRef: { current: null },
      onSelectCommand: () => {},
      onSelectFolder: () => {},
      isOmpSession: false,
      ompFeatureCenterState: buildMockState(),
      ompModelCount: 4,
    })
    const sectionIds = hook.sections.map(s => s.id)

    expect(sectionIds).not.toContain('omp-controls')
    expect(sectionIds).not.toContain('omp-tools')
  })

  it('shows curated OMP sections when session is OMP and state is loaded', () => {
    const hook = renderHook({
      inputRef: { current: null },
      onSelectCommand: () => {},
      onSelectFolder: () => {},
      isOmpSession: true,
      ompFeatureCenterState: buildMockState(),
      ompModelCount: 4,
    })
    const sectionIds = hook.sections.map(s => s.id)

    expect(sectionIds).toContain('omp-controls')
    expect(sectionIds).toContain('omp-tools')
  })

  it('shows discovered skills in the zero-query menu while keeping other runtime commands searchable', () => {
    const hook = renderHook({
      inputRef: { current: null },
      onSelectCommand: () => {},
      onSelectFolder: () => {},
      isOmpSession: true,
      ompFeatureCenterState: buildMockState(),
      ompModelCount: 4,
      ompCommands: [{ name: 'skill:test-skill', source: 'skill', description: 'Test skill' }],
    })
    const sectionIds = hook.sections.map(s => s.id)

    expect(sectionIds).toContain('omp-skills')
  })

  it('falls back to Feature Center skill inventory when the Craft skill loader is empty', () => {
    const hook = renderHook({
      inputRef: { current: null },
      onSelectCommand: () => {},
      onSelectFolder: () => {},
      isOmpSession: true,
      ompFeatureCenterState: buildMockState({
        skills: {
          count: 1,
          sourcePaths: [],
          items: [{ name: 'state-skill', path: 'C:/state-skill/SKILL.md', level: 'user', description: 'From state' }],
          usageHint: '/skill:<name>',
        },
      }),
      ompModelCount: 1,
    })

    expect(getCommand(hook.sections, 'omp:skill:state-skill')?.description).toBe('From state')
  })

  it('filters out commands marked as hidden or needs-upstream-rpc', () => {
    const available = filterAvailableOmpCommands(
      [
        { name: 'plan', source: 'builtin', description: 'Plan command' },
        { name: 'hidden-cmd', source: 'builtin', description: 'Hidden command' },
        { name: 'visible-cmd', source: 'builtin', description: 'Visible command' },
      ],
      [
        { command: '/plan', label: 'Native Plan Mode', status: 'needs-upstream-rpc', reason: 'No RPC toggle' },
        { command: 'hidden-cmd', label: 'Hidden', status: 'hidden', reason: 'Desktop equivalent exists' },
      ],
    )

    expect(available.map(c => c.name)).toContain('visible-cmd')
    expect(available.map(c => c.name)).not.toContain('plan')
    expect(available.map(c => c.name)).not.toContain('hidden-cmd')
  })

  it('keeps runtime OMP commands hidden until unavailable-command metadata is loaded', () => {
    const available = filterAvailableOmpCommands(
      [{ name: 'plan', source: 'builtin', description: 'Plan command' }],
      [],
      false,
    )

    expect(available).toEqual([])
  })

  it('searches runtime OMP commands using the current first input character', () => {
    const baseSections: SlashSection[] = [{
      id: 'commands',
      label: 'Commands',
      items: [{ id: 'compact', label: 'Compact', description: 'Compact context', icon: null }],
    }]
    const runtimeSections: SlashSection[] = [{
      id: 'omp-commands',
      label: 'Oh My Pi',
      items: [{
        id: { type: 'omp', name: 'query-runtime' },
        label: '/query-runtime',
        description: 'Runtime-only command',
        icon: null,
      }],
    }]

    const filtered = filterSlashSectionsForInput(baseSections, runtimeSections, 'q')

    expect(filtered.flatMap(section => section.items).map(item => commandKey(item))).toContain('omp:query-runtime')
  })

  it('shows matching runtime OMP commands when the inline filter is set', () => {
    const sections: SlashSection[] = [
      {
        id: 'omp-skills',
        label: 'Skills',
        items: [
          { id: { type: 'omp', name: 'skill:test-skill' }, label: 'Test skill', description: 'Test skill', icon: null, shortcut: 'skill', meta: 'skill' },
        ],
      },
    ]
    const html = normalizeReactServerHtml(ReactDOMServer.renderToString(
      <InlineSlashCommand
        open
        onOpenChange={() => {}}
        sections={sections}
        filter="test"
        onSelectCommand={() => {}}
        onSelectFolder={() => {}}
        position={{ x: 0, y: 0 }}
      />,
    ))

    expect(html).toContain('Test skill')
    expect(html).toContain('Skills')
  })
})
