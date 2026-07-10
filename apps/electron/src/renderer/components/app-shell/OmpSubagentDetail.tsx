/**
 * OmpSubagentDetail - Drawer/panel for inspecting OMP subagents and their transcripts.
 */

import * as React from 'react'
import { Bot, Loader2, RefreshCw, X, AlertTriangle, ChevronDown, ChevronUp, Activity } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import type { OmpSubagentStateDto, OmpSubagentStateItemDto } from '../../../shared/types'

export interface OmpSubagentDetailProps {
  sessionId: string
  state: OmpSubagentStateDto
  initialSubagentId?: string
  onClose: () => void
}

const STATUS_LABEL: Record<OmpSubagentStateItemDto['status'], string> = {
  pending: 'Pending',
  running: 'Running',
  completed: 'Done',
  failed: 'Failed',
  aborted: 'Aborted',
}

function statusClass(status: OmpSubagentStateItemDto['status']): string {
  switch (status) {
    case 'running':
      return 'border-blue-300/25 bg-blue-500/10 text-blue-100'
    case 'completed':
      return 'border-violet-300/20 bg-violet-500/10 text-violet-100'
    case 'failed':
    case 'aborted':
      return 'border-destructive/20 bg-destructive/10 text-destructive'
    case 'pending':
    default:
      return 'border-foreground/10 bg-foreground/[0.03] text-muted-foreground'
  }
}

function formatCompactNumber(value: number | undefined): string | undefined {
  if (value === undefined) return undefined
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(value)
}

function SubagentListItem({
  subagent,
  selected,
  onClick,
}: {
  subagent: OmpSubagentStateItemDto
  selected: boolean
  onClick: () => void
}) {
  const progress = subagent.progress
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-start gap-2 rounded-lg border px-2 py-2 text-left transition-colors',
        selected
          ? 'border-blue-300/30 bg-blue-500/10'
          : 'border-foreground/10 bg-foreground/[0.02] hover:bg-foreground/[0.04]',
      )}
    >
      <Activity className="mt-0.5 size-4 shrink-0 text-blue-100/70" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-xs font-medium text-foreground/90">
            {subagent.description || subagent.agent}
          </span>
          <span className={cn('shrink-0 rounded-full border px-1.5 py-0.5 text-[10px]', statusClass(subagent.status))}>
            {STATUS_LABEL[subagent.status]}
          </span>
        </div>
        <div className="mt-0.5 truncate text-[11px] text-muted-foreground" title={subagent.assignment || subagent.task}>
          {subagent.assignment || subagent.task || subagent.agent}
        </div>
        {(progress?.currentTool || progress?.tokens || progress?.requests) && (
          <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
            {progress.currentTool && <span>tool: {progress.currentTool}</span>}
            {progress.requests !== undefined && <span>{formatCompactNumber(progress.requests)} req</span>}
            {progress.tokens !== undefined && <span>{formatCompactNumber(progress.tokens)} tok</span>}
          </div>
        )}
      </div>
    </button>
  )
}

