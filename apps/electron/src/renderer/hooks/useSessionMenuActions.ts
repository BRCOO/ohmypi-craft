/**
 * useSessionMenuActions
 *
 * Single source of truth for session-menu side effects (share / refresh title /
 * copy path / show in finder / open in new panel / share-submenu actions / label
 * toggle). Consumed by both `SessionMenu` (desktop dropdown / context menu) and
 * `CompactSessionMenu` (compact-mode drawer) so a new session action only has
 * to be wired through one place.
 *
 * Also owns **optimistic label state**: the parent's labels-changed pipeline
 * (`onLabelsChange` → IPC → server → `labels_changed` event → atom → re-render)
 * is asynchronous, so a fast second tap that derived from the prop's stale
 * `item.labels` would compute against an out-of-date snapshot and could
 * overwrite the first tap's update. The hook keeps a local optimistic copy
 * mirrored in a `useRef` so toggles read the latest value synchronously
 * (without going through React's update queue, which would be impure under
 * Strict Mode and could double-fire `onLabelsChange`). Prop sync only runs
 * when the server has acknowledged our latest local change (tracked via
 * `lastSentKeyRef`) — avoids a brief checkmark-flash without needing a full
 * request-tracking layer. State is hard-reset when `item.id` changes so
 * pending optimistic state from a previous session can't leak into a new one.
 *
 * Pure label-mutation logic lives in `@craft-agent/shared/labels`
 * (`toggleLabelInList`) and is unit-tested there.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { navigate, routes } from '@/lib/navigate'
import { extractLabelId, toggleLabelInList } from '@craft-agent/shared/labels'
import { dispatchFocusInputEvent } from '@/components/app-shell/input/focus-input-events'
import { useAppShellContext } from '@/context/AppShellContext'
import type { SessionMeta } from '@/atoms/sessions'
import type {
  OmpBranchOption,
  OmpBranchOptionsResult,
  OmpBranchSessionResult,
  OmpExportHtmlResult,
  OmpHandoffSessionResult,
  OmpSessionTreeResult,
  OmpSessionForkResult,
} from '../../shared/types'
import type { OmpSessionTreeState } from '@craft-agent/shared/protocol'

export interface UseSessionMenuActionsOptions {
  item: SessionMeta
  onLabelsChange?: (labels: string[]) => void
}


export interface OmpSessionTreeDialogState {
  open: boolean
  tree: OmpSessionTreeState | null
  loading: boolean
  error: string | null
}
export interface OmpBranchDialogState {
  open: boolean
  options: OmpBranchOption[]
}

export interface SessionMenuActions {
  /** Set of base label IDs currently applied (optimistic). */
  appliedLabelIds: Set<string>
  /** Toggle a label (add if absent, remove all entries with this base ID if present). */
  toggleLabel: (labelId: string) => void
  share: () => Promise<void>
  showInFinder: () => void
  copyPath: () => Promise<void>
  refreshTitle: () => Promise<void>
  openInNewPanel: () => void
  /** Open the session's published share URL in the system browser (no-op if not shared). */
  openSharedInBrowser: () => void
  /** Copy the session's published share URL to the clipboard (no-op if not shared). */
  copySharedLink: () => Promise<void>
  /** Re-publish the share to bump the snapshot. */
  updateShare: () => Promise<void>
  /** Revoke the share. */
  revokeShare: () => Promise<void>
  branchOmpSession: () => Promise<void>
  handoffOmpSession: () => Promise<void>
  exportOmpSessionHtml: () => Promise<void>
  /** State and controls for the OMP branch point selection dialog. */
  ompBranchDialog: OmpBranchDialogState
  closeOmpBranchDialog: () => void
  selectOmpBranchOption: (option: OmpBranchOption) => Promise<void>
  /** State and controls for the OMP session tree navigator dialog. */
  sessionTreeDialog: OmpSessionTreeDialogState
  openSessionTreeDialog: () => Promise<void>
  closeSessionTreeDialog: () => void
  /** Switch to a different OMP session in the session tree. */
  switchOmpSession: (ompSessionPath: string) => Promise<void>
  /** Fork the current OMP session at a given entry point. */
  forkOmpSession: () => Promise<void>
}
const LABEL_KEY_SEPARATOR = String.fromCharCode(1)

function joinLabelKey(labels: readonly string[] | undefined): string {
  return (labels ?? []).join(LABEL_KEY_SEPARATOR)
}

