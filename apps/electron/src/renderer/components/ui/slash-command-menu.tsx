import * as React from 'react'
import { useTranslation } from "react-i18next"
import type { TFunction } from 'i18next'
import { Command as CommandPrimitive } from 'cmdk'
import { Bot, BrainCircuit, Check, Cpu, ListChecks, Minimize2, ServerCog, Sparkles, Wrench } from 'lucide-react'
import { Icon_Folder } from '@craft-agent/ui'
import { cn } from '@/lib/utils'
import { PERMISSION_MODE_CONFIG, PERMISSION_MODE_ORDER, type PermissionMode } from '@craft-agent/shared/agent/modes'
import type { LoadedSkill, OmpAvailableCommandDto, OmpAvailableCommandSource, OmpFeatureCenterStateDto, OmpFeatureUnavailableCommandDto, OmpPlanControlStateDto } from '../../../shared/types'

// ============================================================================
// Types
// ============================================================================

export interface OmpSlashCommandId {
  type: 'omp'
  name: string
  subcommand?: string
}

export interface OmpCuratedCommandId {
  type: 'omp-curated'
  kind: 'plan' | 'advisor' | 'mcp' | 'skills' | 'agents' | 'models'
}

export type SlashCommandId = PermissionMode | 'compact' | OmpSlashCommandId | OmpCuratedCommandId

export function isOmpSlashCommandId(id: SlashCommandId): id is OmpSlashCommandId {
  return typeof id === 'object' && id?.type === 'omp'
}

export function isOmpCuratedCommandId(id: SlashCommandId): id is OmpCuratedCommandId {
  return typeof id === 'object' && id?.type === 'omp-curated'
}

export function slashCommandIdKey(id: SlashCommandId): string {
  if (isOmpSlashCommandId(id)) {
    return `omp:${id.name}${id.subcommand ? `:${id.subcommand}` : ''}`
  }
  if (isOmpCuratedCommandId(id)) {
    return `omp-curated:${id.kind}`
  }
  return id
}

/** Union type for all item types in the slash menu */
export type SlashItemType = 'command' | 'folder'

export interface SlashCommand {
  id: SlashCommandId
  label: string
  description: string
  icon: React.ReactNode
  shortcut?: string
  /** Optional color for the command (hex color string) */
  color?: string
  /** Optional compact metadata shown on the right side of inline menus. */
  meta?: string
  /** When true, the item is visible and searchable but cannot be activated. */
  disabled?: boolean
  /** Short reason shown when the item is disabled. */
  disabledReason?: string
  /** Checked state for checkbox-like curated controls. */
  checked?: boolean
}

/** Folder item for the slash menu */
export interface SlashFolderItem {
  id: string
  type: 'folder'
  label: string
  description: string
  path: string
}

/** Section with header for the inline slash menu */
export interface SlashSection {
  id: string
  label: string
  items: (SlashCommand | SlashFolderItem)[]
}

export interface CommandGroup {
  id: string
  commands: SlashCommand[]
}

// ============================================================================
// Permission Mode Icon Component
// ============================================================================

interface PermissionModeIconProps {
  mode: PermissionMode
  className?: string
}

function PermissionModeIcon({ mode, className }: PermissionModeIconProps) {
  const config = PERMISSION_MODE_CONFIG[mode]
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d={config.svgPath} />
    </svg>
  )
}

// ============================================================================
// Default Commands
// ============================================================================

// Icon size constant
const MENU_ICON_SIZE = 'h-3.5 w-3.5'

// Generate permission mode commands from centralized config
const permissionModeCommands: SlashCommand[] = PERMISSION_MODE_ORDER.map(mode => {
  const config = PERMISSION_MODE_CONFIG[mode]
  return {
    id: mode,
    label: config.displayName,
    description: config.description,
    icon: <PermissionModeIcon mode={mode} className={MENU_ICON_SIZE} />,
  }
})

const compactCommand: SlashCommand = {
  id: 'compact',
  label: 'Compact Context',
  description: 'Summarize conversation context to free up token budget',
  icon: <Minimize2 className={MENU_ICON_SIZE} />,
}

export const DEFAULT_SLASH_COMMANDS: SlashCommand[] = [
  ...permissionModeCommands,
  compactCommand,
]

export const DEFAULT_SLASH_COMMAND_GROUPS: CommandGroup[] = [
  { id: 'modes', commands: permissionModeCommands },
]

const permissionModeTranslationKeys: Record<PermissionMode, { label: string; description: string }> = {
  safe: { label: 'commands.mode.explore', description: 'commands.mode.exploreDescription' },
  ask: { label: 'commands.mode.ask', description: 'commands.mode.askDescription' },
  'allow-all': { label: 'commands.mode.execute', description: 'commands.mode.executeDescription' },
}

function buildLocalizedPermissionModeCommands(t: TFunction): SlashCommand[] {
  return PERMISSION_MODE_ORDER.map(mode => {
    const config = PERMISSION_MODE_CONFIG[mode]
    const keys = permissionModeTranslationKeys[mode]
    return {
      id: mode,
      label: t(keys.label, { defaultValue: config.displayName }),
      description: t(keys.description, { defaultValue: config.description }),
      icon: <PermissionModeIcon mode={mode} className={MENU_ICON_SIZE} />,
    }
  })
}

