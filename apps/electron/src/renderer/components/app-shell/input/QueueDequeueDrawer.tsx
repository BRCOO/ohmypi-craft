import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { X, Clock, Loader2, Trash2, AlertCircle } from 'lucide-react'
import {
  Drawer,
  DrawerPortal,
  DrawerOverlay,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerClose,
} from '@/components/ui/drawer'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { OmpCapabilityGate } from '@/components/app-shell/OmpCapabilityGate'
import { useOmpSessionCommand } from '@/hooks/useOmpSessionCommand'

interface OmpQueueItem {
  messageId: string
  mode: 'steer' | 'followUp' | 'abortAndPrompt' | 'prompt'
  preview: string
  createdAt: number
}

interface OmpQueueState {
  messages: OmpQueueItem[]
  revision: number
  updatedAt: number
}

interface QueueDequeueDrawerProps {
  sessionId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

const MODE_LABEL_KEY: Record<OmpQueueItem['mode'], string> = {
  steer: 'omp.queue.mode.steer',
  followUp: 'omp.queue.mode.followUp',
  abortAndPrompt: 'omp.queue.mode.abortAndPrompt',
  prompt: 'omp.queue.mode.prompt',
}

const MODE_COLOR: Record<OmpQueueItem['mode'], string> = {
  steer: 'bg-violet-500/10 text-violet-300',
  followUp: 'bg-blue-500/10 text-blue-300',
  abortAndPrompt: 'bg-amber-500/10 text-amber-300',
  prompt: 'bg-emerald-500/10 text-emerald-300',
}

function formatQueueTime(ts: number): string {
  const now = Date.now()
  const diff = now - ts
  if (diff < 60_000) return '<1m'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`
  return `${Math.floor(diff / 86_400_000)}d`
}

/**
 * A drawer that shows the current OMP message queue and allows the user
 * to dequeue (remove) individual messages.
 *
 * Gated by the `queue.dequeue` OMP capability. When the capability is absent
 * the drawer is replaced by an informational fallback.
 */
export function QueueDequeueDrawer({ sessionId, open, onOpenChange }: QueueDequeueDrawerProps) {
  const { t } = useTranslation()

  return (
    <OmpCapabilityGate
      sessionId={sessionId}
      feature="queue.dequeue"
      fallback={
        <Drawer open={open} onOpenChange={onOpenChange}>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>{t('omp.queue.title')}</DrawerTitle>
              <DrawerDescription className="text-muted-foreground text-sm">
                {t('omp.queue.notSupported')}
              </DrawerDescription>
            </DrawerHeader>
            <DrawerClose asChild>
              <div className="flex justify-end p-4">
                <Button variant="outline" size="sm">{t('common.close')}</Button>
              </div>
            </DrawerClose>
          </DrawerContent>
        </Drawer>
      }
    >
      <QueueDequeueDrawerInner sessionId={sessionId} open={open} onOpenChange={onOpenChange} />
    </OmpCapabilityGate>
  )
}

function QueueDequeueDrawerInner({ sessionId, open, onOpenChange }: QueueDequeueDrawerProps) {
  const { t } = useTranslation()
  const { execute } = useOmpSessionCommand(sessionId)
  const [queueState, setQueueState] = React.useState<OmpQueueState | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [deletingIds, setDeletingIds] = React.useState<Set<string>>(new Set())

  const fetchQueueState = React.useCallback(async (): Promise<OmpQueueState> => {
    return await execute({ type: 'getQueueState' }) as OmpQueueState
  }, [execute])

  // Fetch queue state when the drawer opens
  React.useEffect(() => {
    if (!open) return
    setLoading(true)
    setError(null)
    setQueueState(null)
    fetchQueueState()
      .then((state) => {
        setQueueState(state)
        setLoading(false)
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err)
        setError(msg)
        setLoading(false)
      })
  }, [open, fetchQueueState])

  const handleDequeue = React.useCallback(
    async (messageId: string) => {
      // Optimistic UI: remove the message from local state immediately
      setQueueState((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          messages: prev.messages.filter((m) => m.messageId !== messageId),
        }
      })

      setDeletingIds((prev) => new Set(prev).add(messageId))
      try {
        await execute({ type: 'dequeueMessage', messageId })
        toast.success(t('omp.queue.deleted'))
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        toast.error(t('omp.queue.deleteFailed', { error: msg }))
        // Refresh the full queue state on failure to recover from optimistic
        fetchQueueState()
          .then((state) => setQueueState(state))
          .catch(() => {})
      } finally {
        setDeletingIds((prev) => {
          const next = new Set(prev)
          next.delete(messageId)
          return next
        })
      }
    },
    [execute, fetchQueueState, t],
  )

  const messages = queueState?.messages ?? []
  const revision = queueState?.revision

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[70vh]">
        <DrawerHeader className="border-b border-border/50 pb-3">
          <div className="flex items-center justify-between">
            <DrawerTitle>{t('omp.queue.title')}</DrawerTitle>
            <DrawerClose asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7">
                <X className="h-4 w-4" />
              </Button>
            </DrawerClose>
          </div>
          {messages.length > 0 && revision !== undefined && (
            <DrawerDescription>
              {t('omp.queue.count', { count: messages.length })}
            </DrawerDescription>
          )}
        </DrawerHeader>

        <div className="overflow-y-auto p-3 space-y-2 min-h-[120px]">
          {loading && (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              <span className="text-sm">{t('omp.queue.loading')}</span>
            </div>
          )}

          {error && !loading && (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <AlertCircle className="h-8 w-8 mb-2 text-destructive" />
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          {!loading && !error && messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Clock className="h-8 w-8 mb-2 opacity-30" />
              <p className="text-sm">{t('omp.queue.empty')}</p>
            </div>
          )}

          {!loading && !error && messages.length > 0 && (
            <>
              {messages.map((item) => (
                <QueueCard
                  key={item.messageId}
                  item={item}
                  onDequeue={handleDequeue}
                  isDeleting={deletingIds.has(item.messageId)}
                />
              ))}
              <p className="text-[10px] text-muted-foreground/50 text-center pt-1">
                {t('omp.queue.revision', { revision: revision ?? 0 })}
              </p>
            </>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  )
}

function QueueCard({
  item,
  onDequeue,
  isDeleting,
}: {
  item: OmpQueueItem
  onDequeue: (messageId: string) => void
  isDeleting: boolean
}) {
  const { t } = useTranslation()

  return (
    <div
      className={cn(
        'group flex items-start gap-2 rounded-lg border border-border/40 bg-card/40 p-2.5 transition-colors',
        isDeleting && 'opacity-50 pointer-events-none',
      )}
    >
      {/* Preview */}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground/90 truncate leading-snug">
          {item.preview || <span className="italic text-muted-foreground/60">{t('omp.queue.noPreview')}</span>}
        </p>
        <div className="flex items-center gap-2 mt-1.5">
          {/* Mode badge */}
          <span
            className={cn(
              'inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none',
              MODE_COLOR[item.mode],
            )}
          >
            {t(MODE_LABEL_KEY[item.mode])}
          </span>
          {/* Time */}
          <span className="text-[10px] text-muted-foreground/50">
            {formatQueueTime(item.createdAt)}
          </span>
        </div>
      </div>

      {/* Delete button */}
      <button
        type="button"
        onClick={() => onDequeue(item.messageId)}
        disabled={isDeleting}
        className={cn(
          'mt-0.5 shrink-0 rounded-md p-1 transition-colors',
          'text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10',
          'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
          'disabled:opacity-30 disabled:cursor-not-allowed',
        )}
        aria-label={t('omp.queue.remove', { preview: item.preview })}
      >
        {isDeleting ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Trash2 className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  )
}
