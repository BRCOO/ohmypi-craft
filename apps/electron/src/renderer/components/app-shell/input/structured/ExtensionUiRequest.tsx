import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  Check,
  Clipboard,
  ExternalLink,
  ListChecks,
  MessageSquareText,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import {
  createExtensionUiResponseGate,
  getExtensionUiTimeoutMs,
  isBlockingExtensionUiMethod,
} from '@/lib/extension-ui-state'
import type {
  ExtensionUiRequest as ExtensionUiRequestType,
  ExtensionUiResponse,
} from '../../../../../shared/types'

interface ExtensionUiRequestProps {
  request: ExtensionUiRequestType
  onResponse: (response: ExtensionUiResponse) => void
  unstyled?: boolean
}

function requestDescription(request: ExtensionUiRequestType): string | undefined {
  return request.message || request.instructions
}

function getDefaultTitleKey(method: string): string {
  switch (method) {
    case 'select': return 'chat.extensionUi.chooseOption'
    case 'confirm': return 'chat.extensionUi.confirmationRequired'
    case 'input': return 'chat.extensionUi.inputRequired'
    case 'editor': return 'chat.extensionUi.editText'
    case 'open_url': return 'chat.extensionUi.openExternalLink'
    case 'setWidget': return 'chat.extensionUi.extension'
    default: return 'chat.extensionUi.request'
  }
}

