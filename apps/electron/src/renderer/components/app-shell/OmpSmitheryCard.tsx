import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { LogIn, LogOut, Loader2, Shield, ShieldOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useOmpCapabilities } from '@/hooks/useOmpCapabilities'
import { useOmpSessionCommand } from '@/hooks/useOmpSessionCommand'
import type { OmpSmitheryState } from '@craft-agent/shared/protocol'

interface OmpSmitheryCardProps {
  sessionId: string
}

/**
 * Smithery authentication status card.
 *
 * Displays the current Smithery auth state and provides login/logout actions.
 * Self-gates on the `smithery.auth` capability — returns null when unsupported.
 */
export function OmpSmitheryCard({ sessionId }: OmpSmitheryCardProps): React.ReactElement | null {
  const { t } = useTranslation()
  const { isFeatureSupported } = useOmpCapabilities(sessionId)
  const { execute } = useOmpSessionCommand(sessionId)

  const [smitheryState, setSmitheryState] = React.useState<OmpSmitheryState | null>(null)
  const [actionLoading, setActionLoading] = React.useState(false)

  if (!isFeatureSupported('smithery.auth')) {
    return null
  }

  const handleLogin = async () => {
    setActionLoading(true)
    try {
      const result = await execute({ type: 'smitheryLogin' }) as { success: boolean; data?: OmpSmitheryState; error?: string } | undefined
      if (result?.data) setSmitheryState(result.data)
      if (result?.data?.status === 'authenticated') {
        toast.success(t('omp.smithery.loginSuccess', { defaultValue: 'Smithery login successful' }))
      } else if (result?.data?.error) {
        toast.error(result.data.error)
      } else if (result?.error) {
        toast.error(result.error)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setActionLoading(false)
    }
  }

  const handleLogout = async () => {
    setActionLoading(true)
    try {
      const result = await execute({ type: 'smitheryLogout' }) as { success: boolean; data?: OmpSmitheryState; error?: string } | undefined
      if (result?.data) setSmitheryState(result.data)
      toast.success(t('omp.smithery.logoutSuccess', { defaultValue: 'Smithery logout successful' }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setActionLoading(false)
    }
  }

  const status = smitheryState?.status ?? 'none'
  const isWorking = actionLoading || status === 'authenticating'

  return (
    <div className="border-border/60 bg-background rounded-lg border p-3 shadow-minimal">
      <div className="mb-2 text-sm font-medium">{t('omp.smithery.title', { defaultValue: 'Smithery' })}</div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {status === 'authenticated' ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/12 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-200">
              <Shield className="size-3" />
              {t('omp.smithery.authenticated', { defaultValue: 'Authenticated' })}
              {smitheryState?.username && <> · {smitheryState.username}</>}
            </span>
          ) : status === 'authenticating' ? (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              {t('omp.smithery.authenticating', { defaultValue: 'Authenticating...' })}
            </span>
          ) : status === 'expired' ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/12 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-200">
              <ShieldOff className="size-3" />
              {t('omp.smithery.expired', { defaultValue: 'Session expired' })}
            </span>
          ) : status === 'error' ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-500/12 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-200">
              <ShieldOff className="size-3" />
              {t('omp.smithery.error', { defaultValue: 'Error' })}
              {smitheryState?.error && <> · {smitheryState.error}</>}
            </span>
          ) : (
            <span className="text-muted-foreground">
              {t('omp.smithery.notLoggedIn', { defaultValue: 'Not logged in' })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {(status === 'authenticated' || status === 'expired') ? (
            <Button size="sm" variant="outline" onClick={handleLogout} disabled={isWorking}>
              {isWorking ? (
                <Loader2 className="mr-1.5 size-3 animate-spin" />
              ) : (
                <LogOut className="mr-1.5 size-3" />
              )}
              {t('omp.smithery.logout', { defaultValue: 'Logout' })}
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={handleLogin} disabled={isWorking}>
              {isWorking ? (
                <Loader2 className="mr-1.5 size-3 animate-spin" />
              ) : (
                <LogIn className="mr-1.5 size-3" />
              )}
              {t('omp.smithery.login', { defaultValue: 'Login' })}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
