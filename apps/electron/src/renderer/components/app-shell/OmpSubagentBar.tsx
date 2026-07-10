/**
 * OmpSubagentBar - Discoverable entry point for OMP subagents.
 *
 * Shows a compact badge when subagents exist. Clicking opens the detail panel.
 */

import React from 'react'
import { Bot, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { OmpSubagentStateDto, OmpSubagentSnapshotDto } from '../../../shared/types'

export interface OmpSubagentBarProps {
  state: OmpSubagentStateDto
  isProcessing: boolean
  onOpenDetail: (subagentId?: string) => void
  className?: string
}

function runningCount(subagents: OmpSubagentSnapshotDto[]): number {
  return subagents.filter((s) => s.status === 'running').length
}

function completedCount(subagents: OmpSubagentSnapshotDto[]): number {
  return subagents.filter((s) => s.status === 'completed').length
}

export function OmpSubagentBar({ state, onOpenDetail, className }: OmpSubagentBarProps) {
  const subagents = state.subagents ?? []
  if (subagents.length === 0) return null

  const running = runningCount(subagents)
  const completed = completedCount(subagents)
  const failed = subagents.filter((s) => s.status === 'failed' || s.status === 'aborted').length

  return (
    <button
      type="button"
      onClick={() => onOpenDetail()}
      className={cn(
        'flex w-full items-center gap-2 rounded-xl border border-violet-300/15 bg-violet-500/[0.04] px-3 py-2 text-left transition-colors hover:bg-violet-500/[0.08]',
        className,
      )}
    >
      <span className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500/20 to-violet-500/20 text-blue-100 ring-1 ring-blue-300/20">
        <Bot className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-100/80">OMP Subagents</span>
          {running > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-400/15 px-1.5 py-0.5 text-[10px] text-blue-100/90">
              {running} running
            </span>
          )}
          {completed > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-400/15 px-1.5 py-0.5 text-[10px] text-violet-100/85">
              {completed} done
            </span>
          )}
          {failed > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-1.5 py-0.5 text-[10px] text-destructive">
              {failed} failed
            </span>
          )}
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {subagents.length} subagent{subagents.length === 1 ? '' : 's'} · click to view details and transcript
        </span>
      </span>
      <ChevronRight className="size-4 text-muted-foreground" />
    </button>
  )
}
