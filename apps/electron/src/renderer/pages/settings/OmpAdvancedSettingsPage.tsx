/**
 * OmpAdvancedSettingsPage
 *
 * Schema-driven OMP runtime settings editor. Fetches the settings schema
 * from the OMP backend via the `settings.schema` capability and renders
 * editable fields grouped by tab and group.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useAtomValue } from 'jotai'
import { RefreshCw, Save, EyeOff, AlertTriangle, Info } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { SettingsSection, SettingsCard, SettingsCardContent } from '@/components/settings'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import { activeSessionIdAtom } from '@/atoms/sessions'
import { useOmpCapabilities } from '@/hooks/useOmpCapabilities'
import { useOmpSessionCommand } from '@/hooks/useOmpSessionCommand'
import type {
  OmpSettingsSchema,
  OmpSettingsSchemaEntry,
  OmpSettingsState,
  OmpSettingsSetResult,
  OmpSettingsScope,
} from '@craft-agent/shared/protocol'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'omp-advanced',
}

// Exclude tui-only entries from the desktop UI
const SKIP_APPLIES_TO: Record<string, true> = { 'tui-only': true }

interface SettingsDraft {
  [path: string]: unknown
}

function groupEntries(
  entries: OmpSettingsSchemaEntry[],
): Record<string, Record<string, OmpSettingsSchemaEntry[]>> {
  const grouped: Record<string, Record<string, OmpSettingsSchemaEntry[]>> = {}
  for (const entry of entries) {
    if (entry.appliesTo in SKIP_APPLIES_TO) continue
    const tab = entry.tab ?? '_default'
    const group = entry.group ?? '_default'
    if (!grouped[tab]) grouped[tab] = {}
    if (!grouped[tab][group]) grouped[tab][group] = []
    grouped[tab][group].push(entry)
  }
  return grouped
}

function displayValue(value: unknown, entry: OmpSettingsSchemaEntry): string {
  if (entry.sensitive && value !== undefined && value !== null && value !== '') {
    const raw = String(value)
    if (raw.length <= 4) return '****'
    return raw.slice(0, 2) + '****' + raw.slice(-2)
  }
  if (value === undefined || value === null) return ''
  return String(value)
}

function EntryEditor({
  entry,
  value,
  onChange,
}: {
  entry: OmpSettingsSchemaEntry
  value: unknown
  onChange: (path: string, value: unknown) => void
}) {
  const { t } = useTranslation()

  const handleChange = React.useCallback(
    (newValue: unknown) => {
      onChange(entry.path, newValue)
    },
    [entry.path, onChange],
  )

  const label = (
    <div className="flex items-center gap-1.5">
      <span>{entry.label}</span>
      {entry.sensitive && <EyeOff className="size-3 text-muted-foreground" />}
      {entry.restartRequired && <Info className="size-3 text-amber-500" />}
    </div>
  )

  const description = entry.description && (
    <p className="text-xs text-muted-foreground mt-0.5">{entry.description}</p>
  )

  if (entry.type === 'boolean') {
    return (
      <div className="px-4 py-3.5">
        <div className="flex items-center justify-between">
          <div>
            {label}
            {description}
          </div>
          <Switch
            checked={value === true || value === 'true' || value === 1}
            onCheckedChange={(checked) => handleChange(checked)}
            aria-label={entry.label}
          />
        </div>
      </div>
    )
  }

  if (entry.type === 'enum' && entry.options && entry.options.length > 0) {
    const stringValue = value !== undefined && value !== null ? String(value) : ''
    return (
      <div className="px-4 py-3.5">
        <div>
          {label}
          {description}
        </div>
        <div className="mt-1.5">
          <Select
            value={stringValue}
            onValueChange={(v) => handleChange(v)}
          >
            <SelectTrigger className="w-full max-w-sm" aria-label={entry.label}>
              <SelectValue placeholder={t('settings.omp-advanced.selectPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {entry.options.map((opt: { value: unknown; label: string }) => (
                <SelectItem key={String(opt.value)} value={String(opt.value)}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    )
  }

  if (entry.type === 'number') {
    return (
      <div className="px-4 py-3.5">
        <div>
          {label}
          {description}
        </div>
        <div className="mt-1.5">
          <Input
            type="number"
            value={value !== undefined && value !== null ? String(value) : ''}
            onChange={(e) => {
              const raw = e.target.value
              handleChange(raw === '' ? undefined : Number(raw))
            }}
            className="max-w-sm"
            aria-label={entry.label}
          />
        </div>
      </div>
    )
  }

  // Default: string / array / object (rendered as text input)
  return (
    <div className="px-4 py-3.5">
      <div>
        {label}
        {description}
      </div>
      <div className="mt-1.5">
        <Input
          type={entry.sensitive ? 'password' : 'text'}
          value={displayValue(value, entry)}
          onChange={(e) => handleChange(e.target.value)}
          className="max-w-sm font-mono text-sm"
          placeholder={entry.default !== undefined ? String(entry.default) : ''}
          aria-label={entry.label}
        />
      </div>
    </div>
  )
}

export default function OmpAdvancedSettingsPage() {
  const { t } = useTranslation()
  const activeSessionId = useAtomValue(activeSessionIdAtom)
  const sessionId = activeSessionId ?? undefined

  const { loading: capLoading, isFeatureSupported, getFeatureReason } = useOmpCapabilities(sessionId)
  const { execute, loading: cmdLoading } = useOmpSessionCommand(sessionId)

  const [schema, setSchema] = React.useState<OmpSettingsSchema | null>(null)
  const [state, setState] = React.useState<OmpSettingsState | null>(null)
  const [draft, setDraft] = React.useState<SettingsDraft>({})
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [activeTab, setActiveTab] = React.useState<string>('_default')
  const [scope, setScope] = React.useState<OmpSettingsScope>('global')

  const featureSupported = !capLoading && isFeatureSupported('settings.schema')
  const featureReason = getFeatureReason('settings.schema')

  const fetchSchema = React.useCallback(async () => {
    if (!sessionId || !featureSupported) return
    setLoading(true)
    setError(null)
    try {
      const schemaResult = (await execute({ type: 'getSettingsSchema' })) as
        | { success: true; data?: { entries: OmpSettingsSchemaEntry[]; revision: number } }
        | { success: false; error?: string }
        | undefined

      if (!schemaResult || !('success' in schemaResult)) {
        throw new Error('Invalid schema response')
      }
      if (!schemaResult.success) {
        throw new Error(schemaResult.error ?? 'Failed to fetch schema')
      }

      const parsedSchema: OmpSettingsSchema = {
        entries: schemaResult.data?.entries ?? [],
        revision: schemaResult.data?.revision ?? 0,
      }
      setSchema(parsedSchema)

      // Also fetch current settings
      const settingsResult = (await execute({ type: 'getSettings', scope })) as
        | { success: true; data?: OmpSettingsState }
        | { success: false; error?: string }
        | undefined

      if (!settingsResult || !('success' in settingsResult)) {
        throw new Error('Invalid settings response')
      }
      if (!settingsResult.success) {
        throw new Error(settingsResult.error ?? 'Failed to fetch settings')
      }

      const settingsState: OmpSettingsState = settingsResult.data ?? { scope, values: {}, revision: 0 }
      setState(settingsState)
      setDraft({ ...settingsState.values })

      // Auto-select first tab
      const grouped = groupEntries(parsedSchema.entries)
      const tabKeys = Object.keys(grouped)
      if (tabKeys.length > 0 && tabKeys[0] !== '_default') {
        setActiveTab(tabKeys[0])
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [sessionId, featureSupported, execute, scope])

  React.useEffect(() => {
    void fetchSchema()
  }, [fetchSchema])

  const handleValueChange = React.useCallback(
    (path: string, value: unknown) => {
      setDraft((prev) => ({ ...prev, [path]: value }))
    },
    [],
  )

  const isDirty = React.useMemo(() => {
    if (!state) return false
    return Object.keys(draft).some((key) => draft[key] !== state.values[key])
      || Object.keys(state.values).some((key) => !(key in draft))
  }, [draft, state])

  const handleSave = React.useCallback(async () => {
    if (!schema || !state || !sessionId || !featureSupported) return
    setSaving(true)
    setError(null)
    try {
      // Only send changed values as patch
      const patch: Record<string, unknown> = {}
      for (const key of Object.keys(draft)) {
        if (draft[key] !== state.values[key]) {
          patch[key] = draft[key]
        }
      }
      // Also include keys removed from draft that were in state
      for (const key of Object.keys(state.values)) {
        if (!(key in draft)) {
          patch[key] = undefined as unknown
        }
      }

      if (Object.keys(patch).length === 0) {
        toast.info(t('settings.omp-advanced.noChanges'))
        return
      }

      const result = (await execute({
        type: 'setSettings',
        scope: scope === 'effective' ? 'project' : scope,
        patch,
        expectedRevision: state.revision,
      })) as
        | { success: true; data?: OmpSettingsSetResult }
        | { success: false; data?: OmpSettingsSetResult; error?: string }
        | undefined

      if (!result || !('success' in result)) {
        throw new Error('Invalid save response')
      }
      if (!result.success) {
        const errData = result.data
        if (errData?.conflict) {
          toast.error(t('settings.omp-advanced.conflictError'))
          // Refetch to get latest state
          void fetchSchema()
          return
        }
        throw new Error(result.error ?? errData?.error ?? 'Failed to save settings')
      }

      const saveResult = result.data
      if (saveResult?.restartRequired) {
        toast.success(t('settings.omp-advanced.savedRestart'))
      } else {
        toast.success(t('settings.omp-advanced.saved'))
      }

      // Update local state with new revision
      if (saveResult) {
        setState((prev: OmpSettingsState | null) => prev ? { ...prev, revision: saveResult.revision } : prev)
      }
      // Refetch to get fresh effective values
      void fetchSchema()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }, [schema, state, sessionId, featureSupported, draft, scope, execute, t, fetchSchema])

  // Not supported state
  if (!capLoading && !featureSupported) {
    return (
      <div className="flex h-full flex-col">
        <PanelHeader title={t('settings.omp-advanced.title')} />
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="flex flex-col items-center gap-3 text-center max-w-md">
            <AlertTriangle className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {featureReason || t('settings.omp-advanced.notSupported')}
            </p>
          </div>
        </div>
      </div>
    )
  }

  const grouped = schema ? groupEntries(schema.entries) : {}
  const tabKeys = Object.keys(grouped).filter((k) => k !== '_default')
  const hasDefaultTab = '_default' in grouped

  return (
    <div className="flex h-full flex-col">
      <PanelHeader
        title={t('settings.omp-advanced.title')}
        actions={(
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void fetchSchema()}
              disabled={loading || capLoading || cmdLoading}
            >
              <RefreshCw className={cn('mr-1.5 size-3.5', loading && 'animate-spin')} />
              {t('common.refresh')}
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!isDirty || saving || cmdLoading || capLoading}
            >
              <Save className="mr-1.5 size-3.5" />
              {saving ? t('settings.omp-advanced.saving') : t('settings.omp-advanced.save')}
            </Button>
          </div>
        )}
      />
      <ScrollArea className="flex-1">
        <div className="p-6">
          {/* Scope selector */}
          <div className="mb-6 flex items-center gap-2">
            <Label className="text-sm text-muted-foreground">{t('settings.omp-advanced.scope')}</Label>
            <Select
              value={scope}
              onValueChange={(v: OmpSettingsScope) => {
                setScope(v)
                // Refetch on scope change
                void (async () => {
                  if (!sessionId || !featureSupported) return
                  try {
                    const settingsResult = (await execute({ type: 'getSettings', scope: v })) as
                      | { success: true; data?: OmpSettingsState }
                      | { success: false; error?: string }
                      | undefined
                    if (settingsResult?.success) {
                      const st = settingsResult.data ?? { scope: v, values: {}, revision: 0 }
                      setState(st)
                      setDraft({ ...st.values })
                    }
                  } catch { /* handled by fetchSchema on mount */ }
                })()
              }}
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="global">{t('settings.omp-advanced.scopeGlobal')}</SelectItem>
                <SelectItem value="project">{t('settings.omp-advanced.scopeProject')}</SelectItem>
                <SelectItem value="effective">{t('settings.omp-advanced.scopeEffective')}</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">
              {t('settings.omp-advanced.scopeDesc')}
            </span>
          </div>

          {/* Error banner */}
          {error && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              <AlertTriangle className="size-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Loading state */}
          {(loading || capLoading) && (
            <div className="flex items-center justify-center py-12">
              <p className="text-sm text-muted-foreground">{t('settings.omp-advanced.loading')}</p>
            </div>
          )}

          {/* Empty state */}
          {!loading && !capLoading && schema && schema.entries.length === 0 && (
            <div className="flex items-center justify-center py-12">
              <p className="text-sm text-muted-foreground">{t('settings.omp-advanced.empty')}</p>
            </div>
          )}

          {/* Tabs */}
          {!loading && !capLoading && schema && schema.entries.length > 0 && (
            <>
              {(tabKeys.length > 0 || hasDefaultTab) && (
                <div className="mb-6 flex flex-wrap gap-2 border-b border-border pb-2">
                  {tabKeys.map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={cn(
                        'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                        activeTab === tab
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                      )}
                    >
                      {tab}
                    </button>
                  ))}
                  {hasDefaultTab && (
                    <button
                      onClick={() => setActiveTab('_default')}
                      className={cn(
                        'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                        activeTab === '_default' || (tabKeys.length === 0)
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                      )}
                    >
                      {t('settings.omp-advanced.generalTab')}
                    </button>
                  )}
                </div>
              )}

              {/* Render active tab groups */}
              {activeTab && grouped[activeTab] && (
                <div className="space-y-6">
                  {Object.entries(grouped[activeTab]).map(([groupName, entries]) => (
                    groupName !== '_default' ? (
                      <SettingsSection key={groupName} title={groupName}>
                        <SettingsCard>
                          {entries.map((entry) => (
                            <EntryEditor
                              key={entry.path}
                              entry={entry}
                              value={draft[entry.path] ?? entry.effectiveValue ?? entry.default}
                              onChange={handleValueChange}
                            />
                          ))}
                        </SettingsCard>
                      </SettingsSection>
                    ) : (
                      <SettingsCard key={groupName}>
                        {entries.map((entry) => (
                          <EntryEditor
                            key={entry.path}
                            entry={entry}
                            value={draft[entry.path] ?? entry.effectiveValue ?? entry.default}
                            onChange={handleValueChange}
                          />
                        ))}
                      </SettingsCard>
                    )
                  ))}
                </div>
              )}

              {/* If active tab has no groups (shouldn't happen since groupEntries creates them) */}
              {activeTab && !grouped[activeTab] && (
                <div className="flex items-center justify-center py-12">
                  <p className="text-sm text-muted-foreground">{t('settings.omp-advanced.empty')}</p>
                </div>
              )}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
