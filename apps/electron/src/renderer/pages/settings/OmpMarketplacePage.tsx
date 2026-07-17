/**
 * OmpMarketplacePage
 *
 * OMP Extension/Skill Marketplace browser. Lets users search, inspect, and
 * install marketplace items. Gated by the `marketplace.browse` capability.
 *
 * Commands:
 *   searchMarketplace(query, page?)  -> OmpMarketplaceSearchResult
 *   getMarketplaceItem(id)           -> OmpMarketplaceItem
 *   installMarketplaceItem(id)       -> marketplace_task_update events
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useAtomValue } from 'jotai'
import {
  Search,
  ShoppingBag,
  Loader2,
  Download,
  CheckCircle2,
  AlertTriangle,
  X,
  ChevronLeft,
  ExternalLink,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import { activeSessionIdAtom } from '@/atoms/sessions'
import { useOmpCapabilities } from '@/hooks/useOmpCapabilities'
import { useOmpSessionCommand } from '@/hooks/useOmpSessionCommand'
import type {
  OmpMarketplaceItem,
  OmpMarketplaceSearchResult,
} from '@craft-agent/shared/protocol'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'marketplace',
}

/** Minimal per-item install tracking state */
interface InstallState {
  itemId: string
  phase: 'started' | 'progress' | 'completed' | 'failed' | 'cancelled'
  message?: string
  progress?: number
  error?: string
}

