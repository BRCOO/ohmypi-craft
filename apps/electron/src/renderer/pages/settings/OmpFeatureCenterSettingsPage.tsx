import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Bot, BrainCircuit, Check, ChevronDown, ChevronRight, ClipboardCopy, Cpu, ExternalLink, EyeOff, FolderOpen, ListChecks, Plus, RefreshCw, Save, ServerCog, Sparkles, Trash2 } from 'lucide-react'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { SettingsCard, SettingsCardContent, SettingsSection, SettingsToggle } from '@/components/settings'
import { cn } from '@/lib/utils'
import { useAppShellContext } from '@/context/AppShellContext'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import type { LlmConnectionWithStatus, OmpFeatureCapabilityDto, OmpFeatureCenterStateDto, OmpFeatureModelRoleDto, OmpFeatureUnavailableCommandDto, SaveOmpFeatureCenterConfigInput } from '../../../shared/types'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'omp',
}

type RoleDraft = Record<string, string>
export type AdvisorRosterDraftItem = { id: string; name: string; model: string; tools: string; instructions: string }
export type AdvisorRosterDraft = { instructions: string; advisors: AdvisorRosterDraftItem[] }
export type OmpModelRoleOption = { value: string; label: string; description?: string; source: 'omp' | 'configured' | 'default' }

const emptyDraft: RoleDraft = {}
const emptyAdvisorRosterDraft: AdvisorRosterDraft = { instructions: '', advisors: [] }
const THINKING_SUFFIXES = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const
type ThinkingSuffix = typeof THINKING_SUFFIXES[number]

function isThinkingSuffix(value: string | undefined): value is ThinkingSuffix {
  return !!value && (THINKING_SUFFIXES as readonly string[]).includes(value)
}

function splitModelRoleValue(value: string): { base: string; thinking: ThinkingSuffix } {
  const trimmed = value.trim()
  if (!trimmed) return { base: '', thinking: 'off' }
  const separator = trimmed.lastIndexOf(':')
  if (separator === -1) return { base: trimmed, thinking: 'off' }
  const suffix = trimmed.slice(separator + 1)
  if (!isThinkingSuffix(suffix)) return { base: trimmed, thinking: 'off' }
  return { base: trimmed.slice(0, separator), thinking: suffix }
}

function applyThinkingSuffix(value: string, thinking: ThinkingSuffix): string {
  const { base } = splitModelRoleValue(value)
  if (!base) return value
  return thinking === 'off' ? base : `${base}:${thinking}`
}

function humanizeModelId(value: string): string {
  const id = splitModelRoleValue(value).base || value
  const model = id.includes('/') ? id.split('/').slice(1).join('/') : id
  return model
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase())
}

function addModelRoleOption(
  options: OmpModelRoleOption[],
  seen: Set<string>,
  value: string | undefined,
  label: string | undefined,
  source: OmpModelRoleOption['source'],
  description?: string,
) {
  const trimmed = value?.trim()
  if (!trimmed || seen.has(trimmed)) return
  seen.add(trimmed)
  options.push({
    value: trimmed,
    label: label?.trim() || humanizeModelId(trimmed),
    source,
    description,
  })
}

export function buildOmpModelRoleOptions(
  llmConnections: LlmConnectionWithStatus[],
  state?: OmpFeatureCenterStateDto | null,
): OmpModelRoleOption[] {
  const options: OmpModelRoleOption[] = []
  const seen = new Set<string>()

  for (const connection of llmConnections.filter(conn => conn.providerType === 'omp')) {
    for (const model of connection.models ?? []) {
      const value = typeof model === 'string' ? model : model.id
      const label = typeof model === 'string' ? humanizeModelId(model) : (model.name || humanizeModelId(model.id))
      addModelRoleOption(options, seen, value, label, 'omp', connection.name)
    }
    addModelRoleOption(options, seen, connection.defaultModel, undefined, 'omp', `${connection.name} default`)
  }

  const roles = state ? [...state.modelRoles.common, ...state.modelRoles.advanced] : []
  for (const role of roles) {
    addModelRoleOption(options, seen, role.globalValue, undefined, 'configured', `Configured for ${role.label}`)
    addModelRoleOption(options, seen, role.projectValue, undefined, 'configured', `Project override for ${role.label}`)
    addModelRoleOption(options, seen, role.effectiveValue, undefined, 'configured', `Effective ${role.label}`)
  }
  for (const advisor of state?.advisor.roster.advisors ?? []) {
    addModelRoleOption(options, seen, advisor.model, undefined, 'configured', `Advisor: ${advisor.name}`)
  }

  return options.sort((a, b) => {
    if (a.source !== b.source) return a.source === 'omp' ? -1 : 1
    return a.label.localeCompare(b.label)
  })
}

function sourceLabel(source: string): string {
  if (source === 'project') return 'project override'
  if (source === 'global') return 'global'
  if (source === 'user') return 'user'
  return 'default'
}

