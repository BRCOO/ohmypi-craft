import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useOmpCapabilities } from '@/hooks/useOmpCapabilities'
import { useOmpSessionCommand } from '@/hooks/useOmpSessionCommand'

interface ExternalEditorButtonProps {
  sessionId?: string
  disabled?: boolean
  draft: string
  onInsertText?: (text: string) => void
}

/**
 * Button that opens the current draft in an external editor via OMP.
 * Gated by the `external.editor` capability.
 */
export function ExternalEditorButton({
  sessionId,
  disabled,
  draft,
  onInsertText,
}: ExternalEditorButtonProps): React.ReactElement | null {
  const { t } = useTranslation()
  const { isFeatureSupported, getFeatureReason } = useOmpCapabilities(sessionId)
  const { execute } = useOmpSessionCommand(sessionId)
  const [loading, setLoading] = React.useState(false)

  if (!sessionId || !isFeatureSupported('editor.external')) {
    return null
  }

  const handleClick = async () => {
    setLoading(true)
    try {
      const result = (await execute({ type: 'openExternalEditor', draft })) as
        | { success: boolean; editedText?: string; error?: string }
        | undefined
      if (result?.success && result.editedText !== undefined && onInsertText) {
        onInsertText(result.editedText)
        toast.success(t('omp.externalEditor.returned', { defaultValue: 'Editor content returned' }))
      } else if (!result?.success) {
        toast.error(result?.error || t('omp.externalEditor.failed', { defaultValue: 'External editor failed' }))
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }

  const reason = getFeatureReason('editor.external')

  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      disabled={disabled || loading}
      onClick={handleClick}
      title={reason || t('omp.externalEditor.title', { defaultValue: 'Open in external editor' })}
      className="h-8 w-8 p-0"
    >
      <ExternalLink className="size-4" />
    </Button>
  )
}
