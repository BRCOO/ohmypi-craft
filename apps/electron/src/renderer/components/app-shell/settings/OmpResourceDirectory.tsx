import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AlertCircle, Copy, Pencil, Plus, RefreshCw, ServerCog, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import type { OmpResourceEntry, OmpResourceMcpTestResult, OmpResourceSnapshot, OmpResourceType } from '../../../../shared/types'

export interface OmpResourceDirectoryProps {
  workspaceId?: string | null
  type: OmpResourceType
  title: string
  icon: React.ComponentType<{ className?: string }>
  snapshot: OmpResourceSnapshot
  onChange: () => void
}

/**
 * Attach the active workspace id to every resource mutation payload.
 * Optional so user-scoped operations still work without a workspace.
 */
export function withOmpResourceWorkspace<T extends Record<string, unknown>>(
  payload: T,
  workspaceId?: string | null,
): T & { workspaceId?: string } {
  return {
    ...payload,
    workspaceId: workspaceId ?? undefined,
  }
}

export function canTestOmpResource(type: OmpResourceType): boolean {
  return type === 'mcp'
}

export function canManageOmpResource(entry: Pick<OmpResourceEntry, 'source'>): boolean {
  return entry.source !== 'bundled'
}

function ScopeBadge({ scope }: { scope: string }) {
  const { t } = useTranslation()
  return (
    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      {t(`omp.featureCenter.scope.${scope}`, { defaultValue: scope })}
    </span>
  )
}

function SourceBadgeInline({ source }: { source: string }) {
  const { t } = useTranslation()
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
        source === 'project'
          ? 'bg-violet-500/12 text-violet-700 dark:text-violet-200'
          : source === 'user'
            ? 'bg-cyan-500/12 text-cyan-700 dark:text-cyan-200'
            : 'bg-muted text-muted-foreground'
      )}
    >
      {t(`omp.featureCenter.source.${source}`, { defaultValue: source })}
    </span>
  )
}