function SourceBadge({ source, overridden }: { source: string; overridden?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
        source === 'project'
          ? 'bg-violet-500/12 text-violet-700 dark:text-violet-200'
          : source === 'global'
            ? 'bg-blue-500/12 text-blue-700 dark:text-blue-200'
            : source === 'user'
              ? 'bg-cyan-500/12 text-cyan-700 dark:text-cyan-200'
              : 'bg-muted text-muted-foreground'
      )}
    >
      {overridden ? 'project override' : sourceLabel(source)}
    </span>
  )
}

function valueOrDash(value: string | undefined): string {
  return value?.trim() ? value : 'Not set'
}

function pathSummary(paths: Array<{ path: string; exists: boolean; parseError?: string }>): string {
  const existing = paths.filter(path => path.exists)
  if (existing.length === 0) return 'No files found'
  return existing.map(path => path.path).join(', ')
}

export function capabilityUsageCopy(title: string, usageHint: string): string {
  if (title === 'Skills') return '/skill:<name>'
  if (title === 'MCP') return '/mcp list\n/mcp resources\n/mcp prompts\n/mcp reload'
  return usageHint
}

function advisorDraftFromState(state: OmpFeatureCenterStateDto): AdvisorRosterDraft {
  return {
    instructions: state.advisor.roster.editable.instructions ?? '',
    advisors: state.advisor.roster.editable.advisors.map((advisor, index) => ({
      id: `${index}-${advisor.name}`,
      name: advisor.name,
      model: advisor.model ?? '',
      tools: advisor.tools?.join(', ') ?? '',
      instructions: advisor.instructions ?? '',
    })),
  }
}

function splitTools(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map(tool => tool.trim())
    .filter(Boolean)
}

function normalizeAdvisorRosterDraft(draft: AdvisorRosterDraft) {
  return {
    instructions: draft.instructions.trim(),
    advisors: draft.advisors
      .map(advisor => ({
        name: advisor.name.trim(),
        model: advisor.model.trim(),
        tools: splitTools(advisor.tools),
        instructions: advisor.instructions.trim(),
      }))
      .filter(advisor => advisor.name)
      .map(advisor => ({
        name: advisor.name,
        model: advisor.model || undefined,
        tools: advisor.tools.length > 0 ? advisor.tools : undefined,
        instructions: advisor.instructions || undefined,
      })),
  }
}

function advisorRosterDirty(draft: AdvisorRosterDraft, state: OmpFeatureCenterStateDto): boolean {
  const current = normalizeAdvisorRosterDraft(advisorDraftFromState(state))
  const next = normalizeAdvisorRosterDraft(draft)
  return JSON.stringify(current) !== JSON.stringify(next)
}

export function buildOmpFeatureCenterSavePayload({
  workspaceId,
  roles,
  roleDraft,
  advisorEnabled,
  advisorSubagents,
  advisorRosterDraft,
  state,
}: {
  workspaceId?: string | null
  roles: OmpFeatureModelRoleDto[]
  roleDraft: RoleDraft
  advisorEnabled: boolean
  advisorSubagents: boolean
  advisorRosterDraft: AdvisorRosterDraft
  state: OmpFeatureCenterStateDto
}): SaveOmpFeatureCenterConfigInput {
  const advisorPatch: NonNullable<SaveOmpFeatureCenterConfigInput['advisor']> = {}
  const enabledBaseline = state.advisor.enabled.globalValue ?? state.advisor.enabled.effectiveValue
  const subagentsBaseline = state.advisor.subagents.globalValue ?? state.advisor.subagents.effectiveValue
  if (advisorEnabled !== enabledBaseline) advisorPatch.enabled = advisorEnabled
  if (advisorSubagents !== subagentsBaseline) advisorPatch.subagents = advisorSubagents

  const payload: SaveOmpFeatureCenterConfigInput = {
    workspaceId,
    modelRoles: Object.fromEntries(roles.map(role => [role.role, roleDraft[role.role] ?? ''])) as Record<string, string>,
  }
  if (Object.keys(advisorPatch).length > 0) payload.advisor = advisorPatch
  if (advisorRosterDirty(advisorRosterDraft, state)) {
    payload.advisorRoster = normalizeAdvisorRosterDraft(advisorRosterDraft)
  }
  return payload
}

async function copyText(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`${label} copied`)
  } catch {
    toast.error(`Failed to copy ${label.toLowerCase()}`)
  }
}

async function openFeatureCenterPath(
  workspaceId: string | null | undefined,
  path: string,
  action: 'open' | 'reveal',
) {
  try {
    if (!window.electronAPI?.openOmpFeatureCenterPath) {
      throw new Error('OMP Feature Center path actions are unavailable.')
    }
    await window.electronAPI.openOmpFeatureCenterPath({ workspaceId, path, action })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    toast.error(message || `Failed to ${action === 'open' ? 'open' : 'reveal'} path`)
  }
}