function buildLocalizedCompactCommand(t: TFunction): SlashCommand {
  return {
    id: 'compact',
    label: t('commands.compactContext', { defaultValue: 'Compact Context' }),
    description: t('commands.compactContextDescription', { defaultValue: 'Summarize conversation context to free up token budget' }),
    icon: <Minimize2 className={MENU_ICON_SIZE} />,
  }
}

// ============================================================================
// Shared Styles
// ============================================================================

const MENU_CONTAINER_STYLE = 'min-w-[260px] overflow-hidden rounded-2xl border border-white/10 bg-[#15151c]/95 text-foreground shadow-modal-small backdrop-blur-xl'
const MENU_LIST_STYLE = 'max-h-[360px] overflow-y-auto p-1.5'
const MENU_ITEM_STYLE = 'flex cursor-pointer select-none items-start gap-2.5 rounded-xl px-2.5 py-2 text-[13px]'
const MENU_ITEM_SELECTED = 'bg-white/[0.075]'
const MENU_SECTION_HEADER = 'px-2.5 pb-1.5 pt-2 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground/80'

// ============================================================================
// Shared: Filter utilities
// ============================================================================

function filterCommands(commands: SlashCommand[], filter: string): SlashCommand[] {
  if (!filter) return commands
  const lowerFilter = filter.toLowerCase()
  return commands.filter(
    cmd =>
      cmd.label.toLowerCase().includes(lowerFilter) ||
      cmd.description?.toLowerCase().includes(lowerFilter) ||
      slashCommandIdKey(cmd.id).toLowerCase().includes(lowerFilter) ||
      cmd.shortcut?.toLowerCase().includes(lowerFilter) ||
      cmd.meta?.toLowerCase().includes(lowerFilter)
  )
}

/** Check if an item is a folder */
function isFolder(item: SlashCommand | SlashFolderItem): item is SlashFolderItem {
  return 'type' in item && item.type === 'folder'
}

/** Filter sections by label/id, keeping sections grouped */
function filterSections(sections: SlashSection[], filter: string): SlashSection[] {
  if (!filter) return sections
  const lowerFilter = filter.toLowerCase()

  // Filter items within each section, keeping section structure
  return sections
    .map(section => ({
      ...section,
      items: section.items.filter(item =>
        item.label.toLowerCase().includes(lowerFilter) ||
        (typeof item.id === 'string'
          ? item.id.toLowerCase()
          : slashCommandIdKey(item.id).toLowerCase()
        ).includes(lowerFilter) ||
        item.description?.toLowerCase().includes(lowerFilter) ||
        (!isFolder(item) && item.meta?.toLowerCase().includes(lowerFilter)) ||
        (!isFolder(item) && item.shortcut?.toLowerCase().includes(lowerFilter))
      ),
    }))
    .filter(section => section.items.length > 0)
}

/** Flatten sections into a single array of items */
function flattenSections(sections: SlashSection[]): (SlashCommand | SlashFolderItem)[] {
  return sections.flatMap(section => section.items)
}

// ============================================================================
// Shared: Command Item Content
// ============================================================================

const MODE_COMMAND_IDS = new Set<string>(['safe', 'ask', 'allow-all'])