export function ExtensionUiRequest({
  request,
  onResponse,
  unstyled = false,
}: ExtensionUiRequestProps) {
  const { t } = useTranslation()
  const baseId = React.useId()
  const [value, setValue] = React.useState(request.prefill ?? '')
  const onResponseRef = React.useRef(onResponse)
  const responseGateRef = React.useRef<ReturnType<typeof createExtensionUiResponseGate> | null>(null)
  const optionRefs = React.useRef<Array<HTMLButtonElement | null>>([])
  const description = requestDescription(request)
  const targetUrl = request.launchUrl || request.url
  const requestTimeoutMs = getExtensionUiTimeoutMs(request)
  const titleId = `${baseId}-title`
  const descriptionId = description ? `${baseId}-description` : undefined
  onResponseRef.current = onResponse
  if (!responseGateRef.current) {
    responseGateRef.current = createExtensionUiResponseGate((response) => onResponseRef.current(response))
  }

  const respond = React.useCallback((response: ExtensionUiResponse) => {
    responseGateRef.current?.respond(response)
  }, [])

  React.useEffect(() => {
    responseGateRef.current?.reset()
    setValue(request.prefill ?? '')
  }, [request.requestId, request.prefill])

  React.useEffect(() => {
    if (!requestTimeoutMs) return
    const timer = window.setTimeout(() => {
      respond({ cancelled: true, timedOut: true })
    }, requestTimeoutMs)
    return () => window.clearTimeout(timer)
  }, [request.requestId, requestTimeoutMs, respond])

  const submitValue = (event: React.FormEvent) => {
    event.preventDefault()
    respond({ value })
  }

  const cancelBlockingRequest = React.useCallback(() => {
    if (isBlockingExtensionUiMethod(request.method)) {
      respond({ cancelled: true })
    }
  }, [request.method, respond])

  const handleContainerKeyDown = React.useCallback((event: React.KeyboardEvent) => {
    if (event.key !== 'Escape') return
    if (!isBlockingExtensionUiMethod(request.method)) return
    event.preventDefault()
    cancelBlockingRequest()
  }, [cancelBlockingRequest, request.method])

  const focusSelectOption = React.useCallback((nextIndex: number) => {
    const options = optionRefs.current.filter(Boolean)
    const option = options[nextIndex]
    option?.focus()
  }, [])

  const handleSelectOptionKeyDown = React.useCallback((
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    const optionCount = request.options?.length ?? 0
    if (optionCount === 0) return

    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault()
      focusSelectOption((index + 1) % optionCount)
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault()
      focusSelectOption((index - 1 + optionCount) % optionCount)
    } else if (event.key === 'Home') {
      event.preventDefault()
      focusSelectOption(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      focusSelectOption(optionCount - 1)
    }
  }, [focusSelectOption, request.options?.length])

  const openUrl = async () => {
    if (targetUrl) await window.electronAPI.openUrl(targetUrl)
    respond({ cancelled: true })
  }

  const copyUrl = async () => {
    if (targetUrl) await navigator.clipboard.writeText(targetUrl)
  }

  const title = request.title || t(getDefaultTitleKey(request.method))

  const content = (() => {
    switch (request.method) {
      case 'select':
        return (
          <div
            className="grid gap-2 sm:grid-cols-2"
            role="group"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
          >
            {(request.options ?? []).map((option, index) => (
              <Button
                key={`${option}-${index}`}
                ref={(node) => {
                  optionRefs.current[index] = node
                }}
                type="button"
                variant="outline"
                className="h-auto min-h-9 justify-start whitespace-normal text-left"
                autoFocus={index === 0}
                onKeyDown={(event) => handleSelectOptionKeyDown(event, index)}
                onClick={() => respond({ value: option })}
              >
                {option}
              </Button>
            ))}
            {(request.options?.length ?? 0) === 0 && (
              <p className="text-xs text-muted-foreground">{t('chat.extensionUi.noOptions')}</p>
            )}
          </div>
        )

      case 'confirm':
        return null

      case 'input':
        return (
          <form onSubmit={submitValue} className="space-y-3">
            <Input
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={request.placeholder}
              aria-labelledby={titleId}
              aria-describedby={descriptionId}
              autoFocus
            />
          </form>
        )

      case 'editor':
        return (
          <form onSubmit={submitValue} className="space-y-3">
            <Textarea
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={request.placeholder}
              className="min-h-28 resize-y font-mono text-xs"
              aria-labelledby={titleId}
              aria-describedby={descriptionId}
              autoFocus
            />
          </form>
        )

      case 'open_url':
        return targetUrl ? (
          <div className="rounded-md bg-foreground/5 p-3 font-mono text-xs break-all">
            {targetUrl}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{t('chat.extensionUi.urlMissing')}</p>
        )

      case 'setWidget':
        return (
          <div className="rounded-md bg-foreground/5 p-3 font-mono text-xs whitespace-pre-wrap">
            {(request.widgetLines ?? []).join('\n') || t('chat.extensionUi.emptyWidget')}
          </div>
        )

      default:
        return (
          <pre className="max-h-36 overflow-auto rounded-md bg-foreground/5 p-3 text-[11px] whitespace-pre-wrap break-all">
            {JSON.stringify(request.raw, null, 2)}
          </pre>
        )
    }
  })()

  const icon = request.method === 'select'
    ? <ListChecks className="h-4 w-4 text-info" />
    : request.method === 'open_url'
      ? <ExternalLink className="h-4 w-4 text-info" />
      : <MessageSquareText className="h-4 w-4 text-info" />

  return (
    <div
      className={cn(
        'h-full overflow-hidden bg-info/5 flex flex-col',
        unstyled ? 'border-0' : 'rounded-[8px] border border-info/30 shadow-middle',
      )}
      onKeyDown={handleContainerKeyDown}
      role="region"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
    >
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
        <div className="flex items-start gap-2">
          <div className="mt-0.5 shrink-0">{icon}</div>
          <div className="min-w-0 space-y-1">
            <div id={titleId} className="text-sm font-medium text-foreground">{title}</div>
            {description && (
              <p id={descriptionId} className="text-xs leading-[18px] text-muted-foreground">
                {description}
              </p>
            )}
          </div>
        </div>
        {content}
      </div>

      <div className="shrink-0 flex flex-wrap items-center gap-2 border-t border-border/50 px-3 py-2">
        {request.method === 'confirm' && (
          <>
            <Button size="sm" className="h-7 gap-1.5" autoFocus onClick={() => respond({ confirmed: true })}>
              <Check className="h-3.5 w-3.5" /> {t('chat.extensionUi.confirm')}
            </Button>
            <Button size="sm" variant="ghost" className="h-7 gap-1.5" onClick={() => respond({ confirmed: false })}>
              <X className="h-3.5 w-3.5" /> {t('chat.extensionUi.no')}
            </Button>
          </>
        )}
        {(request.method === 'input' || request.method === 'editor') && (
          <Button size="sm" className="h-7 gap-1.5" disabled={value.length === 0} onClick={() => respond({ value })}>
            <Check className="h-3.5 w-3.5" /> {t('chat.extensionUi.submit')}
          </Button>
        )}
        {request.method === 'open_url' && (
          <>
            <Button size="sm" className="h-7 gap-1.5" disabled={!targetUrl} autoFocus onClick={() => void openUrl()}>
              <ExternalLink className="h-3.5 w-3.5" /> {t('chat.extensionUi.openLink')}
            </Button>
            <Button size="sm" variant="ghost" className="h-7 gap-1.5" disabled={!targetUrl} onClick={() => void copyUrl()}>
              <Clipboard className="h-3.5 w-3.5" /> {t('chat.extensionUi.copy')}
            </Button>
          </>
        )}
        {!['confirm', 'input', 'editor', 'open_url'].includes(request.method) && (
          <Button size="sm" variant="ghost" className="h-7" autoFocus onClick={() => respond({ cancelled: true })}>
            {t('chat.extensionUi.dismiss')}
          </Button>
        )}
        {isBlockingExtensionUiMethod(request.method) && request.method !== 'confirm' && (
          <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-muted-foreground" onClick={() => respond({ cancelled: true })}>
            <X className="h-3.5 w-3.5" /> {t('chat.extensionUi.cancel')}
          </Button>
        )}
      </div>
    </div>
  )
}