function MiniActionButton({
  icon: Icon,
  children,
  disabled,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>
  children: React.ReactNode
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <Button type="button" variant="ghost" size="sm" disabled={disabled} className="h-7 gap-1.5 px-2 text-xs" onClick={onClick}>
      <Icon className="size-3.5" />
      {children}
    </Button>
  )
}

function PathActions({
  path,
  exists,
  label,
  workspaceId,
}: {
  path: string | undefined
  exists?: boolean
  label: string
  workspaceId?: string | null
}) {
  if (!path) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <MiniActionButton icon={ClipboardCopy} onClick={() => void copyText(path, `${label} path`)}>
        Copy path
      </MiniActionButton>
      <MiniActionButton icon={ExternalLink} disabled={exists === false} onClick={() => void openFeatureCenterPath(workspaceId, path, 'open')}>
        Open
      </MiniActionButton>
      <MiniActionButton icon={FolderOpen} disabled={exists === false} onClick={() => void openFeatureCenterPath(workspaceId, path, 'reveal')}>
        Reveal
      </MiniActionButton>
    </div>
  )
}

export function CapabilityCard({
  icon: Icon,
  title,
  capability,
  workspaceId,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  capability: OmpFeatureCapabilityDto
  workspaceId?: string | null
}) {
  const visibleItems = capability.items.slice(0, 8)
  const copyUsage = capabilityUsageCopy(title, capability.usageHint)
  return (
    <div className="rounded-lg border border-border/60 bg-background/70 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-200">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-medium">{title}</div>
          <div className="text-xs text-muted-foreground">{capability.count} discovered</div>
        </div>
      </div>
      <div className="space-y-1.5">
        {visibleItems.length > 0 ? (
          visibleItems.map((item, index) => (
            <div key={`${item.path}-${item.name}-${index}`} className="flex items-center justify-between gap-2 text-xs">
              <button
                type="button"
                className="min-w-0 truncate text-left font-medium hover:underline"
                title={item.path}
                onClick={() => void openFeatureCenterPath(workspaceId, item.path, 'reveal')}
              >
                {item.name}
              </button>
              <div className="flex shrink-0 items-center gap-1.5">
                <SourceBadge source={item.level} />
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  title={`Reveal ${item.name}`}
                  onClick={() => void openFeatureCenterPath(workspaceId, item.path, 'reveal')}
                >
                  <FolderOpen className="size-3.5" />
                </button>
              </div>
            </div>
          ))
        ) : (
          <div className="text-xs text-muted-foreground">No entries discovered.</div>
        )}
      </div>
      {capability.count > visibleItems.length && (
        <div className="mt-2 text-xs text-muted-foreground">+{capability.count - visibleItems.length} more</div>
      )}
      <div className="mt-3 rounded-md bg-muted/50 px-2 py-1.5 text-xs text-muted-foreground">
        {capability.usageHint}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <MiniActionButton icon={ClipboardCopy} onClick={() => void copyText(copyUsage, `${title} usage`)}>
          Copy usage
        </MiniActionButton>
        {capability.sourcePaths.find(path => path.exists)?.path && (
          <MiniActionButton icon={FolderOpen} onClick={() => void openFeatureCenterPath(workspaceId, capability.sourcePaths.find(path => path.exists)!.path, 'reveal')}>
            Reveal source
          </MiniActionButton>
        )}
      </div>
      <div className="mt-2 truncate text-[11px] text-muted-foreground" title={pathSummary(capability.sourcePaths)}>
        {pathSummary(capability.sourcePaths)}
      </div>
    </div>
  )
}