function TranscriptEntry({ entry, index }: { entry: unknown; index: number }) {
  const [expanded, setExpanded] = React.useState(false)
  const text = typeof entry === 'string'
    ? entry
    : typeof entry === 'object' && entry !== null
      ? JSON.stringify(entry, null, 2)
      : String(entry)
  const isLong = text.length > 240

  return (
    <div className="rounded-md border border-foreground/10 bg-foreground/[0.02] px-2 py-1.5">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-[10px] tabular-nums text-muted-foreground">#{index + 1}</span>
        <div className="min-w-0 flex-1">
          <pre className={cn('whitespace-pre-wrap break-words font-mono text-[11px] text-foreground/80', !expanded && isLong && 'line-clamp-3')}>
            {text}
          </pre>
          {isLong && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-1 flex items-center gap-1 text-[10px] text-blue-100/70 hover:text-blue-100"
            >
              {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export function OmpSubagentDetail({ sessionId, state, initialSubagentId, onClose }: OmpSubagentDetailProps) {
  const subagents = state.subagents ?? []
  const [selectedId, setSelectedId] = React.useState(initialSubagentId)
  const selected = subagents.find((s) => s.id === selectedId) ?? subagents[0]
  const selectedCanReceiveMoreTranscript = selected?.status === 'running' || selected?.status === 'pending'
  const canRequestTranscript = !!selected
    && (!selected.cursor || selected.cursor.hasMore || selectedCanReceiveMoreTranscript)
  const transcriptButtonLabel = selected?.transcriptLoading
    ? 'Loading...'
    : selected?.cursor && !selected.cursor.hasMore
      ? selectedCanReceiveMoreTranscript
        ? 'Check updates'
        : 'Transcript loaded'
      : 'Load more'

  React.useEffect(() => {
    if (selectedId && !subagents.some((s) => s.id === selectedId)) {
      setSelectedId(subagents[0]?.id)
    }
  }, [subagents, selectedId])

  const refresh = React.useCallback(async () => {
    try {
      await window.electronAPI.sessionCommand(sessionId, { type: 'refreshOmpSubagents' })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }, [sessionId])

  const loadMore = React.useCallback(async () => {
    if (!selected) return
    try {
      await window.electronAPI.sessionCommand(sessionId, {
        type: 'loadOmpSubagentMessages',
        subagentId: selected.id,
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }, [sessionId, selected])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-violet-300/15 bg-[#090B18]/95 shadow-[0_20px_60px_rgba(35,35,95,0.32)]">
        <div className="pointer-events-none h-[2px] bg-gradient-to-r from-blue-400 via-violet-400 to-fuchsia-400" />
        <div className="flex items-center justify-between border-b border-violet-300/10 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500/20 to-violet-500/20 text-blue-100 ring-1 ring-blue-300/20">
              <Bot className="size-4" />
            </span>
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-100/80">OMP Subagents</div>
              <div className="text-[11px] text-muted-foreground">{subagents.length} subagent{subagents.length === 1 ? '' : 's'}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="size-7 text-blue-100/70 hover:bg-blue-400/10" onClick={refresh} disabled={!!state.pendingAction}>
              <RefreshCw className={cn('size-3.5', state.pendingAction === 'refresh' && 'animate-spin')} />
            </Button>
            <Button variant="ghost" size="icon" className="size-7 text-foreground/70 hover:bg-foreground/10" onClick={onClose}>
              <X className="size-4" />
            </Button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          <div className="w-64 shrink-0 border-r border-violet-300/10 p-2">
            <ScrollArea className="h-full">
              <div className="space-y-2">
                {subagents.map((subagent) => (
                  <SubagentListItem
                    key={subagent.id}
                    subagent={subagent}
                    selected={selected?.id === subagent.id}
                    onClick={() => setSelectedId(subagent.id)}
                  />
                ))}
              </div>
            </ScrollArea>
          </div>

          <div className="flex min-w-0 flex-1 flex-col">
            {selected ? (
              <>
                <div className="border-b border-violet-300/10 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-foreground/90">{selected.description || selected.agent}</span>
                    <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[10px]', statusClass(selected.status))}>
                      {STATUS_LABEL[selected.status]}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">{selected.assignment || selected.task}</div>
                </div>

                <div className="flex min-h-0 flex-1 flex-col px-4 py-3">
                  <ScrollArea className="flex-1">
                    <div className="space-y-2">
                      {selected.transcriptEntries.length === 0 && !selected.transcriptLoading && !selected.transcriptError && (
                        <div className="rounded-lg border border-dashed border-violet-300/10 px-3 py-4 text-center text-xs text-muted-foreground">
                          No transcript entries yet. Click Load more to fetch from OMP.
                        </div>
                      )}

                      {selected.transcriptEntries.map((entry, index) => (
                        <TranscriptEntry key={`${selected.id}-entry-${index}`} entry={entry} index={index} />
                      ))}

                      {selected.transcriptError && (
                        <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                          <div className="flex items-center gap-1.5">
                            <AlertTriangle className="size-3.5" />
                            <span>{selected.transcriptError}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </ScrollArea>

                  <div className="mt-3 flex items-center justify-between border-t border-violet-300/10 pt-3">
                    <div className="text-[11px] text-muted-foreground">
                      {selected.cursor
                        ? `Loaded ${selected.transcriptEntries.length} entries`
                        : selected.transcriptEntries.length > 0
                          ? `${selected.transcriptEntries.length} entries`
                          : ''}
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={loadMore}
                      disabled={selected.transcriptLoading || !canRequestTranscript}
                      className="h-7 text-xs"
                    >
                      {selected.transcriptLoading && <Loader2 className="mr-1 size-3 animate-spin" />}
                      {transcriptButtonLabel}
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
                Select a subagent to view its transcript.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
