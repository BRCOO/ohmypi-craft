import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  Activity,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  Edit3,
  ListChecks,
  Loader2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Trash2,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { OmpTodoMarkdownImportDialog } from './OmpTodoMarkdownImportDialog'
import type {
  OmpTodoMutationDto,
  OmpTodoPhaseDto,
  OmpSubagentSnapshotDto,
  OmpSubagentStatusDto,
  OmpTodoStateDto,
  OmpTodoStatusDto,
} from '../../../shared/types'

interface OmpTodoCardProps {
  sessionId: string
  state: OmpTodoStateDto
  isProcessing: boolean
}

function todoStatusLabel(status: OmpTodoStatusDto, t: ReturnType<typeof useTranslation>['t']): string {
  switch (status) {
    case 'in_progress': return t('omp.todo.status.inProgress')
    case 'completed': return t('omp.todo.status.completed')
    case 'abandoned': return t('omp.todo.status.abandoned')
    case 'pending':
    default: return t('omp.todo.status.pending')
  }
}

function subagentStatusLabel(status: OmpSubagentStatusDto, t: ReturnType<typeof useTranslation>['t']): string {
  switch (status) {
    case 'running': return t('omp.subagent.status.running')
    case 'completed': return t('omp.subagent.status.completed')
    case 'failed': return t('omp.subagent.status.failed')
    case 'aborted': return t('omp.subagent.status.aborted')
    case 'pending':
    default: return t('omp.subagent.status.pending')
  }
}

function actionableCount(phases: OmpTodoPhaseDto[]): { done: number; total: number } {
  let done = 0
  let total = 0
  for (const phase of phases) {
    for (const task of phase.tasks) {
      if (task.status === 'abandoned') continue
      total += 1
      if (task.status === 'completed') done += 1
    }
  }
  return { done, total }
}

function currentTask(phases: OmpTodoPhaseDto[]): string | undefined {
  for (const phase of phases) {
    const task = phase.tasks.find(item => item.status === 'in_progress')
    if (task) return task.content
  }
  return undefined
}

function subagentTodoCount(subagents: OmpSubagentSnapshotDto[]): { done: number; total: number } {
  const phases = subagents.flatMap(subagent => subagent.todoPhases ?? [])
  return actionableCount(phases)
}

function hasHiddenMetadata(phases: OmpTodoPhaseDto[]): boolean {
  return phases.some(phase => phase.tasks.some(task =>
    !!task.details || (Array.isArray(task.notes) && task.notes.length > 0),
  ))
}

export function shouldShowOmpTodoCard(state: OmpTodoStateDto): boolean {
  return !!state.error
    || !!state.pendingAction
    || !!state.reminder
    || state.phases.some(phase => phase.tasks.length > 0)
    || (state.subagents ?? []).length > 0
}

function taskStatusClass(status: OmpTodoStatusDto): string {
  switch (status) {
    case 'in_progress':
      return 'border-blue-400/30 bg-blue-500/10 text-blue-100'
    case 'completed':
      return 'border-violet-400/25 bg-violet-500/10 text-violet-100 line-through decoration-violet-300/60'
    case 'abandoned':
      return 'border-foreground/10 bg-foreground/[0.025] text-muted-foreground line-through decoration-muted-foreground/50'
    case 'pending':
    default:
      return 'border-foreground/10 bg-background/35 text-foreground/85'
  }
}

function statusDotClass(status: OmpTodoStatusDto): string {
  switch (status) {
    case 'in_progress':
      return 'bg-blue-300 shadow-tinted'
    case 'completed':
      return 'bg-violet-300'
    case 'abandoned':
      return 'bg-muted-foreground/50'
    case 'pending':
    default:
      return 'bg-foreground/25'
  }
}