export function UsageGuideCard({
  title,
  description,
  command,
}: {
  title: string
  description: string
  command?: string
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/70 p-3">
      <div className="text-sm font-medium">{title}</div>
      <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</div>
      {command && (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2 py-1.5">
          <code className="min-w-0 whitespace-pre-wrap break-words text-xs text-muted-foreground">{command}</code>
          <button
            type="button"
            className="shrink-0 text-muted-foreground hover:text-foreground"
            title={`Copy ${title}`}
            onClick={() => void copyText(command, title)}
          >
            <ClipboardCopy className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}

export function UnavailableCommandList({ commands }: { commands: OmpFeatureUnavailableCommandDto[] }) {
  if (commands.length === 0) return null
  return (
    <div className="space-y-2">
      {commands.map(command => (
        <div key={command.command} className="rounded-lg border border-border/60 bg-background/70 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{command.command}</code>
            <div className="text-sm font-medium">{command.label}</div>
            <span className={cn(
              'rounded-full px-2 py-0.5 text-[11px] font-medium',
              command.status === 'desktop-equivalent'
                ? 'bg-blue-500/12 text-blue-700 dark:text-blue-200'
                : 'bg-amber-500/12 text-amber-700 dark:text-amber-200'
            )}>
              {command.status === 'desktop-equivalent' ? 'desktop equivalent' : 'hidden'}
            </span>
          </div>
          <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{command.reason}</div>
          {command.alternative && (
            <div className="mt-1 text-xs leading-relaxed text-muted-foreground">Alternative: {command.alternative}</div>
          )}
        </div>
      ))}
    </div>
  )
}

export function AdvisorRosterEditor({
  draft,
  disabled,
  workspaceId,
  editablePath,
  exists,
  parseError,
  onInstructionsChange,
  onAdvisorChange,
  onAddAdvisor,
  onRemoveAdvisor,
}: {
  draft: AdvisorRosterDraft
  disabled?: boolean
  workspaceId?: string | null
  editablePath: string
  exists?: boolean
  parseError?: string
  onInstructionsChange: (value: string) => void
  onAdvisorChange: (id: string, patch: Partial<Omit<AdvisorRosterDraftItem, 'id'>>) => void
  onAddAdvisor: () => void
  onRemoveAdvisor: (id: string) => void
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 rounded-lg border border-border/50 bg-muted/25 p-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="text-sm font-medium">WATCHDOG.yml editor</div>
          <div className="truncate text-xs text-muted-foreground" title={editablePath}>
            Global roster: {editablePath}
          </div>
        </div>
        <PathActions workspaceId={workspaceId} path={editablePath} exists={exists} label="WATCHDOG.yml" />
      </div>
      {parseError && <ErrorCard message={`WATCHDOG.yml parse error: ${parseError}`} />}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Shared instructions</label>
        <textarea
          value={draft.instructions}
          onChange={event => onInstructionsChange(event.target.value)}
          disabled={disabled}
          rows={4}
          placeholder="Optional shared instructions for all advisors"
          className="w-full rounded-md border border-input bg-muted/50 px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-medium text-muted-foreground">Advisors</div>
          <Button type="button" variant="outline" size="sm" className="h-7 gap-1.5 px-2 text-xs" disabled={disabled} onClick={onAddAdvisor}>
            <Plus className="size-3.5" />
            Add advisor
          </Button>
        </div>
        {draft.advisors.length === 0 ? (
          <div className="rounded-md border border-dashed border-border/70 px-3 py-3 text-xs text-muted-foreground">
            No global advisors yet. Add one to write it into WATCHDOG.yml.
          </div>
        ) : (
          draft.advisors.map(advisor => (
            <div key={advisor.id} className="space-y-2 rounded-lg border border-border/60 bg-background/70 p-2">
              <div className="grid gap-2 md:grid-cols-[1fr_1.3fr_1.3fr_auto]">
                <Input
                  value={advisor.name}
                  disabled={disabled}
                  onChange={event => onAdvisorChange(advisor.id, { name: event.target.value })}
                  placeholder="Name"
                  className="h-8 bg-muted/50 text-xs"
                />
                <Input
                  value={advisor.model}
                  disabled={disabled}
                  onChange={event => onAdvisorChange(advisor.id, { model: event.target.value })}
                  placeholder="provider/model or blank"
                  className="h-8 bg-muted/50 text-xs"
                />
                <Input
                  value={advisor.tools}
                  disabled={disabled}
                  onChange={event => onAdvisorChange(advisor.id, { tools: event.target.value })}
                  placeholder="tools, comma separated"
                  className="h-8 bg-muted/50 text-xs"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground hover:text-destructive"
                  disabled={disabled}
                  onClick={() => onRemoveAdvisor(advisor.id)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
              <textarea
                value={advisor.instructions}
                onChange={event => onAdvisorChange(advisor.id, { instructions: event.target.value })}
                disabled={disabled}
                rows={2}
                placeholder="Optional advisor-specific instructions"
                className="w-full rounded-md border border-input bg-muted/50 px-3 py-2 text-xs shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export function ModelRolePicker({
  value,
  disabled,
  options,
  onChange,
}: {
  value: string
  disabled?: boolean
  options: OmpModelRoleOption[]
  onChange: (value: string) => void
}) {
  const [open, setOpen] = React.useState(false)
  const { base, thinking } = splitModelRoleValue(value)
  const selectedOption = options.find(option => option.value === value || option.value === base)

  return (
    <div className="space-y-2">
      <div className="flex min-w-0 gap-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              disabled={disabled || options.length === 0}
              className="h-9 min-w-[160px] flex-1 justify-between border-border/70 bg-muted/40 px-3 font-normal"
            >
              <span className="min-w-0 truncate text-left">
                {selectedOption?.label ?? (base ? humanizeModelId(base) : 'Select OMP model')}
              </span>
              <ChevronDown className="ml-2 size-3.5 shrink-0 opacity-60" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[420px] overflow-hidden p-0">
            <Command shouldFilter>
              <CommandInput placeholder="Search synced OMP models..." />
              <CommandList className="max-h-[320px]">
                <CommandEmpty>No synced OMP models found.</CommandEmpty>
                {options.map(option => {
                  const selected = option.value === value || option.value === base
                  const optionThinking = splitModelRoleValue(option.value).thinking
                  return (
                    <CommandItem
                      key={option.value}
                      value={`${option.label} ${option.value} ${option.description ?? ''}`}
                      onSelect={() => {
                        onChange(optionThinking === 'off' ? applyThinkingSuffix(option.value, thinking) : option.value)
                        setOpen(false)
                      }}
                      className="items-start gap-2 px-3 py-2"
                    >
                      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-200">
                        <Sparkles className="size-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{option.label}</span>
                        <span className="block truncate text-xs text-muted-foreground">{option.value}</span>
                        {option.description && (
                          <span className="block truncate text-[11px] text-muted-foreground/80">{option.description}</span>
                        )}
                      </span>
                      <span className="mt-1 shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {option.source === 'omp' ? 'synced' : 'configured'}
                      </span>
                      {selected && <Check className="mt-1 size-3.5 shrink-0 text-blue-500" />}
                    </CommandItem>
                  )
                })}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          placeholder="provider/model[:thinking]"
          className="h-9 flex-[1.1] bg-muted/50"
        />
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 text-[11px] text-muted-foreground">Thinking</span>
        {THINKING_SUFFIXES.map(suffix => (
          <button
            key={suffix}
            type="button"
            disabled={disabled || !base}
            onClick={() => onChange(applyThinkingSuffix(value, suffix))}
            className={cn(
              'rounded-full border px-2 py-0.5 text-[11px] transition-colors disabled:pointer-events-none disabled:opacity-40',
              thinking === suffix
                ? 'border-blue-400/40 bg-blue-500/15 text-blue-700 dark:text-blue-100'
                : 'border-border/70 bg-muted/30 text-muted-foreground hover:bg-muted/60 hover:text-foreground'
            )}
          >
            {suffix}
          </button>
        ))}
      </div>
    </div>
  )
}

export function RoleRow({
  role,
  value,
  disabled,
  modelOptions = [],
  onChange,
}: {
  role: OmpFeatureModelRoleDto
  value: string
  disabled?: boolean
  modelOptions?: OmpModelRoleOption[]
  onChange: (role: string, value: string) => void
}) {
  return (
    <div className="grid grid-cols-[minmax(120px,1fr)_minmax(180px,2fr)] gap-3 px-4 py-3.5 sm:grid-cols-[160px_minmax(360px,1fr)_auto]">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <div className="truncate text-sm font-medium">{role.label}</div>
          <SourceBadge source={role.source} overridden={role.projectOverridden} />
        </div>
        <div className="mt-1 truncate text-xs text-muted-foreground">
          Effective: {valueOrDash(role.effectiveValue)}
        </div>
        {role.projectOverridden && (
          <div className="mt-1 text-xs text-violet-700 dark:text-violet-200">
            Saving global config will not change the effective value until the project override changes.
          </div>
        )}
      </div>
      <ModelRolePicker
        value={value}
        disabled={disabled}
        options={modelOptions}
        onChange={(nextValue) => onChange(role.role, nextValue)}
      />
      <div className="hidden min-w-[120px] text-right text-xs text-muted-foreground sm:block">
        Global: {valueOrDash(role.globalValue)}
      </div>
    </div>
  )
}

function ErrorCard({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {message}
    </div>
  )
}

export default function OmpFeatureCenterSettingsPage() {
  const { t } = useTranslation()
  const { activeWorkspaceId, llmConnections } = useAppShellContext()
  const [state, setState] = React.useState<OmpFeatureCenterStateDto | null>(null)
  const [roleDraft, setRoleDraft] = React.useState<RoleDraft>(emptyDraft)
  const [advisorRosterDraft, setAdvisorRosterDraft] = React.useState<AdvisorRosterDraft>(emptyAdvisorRosterDraft)
  const [advisorEnabled, setAdvisorEnabled] = React.useState(false)
  const [advisorSubagents, setAdvisorSubagents] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [advancedOpen, setAdvancedOpen] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const hydrateDraft = React.useCallback((next: OmpFeatureCenterStateDto) => {
    const roles: RoleDraft = {}
    for (const role of [...next.modelRoles.common, ...next.modelRoles.advanced]) {
      roles[role.role] = role.globalValue ?? ''
    }
    setRoleDraft(roles)
    setAdvisorRosterDraft(advisorDraftFromState(next))
    setAdvisorEnabled(next.advisor.enabled.globalValue ?? next.advisor.enabled.effectiveValue)
    setAdvisorSubagents(next.advisor.subagents.globalValue ?? next.advisor.subagents.effectiveValue)
  }, [])

  const loadState = React.useCallback(async () => {
    if (!window.electronAPI?.getOmpFeatureCenterState) return
    setLoading(true)
    setError(null)
    try {
      const next = await window.electronAPI.getOmpFeatureCenterState(activeWorkspaceId)
      setState(next)
      hydrateDraft(next)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [activeWorkspaceId, hydrateDraft])

  React.useEffect(() => {
    void loadState()
  }, [loadState])

  const roles = React.useMemo(() => state ? [...state.modelRoles.common, ...state.modelRoles.advanced] : [], [state])
  const modelRoleOptions = React.useMemo(
    () => buildOmpModelRoleOptions(llmConnections, state),
    [llmConnections, state],
  )
  const dirty = React.useMemo(() => {
    if (!state) return false
    const roleDirty = roles.some(role => (roleDraft[role.role] ?? '') !== (role.globalValue ?? ''))
    return roleDirty
      || advisorRosterDirty(advisorRosterDraft, state)
      || advisorEnabled !== (state.advisor.enabled.globalValue ?? state.advisor.enabled.effectiveValue)
      || advisorSubagents !== (state.advisor.subagents.globalValue ?? state.advisor.subagents.effectiveValue)
  }, [advisorEnabled, advisorRosterDraft, advisorSubagents, roleDraft, roles, state])

  const updateRoleDraft = React.useCallback((role: string, value: string) => {
    setRoleDraft(previous => ({ ...previous, [role]: value }))
  }, [])

  const updateAdvisorDraft = React.useCallback((id: string, patch: Partial<Omit<AdvisorRosterDraftItem, 'id'>>) => {
    setAdvisorRosterDraft(previous => ({
      ...previous,
      advisors: previous.advisors.map(advisor => advisor.id === id ? { ...advisor, ...patch } : advisor),
    }))
  }, [])

  const addAdvisorDraft = React.useCallback(() => {
    setAdvisorRosterDraft(previous => ({
      ...previous,
      advisors: [
        ...previous.advisors,
        { id: `new-${Date.now()}-${previous.advisors.length}`, name: '', model: '', tools: '', instructions: '' },
      ],
    }))
  }, [])

  const removeAdvisorDraft = React.useCallback((id: string) => {
    setAdvisorRosterDraft(previous => ({
      ...previous,
      advisors: previous.advisors.filter(advisor => advisor.id !== id),
    }))
  }, [])

  const save = React.useCallback(async () => {
    if (!state || !window.electronAPI?.saveOmpFeatureCenterConfig) return
    setSaving(true)
    setError(null)
    try {
      const result = await window.electronAPI.saveOmpFeatureCenterConfig(buildOmpFeatureCenterSavePayload({
        workspaceId: activeWorkspaceId,
        roles,
        roleDraft,
        advisorEnabled,
        advisorSubagents,
        advisorRosterDraft,
        state,
      }))
      if (!result.success || !result.state) {
        throw new Error(result.error ?? 'Failed to save OMP configuration.')
      }
      setState(result.state)
      hydrateDraft(result.state)
      toast.success('OMP settings saved')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }, [activeWorkspaceId, advisorEnabled, advisorRosterDraft, advisorSubagents, hydrateDraft, roleDraft, roles, state])

  const globalParseError = state?.config.global.parseError
  const projectParseError = state?.config.project?.parseError
  const advisorRosterParseError = state?.advisor.roster.editable.parseError
  const saveDisabled = loading || saving || !dirty || !!globalParseError || !!advisorRosterParseError

  return (
    <div className="flex h-full flex-col">
      <PanelHeader
        title={t('settings.omp.title')}
        actions={(
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={loadState} disabled={loading || saving}>
              <RefreshCw className={cn('mr-1.5 size-3.5', loading && 'animate-spin')} />
              Refresh
            </Button>
            <Button size="sm" onClick={save} disabled={saveDisabled}>
              <Save className="mr-1.5 size-3.5" />
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        )}
      />
      <div className="min-h-0 flex-1 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="mx-auto max-w-4xl space-y-7 px-5 py-7">
            {error && <ErrorCard message={error} />}
            {loading && !state ? (
              <SettingsCard>
                <SettingsCardContent>
                  <div className="text-sm text-muted-foreground">Loading OMP configuration...</div>
                </SettingsCardContent>
              </SettingsCard>
            ) : state && (
              <>
                <SettingsSection title="Runtime" description="The OMP binary and configuration sources used by this desktop.">
                  <SettingsCard>
                    <SettingsCardContent className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn(
                          'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium',
                          state.runtime.available
                            ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-200'
                            : 'bg-amber-500/12 text-amber-700 dark:text-amber-200'
                        )}>
                          <Cpu className="mr-1.5 size-3.5" />
                          {state.runtime.available ? 'OMP available' : 'OMP unavailable'}
                        </span>
                        {state.runtime.version && (
                          <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                            v{state.runtime.version}
                          </span>
                        )}
                        {dirty && (
                          <span className="rounded-full bg-blue-500/12 px-2.5 py-1 text-xs font-medium text-blue-700 dark:text-blue-200">
                            unsaved changes
                          </span>
                        )}
                      </div>
                      {state.runtime.error && <ErrorCard message={state.runtime.error} />}
                      <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                        <div className="truncate" title={state.runtime.rawCommand}>Command: {state.runtime.rawCommand || state.runtime.executablePath || 'Not resolved'}</div>
                        <div className="truncate" title={state.runtime.globalConfigPath}>Global config: {state.runtime.globalConfigPath}</div>
                        <div className="truncate" title={state.runtime.projectRootPath}>Project root: {state.runtime.projectRootPath || 'No active workspace'}</div>
                        <div className="truncate" title={state.runtime.projectConfigPath}>Project config: {state.runtime.projectConfigPath || 'None'}</div>
                      </div>
                      <div className="flex flex-col gap-2 rounded-lg border border-border/50 bg-muted/25 p-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0 text-xs text-muted-foreground">
                          Open or reveal OMP config files directly when you need to edit advanced OMP-only options.
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <PathActions workspaceId={activeWorkspaceId} path={state.runtime.globalConfigPath} exists={state.config.global.exists} label="Global config" />
                          <PathActions workspaceId={activeWorkspaceId} path={state.runtime.projectConfigPath} exists={state.config.project?.exists} label="Project config" />
                        </div>
                      </div>
                      {globalParseError && <ErrorCard message={`Global config parse error: ${globalParseError}`} />}
                      {projectParseError && <ErrorCard message={`Project config parse error: ${projectParseError}`} />}
                    </SettingsCardContent>
                  </SettingsCard>
                </SettingsSection>

                <SettingsSection title="Model Roles" description="Edit global OMP role bindings. Project overrides are shown but not edited here.">
                  <SettingsCard>
                    {state.modelRoles.common.map(role => (
                      <RoleRow
                        key={role.role}
                        role={role}
                        value={roleDraft[role.role] ?? ''}
                        disabled={saving || !!globalParseError}
                        modelOptions={modelRoleOptions}
                        onChange={updateRoleDraft}
                      />
                    ))}
                    <button
                      type="button"
                      onClick={() => setAdvancedOpen(open => !open)}
                      className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-muted-foreground hover:bg-muted/50"
                    >
                      {advancedOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                      Advanced roles
                    </button>
                    {advancedOpen && state.modelRoles.advanced.map(role => (
                      <RoleRow
                        key={role.role}
                        role={role}
                        value={roleDraft[role.role] ?? ''}
                        disabled={saving || !!globalParseError}
                        modelOptions={modelRoleOptions}
                        onChange={updateRoleDraft}
                      />
                    ))}
                  </SettingsCard>
                </SettingsSection>

                <SettingsSection title="Advisor" description="Configure OMP Advisor toggles and the global multi-advisor WATCHDOG.yml roster. Project rosters remain read-only overlays.">
                  <SettingsCard>
                    <SettingsToggle
                      label="Enable Advisor"
                      description="Turn on OMP's second-opinion reviewer for future OMP sessions."
                      checked={advisorEnabled}
                      disabled={saving || !!globalParseError}
                      onCheckedChange={setAdvisorEnabled}
                    />
                    <SettingsToggle
                      label="Advisor subagents"
                      description="Allow Advisor to run through OMP subagent infrastructure."
                      checked={advisorSubagents}
                      disabled={saving || !!globalParseError}
                      onCheckedChange={setAdvisorSubagents}
                    />
                    <SettingsCardContent>
                      <AdvisorRosterEditor
                        draft={advisorRosterDraft}
                        disabled={saving || !!globalParseError || !!advisorRosterParseError}
                        workspaceId={activeWorkspaceId}
                        editablePath={state.advisor.roster.editable.path}
                        exists={state.advisor.roster.editable.exists}
                        parseError={state.advisor.roster.editable.parseError}
                        onInstructionsChange={value => setAdvisorRosterDraft(previous => ({ ...previous, instructions: value }))}
                        onAdvisorChange={updateAdvisorDraft}
                        onAddAdvisor={addAdvisorDraft}
                        onRemoveAdvisor={removeAdvisorDraft}
                      />
                      <div className="mb-2 mt-4 flex items-center gap-2 text-sm font-medium">
                        <BrainCircuit className="size-4 text-violet-500" />
                        Effective roster
                      </div>
                      {state.advisor.roster.advisors.length > 0 ? (
                        <div className="space-y-1.5">
                          {state.advisor.roster.advisors.map(advisor => (
                            <div key={`${advisor.path}-${advisor.name}`} className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-2 py-1.5 text-xs">
                              <span className="font-medium">{advisor.name}</span>
                              <span className="truncate text-muted-foreground">{advisor.model || 'uses advisor role'}</span>
                              {advisor.level && <SourceBadge source={advisor.level} />}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-sm text-muted-foreground">No WATCHDOG.yml roster configured.</div>
                      )}
                      <div className="mt-2 truncate text-xs text-muted-foreground" title={pathSummary(state.advisor.roster.paths)}>
                        {pathSummary(state.advisor.roster.paths)}
                      </div>
                      {state.advisor.roster.parseErrors.length > 0 && (
                        <div className="mt-2 rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-200">
                          {state.advisor.roster.parseErrors.length} roster file(s) could not be parsed.
                        </div>
                      )}
                    </SettingsCardContent>
                  </SettingsCard>
                </SettingsSection>

                <SettingsSection title="How to use OMP features" description="Quick answers for Skills, MCP, agents, Advisor, and the plan model role.">
                  <div className="grid gap-3 md:grid-cols-2">
                    <UsageGuideCard
                      title="Call a Skill"
                      description="Use OMP slash commands in chat. Pick a discovered skill name from the Skills card below."
                      command="/skill:<name>"
                    />
                    <UsageGuideCard
                      title="Inspect MCP"
                      description="OMP MCP remains separate from Craft Sources. Use these commands to list servers, resources, prompts, and reload."
                      command={'/mcp list\n/mcp resources\n/mcp prompts\n/mcp reload'}
                    />
                    <UsageGuideCard
                      title="Configure Advisor"
                      description="Set modelRoles.advisor in Model Roles, then enable Advisor and Advisor subagents in this page. Multi-advisor rosters can be edited in the WATCHDOG.yml editor above."
                    />
                    <UsageGuideCard
                      title="Configure Plan model"
                      description="Set modelRoles.plan in Model Roles. Native OMP /plan controls stay hidden until OMP exposes stable RPC state and review commands."
                    />
                    <UsageGuideCard
                      title="Configure multiple agents"
                      description="Place Markdown agent definitions under project .omp/agents or user ~/.omp/agent/agents. This page discovers and reveals them, but does not edit agent files."
                    />
                  </div>
                </SettingsSection>

                <SettingsSection title="OMP Capabilities" description="Read-only discovery for OMP-specific surfaces. Craft Sources remain separate.">
                  <div className="grid gap-3 md:grid-cols-3">
                    <CapabilityCard workspaceId={activeWorkspaceId} icon={Sparkles} title="Skills" capability={state.skills} />
                    <CapabilityCard workspaceId={activeWorkspaceId} icon={ServerCog} title="MCP" capability={state.mcp} />
                    <CapabilityCard workspaceId={activeWorkspaceId} icon={Bot} title="Agents" capability={state.agents} />
                  </div>
                </SettingsSection>

                <SettingsSection title="Native Plan" description="Current desktop support for OMP native /plan.">
                  <SettingsCard>
                    <SettingsCardContent>
                      <div className="flex items-start gap-3">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-200">
                          <ListChecks className="size-4" />
                        </span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-sm font-medium">Plan model: {valueOrDash(state.nativePlan.modelRole)}</div>
                            <span className="rounded-full bg-amber-500/12 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-200">
                              {state.nativePlan.toggleAvailable ? 'RPC available' : 'RPC hidden'}
                            </span>
                            <span className="rounded-full bg-blue-500/12 px-2 py-0.5 text-[11px] font-medium text-blue-700 dark:text-blue-200">
                              approval UI: {state.nativePlan.approvalUi === 'extension-ui-if-emitted' ? 'ready if emitted' : 'not exposed'}
                            </span>
                          </div>
                          <div className="mt-1 text-sm text-muted-foreground">{state.nativePlan.message}</div>
                          {state.nativePlan.unavailableReason && (
                            <div className="mt-2 text-xs text-muted-foreground">{state.nativePlan.unavailableReason}</div>
                          )}
                          <div className="mt-2 text-xs text-muted-foreground">
                            RPC commands exposed: {state.nativePlan.rpcCommands.length > 0 ? state.nativePlan.rpcCommands.join(', ') : 'none'}
                          </div>
                        </div>
                      </div>
                    </SettingsCardContent>
                  </SettingsCard>
                </SettingsSection>

                <SettingsSection title="Hidden TUI-only commands" description="OMP commands that are not shown in slash autocomplete because the current RPC protocol cannot execute them directly.">
                  <SettingsCard>
                    <SettingsCardContent>
                      <div className="mb-3 flex items-start gap-3">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-200">
                          <EyeOff className="size-4" />
                        </span>
                        <div className="min-w-0">
                          <div className="text-sm font-medium">No fake slash entries</div>
                          <div className="mt-1 text-sm text-muted-foreground">
                            The composer only lists commands returned by OMP RPC get_available_commands. TUI-only commands stay hidden unless we provide a real desktop equivalent.
                          </div>
                        </div>
                      </div>
                      <UnavailableCommandList commands={state.unavailableCommands} />
                    </SettingsCardContent>
                  </SettingsCard>
                </SettingsSection>
              </>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
