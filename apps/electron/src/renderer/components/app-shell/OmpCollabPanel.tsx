/**
 * OmpCollabPanel — collab session controls for the session header.
 *
 * Gated by the `collab.live` capability. Provides:
 * - A status button in the header (connected, disconnected, etc.)
 * - A popover with start/join/leave/stop actions
 * - Participant list
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  Users,
  UserPlus,
  UserMinus,
  LogIn,
  LogOut,
  Link,
  Copy,
  Shield,
  Globe,
  Loader2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { PanelHeaderCenterButton } from '@/components/ui/PanelHeaderCenterButton'
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useOmpCapabilities } from '@/hooks/useOmpCapabilities'
import { useOmpCollabState } from '@/hooks/useOmpCollabState'
import type { OmpCollabParticipant } from '@craft-agent/shared/protocol'

interface OmpCollabPanelProps {
  sessionId: string
}

/**
 * Collab status button with popover controls.
 * Only rendered when `collab.live` capability is supported.
 */
export function OmpCollabPanel({ sessionId }: OmpCollabPanelProps) {
  const { t } = useTranslation()
  const { isFeatureSupported } = useOmpCapabilities(sessionId)
  const collab = useOmpCollabState(sessionId)

  const [open, setOpen] = React.useState(false)
  const [inviteInput, setInviteInput] = React.useState('')
  const [joinMode, setJoinMode] = React.useState<'invite' | null>(null)

  const isSupported = isFeatureSupported('collab.live')

  if (!isSupported) {
    return null
  }

  const state = collab.collabState
  const isConnected = state?.connection === 'connected'
  const isConnecting = state?.connection === 'connecting' || state?.connection === 'reconnecting'
  const isOff = !state || state?.connection === 'off'

  const handleCopyInvite = () => {
    const url = state?.inviteUrl ?? state?.webUrl
    if (url) {
      navigator.clipboard.writeText(url)
        .then(() => toast.success(t('omp.collab.inviteCopied', { defaultValue: 'Invite link copied' })))
        .catch(() => toast.error(t('common.copyFailed', { defaultValue: 'Failed to copy' })))
    }
  }

  const handleStartCollab = () => {
    void collab.startCollab()
  }

  const handleJoinSubmit = () => {
    if (inviteInput.trim()) {
      void collab.joinCollab(inviteInput.trim())
      setJoinMode(null)
      setInviteInput('')
    }
  }

  const handleLeave = () => {
    void collab.leaveCollab()
    setOpen(false)
  }

  const handleStopCollab = () => {
    void collab.stopCollab()
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <PanelHeaderCenterButton
          aria-label={t('omp.collab.controls', { defaultValue: 'Collab session controls' })}
          icon={
            isConnecting ? (
              <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
            ) : isConnected ? (
              <Users className="h-4 w-4 text-emerald-400" />
            ) : (
              <Users className="h-4 w-4 text-muted-foreground" />
            )
          }
        />
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-72 p-0">
        <div className="flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border/50 px-3 py-2">
            <span className="text-sm font-medium">
              {isConnected
                ? t('omp.collab.connected', { defaultValue: 'Collab' })
                : isConnecting
                  ? t('omp.collab.connecting', { defaultValue: 'Connecting…' })
                  : t('omp.collab.disconnected', { defaultValue: 'Collab' })}
            </span>
            {isConnected && state?.participants && (
              <span className="text-xs text-muted-foreground tabular-nums">
                {state.participants.length} {t('omp.collab.participant', { defaultValue: 'participant', count: state.participants.length })}
              </span>
            )}
          </div>

          {/* Content */}
          <div className="p-3 space-y-3">
            {collab.error && (
              <div className="rounded bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
                {collab.error}
              </div>
            )}

            {state?.error && (
              <div className="rounded bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
                {state.error}
              </div>
            )}

            {/* Disconnected state — show start/join */}
            {isOff && !joinMode && (
              <div className="flex flex-col gap-2">
                <Button
                  size="sm"
                  variant="default"
                  className="w-full justify-start gap-2"
                  onClick={handleStartCollab}
                  disabled={collab.loading}
                >
                  {collab.loading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Globe className="h-3.5 w-3.5" />
                  )}
                  {t('omp.collab.startSession', { defaultValue: 'Start collab session' })}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="w-full justify-start gap-2"
                  onClick={() => setJoinMode('invite')}
                >
                  <LogIn className="h-3.5 w-3.5" />
                  {t('omp.collab.joinSession', { defaultValue: 'Join session' })}
                </Button>
              </div>
            )}

            {/* Join via invite */}
            {joinMode === 'invite' && (
              <div className="flex flex-col gap-2">
                <label className="text-xs text-muted-foreground">
                  {t('omp.collab.enterInvite', { defaultValue: 'Enter invite URL or code' })}
                </label>
                <div className="flex gap-1">
                  <Input
                    size={1}
                    value={inviteInput}
                    onChange={e => setInviteInput(e.target.value)}
                    placeholder="https://ohmypi.com/collab/…"
                    className="h-7 text-xs"
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleJoinSubmit()
                    }}
                  />
                  <Button size="sm" variant="default" className="h-7 shrink-0" onClick={handleJoinSubmit} disabled={!inviteInput.trim() || collab.loading}>
                    {t('common.join', { defaultValue: 'Join' })}
                  </Button>
                </div>
                <Button size="sm" variant="ghost" className="h-6 text-xs justify-start" onClick={() => { setJoinMode(null); setInviteInput('') }}>
                  <X className="h-3 w-3 mr-1" />
                  {t('common.cancel', { defaultValue: 'Cancel' })}
                </Button>
              </div>
            )}

            {/* Connected state — show participants and actions */}
            {isConnected && (
              <>
                {/* Participants */}
                <div className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">
                    {t('omp.collab.participants', { defaultValue: 'Participants' })}
                  </span>
                  {state?.participants && state.participants.length > 0 ? (
                    <div className="space-y-1">
                      {state.participants.map(p => (
                        <ParticipantRow key={p.id} participant={p} isSelf={p.id === state?.role} />
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground/60">
                      {t('omp.collab.noParticipants', { defaultValue: 'No other participants' })}
                    </p>
                  )}
                </div>

                {/* Invite link */}
                {(state?.inviteUrl || state?.webUrl) && (
                  <div className="flex items-center gap-2 rounded border border-border/50 px-2 py-1.5">
                    <Link className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      {state?.inviteUrl ?? state?.webUrl}
                    </span>
                    <button
                      type="button"
                      onClick={handleCopyInvite}
                      className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
                      aria-label={t('common.copy', { defaultValue: 'Copy' })}
                    >
                      <Copy className="h-3 w-3" />
                    </button>
                  </div>
                )}

                {/* Actions */}
                <div className="flex flex-col gap-1 pt-1 border-t border-border/50">
                  {state?.role === 'host' && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full justify-start gap-2 text-xs h-7"
                        onClick={() => void collab.startCollab(true)}
                      >
                        <Shield className="h-3 w-3" />
                        {t('omp.collab.toggleReadonly', { defaultValue: 'Toggle read-only' })}
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="w-full justify-start gap-2 text-xs h-7"
                        onClick={handleStopCollab}
                        disabled={collab.loading}
                      >
                        <X className="h-3 w-3" />
                        {t('omp.collab.stopSession', { defaultValue: 'Stop session' })}
                      </Button>
                    </>
                  )}
                  {(state?.role === 'guest' || state?.role === 'readonly') && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full justify-start gap-2 text-xs h-7"
                      onClick={handleLeave}
                      disabled={collab.loading}
                    >
                      <LogOut className="h-3 w-3" />
                      {t('omp.collab.leaveSession', { defaultValue: 'Leave session' })}
                    </Button>
                  )}
                </div>
              </>
            )}

            {/* Connecting state */}
            {isConnecting && (
              <div className="flex items-center justify-center gap-2 py-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  {t('omp.collab.establishing', { defaultValue: 'Establishing connection…' })}
                </span>
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** Single participant row with role badge. */
function ParticipantRow({ participant, isSelf }: { participant: OmpCollabParticipant; isSelf: boolean }) {
  const { t } = useTranslation()
  const roleColor =
    participant.role === 'host'
      ? 'text-amber-500'
      : participant.role === 'readonly'
        ? 'text-sky-500'
        : 'text-emerald-500'

  return (
    <div className="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-accent/30">
      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-accent/30">
        <UserPlus className="h-3 w-3 text-muted-foreground" />
      </div>
      <span className="flex-1 truncate">
        {participant.displayName ?? participant.id.slice(0, 8)}
        {isSelf && (
          <span className="ml-1 text-muted-foreground/60">
            ({t('common.you', { defaultValue: 'you' })})
          </span>
        )}
      </span>
      <span className={cn('shrink-0 rounded px-1 py-0.5 text-[10px] uppercase', roleColor)}>
        {participant.role}
      </span>
    </div>
  )
}
