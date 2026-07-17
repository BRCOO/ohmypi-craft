import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'

export interface ImageSupportWarningBannerProps {
  /** Display name of the active model — interpolated into the message. */
  modelName: string
  /** Click-handler for the inline "Enable image support" action. */
  onEnable?: () => void
}

/**
 * Pre-flight banner shown above the chat input when the user has staged image
 * attachments while the active model is explicitly configured as text-only.
 * Standard provider catalogs render the warning without an action; custom
 * endpoints may provide the inline opt-in handler.
 */
export function ImageSupportWarningBanner({
  modelName,
  onEnable,
}: ImageSupportWarningBannerProps) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-2 px-3 py-2 mx-2 mt-2 rounded-md bg-amber-500/10 text-foreground/70 text-xs">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
      <span className="flex-1 min-w-0">
        {t('chat.imageWarning.title', { modelName })}
      </span>
      {onEnable && (
        <button
          type="button"
          onClick={onEnable}
          className="shrink-0 underline underline-offset-2 hover:text-foreground"
        >
          {t('chat.imageWarning.action')}
        </button>
      )}
    </div>
  )
}