export function OmpResourceDirectory({
  workspaceId,
  type,
  title,
  icon: Icon,
  snapshot,
  onChange,
}: OmpResourceDirectoryProps) {
  const { t } = useTranslation()
  const categoryKey: keyof OmpResourceSnapshot = type === 'skill' ? 'skills' : type === 'agent' ? 'agents' : 'mcp'
  const category = snapshot[categoryKey]
  const [pending, setPending] = React.useState<Record<string, boolean>>({})
  const [testResults, setTestResults] = React.useState<Record<string, OmpResourceMcpTestResult>>({})
  const [adding, setAdding] = React.useState(false)
  const [editing, setEditing] = React.useState<OmpResourceEntry | null>(null)
  const [draftName, setDraftName] = React.useState('')
  const [draftDescription, setDraftDescription] = React.useState('')
  const [draftCommandArgs, setDraftCommandArgs] = React.useState('')
  const [draftScope, setDraftScope] = React.useState<'user' | 'project'>('user')

  const startPending = (key: string) => setPending(previous => ({ ...previous, [key]: true }))
  const stopPending = (key: string) => setPending(previous => {
    const next = { ...previous }
    delete next[key]
    return next
  })
  const isPending = (key: string) => pending[key] ?? false

  const handleToggle = async (entry: OmpResourceEntry, enabled: boolean) => {
    if (!window.electronAPI?.setOmpResourceEnabled) return
    const key = `toggle-${entry.id}`
    startPending(key)
    try {
      const result = await window.electronAPI.setOmpResourceEnabled(
        withOmpResourceWorkspace(
          {
            type,
            id: entry.id,
            scope: entry.scope,
            expectedRevision: entry.revision,
            enabled,
          },
          workspaceId,
        ),
      )
      if (result.success) {
        onChange()
      } else {
        toast.error(result.error ?? t('omp.featureCenter.resourceToggleFailed', { defaultValue: 'Failed to update resource state' }))
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      stopPending(key)
    }
  }

  const handleTest = async (entry: OmpResourceEntry) => {
    if (!window.electronAPI?.testOmpMcpResource) return
    const key = `test-${entry.id}`
    startPending(key)
    try {
      const result = await window.electronAPI.testOmpMcpResource(
        withOmpResourceWorkspace({ id: entry.id, scope: entry.scope }, workspaceId),
      )
      setTestResults(previous => ({ ...previous, [entry.id]: result }))
      if (!result.success) {
        toast.error(result.error ?? result.testError ?? t('omp.featureCenter.resourceTestFailed', { defaultValue: 'MCP test failed' }))
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      stopPending(key)
    }
  }

  const handleRemove = async (entry: OmpResourceEntry) => {
    if (!window.electronAPI?.removeOmpResource) return
    const confirmed = window.confirm(
      t('omp.featureCenter.removeConfirm', {
        name: entry.name,
        defaultValue: `Remove ${entry.name}? This cannot be undone.`,
      })
    )
    if (!confirmed) return
    const key = `remove-${entry.id}`
    startPending(key)
    try {
      const result = await window.electronAPI.removeOmpResource(
        withOmpResourceWorkspace(
          {
            type,
            id: entry.id,
            scope: entry.scope,
            expectedRevision: entry.revision,
          },
          workspaceId,
        ),
      )
      if (result.success) {
        onChange()
      } else {
        toast.error(result.error ?? t('omp.featureCenter.resourceRemoveFailed', { defaultValue: 'Failed to remove resource' }))
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      stopPending(key)
    }
  }

  const handleRefresh = async () => {
    if (!window.electronAPI?.refreshOmpResources) return
    startPending('refresh')
    try {
      await window.electronAPI.refreshOmpResources(withOmpResourceWorkspace({}, workspaceId))
      onChange()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      stopPending('refresh')
    }
  }

  const resetDraft = () => {
    setDraftName('')
    setDraftDescription('')
    setDraftCommandArgs('')
    setDraftScope('user')
  }

  const openEditor = (entry: OmpResourceEntry) => {
    setAdding(false)
    setEditing(entry)
    setDraftName(entry.name)
    setDraftDescription(entry.description ?? '')
    setDraftCommandArgs('')
  }

  const closeEditor = () => {
    setEditing(null)
    resetDraft()
  }

  const copyPath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path)
      toast.success(t('omp.featureCenter.pathCopied', { defaultValue: 'Source path copied' }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  const buildDraft = (): Record<string, unknown> => {
    const draft: Record<string, unknown> = {
      name: draftName.trim(),
      description: draftDescription.trim() || undefined,
    }
    if (type === 'mcp') {
      const parts = draftCommandArgs.trim().split(/\s+/).filter(Boolean)
      if (parts.length > 0) {
        draft.command = parts[0]
        draft.args = parts.slice(1)
      }
    }
    return draft
  }

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!window.electronAPI?.createOmpResource) return
    const draft = buildDraft()
    startPending('create')
    try {
      const result = await window.electronAPI.createOmpResource(
        withOmpResourceWorkspace({ type, scope: draftScope, draft }, workspaceId),
      )
      if (result.success) {
        setAdding(false)
        resetDraft()
        onChange()
      } else {
        toast.error(result.error ?? t('omp.featureCenter.resourceCreateFailed', { defaultValue: 'Failed to create resource' }))
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      stopPending('create')
    }
  }

  const handleUpdate = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!editing || !window.electronAPI?.updateOmpResource) return
    const key = `update-${editing.id}`
    startPending(key)
    try {
      const result = await window.electronAPI.updateOmpResource(
        withOmpResourceWorkspace(
          {
            type,
            id: editing.id,
            scope: editing.scope,
            expectedRevision: editing.revision,
            patch: buildDraft(),
          },
          workspaceId,
        ),
      )
      if (result.success) {
        closeEditor()
        onChange()
      } else {
        toast.error(result.error ?? t('omp.featureCenter.resourceUpdateFailed', { defaultValue: 'Failed to update resource' }))
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      stopPending(key)
    }
  }

  return (
    <div className="rounded-lg border border-border/60 bg-background/70 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-200">
            <Icon className="size-4" />
          </span>
          <div className="min-w-0">
            <div className="text-sm font-medium">{title}</div>
            <div className="text-xs text-muted-foreground">
              {t('omp.featureCenter.discovered', {
                count: category.entries.length,
                defaultValue: `${category.entries.length} discovered`,
              })}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            disabled={isPending('refresh')}
            onClick={() => void handleRefresh()}
            title={t('omp.featureCenter.refresh', { defaultValue: 'Refresh' })}
          >
            <RefreshCw className={cn('size-3.5', isPending('refresh') && 'animate-spin')} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => setAdding(open => !open)}
            title={t('omp.featureCenter.add', { defaultValue: 'Add' })}
          >
            <Plus className="size-3.5" />
          </Button>
        </div>
      </div>

      {category.error && (
        <div className="mb-2 rounded-md border border-destructive/20 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
          {category.error}
        </div>
      )}

      {adding && (
        <form onSubmit={handleCreate} className="mb-3 space-y-2 rounded-md border border-border/60 bg-muted/30 p-2">
          <Input
            value={draftName}
            onChange={event => setDraftName(event.target.value)}
            placeholder={t('omp.featureCenter.name', { defaultValue: 'Name' })}
            className="h-8 bg-muted/50 text-xs"
            disabled={isPending('create')}
          />
          <label className="block text-[11px] text-muted-foreground">
            {t('omp.featureCenter.scopeLabel', { defaultValue: 'Scope' })}
            <select
              value={draftScope}
              onChange={event => setDraftScope(event.target.value as 'user' | 'project')}
              className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
              disabled={isPending('create')}
            >
              <option value="user">{t('omp.featureCenter.scope.user', { defaultValue: 'User' })}</option>
              <option value="project" disabled={!workspaceId}>
                {t('omp.featureCenter.scope.project', { defaultValue: 'Project' })}
              </option>
            </select>
          </label>
          <Input
            value={draftDescription}
            onChange={event => setDraftDescription(event.target.value)}
            placeholder={t('omp.featureCenter.description', { defaultValue: 'Description' })}
            className="h-8 bg-muted/50 text-xs"
            disabled={isPending('create')}
          />
          {type === 'mcp' && (
            <Input
              value={draftCommandArgs}
              onChange={event => setDraftCommandArgs(event.target.value)}
              placeholder={t('omp.featureCenter.commandArgsPlaceholder', { defaultValue: 'command arg1 arg2' })}
              className="h-8 bg-muted/50 text-xs"
              disabled={isPending('create')}
            />
          )}
          <div className="flex justify-end gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setAdding(false)}
              disabled={isPending('create')}
            >
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              type="submit"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={isPending('create') || !draftName.trim()}
            >
              {t('common.create', { defaultValue: 'Create' })}
            </Button>
          </div>
        </form>
      )}

      <div className="space-y-1.5">
        {category.entries.length > 0 ? (
          category.entries.map(entry => {
            const testResult = testResults[entry.id]
            return (
              <React.Fragment key={`${entry.id}-${entry.revision}`}>
              <div className="flex items-start justify-between gap-2 rounded-md bg-muted/30 px-2 py-1.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-medium">{entry.name}</span>
                    <SourceBadgeInline source={entry.source} />
                    <ScopeBadge scope={entry.scope} />
                    {entry.diagnostics.length > 0 && (
                      <span
                        className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/12 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-200"
                        title={entry.diagnostics.map(diagnostic => diagnostic.message).join('; ')}
                      >
                        <AlertCircle className="size-3" />
                        {entry.diagnostics.length}
                      </span>
                    )}
                  </div>
                  {entry.description && (
                    <div className="mt-0.5 truncate text-[11px] text-muted-foreground" title={entry.description}>
                      {entry.description}
                    </div>
                  )}
                  <button
                    type="button"
                    className="mt-1 flex max-w-full items-center gap-1 truncate text-left text-[10px] text-muted-foreground hover:text-foreground"
                    onClick={() => void copyPath(entry.path)}
                    title={entry.path}
                  >
                    <Copy className="size-3 shrink-0" />
                    <span className="truncate">{entry.path}</span>
                  </button>
                  {testResult && (
                    <div className="mt-1">
                      {testResult.success && testResult.connected ? (
                        <span className="inline-flex items-center rounded-full bg-emerald-500/12 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-200">
                          {t('omp.featureCenter.testConnected', {
                            count: testResult.tools?.length ?? 0,
                            defaultValue: `Connected (${testResult.tools?.length ?? 0} tools)`,
                          })}
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
                          {testResult.testError ?? testResult.error ?? t('omp.featureCenter.testFailed', { defaultValue: 'Test failed' })}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {canTestOmpResource(type) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 px-1.5 text-xs"
                      disabled={isPending(`test-${entry.id}`)}
                      onClick={() => void handleTest(entry)}
                      title={t('omp.featureCenter.testConnection', { defaultValue: 'Test connection' })}
                    >
                      <ServerCog className="size-3.5" />
                      {isPending(`test-${entry.id}`)
                        ? t('common.testing', { defaultValue: 'Testing' })
                        : t('omp.featureCenter.test', { defaultValue: 'Test' })}
                    </Button>
                  )}
                  <Switch
                    checked={entry.enabled}
                    disabled={isPending(`toggle-${entry.id}`)}
                    onCheckedChange={checked => void handleToggle(entry, checked)}
                    aria-label={t('omp.featureCenter.enableResource', {
                      name: entry.name,
                      defaultValue: `Enable ${entry.name}`,
                    })}
                  />
                  {canManageOmpResource(entry) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7 text-muted-foreground"
                      disabled={isPending(`update-${entry.id}`)}
                      onClick={() => openEditor(entry)}
                      title={t('omp.featureCenter.edit', { defaultValue: 'Edit' })}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                  )}
                  {canManageOmpResource(entry) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7 text-muted-foreground hover:text-destructive"
                      disabled={isPending(`remove-${entry.id}`)}
                      onClick={() => void handleRemove(entry)}
                      title={t('omp.featureCenter.remove', { defaultValue: 'Remove' })}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
              </div>
              </div>
              {editing?.id === entry.id && (
                <form onSubmit={handleUpdate} className="mt-1.5 space-y-2 rounded-md border border-border/60 bg-background p-2">
                  <Input
                    value={draftName}
                    onChange={event => setDraftName(event.target.value)}
                    placeholder={t('omp.featureCenter.name', { defaultValue: 'Name' })}
                    className="h-8 text-xs"
                    disabled={isPending(`update-${entry.id}`)}
                  />
                  {type !== 'mcp' && (
                    <Input
                      value={draftDescription}
                      onChange={event => setDraftDescription(event.target.value)}
                      placeholder={t('omp.featureCenter.description', { defaultValue: 'Description' })}
                      className="h-8 text-xs"
                      disabled={isPending(`update-${entry.id}`)}
                    />
                  )}
                  {type === 'mcp' && (
                    <Input
                      value={draftCommandArgs}
                      onChange={event => setDraftCommandArgs(event.target.value)}
                      placeholder={t('omp.featureCenter.commandArgsOptional', { defaultValue: 'New command and arguments (optional)' })}
                      className="h-8 text-xs"
                      disabled={isPending(`update-${entry.id}`)}
                    />
                  )}
                  <div className="flex justify-end gap-1.5">
                    <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={closeEditor}>
                      {t('common.cancel', { defaultValue: 'Cancel' })}
                    </Button>
                    <Button type="submit" size="sm" className="h-7 px-2 text-xs" disabled={isPending(`update-${entry.id}`) || !draftName.trim()}>
                      {t('common.save', { defaultValue: 'Save' })}
                    </Button>
                  </div>
                </form>
              )}
              </React.Fragment>
            )
          })
        ) : (
          <div className="text-xs text-muted-foreground">{t('omp.featureCenter.emptyEntries')}</div>
        )}
      </div>
    </div>
  )
}
