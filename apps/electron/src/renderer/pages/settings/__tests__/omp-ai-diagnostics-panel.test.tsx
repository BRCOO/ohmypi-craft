import { beforeAll, describe, expect, it, mock } from 'bun:test'
import * as React from 'react'
import * as ReactDOMServer from 'react-dom/server'
import { initReactI18next } from 'react-i18next'
import { i18n, setupI18n } from '@craft-agent/shared/i18n'
import type { OmpResourceSnapshot } from '../../../../shared/types'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))
setupI18n([initReactI18next])
i18n.changeLanguage('zh-Hans')

let OmpAiDiagnosticsPanel: typeof import('../OmpAiDiagnosticsPanel').OmpAiDiagnosticsPanel
let buildOmpFeatureCountTiles: typeof import('../OmpAiDiagnosticsPanel').buildOmpFeatureCountTiles
let featureCountStatusText: typeof import('../OmpAiDiagnosticsPanel').featureCountStatusText
let OMP_UNWIRED_DIAGNOSTIC_SUBSYSTEMS: typeof import('../OmpAiDiagnosticsPanel').OMP_UNWIRED_DIAGNOSTIC_SUBSYSTEMS

function normalizeReactServerHtml(html: string): string {
  return html.replace(/<!-- -->/g, '')
}

function sampleSnapshot(overrides?: Partial<OmpResourceSnapshot>): OmpResourceSnapshot {
  return {
    mcp: {
      entries: [
        { id: 'a', name: 'alpha', enabled: true, scope: 'user' } as never,
        { id: 'b', name: 'beta', enabled: true, scope: 'user' } as never,
      ],
    },
    skills: {
      entries: [{ id: 's1', name: 'skill-one', enabled: true, scope: 'user' } as never],
    },
    agents: {
      entries: [],
    },
    ...overrides,
  } as OmpResourceSnapshot
}

beforeAll(async () => {
  const mod = await import('../OmpAiDiagnosticsPanel')
  OmpAiDiagnosticsPanel = mod.OmpAiDiagnosticsPanel
  buildOmpFeatureCountTiles = mod.buildOmpFeatureCountTiles
  featureCountStatusText = mod.featureCountStatusText
  OMP_UNWIRED_DIAGNOSTIC_SUBSYSTEMS = mod.OMP_UNWIRED_DIAGNOSTIC_SUBSYSTEMS
})

describe('OmpAiDiagnosticsPanel helpers', () => {
  it('builds feature count tiles from a snapshot', () => {
    const tiles = buildOmpFeatureCountTiles(sampleSnapshot(), {
      mcp: 'MCP',
      skills: 'Skills',
      agents: 'Agents',
    })
    expect(tiles).toHaveLength(3)
    expect(tiles[0]?.count).toBe(2)
    expect(tiles[1]?.count).toBe(1)
    expect(tiles[2]?.count).toBe(0)
  })

  it('formats loading, error, and count statuses', () => {
    expect(featureCountStatusText({
      unavailable: true,
      count: 3,
      loadingLabel: 'loading',
      unavailableLabel: 'unavailable',
      discoveredLabel: (n) => `${n} found`,
    })).toBe('unavailable')

    expect(featureCountStatusText({
      unavailable: false,
      count: undefined,
      loadingLabel: 'loading',
      unavailableLabel: 'unavailable',
      discoveredLabel: (n) => `${n} found`,
    })).toBe('loading')

    expect(featureCountStatusText({
      unavailable: false,
      count: 4,
      loadingLabel: 'loading',
      unavailableLabel: 'unavailable',
      discoveredLabel: (n) => `${n} found`,
    })).toBe('4 found')
  })

  it('lists Browser/LSP/GitHub/SSH as unwired diagnostics (future RPC telemetry)', () => {
    expect([...OMP_UNWIRED_DIAGNOSTIC_SUBSYSTEMS]).toEqual(['browser', 'lsp', 'github', 'ssh'])
  })
})

describe('OmpAiDiagnosticsPanel render', () => {
  it('renders feature counts and navigable test ids', () => {
    const clicks: string[] = []
    const html = normalizeReactServerHtml(ReactDOMServer.renderToString(
      <OmpAiDiagnosticsPanel
        snapshot={sampleSnapshot()}
        snapshotError={false}
        onOpenFeatureCenter={(section) => clicks.push(section)}
      />,
    ))

    expect(html).toContain('data-testid="omp-ai-diagnostics-panel"')
    expect(html).toContain('data-testid="omp-feature-count-mcp"')
    expect(html).toContain('data-testid="omp-feature-count-skills"')
    expect(html).toContain('data-testid="omp-feature-count-agents"')
    expect(html).toContain('data-count="2"')
    expect(html).toContain('data-count="1"')
    expect(html).toContain('data-count="0"')
    expect(html).toContain('data-status="ok"')
  })

  it('renders failure status when snapshot load fails', () => {
    const html = normalizeReactServerHtml(ReactDOMServer.renderToString(
      <OmpAiDiagnosticsPanel
        snapshot={null}
        snapshotError={true}
        onOpenFeatureCenter={() => {}}
      />,
    ))

    expect(html).toContain('data-status="error"')
    // zh-Hans common.unavailable
    expect(html).toContain('不可用')
  })

  it('shows diagnostics-not-wired for Browser/LSP/GitHub/SSH', () => {
    const html = normalizeReactServerHtml(ReactDOMServer.renderToString(
      <OmpAiDiagnosticsPanel
        snapshot={sampleSnapshot()}
        snapshotError={false}
        onOpenFeatureCenter={() => {}}
      />,
    ))

    for (const id of ['browser', 'lsp', 'github', 'ssh']) {
      expect(html).toContain(`data-testid="omp-unwired-${id}"`)
      expect(html).toContain('data-diagnostic-status="not-wired"')
    }
    // zh-Hans: 暂未接入诊断
    expect(html).toContain('暂未接入诊断')
  })

  it('invokes navigation callback for feature tiles (client path covered by pure handler)', () => {
    const opened: string[] = []
    const tiles = buildOmpFeatureCountTiles(sampleSnapshot(), {
      mcp: 'MCP',
      skills: 'Skills',
      agents: 'Agents',
    })
    for (const tile of tiles) {
      opened.push(tile.section)
    }
    expect(opened).toEqual(['mcp', 'skills', 'agents'])
  })
})
