import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Activity, Ban, RefreshCw, Sparkles } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { useAppShellContext, useSession } from '@/context/AppShellContext'
import { cn } from '@/lib/utils'
import { SessionFilesSection } from '../right-sidebar/SessionFilesSection'
import type { OmpRuntimeStateDto, SessionCommand } from '@craft-agent/shared/protocol'

interface SessionInfoPopoverProps {
  sessionId: string
  sessionFolderPath?: string
  trigger: React.ReactElement
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  sideOffset?: number
  contentClassName?: string
  presentation?: 'popover' | 'drawer'
}

const DEFAULT_POPOVER_CONTENT_CLASS = 'w-[380px] h-[min(620px,80vh)] min-w-[280px] max-w-[440px] overflow-hidden rounded-[8px] bg-background text-foreground shadow-modal-small p-0'
const DEFAULT_DRAWER_CONTENT_CLASS = [
  'data-[vaul-drawer-direction=bottom]:inset-x-2',
  'data-[vaul-drawer-direction=bottom]:bottom-2',
  'data-[vaul-drawer-direction=bottom]:mt-0',
  'data-[vaul-drawer-direction=bottom]:max-h-[min(82vh,42rem)]',
  'overflow-hidden rounded-[14px] border border-border/60 bg-background shadow-modal-small',
].join(' ')

export function SessionInfoPopover({
  sessionId,
  sessionFolderPath,
  trigger,
  side = 'top',
  align = 'end',
  sideOffset = 6,
  contentClassName,
  presentation = 'popover',
}: SessionInfoPopoverProps) {
  const [open, setOpen] = React.useState(false)

  const handleOpenChange = React.useCallback((nextOpen: boolean) => {
    setOpen(nextOpen)

    if (!nextOpen) {
      requestAnimationFrame(() => {
        window.dispatchEvent(new CustomEvent('craft:focus-input', {
          detail: { sessionId },
        }))
      })
    }
  }, [sessionId])

  if (presentation === 'drawer') {
    return (
      <Drawer open={open} onOpenChange={handleOpenChange} direction="bottom">
        <DrawerTrigger asChild>
          {trigger}
        </DrawerTrigger>
        <DrawerContent
          className={cn(DEFAULT_DRAWER_CONTENT_CLASS, contentClassName)}
          onOpenAutoFocus={(e) => {
            e.preventDefault()
          }}
        >
          <DrawerHeader className="border-b border-border/50 px-4 py-3 group-data-[vaul-drawer-direction=bottom]/drawer-content:text-left">
            <DrawerTitle className="text-sm font-medium">Session info</DrawerTitle>
          </DrawerHeader>
          <div className="flex-1 min-h-0 overflow-hidden">
            <SessionInfoPopoverContent sessionId={sessionId} sessionFolderPath={sessionFolderPath} />
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        {trigger}
      </PopoverTrigger>
      <PopoverContent
        className={contentClassName ?? DEFAULT_POPOVER_CONTENT_CLASS}
        side={side}
        align={align}
        sideOffset={sideOffset}
        onOpenAutoFocus={(e) => {
          e.preventDefault()
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault()
        }}
      >
        <SessionInfoPopoverContent sessionId={sessionId} sessionFolderPath={sessionFolderPath} />
      </PopoverContent>
    </Popover>
  )
}

function SessionInfoPopoverContent({ sessionId, sessionFolderPath }: { sessionId: string; sessionFolderPath?: string }) {
  const { t } = useTranslation()
  const session = useSession(sessionId)
  const { onRenameSession, llmConnections } = useAppShellContext()
  const [name, setName] = React.useState('')
  const renameTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const isOmpSession = session?.ompSessionLink?.provider === 'omp'
    || !!session?.ompControlState
    || llmConnections.some((connection) => (
      connection.slug === session?.llmConnection && connection.providerType === 'omp'
    ))

  React.useEffect(() => {
    if (!isOmpSession) return
    void window.electronAPI.sessionCommand(sessionId, { type: 'refreshOmpRuntime' }).catch(() => {
      // The backend publishes a scoped runtime error snapshot. Avoid a duplicate toast.
    })
  }, [isOmpSession, sessionId])

  React.useEffect(() => {
    setName(session?.name || '')
  }, [session?.name])

  React.useEffect(() => {
    return () => {
      if (renameTimeoutRef.current) {
        clearTimeout(renameTimeoutRef.current)
      }
    }
  }, [])

  const handleNameChange = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value
    setName(newName)

    if (renameTimeoutRef.current) {
      clearTimeout(renameTimeoutRef.current)
    }

    renameTimeoutRef.current = setTimeout(() => {
      const trimmed = newName.trim()
      if (trimmed) {
        onRenameSession(sessionId, trimmed)
      }
    }, 500)
  }, [onRenameSession, sessionId])

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="shrink-0 p-3 border-b border-border/50">
        <label className="text-xs font-medium text-muted-foreground block mb-1.5 select-none">
          {t("chat.title")}
        </label>
        <div className="rounded-lg bg-foreground-2 has-[:focus]:bg-background shadow-minimal transition-colors">
          <Input
            value={name}
            onChange={handleNameChange}
            placeholder={t("chat.titlePlaceholder")}
            className="h-9 py-2 text-sm border-0 shadow-none bg-transparent focus-visible:ring-0"
          />
        </div>
      </div>
      {isOmpSession && (
        <OmpRuntimeSection
          sessionId={sessionId}
          runtime={session?.ompControlState?.runtime}
          processing={!!session?.isProcessing || !!session?.ompControlState?.queue.isStreaming}
          queueCompacting={!!session?.ompControlState?.queue.isCompacting}
        />
      )}
      <div className="flex-1 min-h-0 overflow-hidden">
        <SessionFilesSection
          sessionId={sessionId}
          sessionFolderPath={sessionFolderPath}
          hideHeader={false}
          className="h-full min-h-0"
        />
      </div>
    </div>
  )
}

