import * as React from 'react'
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
import type {
  ExtensionUiRequest as ExtensionUiRequestType,
  ExtensionUiResponse,
} from '../../../../../shared/types'

interface ExtensionUiRequestProps {
  request: ExtensionUiRequestType
  onResponse: (response: ExtensionUiResponse) => void
  unstyled?: boolean
}

const BLOCKING_METHODS = new Set(['select', 'confirm', 'input', 'editor'])

function requestDescription(request: ExtensionUiRequestType): string | undefined {
  return request.message || request.instructions
}

export function ExtensionUiRequest({
  request,
  onResponse,
  unstyled = false,
}: ExtensionUiRequestProps) {
  const [value, setValue] = React.useState(request.prefill ?? '')
  const respondedRef = React.useRef(false)
  const onResponseRef = React.useRef(onResponse)
  const description = requestDescription(request)
  const targetUrl = request.launchUrl || request.url
  onResponseRef.current = onResponse

  const respond = React.useCallback((response: ExtensionUiResponse) => {
    if (respondedRef.current) return
    respondedRef.current = true
    onResponseRef.current(response)
  }, [])

  React.useEffect(() => {
    respondedRef.current = false
    setValue(request.prefill ?? '')
  }, [request.requestId, request.prefill])

  React.useEffect(() => {
    if (!request.timeoutMs || !BLOCKING_METHODS.has(request.method)) return
    const timer = window.setTimeout(() => {
      respond({ cancelled: true, timedOut: true })
    }, request.timeoutMs)
    return () => window.clearTimeout(timer)
  }, [request.requestId, request.method, request.timeoutMs, respond])

  const submitValue = (event: React.FormEvent) => {
    event.preventDefault()
    respond({ value })
  }

  const openUrl = async () => {
    if (targetUrl) await window.electronAPI.openUrl(targetUrl)
    respond({ cancelled: true })
  }

  const copyUrl = async () => {
    if (targetUrl) await navigator.clipboard.writeText(targetUrl)
  }

  const title = request.title || (() => {
    switch (request.method) {
      case 'select': return 'Choose an option'
      case 'confirm': return 'Confirmation required'
      case 'input': return 'Input required'
      case 'editor': return 'Edit text'
      case 'open_url': return 'Open external link'
      case 'setWidget': return 'OMP extension'
      default: return 'OMP extension request'
    }
  })()

  const content = (() => {
    switch (request.method) {
      case 'select':
        return (
          <div className="grid gap-2 sm:grid-cols-2">
            {(request.options ?? []).map((option) => (
              <Button
                key={option}
                type="button"
                variant="outline"
                className="h-auto min-h-9 justify-start whitespace-normal text-left"
                onClick={() => respond({ value: option })}
              >
                {option}
              </Button>
            ))}
            {(request.options?.length ?? 0) === 0 && (
              <p className="text-xs text-muted-foreground">No options were supplied.</p>
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
          <p className="text-xs text-muted-foreground">The extension did not supply a URL.</p>
        )

      case 'setWidget':
        return (
          <div className="rounded-md bg-foreground/5 p-3 font-mono text-xs whitespace-pre-wrap">
            {(request.widgetLines ?? []).join('\n') || 'Empty widget'}
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
    <div className={cn(
      'h-full overflow-hidden bg-info/5 flex flex-col',
      unstyled ? 'border-0' : 'rounded-[8px] border border-info/30 shadow-middle',
    )}>
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
        <div className="flex items-start gap-2">
          <div className="mt-0.5 shrink-0">{icon}</div>
          <div className="min-w-0 space-y-1">
            <div className="text-sm font-medium text-foreground">{title}</div>
            {description && <p className="text-xs leading-[18px] text-muted-foreground">{description}</p>}
          </div>
        </div>
        {content}
      </div>

      <div className="shrink-0 flex flex-wrap items-center gap-2 border-t border-border/50 px-3 py-2">
        {request.method === 'confirm' && (
          <>
            <Button size="sm" className="h-7 gap-1.5" onClick={() => respond({ confirmed: true })}>
              <Check className="h-3.5 w-3.5" /> Confirm
            </Button>
            <Button size="sm" variant="ghost" className="h-7 gap-1.5" onClick={() => respond({ confirmed: false })}>
              <X className="h-3.5 w-3.5" /> No
            </Button>
          </>
        )}
        {(request.method === 'input' || request.method === 'editor') && (
          <Button size="sm" className="h-7 gap-1.5" disabled={value.length === 0} onClick={() => respond({ value })}>
            <Check className="h-3.5 w-3.5" /> Submit
          </Button>
        )}
        {request.method === 'open_url' && (
          <>
            <Button size="sm" className="h-7 gap-1.5" disabled={!targetUrl} onClick={() => void openUrl()}>
              <ExternalLink className="h-3.5 w-3.5" /> Open link
            </Button>
            <Button size="sm" variant="ghost" className="h-7 gap-1.5" disabled={!targetUrl} onClick={() => void copyUrl()}>
              <Clipboard className="h-3.5 w-3.5" /> Copy
            </Button>
          </>
        )}
        {!['confirm', 'input', 'editor', 'open_url'].includes(request.method) && (
          <Button size="sm" variant="ghost" className="h-7" onClick={() => respond({ cancelled: true })}>
            Dismiss
          </Button>
        )}
        {BLOCKING_METHODS.has(request.method) && request.method !== 'confirm' && (
          <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-muted-foreground" onClick={() => respond({ cancelled: true })}>
            <X className="h-3.5 w-3.5" /> Cancel
          </Button>
        )}
      </div>
    </div>
  )
}