function CommandItemContent({ command, isActive }: { command: SlashCommand; isActive: boolean }) {
  const { t } = useTranslation()
  const label = typeof command.id === 'string' && MODE_COMMAND_IDS.has(command.id)
    ? t(`mode.${command.id}`, command.label)
    : command.label
  return (
    <>
      <div className={cn('mt-0.5 shrink-0', command.disabled ? 'text-muted-foreground/50' : 'text-muted-foreground')}>
        {command.icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className={cn('truncate font-medium leading-5', command.disabled && 'text-muted-foreground/70')}>
          {label}
        </div>
        {command.description && (
          <div className="truncate text-[11px] leading-4 text-muted-foreground/80">
            {command.description}
          </div>
        )}
        {command.disabled && command.disabledReason && (
          <div className="truncate text-[11px] leading-4 text-muted-foreground/60">
            {command.disabledReason}
          </div>
        )}
      </div>
      {(command.meta || command.shortcut) && (
        <div className="mt-0.5 shrink-0 rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-muted-foreground/80">
          {command.meta ?? command.shortcut}
        </div>
      )}
      {isActive && (
        <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-current">
          <Check className="h-2.5 w-2.5 text-white dark:text-black" strokeWidth={3} />
        </div>
      )}
    </>
  )
}

// ============================================================================
// SlashCommandMenu Component (Button-triggered popup)
// ============================================================================

export interface SlashCommandMenuProps {
  /** Flat list of commands (use this OR commandGroups, not both) */
  commands?: SlashCommand[]
  /** Grouped commands with separators between groups */
  commandGroups?: CommandGroup[]
  activeCommands?: SlashCommandId[]
  onSelect: (commandId: SlashCommandId) => void
  showFilter?: boolean
  filterPlaceholder?: string
  className?: string
}

export function SlashCommandMenu({
  commands,
  commandGroups,
  activeCommands = [],
  onSelect,
  showFilter = false,
  filterPlaceholder,
  className,
}: SlashCommandMenuProps) {
  const { t } = useTranslation()
  const effectiveFilterPlaceholder = filterPlaceholder ?? t("commands.searchCommands")
  const [filter, setFilter] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement>(null)

  // If groups provided, filter within each group; otherwise use flat commands
  const filteredGroups = React.useMemo(() => {
    if (commandGroups) {
      return commandGroups.map(group => ({
        ...group,
        commands: filterCommands(group.commands, filter),
      })).filter(group => group.commands.length > 0)
    }
    return null
  }, [commandGroups, filter])

  const filteredCommands = React.useMemo(() => {
    if (commands && !commandGroups) {
      return filterCommands(commands, filter)
    }
    return null
  }, [commands, commandGroups, filter])

  // Get all commands for defaultValue calculation
  const allFilteredCommands = filteredGroups
    ? filteredGroups.flatMap(g => g.commands)
    : (filteredCommands ?? [])

  // Default to the first active command, or first command if none active
  const defaultValue = activeCommands[0] ? slashCommandIdKey(activeCommands[0]) : (allFilteredCommands[0] ? slashCommandIdKey(allFilteredCommands[0].id) : undefined)

  React.useEffect(() => {
    // Don't auto-focus the filter on touch devices — it pulls up the virtual keyboard
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0
    if (showFilter && inputRef.current && !isTouchDevice) {
      inputRef.current.focus()
    }
  }, [showFilter])

  if (allFilteredCommands.length === 0 && !showFilter) return null

  // Render a single command item
  const renderCommandItem = (cmd: SlashCommand) => {
    const cmdKey = slashCommandIdKey(cmd.id)
    const isActive = activeCommands.some(id => slashCommandIdKey(id) === cmdKey)
    return (
      <CommandPrimitive.Item
        key={cmdKey}
        value={cmdKey}
        disabled={cmd.disabled}
        aria-disabled={cmd.disabled || undefined}
        onSelect={() => {
          if (!cmd.disabled) onSelect(cmd.id)
        }}
        data-tutorial={`permission-mode-${cmdKey}`}
        className={cn(
          MENU_ITEM_STYLE,
          'outline-none',
          'data-[selected=true]:bg-foreground/5'
        )}
      >
        <CommandItemContent command={cmd} isActive={isActive} />
      </CommandPrimitive.Item>
    )
  }

  return (
    <CommandPrimitive
      className={cn(MENU_CONTAINER_STYLE, className)}
      shouldFilter={false}
      defaultValue={defaultValue}
    >
      {showFilter && (
        <div className="border-b border-border/50 px-3 py-2">
          <CommandPrimitive.Input
            ref={inputRef}
            value={filter}
            onValueChange={setFilter}
            placeholder={effectiveFilterPlaceholder}
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      )}
      <CommandPrimitive.List className={MENU_LIST_STYLE}>
        {allFilteredCommands.length === 0 ? (
          <CommandPrimitive.Empty className="py-4 text-center text-sm text-muted-foreground">
            {t('composer.slash.noCommands')}
          </CommandPrimitive.Empty>
        ) : filteredGroups ? (
          // Group-based rendering with smart separators
          filteredGroups.map((group, groupIndex) => (
            <React.Fragment key={group.id}>
              {group.commands.map(renderCommandItem)}
              {/* Separator: only show if there's another group after this one */}
              {groupIndex < filteredGroups.length - 1 && (
                <div className="h-px bg-border/50 my-1 mx-2" />
              )}
            </React.Fragment>
          ))
        ) : (
          // Flat list rendering
          filteredCommands?.map(renderCommandItem)
        )}
      </CommandPrimitive.List>
    </CommandPrimitive>
  )
}

// ============================================================================
// InlineSlashCommand - Autocomplete that follows cursor
// ============================================================================

export interface InlineSlashCommandProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sections: SlashSection[]
  activeCommands?: SlashCommandId[]
  onSelectCommand: (commandId: SlashCommandId) => void
  onSelectFolder: (path: string) => void
  filter?: string
  position: { x: number; y: number }
  className?: string
}

function isSelectableItem(item: SlashCommand | SlashFolderItem): boolean {
  return isFolder(item) || !item.disabled
}