function OmpRuntimeSection({
  sessionId,
  runtime,
  processing,
  queueCompacting,
}: {
  sessionId: string
  runtime?: OmpRuntimeStateDto
  processing: boolean
  queueCompacting: boolean
}) {
  const { t, i18n } = useTranslation()
  const pending = runtime?.pendingAction
  const isRefreshing = pending === 'refresh'
  const compacting = queueCompacting || runtime?.compaction.phase === 'running' || pending === 'compact'
  const retryWaiting = runtime?.retry.phase === 'waiting'

  const run = React.useCallback((command: SessionCommand) => {
    void window.electronAPI.sessionCommand(sessionId, command).catch(() => {
      // Runtime command failures are reflected in the session snapshot.
    })
  }, [sessionId])

  const formatNumber = React.useCallback((value: number) => new Intl.NumberFormat(i18n.language, {
    notation: value >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(value), [i18n.language])

  const context = runtime?.contextUsage
  const stats = runtime?.stats
  const contextPercent = Math.max(0, Math.min(100, context?.percent ?? 0))

  return (
    <section className="shrink-0 border-b border-border/50 bg-gradient-to-br from-violet-500/[0.05] via-transparent to-sky-500/[0.04] px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Activity className="h-3.5 w-3.5 text-violet-300" />
          <h3 className="text-xs font-semibold text-foreground">{t('ompRuntime.title')}</h3>
          <span className="rounded-full border border-violet-400/20 bg-violet-400/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-violet-200">
            OMP
          </span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-violet-200"
          disabled={!!pending}
          aria-label={t('ompRuntime.refresh')}
          onClick={() => run({ type: 'refreshOmpRuntime' })}
        >
          <RefreshCw className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')} />
        </Button>
      </div>

      <div className="mt-3 space-y-3">
        <div>
          <div className="flex items-baseline justify-between gap-2 text-[11px]">
            <span className="text-muted-foreground">{t('ompRuntime.context')}</span>
            <span className="font-medium text-foreground" title={context ? `${context.tokens} / ${context.contextWindow}` : undefined}>
              {context
                ? t('ompRuntime.contextValue', {
                    used: formatNumber(context.tokens),
                    total: formatNumber(context.contextWindow),
                    percent: Math.round(context.percent),
                  })
                : t('ompRuntime.unavailable')}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-foreground/8" role="progressbar" aria-valuenow={contextPercent} aria-valuemin={0} aria-valuemax={100}>
            <div
              className="h-full rounded-full bg-gradient-to-r from-sky-400 via-indigo-400 to-violet-400 transition-[width] duration-300"
              style={{ width: `${contextPercent}%` }}
            />
          </div>
        </div>

        {stats && (
          <div className="grid grid-cols-3 gap-1.5">
            <RuntimeMetric label={t('ompRuntime.totalTokens')} value={formatNumber(stats.tokens.total)} exact={stats.tokens.total} />
            <RuntimeMetric label={t('ompRuntime.messages')} value={formatNumber(stats.totalMessages)} exact={stats.totalMessages} />
            <RuntimeMetric label={t('ompRuntime.toolCalls')} value={formatNumber(stats.toolCalls)} exact={stats.toolCalls} />
            <RuntimeMetric label={t('ompRuntime.userMessages')} value={formatNumber(stats.userMessages)} exact={stats.userMessages} />
            <RuntimeMetric label={t('ompRuntime.assistantMessages')} value={formatNumber(stats.assistantMessages)} exact={stats.assistantMessages} />
            <RuntimeMetric label={t('ompRuntime.toolResults')} value={formatNumber(stats.toolResults)} exact={stats.toolResults} />
            <RuntimeMetric label={t('ompRuntime.input')} value={formatNumber(stats.tokens.input)} exact={stats.tokens.input} />
            <RuntimeMetric label={t('ompRuntime.output')} value={formatNumber(stats.tokens.output)} exact={stats.tokens.output} />
            <RuntimeMetric label={t('ompRuntime.cacheRead')} value={formatNumber(stats.tokens.cacheRead)} exact={stats.tokens.cacheRead} />
            <RuntimeMetric label={t('ompRuntime.cacheWrite')} value={formatNumber(stats.tokens.cacheWrite)} exact={stats.tokens.cacheWrite} />
            <RuntimeMetric label={t('ompRuntime.reasoning')} value={formatNumber(stats.tokens.reasoning)} exact={stats.tokens.reasoning} />
            <RuntimeMetric label={t('ompRuntime.premium')} value={formatNumber(stats.premiumRequests)} exact={stats.premiumRequests} />
            <RuntimeMetric label={t('ompRuntime.cost')} value={`$${stats.cost.toFixed(4)}`} />
          </div>
        )}

        <div className="space-y-2 rounded-lg border border-violet-400/10 bg-background/35 p-2.5">
          <RuntimeToggle
            label={t('ompRuntime.autoCompaction')}
            checked={runtime?.autoCompactionEnabled}
            pending={!!pending}
            onChange={(enabled) => run({ type: 'setOmpAutoCompaction', enabled })}
          />
          <RuntimeToggle
            label={t('ompRuntime.autoRetry')}
            checked={runtime?.autoRetryEnabled}
            pending={!!pending}
            unknownLabel={t('ompRuntime.unknown')}
            onChange={(enabled) => run({ type: 'setOmpAutoRetry', enabled })}
          />
          <p className="text-[10px] leading-relaxed text-muted-foreground/80">{t('ompRuntime.globalSettingHint')}</p>
          <div className="flex gap-2 pt-0.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 flex-1 border-violet-400/20 bg-violet-400/[0.04] text-[11px] hover:bg-violet-400/10 hover:text-violet-100"
              disabled={processing || compacting || !!pending}
              onClick={() => run({ type: 'compactOmpRuntime' })}
            >
              <Sparkles className={cn('h-3.5 w-3.5', compacting && 'animate-pulse text-violet-300')} />
              {compacting ? t('ompRuntime.compacting') : t('ompRuntime.compactNow')}
            </Button>
            {retryWaiting && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 flex-1 text-[11px]"
                disabled={!!pending}
                onClick={() => run({ type: 'abortOmpRetry' })}
              >
                <Ban className="h-3.5 w-3.5" />
                {t('ompRuntime.cancelRetry')}
              </Button>
            )}
          </div>
        </div>

        <RuntimeActivity runtime={runtime} />
        {runtime?.error && (
          <p className="rounded-md border border-destructive/20 bg-destructive/5 px-2 py-1.5 text-[10px] leading-relaxed text-destructive">
            {runtime.error}
          </p>
        )}
      </div>
    </section>
  )
}

function RuntimeMetric({ label, value, exact }: { label: string; value: string; exact?: number }) {
  return (
    <div className="rounded-md border border-border/40 bg-background/45 px-2 py-1.5" title={exact === undefined ? undefined : String(exact)}>
      <div className="truncate text-[9px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate text-[11px] font-semibold tabular-nums text-foreground">{value}</div>
    </div>
  )
}

function RuntimeToggle({
  label,
  checked,
  pending,
  unknownLabel,
  onChange,
}: {
  label: string
  checked?: boolean
  pending: boolean
  unknownLabel?: string
  onChange: (enabled: boolean) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[11px] text-foreground/85">{label}</span>
      {checked === undefined ? (
        <div className="flex items-center gap-1">
          {unknownLabel && <span className="mr-1 text-[9px] text-muted-foreground">{unknownLabel}</span>}
          <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-[10px]" disabled={pending} onClick={() => onChange(true)}>{t('ompRuntime.on')}</Button>
          <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-[10px]" disabled={pending} onClick={() => onChange(false)}>{t('ompRuntime.off')}</Button>
        </div>
      ) : (
        <Switch checked={checked} disabled={pending} onCheckedChange={onChange} aria-label={label} />
      )}
    </div>
  )
}

function RuntimeActivity({ runtime }: { runtime?: OmpRuntimeStateDto }) {
  const { t } = useTranslation()
  if (!runtime) return null

  if (runtime.retry.phase === 'waiting') {
    return (
      <p className="text-[10px] leading-relaxed text-amber-200/85">
        {t('ompRuntime.retryWaiting', {
          attempt: runtime.retry.attempt ?? 0,
          max: runtime.retry.maxAttempts ?? 0,
          delay: Math.ceil((runtime.retry.delayMs ?? 0) / 1000),
        })}
        {runtime.retry.error ? ` · ${runtime.retry.error}` : ''}
      </p>
    )
  }

  if (runtime.fallback) {
    return (
      <p className="text-[10px] leading-relaxed text-violet-200/85">
        {runtime.fallback.phase === 'succeeded'
          ? t('ompRuntime.fallbackSucceeded', { model: runtime.fallback.to, role: runtime.fallback.role })
          : t('ompRuntime.fallbackApplied', {
              from: runtime.fallback.from ?? '—',
              to: runtime.fallback.to,
              role: runtime.fallback.role,
            })}
      </p>
    )
  }

  if (runtime.compaction.phase !== 'idle') {
    return (
      <p className="text-[10px] leading-relaxed text-violet-200/85">
        {t(`ompRuntime.compaction.${runtime.compaction.phase}`, {
          reason: runtime.compaction.reason ?? runtime.compaction.action ?? '',
        })}
      </p>
    )
  }

  return null
}
