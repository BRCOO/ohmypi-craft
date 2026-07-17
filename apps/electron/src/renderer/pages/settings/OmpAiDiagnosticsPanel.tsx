/**
 * OMP diagnostics strip on the AI settings page.
 *
 * Shows Feature Center counts (MCP / Skills / Agents) with navigation, and
 * Browser / LSP / GitHub / SSH rows that honestly report "diagnostics not
 * wired" until OMP RPC exposes real-time telemetry for those subsystems.
 */

import { useTranslation } from 'react-i18next'
import {
  ExternalLink,
  GitBranch,
  Globe,
  Info,
  Layers,
  MessageSquareMore,
  Search,
  Settings2,
  Terminal,
} from 'lucide-react'
import type { OmpResourceSnapshot } from '../../../shared/types'
import type { OmpFeatureCenterSection } from '@/lib/omp-feature-center-navigation'
import { SettingsCard, SettingsSection } from '@/components/settings'

/** Subsystems that OMP RPC does not yet stream live status for. */
export const OMP_UNWIRED_DIAGNOSTIC_SUBSYSTEMS = [
  'browser',
  'lsp',
  'github',
  'ssh',
] as const

export type OmpUnwiredDiagnosticSubsystem = (typeof OMP_UNWIRED_DIAGNOSTIC_SUBSYSTEMS)[number]

export interface OmpFeatureCountTile {
  section: Extract<OmpFeatureCenterSection, 'mcp' | 'skills' | 'agents'>
  label: string
  count?: number
  error?: string
}

export function buildOmpFeatureCountTiles(
  snapshot: OmpResourceSnapshot | null,
  labels: { mcp: string; skills: string; agents: string },
): OmpFeatureCountTile[] {
  const runtimeCounts = snapshot?.runtimeCounts
  const runtimeError = snapshot?.runtimeResourcesError
  return [
    {
      section: 'mcp',
      label: labels.mcp,
      count: runtimeCounts?.mcp ?? snapshot?.mcp.entries.length,
      error: snapshot?.mcp.error ?? (!runtimeCounts ? runtimeError : undefined),
    },
    {
      section: 'skills',
      label: labels.skills,
      count: runtimeCounts?.skills ?? snapshot?.skills.entries.length,
      error: snapshot?.skills.error ?? (!runtimeCounts ? runtimeError : undefined),
    },
    {
      section: 'agents',
      label: labels.agents,
      count: runtimeCounts?.agents ?? snapshot?.agents.entries.length,
      error: snapshot?.agents.error ?? (!runtimeCounts ? runtimeError : undefined),
    },
  ]
}

export function featureCountStatusText(options: {
  unavailable: boolean
  count: number | undefined
  loadingLabel: string
  unavailableLabel: string
  discoveredLabel: (count: number) => string
}): string {
  if (options.unavailable) return options.unavailableLabel
  if (options.count === undefined) return options.loadingLabel
  return options.discoveredLabel(options.count)
}

export interface OmpAiDiagnosticsPanelProps {
  snapshot: OmpResourceSnapshot | null
  snapshotError: boolean
  onOpenFeatureCenter: (section: Extract<OmpFeatureCenterSection, 'mcp' | 'skills' | 'agents'>) => void
}

export function OmpAiDiagnosticsPanel({
  snapshot,
  snapshotError,
  onOpenFeatureCenter,
}: OmpAiDiagnosticsPanelProps) {
  const { t } = useTranslation()

  const tiles = buildOmpFeatureCountTiles(snapshot, {
    mcp: t('omp.featureCenter.mcp'),
    skills: t('omp.featureCenter.skills'),
    agents: t('omp.featureCenter.agents'),
  })

  const unwired = [
    {
      id: 'browser' as const,
      icon: Globe,
      label: t('settings.ai.ompSubsystems.browser'),
      description: t('settings.ai.ompSubsystems.browserDescription'),
    },
    {
      id: 'lsp' as const,
      icon: Layers,
      label: 'LSP',
      description: t('settings.ai.ompSubsystems.lspDescription'),
    },
    {
      id: 'github' as const,
      icon: GitBranch,
      label: 'GitHub',
      description: t('settings.ai.ompSubsystems.githubDescription'),
    },
    {
      id: 'ssh' as const,
      icon: Terminal,
      label: 'SSH',
      description: t('settings.ai.ompSubsystems.sshDescription'),
    },
  ]

  const icons = {
    mcp: Search,
    skills: Settings2,
    agents: MessageSquareMore,
  }

  return (
    <SettingsSection
      title={t('settings.ai.ompSubsystems.title')}
      description={t('settings.ai.ompSubsystems.description')}
    >
      <SettingsCard>
        <div className="divide-y divide-border/50" data-testid="omp-ai-diagnostics-panel">
          <div className="grid gap-2 p-3 sm:grid-cols-3" data-testid="omp-feature-counts">
            {tiles.map(({ section, label, count, error }) => {
              const Icon = icons[section]
              const unavailable = snapshotError || Boolean(error)
              const statusTitle = error ?? (snapshotError ? t('common.unavailable') : undefined)
              const statusText = featureCountStatusText({
                unavailable,
                count,
                loadingLabel: t('omp.featureCenter.loading'),
                unavailableLabel: t('common.unavailable'),
                discoveredLabel: (n) => t('omp.featureCenter.discovered', { count: n }),
              })
              return (
                <button
                  key={section}
                  type="button"
                  data-testid={`omp-feature-count-${section}`}
                  data-count={count === undefined ? '' : String(count)}
                  data-status={unavailable ? 'error' : count === undefined ? 'loading' : 'ok'}
                  onClick={() => onOpenFeatureCenter(section)}
                  className="group flex min-w-0 items-center gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-muted/50"
                  title={statusTitle}
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{label}</span>
                    <span className="block text-xs text-muted-foreground">{statusText}</span>
                  </span>
                  <ExternalLink className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
                </button>
              )
            })}
          </div>
          <div className="divide-y divide-border/50" data-testid="omp-unwired-diagnostics">
            {unwired.map(({ id, icon: Icon, label, description }) => (
              <div
                key={id}
                className="flex items-start gap-3 px-4 py-3"
                data-testid={`omp-unwired-${id}`}
                data-diagnostic-status="not-wired"
              >
                <span className="mt-0.5 flex size-7 items-center justify-center rounded-lg bg-foreground/5 text-foreground/70">
                  <Icon className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {label}
                    <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      <Info className="mr-1 size-3" />
                      {t('settings.ai.ompSubsystems.notReported')}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">{description}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </SettingsCard>
    </SettingsSection>
  )
}