export function InlineSlashCommand({
  open,
  onOpenChange,
  sections,
  activeCommands = [],
  onSelectCommand,
  onSelectFolder,
  filter = '',
  position,
  className,
}: InlineSlashCommandProps) {
  const { t } = useTranslation()
  const menuRef = React.useRef<HTMLDivElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)
  const [selectedIndex, setSelectedIndex] = React.useState(0)
  const filteredSections = filterSections(sections, filter)
  const flatItems = flattenSections(filteredSections)
  const selectableItems = React.useMemo(
    () => flatItems.filter(isSelectableItem),
    [flatItems]
  )

  // Reset selection when filter changes
  React.useEffect(() => {
    setSelectedIndex(0)
  }, [filter])

  // Scroll selected item into view
  React.useEffect(() => {
    if (!listRef.current) return
    const selectedEl = listRef.current.querySelector('[data-selected="true"]')
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  // Handle item selection
  const handleSelect = React.useCallback((item: SlashCommand | SlashFolderItem) => {
    if (isFolder(item)) {
      onSelectFolder(item.path)
    } else {
      onSelectCommand(item.id)
    }
    onOpenChange(false)
  }, [onSelectCommand, onSelectFolder, onOpenChange])

  // Keyboard navigation
  // Don't attach listener when no selectable items - allows Enter to propagate to input handler
  React.useEffect(() => {
    if (!open || selectableItems.length === 0) return

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex(prev => (prev < selectableItems.length - 1 ? prev + 1 : 0))
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex(prev => (prev > 0 ? prev - 1 : selectableItems.length - 1))
          break
        case 'Enter':
        case 'Tab':
          e.preventDefault()
          if (selectableItems[selectedIndex]) {
            handleSelect(selectableItems[selectedIndex])
          }
          break
        case 'Escape':
          e.preventDefault()
          onOpenChange(false)
          break
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, selectableItems, selectedIndex, handleSelect, onOpenChange])

  // Close on click outside
  React.useEffect(() => {
    if (!open) return

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onOpenChange(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open, onOpenChange])

  // Hide if no results or not open
  if (!open || flatItems.length === 0) return null

  // Calculate bottom position from window height (menu appears above cursor)
  const bottomPosition = typeof window !== 'undefined'
    ? window.innerHeight - Math.round(position.y) + 8
    : 0
  const menuWidth = typeof window !== 'undefined'
    ? Math.min(420, Math.max(320, window.innerWidth - 24))
    : 420
  const leftPosition = typeof window !== 'undefined'
    ? Math.min(Math.max(12, Math.round(position.x) - 10), Math.max(12, window.innerWidth - menuWidth - 12))
    : Math.round(position.x) - 10

  // Track selectable item index across all sections for rendering selection state
  let selectableIndex = 0

  return (
    <div
      ref={menuRef}
      data-inline-menu
      role="menu"
      aria-label={t('commands.searchCommands')}
      className={cn('fixed z-dropdown', MENU_CONTAINER_STYLE, className)}
      style={{ left: leftPosition, bottom: bottomPosition, width: menuWidth }}
    >
      <div ref={listRef} className={MENU_LIST_STYLE}>
        {filteredSections.map((section, sectionIndex) => (
          <React.Fragment key={section.id}>
            {/* Section header */}
            <div role="presentation" className={MENU_SECTION_HEADER}>
              {section.label}
            </div>

            {/* Section items */}
            {section.items.map((item) => {
              const itemIsSelectable = isSelectableItem(item)
              const currentSelectableIndex = selectableIndex
              const isSelected = itemIsSelectable && currentSelectableIndex === selectedIndex

              if (itemIsSelectable) selectableIndex++

              if (isFolder(item)) {
                // Folder item - single line with path
                return (
                  <div
                    key={`${section.id}-${item.id}`}
                    role="menuitem"
                    tabIndex={-1}
                    data-selected={isSelected}
                    onClick={itemIsSelectable ? () => handleSelect(item) : undefined}
                    onMouseEnter={itemIsSelectable ? () => setSelectedIndex(currentSelectableIndex) : undefined}
                    className={cn(
                      MENU_ITEM_STYLE,
                      isSelected && MENU_ITEM_SELECTED
                    )}
                  >
                    <div className="mt-0.5 shrink-0 text-muted-foreground">
                      <Icon_Folder className={MENU_ICON_SIZE} strokeWidth={1.75} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium leading-5">{item.label}</div>
                      <div className="truncate text-[11px] leading-4 text-muted-foreground/80">{item.description}</div>
                    </div>
                  </div>
                )
              } else {
                // Command item
                const itemKey = slashCommandIdKey(item.id)
                const isActive = activeCommands.some(id => slashCommandIdKey(id) === itemKey)
                const isAdvisorToggle = isOmpCuratedCommandId(item.id) && item.id.kind === 'advisor'
                const isModeCommand = typeof item.id === 'string' && MODE_COMMAND_IDS.has(item.id)
                return (
                  <div
                    key={itemKey}
                    role={isAdvisorToggle ? 'menuitemcheckbox' : isModeCommand ? 'menuitemradio' : 'menuitem'}
                    tabIndex={-1}
                    aria-checked={isAdvisorToggle ? item.checked : isModeCommand ? isActive : undefined}
                    aria-disabled={item.disabled || undefined}
                    data-selected={isSelected}
                    data-disabled={item.disabled || undefined}
                    onClick={itemIsSelectable ? () => handleSelect(item) : undefined}
                    onMouseEnter={itemIsSelectable ? () => setSelectedIndex(currentSelectableIndex) : undefined}
                    className={cn(
                      MENU_ITEM_STYLE,
                      isSelected && MENU_ITEM_SELECTED,
                      item.disabled && 'cursor-default opacity-60'
                    )}
                  >
                    <CommandItemContent command={item} isActive={isActive} />
                  </div>
                )
              }
            })}

          </React.Fragment>
        ))}
      </div>
      {/* Always-visible footer hint for @ mentions */}
      <div className="mx-3 h-px bg-white/10" />
      <div className="select-none px-3 py-2.5 text-xs text-muted-foreground">
        {t('commands.useMentions', { defaultValue: 'Use @ for skills and files' })}
      </div>
    </div>
  )
}

// ============================================================================
// Hook for managing inline slash command state
// ============================================================================

export interface SlashCommandInputElement {
  getBoundingClientRect: () => DOMRect
  getCaretRect?: () => DOMRect | null
  value: string
  selectionStart: number
}

/**
 * Format path for display, shortening home directory
 */
function formatPathForDisplay(path: string, homeDir?: string): string {
  if (homeDir && path.startsWith(homeDir)) {
    return '~' + path.slice(homeDir.length)
  }
  return path
}

/**
 * Get folder name from path
 */
function getFolderName(path: string): string {
  return path.split('/').pop() || path
}

function humanizeSlashName(value: string): string {
  return value
    .replace(/^skill:/, '')
    .replace(/^agent:/, '')
    .replace(/[-_:]+/g, ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase())
}

function ompCommandSection(command: OmpAvailableCommandDto, t: TFunction): { id: string; label: string; meta: string; icon: React.ReactNode } {
  if (command.source === 'skill' || command.name.startsWith('skill:')) {
    return { id: 'omp-skills', label: t('commands.skills', { defaultValue: 'Skills' }), meta: t('commands.sourceSkill', { defaultValue: 'skill' }), icon: <Sparkles className={MENU_ICON_SIZE} /> }
  }
  if (command.source === 'mcp_prompt' || command.name === 'mcp' || command.name.startsWith('mcp:')) {
    return { id: 'omp-mcp', label: t('commands.mcp', { defaultValue: 'MCP' }), meta: command.source === 'mcp_prompt' ? t('commands.sourcePrompt', { defaultValue: 'prompt' }) : t('commands.sourceMcp', { defaultValue: 'mcp' }), icon: <ServerCog className={MENU_ICON_SIZE} /> }
  }
  if (command.name.includes('agent') || command.source === 'file') {
    return { id: 'omp-agents', label: t('commands.agents', { defaultValue: 'Agents' }), meta: command.source === 'file' ? t('commands.sourceFile', { defaultValue: 'file' }) : t('commands.sourceAgent', { defaultValue: 'agent' }), icon: <Bot className={MENU_ICON_SIZE} /> }
  }
  return {
    id: 'omp-commands',
    label: t('commands.ohMyPi', { defaultValue: 'Oh My Pi' }),
    meta: command.source === 'builtin' ? t('commands.sourceOmp', { defaultValue: 'omp' }) : command.source,
    icon: command.source === 'builtin' ? <Wrench className={MENU_ICON_SIZE} /> : <Sparkles className={MENU_ICON_SIZE} />,
  }
}

function formatOmpCommandLabel(commandName: string, subcommand?: string): string {
  if (commandName.startsWith('skill:')) return humanizeSlashName(commandName)
  if (subcommand) return `${humanizeSlashName(commandName)} ${humanizeSlashName(subcommand)}`
  return commandName.startsWith('/') ? commandName : `/${commandName}`
}

function formatOmpCommandMeta(source: OmpAvailableCommandSource, fallback: string, t: TFunction): string {
  if (source === 'mcp_prompt') return t('commands.sourceMcp', { defaultValue: 'mcp' })
  return fallback
}

export function filterAvailableOmpCommands(
  commands: OmpAvailableCommandDto[],
  unavailableCommands: OmpFeatureUnavailableCommandDto[],
  unavailableCommandsLoaded = true,
): OmpAvailableCommandDto[] {
  if (!unavailableCommandsLoaded) return []
  const hidden = new Set<string>()
  for (const command of unavailableCommands) {
    if (command.status === 'hidden' || command.status === 'needs-upstream-rpc') {
      hidden.add(normalizeOmpCommandName(command.command))
    }
  }
  return commands.filter(command => !hidden.has(normalizeOmpCommandName(command.name)))
}

function insertRuntimeOmpSections(
  baseSections: SlashSection[],
  runtimeSections: SlashSection[],
  includeRuntime: boolean,
): SlashSection[] {
  const visibleRuntimeSections = includeRuntime
    ? runtimeSections
    : runtimeSections.filter(section => section.id === 'omp-skills')
  if (visibleRuntimeSections.length === 0) return baseSections
  const result = [...baseSections]
  const folderIndex = result.findIndex(section => section.id === 'folders')
  result.splice(folderIndex === -1 ? result.length : folderIndex, 0, ...visibleRuntimeSections)
  return result
}

export function filterSlashSectionsForInput(
  baseSections: SlashSection[],
  runtimeSections: SlashSection[],
  filterText: string,
): SlashSection[] {
  return filterSections(
    insertRuntimeOmpSections(baseSections, runtimeSections, filterText.length > 0),
    filterText,
  )
}

function normalizeOmpCommandName(command: string): string {
  return command.trim().replace(/^\/+/, '').split(/\s+/, 1)[0]?.toLowerCase() ?? ''
}

export interface UseInlineSlashCommandOptions {
  /** Ref to input element (textarea or RichTextInput handle) */
  inputRef: React.RefObject<SlashCommandInputElement | null>
  onSelectCommand: (commandId: SlashCommandId) => void
  onSelectFolder: (path: string) => void
  activeCommands?: SlashCommandId[]
  ompCommands?: OmpAvailableCommandDto[]
  /** Skills already discovered by Craft's workspace skill loader. */
  skills?: LoadedSkill[]
  /** Runtime OMP commands that should not be executable in the menu. */
  ompUnavailableCommands?: OmpFeatureUnavailableCommandDto[]
  /** True when the current session uses the OMP backend. */
  isOmpSession?: boolean
  /** Lazy-loaded Feature Center state for OMP curated rows. */
  ompFeatureCenterState?: OmpFeatureCenterStateDto | null
  /** Number of synchronized models available on the active OMP connection. */
  ompModelCount?: number
  /** Native Plan capability negotiated with the active OMP RPC process. */
  ompPlanState?: OmpPlanControlStateDto
  recentFolders?: string[]
  homeDir?: string
}

export interface UseInlineSlashCommandReturn {
  isOpen: boolean
  filter: string
  position: { x: number; y: number }
  sections: SlashSection[]
  handleInputChange: (value: string, cursorPosition: number) => void
  close: () => void
  activeCommands: SlashCommandId[]
  handleSelectCommand: (commandId: SlashCommandId) => string
  handleSelectFolder: (path: string) => string
}

export function buildOmpCuratedSections(
  state: OmpFeatureCenterStateDto,
  t: TFunction,
  ompModelCount?: number,
  ompPlanState?: OmpPlanControlStateDto,
): SlashSection[] {
  // OMP starts lazily on the first action. Keep Plan actionable when this
  // desktop's bundled runtime advertises the RPC bridge, so the click itself
  // can start the process and complete capability negotiation.
  const planDisabled = !ompPlanState?.supported && !state.nativePlan.toggleAvailable
  const planEnabled = ompPlanState?.state.enabled === true
  const advisorEnabled = state.advisor.enabled.effectiveValue
  const advisorProjectOverridden = state.advisor.enabled.projectOverridden

  const controls: SlashCommand[] = [
    {
      id: { type: 'omp-curated', kind: 'plan' },
      label: t('omp.quickControls.planMode'),
      description: planDisabled
        ? t('omp.quickControls.planUnavailableDescription')
        : t('omp.quickControls.planToggleDescription'),
      icon: <ListChecks className={MENU_ICON_SIZE} />,
      meta: planDisabled ? t('omp.quickControls.rpcUnavailable') : t(planEnabled ? 'omp.quickControls.on' : 'omp.quickControls.off'),
      disabled: planDisabled,
      disabledReason: planDisabled ? t('omp.quickControls.rpcUnavailable') : undefined,
      checked: planEnabled,
    },
    {
      id: { type: 'omp-curated', kind: 'advisor' },
      label: t('omp.quickControls.advisor'),
      description: advisorProjectOverridden
        ? t('omp.quickControls.projectOverrideDescription')
        : t('omp.quickControls.advisorToggleDescription'),
      icon: <BrainCircuit className={MENU_ICON_SIZE} />,
      meta: advisorProjectOverridden
        ? t('omp.quickControls.projectOverride')
        : t(advisorEnabled ? 'omp.quickControls.on' : 'omp.quickControls.off'),
      disabled: advisorProjectOverridden,
      disabledReason: advisorProjectOverridden ? t('omp.quickControls.projectOverride') : undefined,
      checked: advisorEnabled,
    },
  ]

  const tools: SlashCommand[] = [
    {
      id: { type: 'omp-curated', kind: 'mcp' },
      label: t('omp.quickControls.mcp'),
      description: t('omp.quickControls.mcpDescription'),
      icon: <ServerCog className={MENU_ICON_SIZE} />,
      meta: state.mcp.error
        ? t('omp.quickControls.unavailable')
        : t('omp.quickControls.serverCount', { count: state.mcp.count }),
    },
    {
      id: { type: 'omp-curated', kind: 'skills' },
      label: t('omp.quickControls.skills'),
      description: t('omp.quickControls.skillsDescription'),
      icon: <Sparkles className={MENU_ICON_SIZE} />,
      meta: state.skills.error
        ? t('omp.quickControls.unavailable')
        : t('omp.quickControls.skillCount', { count: state.skills.count }),
    },
    {
      id: { type: 'omp-curated', kind: 'agents' },
      label: t('omp.quickControls.agents'),
      description: t('omp.quickControls.agentsDescription'),
      icon: <Bot className={MENU_ICON_SIZE} />,
      meta: state.agents.error
        ? t('omp.quickControls.unavailable')
        : t('omp.quickControls.agentCount', { count: state.agents.count }),
    },
    {
      id: { type: 'omp-curated', kind: 'models' },
      label: t('omp.quickControls.models'),
      description: t('omp.quickControls.modelsDescription'),
      icon: <Cpu className={MENU_ICON_SIZE} />,
      meta: ompModelCount === undefined
        ? t('omp.quickControls.unavailable')
        : t('omp.quickControls.modelCount', { count: ompModelCount }),
    },
  ]

  return [
    { id: 'omp-controls', label: t('omp.quickControls.controlsSection'), items: controls },
    { id: 'omp-tools', label: t('omp.quickControls.toolsSection'), items: tools },
  ]
}

export function useInlineSlashCommand({
  inputRef,
  onSelectCommand,
  onSelectFolder,
  activeCommands = [],
  ompCommands = [],
  skills = [],
  ompUnavailableCommands = [],
  isOmpSession = false,
  ompFeatureCenterState,
  ompModelCount,
  ompPlanState,
  recentFolders = [],
  homeDir,
}: UseInlineSlashCommandOptions): UseInlineSlashCommandReturn {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = React.useState(false)
  const [filter, setFilter] = React.useState('')
  const [position, setPosition] = React.useState({ x: 0, y: 0 })
  const [slashStart, setSlashStart] = React.useState(-1)
  // Store current input state for handleSelect
  const currentInputRef = React.useRef({ value: '', cursorPosition: 0 })

  const availableOmpCommands = React.useMemo(() => {
    const runtimeCommands = filterAvailableOmpCommands(
      ompCommands,
      ompUnavailableCommands,
      !isOmpSession || !!ompFeatureCenterState,
    )
    if (!isOmpSession) return runtimeCommands

    const known = new Set(runtimeCommands.map(command => command.name.toLowerCase()))
    const discoveredSkills: OmpAvailableCommandDto[] = [
      ...skills
        .filter(skill => skill.slug.trim())
        .map((skill): OmpAvailableCommandDto => ({
          name: `skill:${skill.slug}`,
          description: skill.metadata.description,
          source: 'skill',
        })),
      ...(ompFeatureCenterState?.skills.items ?? [])
        .filter(skill => skill.name.trim())
        .map((skill): OmpAvailableCommandDto => ({
          name: `skill:${skill.name}`,
          description: skill.description,
          source: 'skill',
        })),
    ]
      .filter(command => {
        const key = command.name.toLowerCase()
        if (known.has(key)) return false
        known.add(key)
        return true
      })

    return [...runtimeCommands, ...discoveredSkills]
  }, [isOmpSession, ompCommands, ompFeatureCenterState, ompUnavailableCommands, skills])

  const ompSlashCommands = React.useMemo((): SlashCommand[] => {
    return availableOmpCommands.flatMap((command) => {
      const section = ompCommandSection(command, t)
      const base: SlashCommand = {
        id: { type: 'omp', name: command.name },
        label: formatOmpCommandLabel(command.name),
        description: command.description || command.input?.hint || t('commands.ompCommand', { defaultValue: 'Oh My Pi command' }),
        icon: section.icon,
        shortcut: command.source,
        meta: formatOmpCommandMeta(command.source, section.meta, t),
      }
      const subcommands = command.subcommands?.map((subcommand): SlashCommand => ({
        id: { type: 'omp', name: command.name, subcommand: subcommand.name },
        label: formatOmpCommandLabel(command.name, subcommand.name),
        description: subcommand.description || subcommand.usage || command.description || t('commands.ompSubcommand', { defaultValue: 'Oh My Pi subcommand' }),
        icon: section.icon,
        shortcut: command.source,
        meta: formatOmpCommandMeta(command.source, section.meta, t),
      })) ?? []
      return [base, ...subcommands]
    })
  }, [availableOmpCommands, t])

  const ompSections = React.useMemo((): SlashSection[] => {
    const grouped = new Map<string, SlashSection>()
    for (const command of availableOmpCommands) {
      const section = ompCommandSection(command, t)
      if (!grouped.has(section.id)) {
        grouped.set(section.id, { id: section.id, label: section.label, items: [] })
      }
    }
    for (const item of ompSlashCommands) {
      const commandName = isOmpSlashCommandId(item.id) ? item.id.name : ''
      const source = availableOmpCommands.find(command => command.name === commandName)
      const section = source ? ompCommandSection(source, t) : { id: 'omp-commands', label: t('commands.ohMyPi', { defaultValue: 'Oh My Pi' }) }
      grouped.get(section.id)?.items.push(item)
    }
    return ['omp-commands', 'omp-skills', 'omp-mcp', 'omp-agents']
      .map(id => grouped.get(id))
      .filter((section): section is SlashSection => !!section && section.items.length > 0)
  }, [availableOmpCommands, ompSlashCommands, t])

  const ompCuratedSections = React.useMemo((): SlashSection[] => {
    if (!isOmpSession || !ompFeatureCenterState) return []
    return buildOmpCuratedSections(ompFeatureCenterState, t, ompModelCount, ompPlanState)
  }, [isOmpSession, ompFeatureCenterState, ompModelCount, ompPlanState, t])

  // Build sections from commands and folders
  const baseSections = React.useMemo((): SlashSection[] => {
    const result: SlashSection[] = []
    const localizedPermissionModeCommands = buildLocalizedPermissionModeCommands(t)
    const localizedCompactCommand = buildLocalizedCompactCommand(t)

    // Modes section
    result.push({
      id: 'modes',
      label: t('commands.modes', { defaultValue: 'Modes' }),
      items: localizedPermissionModeCommands,
    })

    // OMP Controls and Tools & Context
    if (ompCuratedSections.length > 0) {
      result.push(...ompCuratedSections)
    }

    // Commands section
    result.push({
      id: 'commands',
      label: t('commands.commands', { defaultValue: 'Commands' }),
      items: [localizedCompactCommand],
    })

    // Recent folders section - sorted alphabetically by folder name, show all
    if (recentFolders.length > 0) {
      const sortedFolders = [...recentFolders]
        .sort((a, b) => {
          const nameA = getFolderName(a).toLowerCase()
          const nameB = getFolderName(b).toLowerCase()
          return nameA.localeCompare(nameB)
        })

      result.push({
        id: 'folders',
        label: t('commands.recentWorkingDirectories', { defaultValue: 'Recent Working Directories' }),
        items: sortedFolders.map(path => ({
          id: path,
          type: 'folder' as const,
          label: getFolderName(path),
          description: formatPathForDisplay(path, homeDir),
          path,
        })),
      })
    }

    return result
  }, [ompCuratedSections, recentFolders, homeDir, t])

  const sections = React.useMemo(
    () => insertRuntimeOmpSections(baseSections, ompSections, filter.length > 0),
    [baseSections, filter, ompSections],
  )

  const handleInputChange = React.useCallback((value: string, cursorPosition: number) => {
    // Store current state for handleSelect
    currentInputRef.current = { value, cursorPosition }

    const textBeforeCursor = value.slice(0, cursorPosition)
    const slashMatch = textBeforeCursor.match(/(?:^|\s)\/([\w-]*)$/)

    if (slashMatch) {
      const filterText = slashMatch[1] || ''
      // Check if there are any filtered results before opening menu
      // This ensures Enter key works normally when no matches exist
      const filteredSections = filterSlashSectionsForInput(baseSections, ompSections, filterText)
      const hasFilteredItems = filteredSections.some(s => s.items.length > 0)

      if (!hasFilteredItems) {
        // No results after filtering - close menu to allow normal Enter handling
        setIsOpen(false)
        setFilter('')
        setSlashStart(-1)
        return
      }

      const matchStart = textBeforeCursor.lastIndexOf('/')
      setSlashStart(matchStart)
      setFilter(filterText)

      if (inputRef.current) {
        // Try to get actual caret position from the input element
        const caretRect = inputRef.current.getCaretRect?.()

        if (caretRect && caretRect.x > 0) {
          // Use actual caret position
          setPosition({
            x: caretRect.x,
            y: caretRect.y,
          })
        } else {
          // Fallback: position at input element's left edge
          const rect = inputRef.current.getBoundingClientRect()
          const lineHeight = 20
          const linesBeforeCursor = textBeforeCursor.split('\n').length - 1
          setPosition({
            x: rect.left,
            y: rect.top + (linesBeforeCursor + 1) * lineHeight,
          })
        }
      }

      setIsOpen(true)
    } else {
      setIsOpen(false)
      setFilter('')
      setSlashStart(-1)
    }
  }, [baseSections, inputRef, ompSections])

  const handleSelectCommand = React.useCallback((commandId: SlashCommandId): string => {
    // Capture values BEFORE any state changes to avoid race conditions
    let result = ''
    if (slashStart >= 0) {
      const { value: currentValue, cursorPosition } = currentInputRef.current
      const before = currentValue.slice(0, slashStart)
      const after = currentValue.slice(cursorPosition)
      if (isOmpSlashCommandId(commandId)) {
        const inserted = `/${commandId.name}${commandId.subcommand ? ` ${commandId.subcommand}` : ''} `
        result = before + inserted + after.trimStart()
      } else {
        result = (before + after).trim()
      }
    }

    // Now safe to trigger state changes
    onSelectCommand(commandId)
    setIsOpen(false)

    return result
  }, [onSelectCommand, slashStart])

  const handleSelectFolder = React.useCallback((path: string): string => {
    // Capture values BEFORE any state changes to avoid race conditions
    // Folder selection directly changes working directory, doesn't insert text
    let result = ''
    if (slashStart >= 0) {
      const { value: currentValue, cursorPosition } = currentInputRef.current
      const before = currentValue.slice(0, slashStart)
      const after = currentValue.slice(cursorPosition)
      // Just remove the /command text, no badge insertion
      result = (before + after).trim()
    }

    // Trigger working directory change
    onSelectFolder(path)
    setIsOpen(false)

    return result
  }, [onSelectFolder, slashStart])

  const close = React.useCallback(() => {
    setIsOpen(false)
    setFilter('')
    setSlashStart(-1)
  }, [])

  return {
    isOpen,
    filter,
    position,
    sections,
    handleInputChange,
    close,
    activeCommands,
    handleSelectCommand,
    handleSelectFolder,
  }
}
