import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  AlertCircle,
  Bot,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Search,
  Terminal,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { OmpCapabilityGate } from '@/components/app-shell/OmpCapabilityGate'
import { useOmpAgents } from '@/hooks/useOmpAgents'
import type { OmpAgentDefinitionState, OmpAgentSource } from '@craft-agent/shared/protocol'

export interface OmpAgentControlCenterProps {
  sessionId: string
  className?: string
}

const SOURCE_TABS: Array<{ key: OmpAgentSource | 'all'; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'bundled', label: 'Bundled' },
  { key: 'user', label: 'User' },
  { key: 'project', label: 'Project' },
] as const

function SourceBadge({ source }: { source: OmpAgentSource }) {
  const colors: Record<OmpAgentSource, string> = {
    bundled: 'bg-blue-500/10 text-blue-700 dark:text-blue-200',
    user: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-200',
    project: 'bg-amber-500/10 text-amber-700 dark:text-amber-200',
  }
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium', colors[source])}>
      {source}
    </span>
  )
}

function AgentDetailCard({
  agent,
  onToggle,
  onModelOverride,
  onClose,
}: {
  agent: OmpAgentDefinitionState
  onToggle: (id: string, enabled: boolean) => Promise<void>
  onModelOverride: (id: string, model?: string) => Promise<void>
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [toggling, setToggling] = React.useState(false)
  const [modelInput, setModelInput] = React.useState(
    Array.isArray(agent.modelOverride) ? agent.modelOverride.join(', ') : agent.modelOverride ?? '',
  )
  const [savingModel, setSavingModel] = React.useState(false)

  const handleToggle = async () => {
    setToggling(true)
    try {
      await onToggle(agent.id, !agent.enabled)
      toast.success(agent.enabled ? t('omp.agents.disabled', { name: agent.name }) : t('omp.agents.enabled', { name: agent.name }))
    } catch {
      toast.error(t('omp.agents.toggleError'))
    } finally {
      setToggling(false)
    }
  }

  const handleModelSave = async () => {
    const model = modelInput.trim() || undefined
    setSavingModel(true)
    try {
      await onModelOverride(agent.id, model)
      toast.success(t('omp.agents.modelUpdated'))
    } catch {
      toast.error(t('omp.agents.modelUpdateError'))
    } finally {
      setSavingModel(false)
    }
  }

  return (
    <div className="rounded-lg border border-border/50 bg-muted/20 p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{agent.name}</span>
            <SourceBadge source={agent.source} />
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
              {agent.identifier}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={handleToggle}
          disabled={toggling}
          className="shrink-0 text-muted-foreground hover:text-foreground"
          aria-label={agent.enabled ? t('omp.agents.disable') : t('omp.agents.enable')}
        >
          {agent.enabled ? <ToggleRight className="size-5 text-emerald-500" /> : <ToggleLeft className="size-5" />}
        </button>
      </div>

      {agent.error && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-red-500/20 bg-red-500/10 p-2 text-xs text-red-700 dark:text-red-200">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          <span>{agent.error}</span>
        </div>
      )}

      <div className="space-y-3 text-sm">
        {agent.whenToUse && (
          <div>
            <div className="mb-0.5 text-[11px] font-medium text-muted-foreground">{t('omp.agents.whenToUse')}</div>
            <div className="text-xs text-foreground/80">{agent.whenToUse}</div>
          </div>
        )}

        {agent.systemPrompt && (
          <div>
            <div className="mb-0.5 text-[11px] font-medium text-muted-foreground">{t('omp.agents.systemPrompt')}</div>
            <div className="max-h-24 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/40 p-2 text-xs text-foreground/80">
              {agent.systemPrompt}
            </div>
          </div>
        )}

        <div>
          <label className="mb-0.5 block text-[11px] font-medium text-muted-foreground">
            {t('omp.agents.modelOverride')}
          </label>
          <div className="flex items-center gap-2">
            <Input
              value={modelInput}
              onChange={e => setModelInput(e.target.value)}
              placeholder={t('omp.agents.modelPlaceholder')}
              className="h-8 text-xs"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={handleModelSave}
              disabled={savingModel || (modelInput.trim() || undefined) === (Array.isArray(agent.modelOverride) ? agent.modelOverride.join(', ') : agent.modelOverride ?? '')}
              className="h-8 text-xs"
            >
              {savingModel ? t('omp.agents.saving') : t('omp.agents.save')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Agent Control Center — lists OMP agent definitions with source tabs,
 * search, enable/disable toggles, and per-agent detail inspection.
 *
 * Gated behind the `agents.control` OMP capability.
 */
export function OmpAgentControlCenter({ sessionId, className }: OmpAgentControlCenterProps) {
  const { t } = useTranslation()
  const {
    agents,
    loading,
    error,
    refreshing,
    refresh,
    setEnabled,
    setModelOverride,
    reloadAgents,
  } = useOmpAgents(sessionId)
  const [search, setSearch] = React.useState('')
  const [sourceTab, setSourceTab] = React.useState<OmpAgentSource | 'all'>('all')
  const [expandedId, setExpandedId] = React.useState<string | null>(null)

  const filtered = React.useMemo(() => {
    const query = search.toLowerCase().trim()
    return agents.filter(a => {
      if (sourceTab !== 'all' && a.source !== sourceTab) return false
      if (query && !a.name.toLowerCase().includes(query) && !a.identifier.toLowerCase().includes(query)) return false
      return true
    })
  }, [agents, search, sourceTab])

  const agentCounts = React.useMemo(() => {
    const counts: Record<string, number> = { all: agents.length }
    for (const a of agents) {
      counts[a.source] = (counts[a.source] ?? 0) + 1
    }
    return counts
  }, [agents])

  const handleRefresh = async () => {
    try {
      await refresh()
      toast.success(t('omp.agents.refreshed'))
    } catch {
      // error state is managed by the hook
    }
  }

  const handleReload = async () => {
    try {
      await reloadAgents()
      toast.success(t('omp.agents.reloaded'))
    } catch {
      // error state is managed by the hook
    }
  }

  return (
    <OmpCapabilityGate sessionId={sessionId} feature="agents.control">
      <div className={cn('flex flex-col', className)}>
        {/* Header */}
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-md bg-violet-500/10 text-violet-600 dark:text-violet-200">
              <Bot className="size-4" />
            </span>
            <span className="text-sm font-medium">{t('omp.featureCenter.agents')}</span>
            {!loading && (
              <Badge variant="secondary" className="text-[11px]">
                {agents.length}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReload}
              disabled={refreshing || loading}
              className="h-7 text-xs"
            >
              <Terminal className="mr-1 size-3" />
              {t('omp.agents.reloadAgents')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefresh}
              disabled={refreshing || loading}
              className="h-7 text-xs"
            >
              <RefreshCw className={cn('mr-1 size-3', refreshing && 'animate-spin')} />
              {t('omp.featureCenter.refresh')}
            </Button>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('omp.agents.searchPlaceholder') ?? 'Search agents...'}
            className="h-8 pl-8 text-xs"
          />
        </div>

        {/* Source tabs */}
        <div className="mb-2 flex gap-1">
          {SOURCE_TABS.map(tab => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setSourceTab(tab.key)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                sourceTab === tab.key
                  ? 'bg-violet-500/10 text-violet-700 dark:text-violet-200'
                  : 'text-muted-foreground hover:bg-muted/50',
              )}
            >
              {tab.label}
              {agentCounts[tab.key] !== undefined && (
                <span className="ml-1 rounded-full bg-muted px-1.5 text-[10px]">{agentCounts[tab.key]}</span>
              )}
            </button>
          ))}
        </div>

        <Separator className="mb-2" />

        {/* Error state */}
        {error && (
          <div className="mb-2 flex items-start gap-2 rounded-md border border-red-500/20 bg-red-500/10 p-2 text-xs text-red-700 dark:text-red-200">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Agent list */}
        {loading ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            <RefreshCw className="mr-2 size-3.5 animate-spin" />
            {t('omp.featureCenter.loading')}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            {search
              ? t('omp.agents.noSearchResults') ?? 'No agents match your search'
              : t('omp.agents.noAgents') ?? 'No agents found'}
          </div>
        ) : (
          <ScrollArea className="max-h-80">
            <div className="space-y-1">
              {filtered.map(agent => (
                <div key={agent.id}>
                  <button
                    type="button"
                    onClick={() => setExpandedId(expandedId === agent.id ? null : agent.id)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/50"
                  >
                    <span className="shrink-0 text-muted-foreground">
                      {expandedId === agent.id ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                    </span>
                    <span className="flex size-6 items-center justify-center rounded-md bg-violet-500/8 text-violet-600 dark:text-violet-200">
                      <Bot className="size-3.5" />
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium">{agent.name}</span>
                    <span className="hidden truncate text-xs text-muted-foreground sm:block">{agent.identifier}</span>
                    <SourceBadge source={agent.source} />
                    <span
                      className={cn(
                        'size-1.5 shrink-0 rounded-full',
                        agent.enabled ? 'bg-emerald-500' : 'bg-muted-foreground/40',
                      )}
                    />
                    <Switch
                      checked={agent.enabled}
                      onCheckedChange={checked => {
                        setEnabled(agent.id, checked).catch(() => toast.error(t('omp.agents.toggleError')))
                      }}
                      onClick={e => e.stopPropagation()}
                      className="shrink-0"
                    />
                  </button>

                  {expandedId === agent.id && (
                    <div className="px-2 pb-2 pt-1">
                      <AgentDetailCard
                        agent={agent}
                        onToggle={setEnabled}
                        onModelOverride={setModelOverride}
                        onClose={() => setExpandedId(null)}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>
    </OmpCapabilityGate>
  )
}
