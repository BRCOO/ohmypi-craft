import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useAtomValue } from 'jotai'
import { Puzzle, RefreshCw, Trash2, RotateCcw, Command, Cpu, Sparkles, ServerCog, Bot, AlertCircle, Loader2 } from 'lucide-react'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { SettingsCard, SettingsCardContent, SettingsSection } from '@/components/settings'
import { cn } from '@/lib/utils'
import { activeSessionIdAtom } from '@/atoms/sessions'
import { useOmpCapabilities } from '@/hooks/useOmpCapabilities'
import { useOmpSessionCommand } from '@/hooks/useOmpSessionCommand'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import type { OmpExtensionState, OmpExtensionCapability } from '@craft-agent/shared/protocol'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'extensions',
}

const CAPABILITY_FEATURE = 'extensions.control' as const

function ExtensionCapabilityIcons({ provides }: { provides: OmpExtensionCapability }) {
  const items: { icon: React.ComponentType<{ className?: string }>; count: number; labelKey: string }[] = []
  if ((provides.commands?.length ?? 0) > 0) {
    items.push({ icon: Command, count: provides.commands!.length, labelKey: 'omp.extensions.commands' })
  }
  if ((provides.skills?.length ?? 0) > 0) {
    items.push({ icon: Sparkles, count: provides.skills!.length, labelKey: 'omp.extensions.skills' })
  }
  if ((provides.mcps?.length ?? 0) > 0) {
    items.push({ icon: ServerCog, count: provides.mcps!.length, labelKey: 'omp.extensions.mcps' })
  }
  if ((provides.agents?.length ?? 0) > 0) {
    items.push({ icon: Bot, count: provides.agents!.length, labelKey: 'omp.extensions.agents' })
  }
  if (items.length === 0) return null
  return (
    <div className="flex flex-wrap gap-2">
      {items.map(item => (
        <span
          key={item.labelKey}
          className="inline-flex items-center gap-1 rounded-md bg-muted/40 px-1.5 py-0.5 text-[11px] text-muted-foreground"
        >
          <item.icon className="size-3" />
          <span>{item.count}</span>
        </span>
      ))}
    </div>
  )
}

function StatusBadge({ status, restartRequired }: { status: OmpExtensionState['status']; restartRequired: boolean }) {
  const { t } = useTranslation()
  const configs: Record<string, { className: string; labelKey: string }> = {
    enabled: {
      className: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-200',
      labelKey: 'omp.extensions.enabled',
    },
    disabled: {
      className: 'bg-muted text-muted-foreground',
      labelKey: 'omp.extensions.disabled',
    },
    error: {
      className: 'bg-red-500/12 text-red-700 dark:text-red-200',
      labelKey: 'omp.extensions.error',
    },
    reload_required: {
      className: 'bg-amber-500/12 text-amber-700 dark:text-amber-200',
      labelKey: 'omp.extensions.reloadRequired',
    },
  }
  const cfg = configs[status] ?? configs.disabled
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', cfg.className)}>
      {t(cfg.labelKey)}
      {restartRequired && (
        <RotateCcw className="ml-1 size-3" />
      )}
    </span>
  )
}

function SourceBadge({ source }: { source: OmpExtensionState['source'] }) {
  const { t } = useTranslation()
  const labels: Record<string, string> = {
    builtin: 'omp.extensions.builtin',
    user: 'omp.extensions.user',
    project: 'omp.extensions.project',
    marketplace: 'omp.extensions.marketplace',
  }
  return (
    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
      {t(labels[source] ?? source)}
    </span>
  )
}

