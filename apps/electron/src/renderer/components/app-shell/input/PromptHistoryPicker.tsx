import * as React from 'react'
import { Command as CommandPrimitive } from 'cmdk'
import { History, X, Trash2, Search } from 'lucide-react'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { useOmpCapabilities } from '@/hooks/useOmpCapabilities'
import { useOmpSessionCommand } from '@/hooks/useOmpSessionCommand'
import {
  getPromptHistory,
  setPromptHistoryData,
  addPrompt,
  removePrompt,
  clearPromptHistory,
  type PromptHistoryData,
} from './prompt-history'

interface PromptHistoryPickerProps {
  /** Session ID for capability gating */
  sessionId?: string
  /** Workspace ID for scoped storage */
  workspaceId?: string
  /** Called when user selects a prompt to fill into the input */
  onSelect: (prompt: string) => void
  /** Called when the picker should be dismissed */
  onClose: () => void
  /** Whether the picker is currently open */
  open: boolean
  /** The current input value (to add to history when writing) */
  currentInput?: string
}

/**
 * PromptHistoryPicker - Ctrl+R searchable prompt history overlay.
 *
 * Shows the most recent prompts, filterable by typing.
 * Gated by the `prompt.history` OMP capability when `sessionId` is provided.
 *
 * - Supports keyboard navigation (up/down arrows, Enter to select, Escape to close)
 * - Allows clearing history or removing individual entries
 * - Workspace-scoped storage when workspaceId provided
 */
export function PromptHistoryPicker({
  sessionId,
  workspaceId,
  onSelect,
  onClose,
  open,
  currentInput,
}: PromptHistoryPickerProps) {
  // Always read from local storage directly for instant display
  const [data, setData] = React.useState<PromptHistoryData>(() =>
    getPromptHistory(workspaceId),
  )

  // Refresh data when opening
  React.useEffect(() => {
    if (open) {
      setData(getPromptHistory(workspaceId))
    }
  }, [open, workspaceId])

  // Also attempt server-side read if session-aware
  const { execute } = useOmpSessionCommand(sessionId)
  React.useEffect(() => {
    if (open && sessionId) {
      execute({ type: 'getPromptHistory' }).then(() => {
        // Server-side confirmation; local state already loaded
      }).catch(() => {
        // Fallback to local state — it's already loaded
      })
    }
  }, [open, sessionId, execute])

  const handleSelect = React.useCallback(
    (prompt: string) => {
      onSelect(prompt)
      onClose()
    },
    [onSelect, onClose],
  )

  const handleRemove = React.useCallback(
    (e: React.MouseEvent, prompt: string) => {
      e.stopPropagation()
      const updated = removePrompt(prompt, workspaceId)
      setData(prev => ({ ...prev, prompts: updated }))
    },
    [workspaceId],
  )

  const handleClearAll = React.useCallback(() => {
    clearPromptHistory(workspaceId)
    setData({ prompts: [], enabled: true })
  }, [workspaceId])

  const historyEnabled = data.enabled && data.prompts.length > 0

  return (
    <CommandDialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose() }}>
      <div className="flex items-center gap-2 pr-2">
        <CommandInput
          placeholder="Search prompt history…"
          className="flex-1"
          autoFocus
        />
      </div>
      <CommandList>
        {(!historyEnabled) ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            {data.enabled
              ? 'No prompt history yet. Send a message to start building history.'
              : 'Prompt history is disabled.'}
          </div>
        ) : (
          <>
            <CommandEmpty>No prompts found.</CommandEmpty>
            <CommandGroup heading="Recent prompts">
              {data.prompts.map((prompt, index) => (
                <CommandItem
                  key={`${prompt}-${index}`}
                  value={prompt}
                  onSelect={() => handleSelect(prompt)}
                  className="group flex items-center gap-2"
                >
                  <History className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate">{prompt}</span>
                  <button
                    type="button"
                    onClick={(e) => handleRemove(e, prompt)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-accent"
                    aria-label={`Remove "${prompt}" from history`}
                  >
                    <X className="h-3 w-3 text-muted-foreground" />
                  </button>
                </CommandItem>
              ))}
            </CommandGroup>
            {data.prompts.length > 0 && (
              <div className="border-t border-border/50 px-2 py-1.5">
                <button
                  type="button"
                  onClick={handleClearAll}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive transition-colors px-2 py-1 rounded"
                >
                  <Trash2 className="h-3 w-3" />
                  Clear all history
                </button>
              </div>
            )}
          </>
        )}
      </CommandList>
    </CommandDialog>
  )
}

/**
 * Hook to manage prompt history state and keyboard shortcut.
 * Wraps the PromptHistoryPicker open/close + records new prompts on submit.
 *
 * @param sessionId - session for capability gating
 * @param workspaceId - workspace for scoped storage
 */
export function usePromptHistory(sessionId?: string, workspaceId?: string) {
  const [isOpen, setIsOpen] = React.useState(false)
  const capabilities = useOmpCapabilities(sessionId)

  const isSupported = React.useMemo(() => {
    if (!sessionId) return false
    return capabilities.isFeatureSupported('prompt.history')
  }, [capabilities, sessionId])

  const open = React.useCallback(() => {
    if (isSupported) setIsOpen(true)
  }, [isSupported])

  const close = React.useCallback(() => {
    setIsOpen(false)
  }, [])

  const recordPrompt = React.useCallback(
    (prompt: string) => {
      if (!isSupported) return
      addPrompt(prompt, workspaceId)
    },
    [isSupported, workspaceId],
  )

  return {
    isOpen,
    isSupported,
    open,
    close,
    recordPrompt,
  }
}