function subagentStatusClass(status: OmpSubagentStatusDto): string {
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

function SubagentTodoPreview({ phases }: { phases: OmpTodoPhaseDto[] }) {
  const { t } = useTranslation()
  return (
    <div className="space-y-1.5">
      {phases.map((phase, phaseIndex) => (
        <div key={`${phaseIndex}-${phase.name}`} className="rounded-lg border border-violet-300/10 bg-background/[0.04] px-2 py-2">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="truncate text-[11px] font-medium text-violet-100/85">{phase.name}</span>
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {phase.tasks.filter(task => task.status === 'completed').length}/{phase.tasks.length}
            </span>
          </div>
          <div className="space-y-1">
            {phase.tasks.length === 0 ? (
              <div className="text-[11px] text-muted-foreground">{t('omp.todo.emptyPhase')}</div>
            ) : (
              phase.tasks.slice(0, 4).map((task, taskIndex) => (
                <div
                  key={`${phaseIndex}-${taskIndex}-${task.content}`}
                  className={cn('flex items-center gap-2 rounded-md border px-2 py-1 text-[11px]', taskStatusClass(task.status))}
                >
                  <span className={cn('size-1.5 rounded-full', statusDotClass(task.status))} />
                  <span className="min-w-0 flex-1 truncate" title={task.content}>{task.content}</span>
                  <span className="shrink-0 text-[9px] uppercase tracking-wide text-muted-foreground">
                    {todoStatusLabel(task.status, t)}
                  </span>
                </div>
              ))
            )}
            {phase.tasks.length > 4 && (
              <div className="px-2 text-[10px] text-muted-foreground">+{phase.tasks.length - 4} {t('common.more')}</div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function OmpSubagentsSection({ subagents }: { subagents: OmpSubagentSnapshotDto[] }) {
  const { t } = useTranslation()
  if (subagents.length === 0) return null

  return (
    <div className="rounded-xl border border-violet-300/10 bg-violet-500/[0.035] p-2">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex size-6 items-center justify-center rounded-lg bg-violet-400/10 text-violet-100 ring-1 ring-violet-300/15">
          <Bot className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-violet-100/80">{t('omp.todo.subagentsTitle')}</div>
          <div className="text-[11px] text-muted-foreground">{t('omp.todo.subagentsDescription')}</div>
        </div>
      </div>

      <div className="space-y-2">
        {subagents.map((subagent) => {
          const phases = subagent.todoPhases ?? []
          const progress = subagent.progress
          const compactTokens = formatCompactNumber(progress?.tokens)
          const compactRequests = formatCompactNumber(progress?.requests)
          const recentOutput = progress?.recentOutput?.filter(Boolean).slice(-2) ?? []
          return (
            <div key={subagent.id} className="rounded-xl border border-blue-300/10 bg-[#0B0D1D]/70 p-2">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500/15 to-violet-500/20 text-blue-100 ring-1 ring-blue-300/15">
                  <Activity className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-xs font-medium text-blue-100/90">
                      {subagent.description || subagent.agent}
                    </span>
                    <span className={cn('shrink-0 rounded-full border px-1.5 py-0.5 text-[10px]', subagentStatusClass(subagent.status))}>
                      {subagentStatusLabel(subagent.status, t)}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-muted-foreground" title={subagent.assignment || subagent.task}>
                    {subagent.assignment || subagent.task || subagent.agent}
                  </div>
                  {(progress?.currentTool || compactTokens || compactRequests) && (
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-blue-100/60">
                      {progress?.currentTool && (
                        <span className="rounded-full bg-blue-400/10 px-1.5 py-0.5">
                          {t('omp.todo.tool', { tool: progress.currentTool })}
                        </span>
                      )}
                      {compactRequests && (
                        <span className="rounded-full bg-violet-400/10 px-1.5 py-0.5">
                          {t('omp.todo.requests', { value: compactRequests })}
                        </span>
                      )}
                      {compactTokens && (
                        <span className="rounded-full bg-violet-400/10 px-1.5 py-0.5">
                          {t('omp.todo.tokens', { value: compactTokens })}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {phases.length > 0 ? (
                <div className="mt-2">
                  <SubagentTodoPreview phases={phases} />
                </div>
              ) : (
                <div className="mt-2 rounded-lg border border-dashed border-violet-300/10 px-2 py-2 text-[11px] text-muted-foreground">
                  {t('omp.todo.noSnapshot')}
                </div>
              )}

              {recentOutput.length > 0 && (
                <div className="mt-2 space-y-1 rounded-lg bg-foreground/[0.025] px-2 py-2">
                  {recentOutput.map((line, index) => (
                    <div key={`${subagent.id}-out-${index}`} className="truncate text-[10px] text-muted-foreground" title={line}>
                      {line}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function OmpTodoCard({ sessionId, state, isProcessing }: OmpTodoCardProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = React.useState(false)
  const [importOpen, setImportOpen] = React.useState(false)
  const disabled = isProcessing || !!state.pendingAction || !state.available
  const progress = actionableCount(state.phases)
  const activeTask = currentTask(state.phases)
  const hasTodos = state.phases.some(phase => phase.tasks.length > 0)
  const subagents = state.subagents ?? []
  const subagentProgress = subagentTodoCount(subagents)

  const runMutation = React.useCallback(async (mutation: OmpTodoMutationDto) => {
    try {
      await window.electronAPI.sessionCommand(sessionId, {
        type: 'mutateOmpTodos',
        expectedRevision: state.revision,
        mutation,
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }, [sessionId, state.revision])

  const refresh = React.useCallback(async () => {
    try {
      await window.electronAPI.sessionCommand(sessionId, { type: 'refreshOmpTodos' })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }, [sessionId])

  const addPhase = React.useCallback(() => {
    const name = window.prompt(t('omp.todo.phaseName'), t('omp.todo.phaseNameDefault', { number: state.phases.length + 1 }))
    if (name === null) return
    void runMutation({ type: 'addPhase', name })
  }, [runMutation, state.phases.length, t])

  const renamePhase = React.useCallback((phaseIndex: number, currentName: string) => {
    const name = window.prompt(t('omp.todo.renamePhase'), currentName)
    if (name === null) return
    void runMutation({ type: 'renamePhase', phaseIndex, name })
  }, [runMutation, t])

  const removePhase = React.useCallback((phaseIndex: number, phase: OmpTodoPhaseDto) => {
    if (phase.tasks.length > 0 && !window.confirm(t('omp.todo.removePhaseConfirm', { phaseName: phase.name, count: phase.tasks.length }))) return
    void runMutation({ type: 'removePhase', phaseIndex })
  }, [runMutation, t])

  const addTask = React.useCallback((phaseIndex: number) => {
    const content = window.prompt(t('omp.todo.newTask'))
    if (content === null) return
    void runMutation({ type: 'addTask', phaseIndex, content })
  }, [runMutation, t])

  const editTask = React.useCallback((phaseIndex: number, taskIndex: number, currentContent: string) => {
    const content = window.prompt(t('omp.todo.editTask'), currentContent)
    if (content === null) return
    void runMutation({ type: 'editTask', phaseIndex, taskIndex, content })
  }, [runMutation, t])

  const removeTask = React.useCallback((phaseIndex: number, taskIndex: number, content: string) => {
    if (!window.confirm(t('omp.todo.removeTaskConfirm', { content }))) return
    void runMutation({ type: 'removeTask', phaseIndex, taskIndex })
  }, [runMutation, t])

  const exportMarkdown = React.useCallback(async () => {
    try {
      const result = await window.electronAPI.sessionCommand(sessionId, { type: 'exportOmpTodosMarkdown' }) as { success: boolean; markdown?: string; error?: string } | undefined
      if (!result?.success || result.markdown === undefined) {
        throw new Error(result?.error ?? t('omp.todo.exportFailed'))
      }
      await navigator.clipboard.writeText(result.markdown)
      toast.success(t('omp.todo.markdownCopied'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }, [sessionId, t])

  const openImportDialog = React.useCallback(() => {
    setImportOpen(true)
  }, [])

  return (
    <div className="mx-auto w-full max-w-3xl px-3 pb-2">
      <div className="overflow-hidden rounded-xl border border-blue-300/15 bg-[#090B18]/85 shadow-strong backdrop-blur">
        <div className="pointer-events-none h-[2px] bg-gradient-to-r from-blue-400 via-violet-400 to-fuchsia-400" />
        <div className="flex items-center gap-2 px-3 py-2">
          <button
            type="button"
            onClick={() => setExpanded(value => !value)}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            <span className="flex size-6 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500/20 to-violet-500/20 text-blue-100 ring-1 ring-blue-300/20">
              <ListChecks className="size-3.5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-100/80">{t('omp.todo.title')}</span>
                {state.pendingAction && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-blue-400/10 px-1.5 py-0.5 text-[10px] text-blue-100/80">
                    <Loader2 className="size-3 animate-spin" />
                    {state.pendingAction}
                  </span>
                )}
                {state.reminder && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-violet-400/10 px-1.5 py-0.5 text-[10px] text-violet-100/85">
                    <Sparkles className="size-3" />
                    {t('omp.todo.reminder', { attempt: state.reminder.attempt, max: state.reminder.maxAttempts })}
                  </span>
                )}
              </span>
              <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                {activeTask
                  ? t('omp.todo.activeNow', { task: activeTask })
                  : hasTodos
                    ? t('omp.todo.progress', { done: progress.done, total: progress.total })
                    : subagents.length > 0
                      ? t('omp.todo.subagentsActive', { count: subagents.length }) +
                        (subagentProgress.total > 0 ? t('omp.todo.subagentTasksDone', { done: subagentProgress.done, total: subagentProgress.total }) : '')
                    : state.available
                      ? t('omp.todo.noItems')
                      : t('omp.todo.waiting')}
              </span>
            </span>
            {expanded ? <ChevronDown className="size-4 text-muted-foreground" /> : <ChevronRight className="size-4 text-muted-foreground" />}
          </button>

          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="size-7 text-blue-100/70 hover:bg-blue-400/10" onClick={refresh} disabled={!!state.pendingAction}>
              <RefreshCw className={cn('size-3.5', state.pendingAction === 'refresh' && 'animate-spin')} />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-7 text-blue-100/70 hover:bg-blue-400/10">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled={disabled} onSelect={addPhase}>
                  <Plus className="size-4" />
                  {t('omp.todo.addPhase')}
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!state.available} onSelect={exportMarkdown}>
                  <ClipboardCopy className="size-4" />
                  {t('omp.todo.copyMarkdown')}
                </DropdownMenuItem>
                <DropdownMenuItem disabled={disabled} onSelect={openImportDialog}>
                  <RotateCcw className="size-4" />
                  {t('omp.todo.importMarkdown')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {expanded && (
          <div className="space-y-2 border-t border-blue-300/10 px-3 pb-3 pt-2">
            {state.error && (
              <div className="rounded-xl border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {state.error}
              </div>
            )}

            {state.phases.length === 0 ? (
              <div className="rounded-xl border border-dashed border-blue-300/15 bg-blue-400/[0.03] px-3 py-3 text-xs text-muted-foreground">
                {t('omp.todo.emptyState')}
              </div>
            ) : (
              state.phases.map((phase, phaseIndex) => (
                <div key={`${phaseIndex}-${phase.name}`} className="rounded-xl border border-blue-300/10 bg-background/[0.04] p-2">
                  <div className="mb-2 flex items-center gap-2">
                    <div className="min-w-0 flex-1 truncate text-xs font-medium text-blue-100/90">{phase.name}</div>
                    <Button variant="ghost" size="icon" className="size-6" disabled={disabled} onClick={() => addTask(phaseIndex)}>
                      <Plus className="size-3.5" />
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-6">
                          <MoreHorizontal className="size-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem disabled={disabled} onSelect={() => renamePhase(phaseIndex, phase.name)}>
                          <Edit3 className="size-4" />
                          {t('omp.todo.renamePhase')}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem disabled={disabled} variant="destructive" onSelect={() => removePhase(phaseIndex, phase)}>
                          <Trash2 className="size-4" />
                          {t('omp.todo.removePhase')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  <div className="space-y-1.5">
                    {phase.tasks.length === 0 ? (
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => addTask(phaseIndex)}
                        className="w-full rounded-lg border border-dashed border-foreground/10 px-2 py-2 text-left text-xs text-muted-foreground hover:bg-foreground/[0.03] disabled:pointer-events-none disabled:opacity-50"
                      >
                        {t('omp.todo.addTask')}
                      </button>
                    ) : (
                      phase.tasks.map((task, taskIndex) => (
                        <div
                          key={`${phaseIndex}-${taskIndex}-${task.content}`}
                          className={cn('group flex items-center gap-2 rounded-lg border px-2 py-1.5 text-xs', taskStatusClass(task.status))}
                        >
                          <span className={cn('size-2 rounded-full', statusDotClass(task.status))} />
                          <button
                            type="button"
                            disabled={disabled}
                            onClick={() => editTask(phaseIndex, taskIndex, task.content)}
                            className="min-w-0 flex-1 truncate text-left disabled:pointer-events-none"
                            title={task.content}
                          >
                            {task.content}
                          </button>
                          <span className="hidden shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground group-hover:inline">
                            {todoStatusLabel(task.status, t)}
                          </span>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="size-6 opacity-70 hover:opacity-100">
                                <MoreHorizontal className="size-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem disabled={disabled || task.status === 'in_progress'} onSelect={() => runMutation({ type: 'startTask', phaseIndex, taskIndex })}>
                                <Sparkles className="size-4" />
                                {t('omp.todo.start')}
                              </DropdownMenuItem>
                              <DropdownMenuItem disabled={disabled || task.status === 'completed'} onSelect={() => runMutation({ type: 'completeTask', phaseIndex, taskIndex })}>
                                <CheckCircle2 className="size-4" />
                                {t('omp.todo.done')}
                              </DropdownMenuItem>
                              <DropdownMenuItem disabled={disabled || task.status === 'abandoned'} onSelect={() => runMutation({ type: 'abandonTask', phaseIndex, taskIndex })}>
                                <XCircle className="size-4" />
                                {t('omp.todo.drop')}
                              </DropdownMenuItem>
                              <DropdownMenuItem disabled={disabled || task.status === 'pending'} onSelect={() => runMutation({ type: 'reopenTask', phaseIndex, taskIndex })}>
                                <RotateCcw className="size-4" />
                                {t('omp.todo.reopen')}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem disabled={disabled} onSelect={() => editTask(phaseIndex, taskIndex, task.content)}>
                                <Edit3 className="size-4" />
                                {t('common.edit')}
                              </DropdownMenuItem>
                              <DropdownMenuItem disabled={disabled} variant="destructive" onSelect={() => removeTask(phaseIndex, taskIndex, task.content)}>
                                <Trash2 className="size-4" />
                                {t('common.remove')}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ))
            )}

            <OmpSubagentsSection subagents={subagents} />
          </div>
        )}
      </div>
      <OmpTodoMarkdownImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        sessionId={sessionId}
        expectedRevision={state.revision}
        hasHiddenMetadata={hasHiddenMetadata(state.phases)}
      />
    </div>
  )
}