export default function ExtensionsControlCenterPage() {
  const { t } = useTranslation()
  const activeSessionId = useAtomValue(activeSessionIdAtom)
  const capabilities = useOmpCapabilities(activeSessionId ?? undefined)
  const sessionCommand = useOmpSessionCommand(activeSessionId ?? undefined)

  const [extensions, setExtensions] = React.useState<OmpExtensionState[]>([])
  const [loading, setLoading] = React.useState(true)
  const [reloadingAll, setReloadingAll] = React.useState(false)
  const [pending, setPending] = React.useState<Record<string, boolean>>({})
  const [error, setError] = React.useState<string | null>(null)

  const isExtensionControlSupported = capabilities.isFeatureSupported(CAPABILITY_FEATURE)
  const extensionControlReason = capabilities.getFeatureReason(CAPABILITY_FEATURE)

  const startPending = (key: string) => setPending(p => ({ ...p, [key]: true }))
  const stopPending = (key: string) => setPending(p => {
    const next = { ...p }
    delete next[key]
    return next
  })

  const loadExtensions = React.useCallback(async () => {
    if (!activeSessionId) return
    setLoading(true)
    setError(null)
    try {
      const result = await sessionCommand.execute({ type: 'getExtensions' }) as { success: boolean; data?: OmpExtensionState[]; error?: string } | undefined
      if (result && 'success' in result) {
        if (result.success && Array.isArray(result.data)) {
          setExtensions(result.data)
        } else {
          setError(result.error ?? 'Failed to load extensions')
        }
      } else {
        // Legacy OMP: assume the raw data is an array
        setExtensions(Array.isArray(result) ? result : [])
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [activeSessionId, sessionCommand])

  React.useEffect(() => {
    void loadExtensions()
  }, [loadExtensions])

  const handleSetEnabled = async (id: string, enabled: boolean) => {
    setError(null)
    const key = `enable-${id}`
    startPending(key)
    try {
      await sessionCommand.execute({ type: 'setExtensionEnabled', id, enabled })
      toast.success(enabled ? 'Extension enabled' : 'Extension disabled')
      void loadExtensions()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      toast.error(t(enabled ? 'omp.extensions.enableFailed' : 'omp.extensions.disableFailed'))
    } finally {
      stopPending(key)
    }
  }

  const handleReloadAll = async () => {
    setError(null)
    setReloadingAll(true)
    try {
      await sessionCommand.execute({ type: 'reloadExtensions' })
      toast.success('Extensions reloaded')
      void loadExtensions()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      toast.error(t('omp.extensions.reloadFailed'))
    } finally {
      setReloadingAll(false)
    }
  }

  const handleUninstall = async (id: string) => {
    setError(null)
    const key = `uninstall-${id}`
    startPending(key)
    try {
      await sessionCommand.execute({ type: 'uninstallExtension', id })
      toast.success('Extension uninstalled')
      void loadExtensions()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      toast.error(t('omp.extensions.uninstallFailed'))
    } finally {
      stopPending(key)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PanelHeader
        title={t('settings.extensions.title')}
        actions={(
          <div className="flex items-center gap-2">
            {isExtensionControlSupported && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleReloadAll()}
                disabled={reloadingAll || !activeSessionId}
              >
                <RefreshCw className={cn('mr-1.5 size-3.5', reloadingAll && 'animate-spin')} />
                {reloadingAll ? t('omp.extensions.reloading') : t('omp.extensions.reload')}
              </Button>
            )}
          </div>
        )}
      />
      <div className="min-h-0 flex-1 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="mx-auto max-w-4xl space-y-6 px-5 py-7">
            <SettingsSection
              title={t('omp.extensions.title')}
              description={t('omp.extensions.description')}
            >
              {loading && extensions.length === 0 && !error && (
                <SettingsCard>
                  <SettingsCardContent>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" />
                      {t('omp.extensions.loading')}
                    </div>
                  </SettingsCardContent>
                </SettingsCard>
              )}

              {!isExtensionControlSupported && capabilities.manifest && (
                <SettingsCard>
                  <SettingsCardContent>
                    <div className="flex items-start gap-3">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-200">
                        <Cpu className="size-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm font-medium">{t('omp.extensions.capabilityMissing')}</div>
                        {extensionControlReason && (
                          <div className="mt-1 text-xs text-muted-foreground">{extensionControlReason}</div>
                        )}
                      </div>
                    </div>
                  </SettingsCardContent>
                </SettingsCard>
              )}

              {error && (
                <SettingsCard>
                  <SettingsCardContent>
                    <div className="rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-200">
                      <AlertCircle className="mr-1.5 inline size-4 align-text-bottom" />
                      {error}
                    </div>
                  </SettingsCardContent>
                </SettingsCard>
              )}

              {isExtensionControlSupported && !loading && extensions.length === 0 && (
                <SettingsCard>
                  <SettingsCardContent>
                    <div className="flex items-start gap-3">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                        <Puzzle className="size-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm text-muted-foreground">{t('omp.extensions.noExtensions')}</div>
                      </div>
                    </div>
                  </SettingsCardContent>
                </SettingsCard>
              )}

              {isExtensionControlSupported && extensions.map(ext => (
                <SettingsCard key={ext.id}>
                  <SettingsCardContent className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">{ext.name}</span>
                          <span className="text-xs text-muted-foreground">{ext.version}</span>
                          <SourceBadge source={ext.source} />
                          <StatusBadge status={ext.status} restartRequired={ext.restartRequired} />
                        </div>
                        {ext.error && (
                          <div className="mt-1.5 text-xs text-red-600 dark:text-red-300">
                            {ext.error}
                          </div>
                        )}
                        <div className="mt-2">
                          <ExtensionCapabilityIcons provides={ext.provides} />
                        </div>
                        {ext.restartRequired && (
                          <div className="mt-1.5 text-[11px] text-amber-600 dark:text-amber-300">
                            {t('omp.extensions.restartRequiredHint')}
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Switch
                          checked={ext.status === 'enabled'}
                          disabled={!!pending[`enable-${ext.id}`] || !activeSessionId}
                          onCheckedChange={checked => void handleSetEnabled(ext.id, checked)}
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={!!pending[`uninstall-${ext.id}`] || !activeSessionId || ext.source === 'builtin'}
                          onClick={() => void handleUninstall(ext.id)}
                          title={t('omp.extensions.uninstall')}
                        >
                          {pending[`uninstall-${ext.id}`] ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Trash2 className="size-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                  </SettingsCardContent>
                </SettingsCard>
              ))}
            </SettingsSection>
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
