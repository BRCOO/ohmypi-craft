import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink, Loader2, AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { StepFormLayout, StepActions, BackButton, ContinueButton } from './primitives'
import type { OmpLoginProviderDto } from '../../../shared/types'

interface OmpLoginStepProps {
  /** Saved OMP connection slug used to refresh models after login. */
  connectionSlug: string
  onBack: () => void
  onComplete: () => void
  onOpenSettings?: () => void
}

type StepStatus = 'loading' | 'idle' | 'logging-in' | 'refreshing' | 'error'

export function OmpLoginStep({ connectionSlug, onBack, onComplete, onOpenSettings }: OmpLoginStepProps) {
  const { t } = useTranslation()
  const [providers, setProviders] = useState<OmpLoginProviderDto[]>([])
  const [status, setStatus] = useState<StepStatus>('loading')
  const [errorMessage, setErrorMessage] = useState<string | undefined>()
  const [activeProviderId, setActiveProviderId] = useState<string | undefined>()
  const [lastOpenedUrl, setLastOpenedUrl] = useState<string | undefined>()

  const loadProviders = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setStatus('loading')
    setErrorMessage(undefined)
    setActiveProviderId(undefined)

    try {
      const result = await window.electronAPI.getOmpLoginProviders()
      if (!result.success) {
        setStatus('error')
        setErrorMessage(result.error || t('onboarding.ompLogin.loadFailed'))
        setProviders([])
        return
      }

      const list = result.providers ?? []
      setProviders(list)

      const authenticatedCount = list.filter(p => p.authenticated).length
      if (authenticatedCount > 0) {
        // Already logged in — refresh models so the selector is usable immediately.
        await refreshModels()
      } else {
        setStatus('idle')
      }
    } catch (error) {
      setStatus('error')
      setErrorMessage(error instanceof Error ? error.message : t('onboarding.ompLogin.loadFailed'))
      setProviders([])
    }
  }, [t])

  const refreshModels = useCallback(async () => {
    setStatus('refreshing')
    try {
      await window.electronAPI.refreshLlmConnectionModels(connectionSlug)
      setStatus('idle')
      onComplete()
    } catch (error) {
      setStatus('error')
      setErrorMessage(error instanceof Error ? error.message : t('onboarding.ompLogin.refreshFailed'))
    }
  }, [connectionSlug, onComplete, t])

  useEffect(() => {
    loadProviders()
  }, [loadProviders])

  const handleLogin = useCallback(async (provider: OmpLoginProviderDto) => {
    setActiveProviderId(provider.id)
    setStatus('logging-in')
    setErrorMessage(undefined)
    setLastOpenedUrl(undefined)

    try {
      const result = await window.electronAPI.loginOmpProvider(provider.id)
      if (!result.success) {
        setStatus('error')
        setErrorMessage(result.error || t('onboarding.ompLogin.loginFailed'))
        return
      }

      const openedUrl = result.openUrl || result.launchUrl
      if (openedUrl) {
        setLastOpenedUrl(openedUrl)
      }

      // Re-fetch providers to see whether authentication succeeded.
      await loadProviders({ silent: true })
    } catch (error) {
      setStatus('error')
      setErrorMessage(error instanceof Error ? error.message : t('onboarding.ompLogin.loginFailed'))
    } finally {
      setActiveProviderId(undefined)
    }
  }, [loadProviders, t])

  const authenticatedCount = providers.filter(p => p.authenticated).length
  const availableProviders = providers.filter(p => p.available && !p.authenticated)

  return (
    <StepFormLayout
      icon={<RefreshCw className="size-8" />}
      title={t('onboarding.ompLogin.title')}
      description={t('onboarding.ompLogin.description')}
      actions={
        <StepActions variant="flex">
          <BackButton onClick={onBack}>
            {t('common.back')}
          </BackButton>
          {authenticatedCount > 0 && (
            <ContinueButton onClick={onComplete}>
              {t('common.continue')}
            </ContinueButton>
          )}
        </StepActions>
      }
    >
      <div className="w-full space-y-3">
        {status === 'loading' && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t('onboarding.ompLogin.loadingProviders')}
          </div>
        )}

        {status === 'refreshing' && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t('onboarding.ompLogin.refreshingModels')}
          </div>
        )}

        {!['loading', 'refreshing'].includes(status) && providers.length === 0 && (
          <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
              <div className="flex-1 space-y-2">
                <p>{errorMessage || t('onboarding.ompLogin.noProviders')}</p>
                {onOpenSettings && (
                  <button
                    onClick={onOpenSettings}
                    className="text-xs underline underline-offset-2 hover:text-foreground"
                  >
                    {t('onboarding.ompLogin.openSettings')}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {!['loading', 'refreshing'].includes(status) && providers.length > 0 && (
          <div className="space-y-2">
            {providers.map(provider => (
              <div
                key={provider.id}
                className={cn(
                  'flex items-center justify-between gap-3 rounded-xl border p-3 text-sm',
                  provider.authenticated
                    ? 'border-success/30 bg-success/5'
                    : provider.available
                      ? 'border-border bg-foreground-2'
                      : 'border-border/50 bg-foreground-2/50 opacity-70',
                )}
              >
                <div className="min-w-0">
                  <div className="font-medium">{provider.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {provider.authenticated
                      ? t('onboarding.ompLogin.authenticated')
                      : provider.available
                        ? t('onboarding.ompLogin.notAuthenticated')
                        : t('onboarding.ompLogin.unavailable')}
                  </div>
                </div>

                {provider.authenticated ? (
                  <CheckCircle2 className="size-5 shrink-0 text-success" />
                ) : provider.available ? (
                  <button
                    onClick={() => handleLogin(provider)}
                    disabled={status === 'logging-in'}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-lg bg-background px-3 py-1.5 text-xs font-medium shadow-minimal hover:bg-foreground/5 disabled:opacity-50',
                    )}
                  >
                    {status === 'logging-in' && activeProviderId === provider.id ? (
                      <>
                        <Loader2 className="size-3 animate-spin" />
                        {t('onboarding.ompLogin.loggingIn')}
                      </>
                    ) : (
                      <>
                        <ExternalLink className="size-3" />
                        {t('onboarding.ompLogin.loginButton')}
                      </>
                    )}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}

        {lastOpenedUrl && (
          <p className="text-center text-xs text-muted-foreground">
            {t('onboarding.ompLogin.browserOpened')}
          </p>
        )}

        {status === 'error' && errorMessage && providers.length > 0 && (
          <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-xs text-destructive">
            {errorMessage}
          </div>
        )}
      </div>
    </StepFormLayout>
  )
}