export function useSessionMenuActions({
  item,
  onLabelsChange,
}: UseSessionMenuActionsOptions): SessionMenuActions {
  const { t } = useTranslation()
  const { onOpenFile } = useAppShellContext()
  const sessionId = item.id
  const sharedUrl = item.sharedUrl
  const propLabels = item.labels
  const isOmpSession = item.ompSessionLink?.provider === 'omp'

  const [optimisticLabels, setOptimisticLabels] = React.useState<string[]>(() => propLabels ?? [])
  const optimisticLabelsRef = React.useRef<string[]>(propLabels ?? [])
  const lastSentKeyRef = React.useRef<string | null>(null)
  const propKey = joinLabelKey(propLabels)
  const [ompBranchDialog, setOmpBranchDialog] = React.useState<OmpBranchDialogState>({
    open: false,
    options: [],
  })

  const [sessionTreeDialog, setSessionTreeDialog] = React.useState<OmpSessionTreeDialogState>({
    open: false,
    tree: null,
    loading: false,
    error: null,
  })


  // Hard-reset on session change so optimistic state from a previous session
  // cannot leak into a new one (e.g. user toggles `bug` on session A, navigates
  // to B before the IPC ACK — without this reset, lastSentKeyRef would block
  // the prop sync and B would briefly render A's labels).
  React.useEffect(() => {
    const next = propLabels ?? []
    optimisticLabelsRef.current = next
    lastSentKeyRef.current = null
    setOptimisticLabels(next)
    setOmpBranchDialog({ open: false, options: [] })
    setSessionTreeDialog({ open: false, tree: null, loading: false, error: null })
    // Intentionally only depending on sessionId — propLabels changes within
    // the same session are handled by the prop-sync effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  React.useEffect(() => {
    // Sync from prop only when the server has caught up to (or surpassed)
    // our last sent value — otherwise an in-flight prop update would briefly
    // erase a queued local toggle. lastSentKeyRef === null means we have
    // no pending local changes, so the prop is authoritative.
    if (lastSentKeyRef.current === null || lastSentKeyRef.current === propKey) {
      const next = propLabels ?? []
      optimisticLabelsRef.current = next
      setOptimisticLabels(next)
      lastSentKeyRef.current = null
    }
  }, [propKey, propLabels])

  const appliedLabelIds = React.useMemo(
    () => new Set(optimisticLabels.map(extractLabelId)),
    [optimisticLabels],
  )

  const toggleLabel = React.useCallback((labelId: string) => {
    if (!onLabelsChange) return
    // Read the canonical latest value from the ref, mutate refs, fire the
    // callback, and only THEN call setState. All side effects happen outside
    // any state-updater callback so they fire exactly once per user tap
    // even under Strict Mode's double-render checks.
    const next = toggleLabelInList(optimisticLabelsRef.current, labelId)
    optimisticLabelsRef.current = next
    lastSentKeyRef.current = joinLabelKey(next)
    setOptimisticLabels(next)
    onLabelsChange(next)
  }, [onLabelsChange])

  const share = React.useCallback(async () => {
    const result = await window.electronAPI.sessionCommand(sessionId, { type: 'shareToViewer' }) as { success: boolean; url?: string; error?: string } | undefined
    if (result?.success && result.url) {
      await navigator.clipboard.writeText(result.url)
      toast.success(t('toast.linkCopied'), {
        description: result.url,
        action: {
          label: t('common.open'),
          onClick: () => window.electronAPI.openUrl(result.url!),
        },
      })
    } else {
      toast.error(t('toast.failedToShare'), { description: result?.error || t('toast.unknownError') })
    }
  }, [sessionId, t])

  const showInFinder = React.useCallback(() => {
    window.electronAPI.sessionCommand(sessionId, { type: 'showInFinder' })
  }, [sessionId])

  const copyPath = React.useCallback(async () => {
    const result = await window.electronAPI.sessionCommand(sessionId, { type: 'copyPath' }) as { success: boolean; path?: string } | undefined
    if (result?.success && result.path) {
      await navigator.clipboard.writeText(result.path)
      toast.success(t('toast.pathCopied'))
    }
  }, [sessionId, t])

  const refreshTitle = React.useCallback(async () => {
    const result = await window.electronAPI.sessionCommand(sessionId, { type: 'refreshTitle' }) as { success: boolean; title?: string; error?: string } | undefined
    if (result?.success) {
      toast.success(t('toast.titleRefreshed'), { description: result.title })
    } else {
      toast.error(t('toast.failedToRefreshTitle'), { description: result?.error || t('toast.unknownError') })
    }
  }, [sessionId, t])

  const openInNewPanel = React.useCallback(() => {
    navigate(routes.view.allSessions(sessionId), { newPanel: true })
  }, [sessionId])

  const openSharedInBrowser = React.useCallback(() => {
    if (!sharedUrl) return
    window.electronAPI.openUrl(sharedUrl)
  }, [sharedUrl])

  const copySharedLink = React.useCallback(async () => {
    if (!sharedUrl) return
    await navigator.clipboard.writeText(sharedUrl)
    toast.success(t('toast.linkCopied'))
  }, [sharedUrl, t])

  const updateShare = React.useCallback(async () => {
    const result = await window.electronAPI.sessionCommand(sessionId, { type: 'updateShare' })
    if (result && 'success' in result && result.success) {
      toast.success(t('chat.shareUpdated'))
    } else {
      const errorMsg = result && 'error' in result ? result.error : undefined
      toast.error(t('chat.failedToUpdateShare'), { description: errorMsg })
    }
  }, [sessionId, t])

  const revokeShare = React.useCallback(async () => {
    const result = await window.electronAPI.sessionCommand(sessionId, { type: 'revokeShare' })
    if (result && 'success' in result && result.success) {
      toast.success(t('chat.sharingStopped'))
    } else {
      const errorMsg = result && 'error' in result ? result.error : undefined
      toast.error(t('chat.failedToStopSharing'), { description: errorMsg })
    }
  }, [sessionId, t])

  const closeOmpBranchDialog = React.useCallback(() => {
    setOmpBranchDialog((prev) => ({ ...prev, open: false }))
  }, [])

  const selectOmpBranchOption = React.useCallback(async (selected: OmpBranchOption) => {
    closeOmpBranchDialog()
    const result = await window.electronAPI.sessionCommand(sessionId, {
      type: 'branchOmpSession',
      entryId: selected.entryId,
      craftMessageId: selected.craftMessageId,
    }) as OmpBranchSessionResult | undefined

    if (result?.success && result.cancelled) {
      toast.info(t('sessionMenu.ompBranchCancelled'))
      return
    }

    if (result?.success) {
      const text = result.selectedText ?? ''
      if (text) {
        window.dispatchEvent(new CustomEvent('craft:restore-input', {
          detail: { sessionId, text },
        }))
        dispatchFocusInputEvent({ sessionId })
      }
      toast.success(t('sessionMenu.ompBranchCreated'))
    } else {
      toast.error(t('sessionMenu.ompBranchFailed'), {
        description: result?.error ?? t('toast.unknownError'),
      })
    }
  }, [closeOmpBranchDialog, sessionId, t])

  const forkOmpSession = React.useCallback(async () => {
    if (!isOmpSession) {
      toast.error(t('sessionMenu.ompUnavailable'))
      return
    }

    // Open the tree dialog first so the user can choose where to fork from
    const treeResult = await window.electronAPI.sessionCommand(sessionId, {
      type: 'getSessionTree',
    }) as OmpSessionTreeResult | undefined

    if (!treeResult?.success || !treeResult.tree) {
      toast.error(t('sessionMenu.ompForkFailed', { defaultValue: 'Failed to retrieve session tree' }))
      return
    }

    setSessionTreeDialog({
      open: true,
      tree: treeResult.tree,
      loading: false,
      error: null,
    })
  }, [isOmpSession, sessionId, t])

  const openSessionTreeDialog = React.useCallback(async () => {
    if (!isOmpSession) {
      toast.error(t('sessionMenu.ompUnavailable'))
      return
    }

    setSessionTreeDialog((prev) => ({ ...prev, loading: true, error: null }))

    const result = await window.electronAPI.sessionCommand(sessionId, {
      type: 'getSessionTree',
    }) as OmpSessionTreeResult | undefined

    if (result?.success && result.tree) {
      setSessionTreeDialog({
        open: true,
        tree: result.tree,
        loading: false,
        error: null,
      })
    } else {
      setSessionTreeDialog({
        open: true,
        tree: null,
        loading: false,
        error: result?.error ? String(result.error) : t('sessionMenu.ompTreeLoadFailed', { defaultValue: 'Failed to load session tree' }),
      })
    }
  }, [isOmpSession, sessionId, t])

  const closeSessionTreeDialog = React.useCallback(() => {
    setSessionTreeDialog((prev) => ({ ...prev, open: false }))
  }, [])

  const switchOmpSession = React.useCallback(async (ompSessionPath: string) => {
    if (!isOmpSession) return

    const result = await window.electronAPI.sessionCommand(sessionId, {
      type: 'switchSession',
      ompSessionPath,
    }) as { success: boolean; craftSessionId?: string; error?: string } | undefined

    if (result?.success) {
      closeSessionTreeDialog()
      if (result.craftSessionId) {
        navigate(routes.view.allSessions(result.craftSessionId))
      }
      toast.success(t('sessionMenu.ompSwitchComplete', { defaultValue: 'Switched to session' }))
    } else {
      toast.error(t('sessionMenu.ompSwitchFailed', { defaultValue: 'Failed to switch session' }), {
        description: result?.error ?? t('toast.unknownError'),
      })
    }
  }, [isOmpSession, sessionId, t, closeSessionTreeDialog])

  const branchOmpSession = React.useCallback(async () => {
    if (!isOmpSession) {
      toast.error(t('sessionMenu.ompUnavailable'))
      return
    }

    const optionsResult = await window.electronAPI.sessionCommand(sessionId, {
      type: 'getOmpBranchOptions',
    }) as OmpBranchOptionsResult | undefined

    if (!optionsResult?.success) {
      toast.error(t('sessionMenu.ompBranchFailed'), {
        description: optionsResult?.error ?? t('toast.unknownError'),
      })
      return
    }

    const options = optionsResult.options ?? []
    if (options.length === 0) {
      toast.info(t('sessionMenu.ompNoBranchPoints'))
      return
    }

    setOmpBranchDialog({ open: true, options })
  }, [isOmpSession, sessionId, t])

  const handoffOmpSession = React.useCallback(async () => {
    if (!isOmpSession) {
      toast.error(t('sessionMenu.ompUnavailable'))
      return
    }

    const customInstructions = window.prompt(t('sessionMenu.ompHandoffPrompt'), '') ?? null
    if (customInstructions === null) return

    const result = await window.electronAPI.sessionCommand(sessionId, {
      type: 'handoffOmpSession',
      customInstructions,
    }) as OmpHandoffSessionResult | undefined

    if (result?.success && result.cancelled) {
      toast.info(t('sessionMenu.ompHandoffCancelled'))
      return
    }

    if (result?.success) {
      toast.success(t('sessionMenu.ompHandoffComplete'), {
        description: result.savedPath,
        action: result.savedPath ? {
          label: t('common.open'),
          onClick: () => onOpenFile(result.savedPath!),
        } : undefined,
      })
    } else {
      toast.error(t('sessionMenu.ompHandoffFailed'), {
        description: result?.error ?? t('toast.unknownError'),
      })
    }
  }, [isOmpSession, sessionId, t])

  const exportOmpSessionHtml = React.useCallback(async () => {
    if (!isOmpSession) {
      toast.error(t('sessionMenu.ompUnavailable'))
      return
    }

    const result = await window.electronAPI.sessionCommand(sessionId, {
      type: 'exportOmpSessionHtml',
    }) as OmpExportHtmlResult | undefined

    if (result?.success && result.outputPath) {
      toast.success(t('sessionMenu.ompExportComplete'), {
        description: result.outputPath,
        action: {
          label: t('common.open'),
          onClick: () => onOpenFile(result.outputPath!),
        },
      })
    } else {
      toast.error(t('sessionMenu.ompExportFailed'), {
        description: result?.error ?? t('toast.unknownError'),
      })
    }
  }, [isOmpSession, sessionId, t])

  return {
    appliedLabelIds,
    toggleLabel,
    share,
    showInFinder,
    copyPath,
    refreshTitle,
    openInNewPanel,
    openSharedInBrowser,
    copySharedLink,
    updateShare,
    revokeShare,
    branchOmpSession,
    forkOmpSession,
    handoffOmpSession,
    exportOmpSessionHtml,
    ompBranchDialog,
    closeOmpBranchDialog,
    selectOmpBranchOption,
    sessionTreeDialog,
    openSessionTreeDialog,
    closeSessionTreeDialog,
    switchOmpSession,
  }
}