export default function OmpMarketplacePage() {
  const { t } = useTranslation()
  const activeSessionId = useAtomValue(activeSessionIdAtom)
  const sessionId = activeSessionId ?? undefined

  const { loading: capLoading, isFeatureSupported, getFeatureReason } = useOmpCapabilities(sessionId)
  const { execute, loading: cmdLoading } = useOmpSessionCommand(sessionId)

  // Search state
  const [query, setQuery] = React.useState('')
  const [results, setResults] = React.useState<OmpMarketplaceSearchResult | null>(null)
  const [searching, setSearching] = React.useState(false)
  const [searchError, setSearchError] = React.useState<string | null>(null)

  // Detail / selection state
  const [selectedItem, setSelectedItem] = React.useState<OmpMarketplaceItem | null>(null)
  const [loadingDetail, setLoadingDetail] = React.useState(false)

  // Install tracking
  const [installStates, setInstallStates] = React.useState<Record<string, InstallState>>({})

  const featureSupported = !capLoading && isFeatureSupported('marketplace.browse')
  const featureReason = getFeatureReason('marketplace.browse')

  // ── Search ────────────────────────────────────────────────────────────────

  const handleSearch = React.useCallback(async () => {
    const trimmed = query.trim()
    if (!trimmed || !sessionId) return
    setSearching(true)
    setSearchError(null)
    setSelectedItem(null)
    setResults(null)
    try {
      const result = (await execute({ type: 'searchMarketplace', query: trimmed })) as
        | { items: OmpMarketplaceItem[]; total: number; page: number }
        | undefined

      if (!result) {
        throw new Error(t('settings.marketplace.invalidResponse'))
      }
      setResults({
        items: result.items ?? [],
        total: result.total ?? 0,
        page: result.page ?? 1,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setSearchError(message)
      setResults(null)
    } finally {
      setSearching(false)
    }
  }, [query, sessionId, execute, t])

  // Debounced search on Enter
  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        void handleSearch()
      }
    },
    [handleSearch],
  )

  // ── Detail ────────────────────────────────────────────────────────────────

  const handleSelectItem = React.useCallback(
    async (item: OmpMarketplaceItem) => {
      if (!sessionId) return
      setLoadingDetail(true)
      setSelectedItem(null)
      try {
        const detail = (await execute({ type: 'getMarketplaceItem', id: item.id })) as
          | OmpMarketplaceItem
          | undefined

        if (!detail) {
          throw new Error(t('settings.marketplace.invalidItemResponse'))
        }
        setSelectedItem(detail)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        toast.error(message)
      } finally {
        setLoadingDetail(false)
      }
    },
    [sessionId, execute, t],
  )

  const handleBackToList = React.useCallback(() => {
    setSelectedItem(null)
  }, [])

  // ── Install ───────────────────────────────────────────────────────────────

  const handleInstall = React.useCallback(
    async (itemId: string) => {
      if (!sessionId) return
      setInstallStates((prev) => ({
        ...prev,
        [itemId]: { itemId, phase: 'started', message: t('settings.marketplace.installing') },
      }))
      try {
        const result = (await execute({ type: 'installMarketplaceItem', id: itemId })) as
          | { success?: boolean; phase?: string; error?: string }
          | undefined

        if (result?.error) {
          throw new Error(result.error)
        }
        setInstallStates((prev: Record<string, InstallState>) => ({
          ...prev,
          [itemId]: { itemId, phase: 'completed', message: t('settings.marketplace.installSuccess') },
        }))
        toast.success(t('settings.marketplace.installSuccess'))
        // Refresh to show updated installed state
        if (selectedItem?.id === itemId) {
          setSelectedItem((prev: OmpMarketplaceItem | null) => prev ? { ...prev, installed: true } : prev)
        }
        setResults((prev: OmpMarketplaceSearchResult | null) => {
          if (!prev) return prev
          return {
            ...prev,
            items: prev.items.map((item: OmpMarketplaceItem) =>
              item.id === itemId ? { ...item, installed: true } : item,
            ),
          }
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setInstallStates((prev) => ({
          ...prev,
          [itemId]: { itemId, phase: 'failed', message, error: message },
        }))
        toast.error(message)
      }
    },
    [sessionId, execute, t, selectedItem],
  )

  // ── Not supported state ───────────────────────────────────────────────────

  if (!capLoading && !featureSupported) {
    return (
      <div className="flex h-full flex-col">
        <PanelHeader title={t('settings.marketplace.title')} />
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="flex flex-col items-center gap-3 text-center max-w-md">
            <ShoppingBag className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {featureReason || t('settings.marketplace.notSupported')}
            </p>
          </div>
        </div>
      </div>
    )
  }

  // ── Detail view ───────────────────────────────────────────────────────────

  if (selectedItem) {
    const install = installStates[selectedItem.id]
    const installing = install && (install.phase === 'started' || install.phase === 'progress')
    const installed = selectedItem.installed || install?.phase === 'completed'

    return (
      <div className="flex h-full flex-col">
        <PanelHeader
          title={selectedItem.name}
          leadingAction={
            <Button variant="ghost" size="icon" onClick={handleBackToList} aria-label={t('common.back')}>
              <ChevronLeft className="size-4" />
            </Button>
          }
        />
        <ScrollArea className="flex-1">
          <div className="p-6 space-y-6 max-w-2xl">
            {/* Metadata card */}
            <div className="rounded-lg border bg-card p-5 space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold">{selectedItem.name}</h2>
                  {selectedItem.author && (
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {t('settings.marketplace.byAuthor', { author: selectedItem.author })}
                    </p>
                  )}
                </div>
                <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  v{selectedItem.version}
                </span>
              </div>

              {selectedItem.description && (
                <p className="text-sm text-foreground/80">{selectedItem.description}</p>
              )}

              {/* Permissions */}
              {selectedItem.permissions.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    {t('settings.marketplace.permissions')}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedItem.permissions.map((perm: string) => (
                      <span
                        key={perm}
                        className="inline-flex items-center rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-300"
                      >
                        {perm}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Install status */}
              {install && install.phase === 'failed' && install.error && (
                <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <span>{install.error}</span>
                </div>
              )}

              {/* Action button */}
              <div className="pt-2">
                {installed ? (
                  <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                    <CheckCircle2 className="size-4" />
                    {t('settings.marketplace.installed')}
                  </div>
                ) : installing ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    {install.message || t('settings.marketplace.installing')}
                    {install.progress !== undefined && (
                      <span className="text-xs">({install.progress}%)</span>
                    )}
                  </div>
                ) : (
                  <Button onClick={() => void handleInstall(selectedItem.id)} disabled={cmdLoading}>
                    <Download className="mr-2 size-4" />
                    {t('settings.marketplace.install')}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </ScrollArea>
      </div>
    )
  }

  // ── List / search view ────────────────────────────────────────────────────

  const hasResults = results && results.items.length > 0

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title={t('settings.marketplace.title')} />
      <div className="border-b border-border px-5 py-3">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9 pr-9"
            placeholder={t('settings.marketplace.searchPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={cmdLoading}
          />
          {query && (
            <button
              onClick={() => {
                setQuery('')
                setResults(null)
                setSearchError(null)
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={t('common.clear')}
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-5 space-y-3">
          {/* Loading */}
          {searching && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* Error */}
          {searchError && !searching && (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-4 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{searchError}</span>
            </div>
          )}

          {/* Results */}
          {!searching && hasResults && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {t('settings.marketplace.resultCount', { count: results.total })}
              </p>
              {results.items.map((item: OmpMarketplaceItem) => {
                const install = installStates[item.id]
                const installing = install && (install.phase === 'started' || install.phase === 'progress')

                return (
                  <button
                    key={item.id}
                    onClick={() => void handleSelectItem(item)}
                    className="w-full text-left rounded-lg border bg-card p-4 transition-colors hover:bg-accent/50"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm truncate">{item.name}</span>
                          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            v{item.version}
                          </span>
                        </div>
                        {item.description && (
                          <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                            {item.description}
                          </p>
                        )}
                        {item.author && (
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {t('settings.marketplace.byAuthor', { author: item.author })}
                          </p>
                        )}
                      </div>
                      <div className="shrink-0 flex items-center gap-2">
                        {item.installed && (
                          <CheckCircle2 className="size-4 text-green-500" />
                        )}
                        {installing && (
                          <Loader2 className="size-4 animate-spin text-muted-foreground" />
                        )}
                        {!item.installed && !installing && (
                          <ExternalLink className="size-4 text-muted-foreground" />
                        )}
                      </div>
                    </div>
                    {item.updateAvailable && (
                      <div className="mt-2 flex items-center gap-1.5">
                        <span className="inline-flex items-center rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:text-blue-300">
                          {t('settings.marketplace.updateAvailable')}
                        </span>
                      </div>
                    )}
                    {item.permissions.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {item.permissions.map((perm: string) => (
                          <span
                            key={perm}
                            className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                          >
                            {perm}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          )}

          {/* Empty state — never searched or no results */}
          {!searching && !searchError && !hasResults && query && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Search className="size-8 text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">
                {t('settings.marketplace.noResults', { query })}
              </p>
            </div>
          )}

          {/* Initial empty state */}
          {!searching && !searchError && !hasResults && !query && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <ShoppingBag className="size-10 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">
                {t('settings.marketplace.empty')}
              </p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
