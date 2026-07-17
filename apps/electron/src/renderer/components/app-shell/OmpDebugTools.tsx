/**
 * OmpDebugTools - Drawer for inspecting and running OMP debug tools.
 *
 * Gates itself behind the `tools.debug` capability. On mount, fetches the
 * available debug tool definitions from the OMP runtime via `getDebugTools`,
 * then lets the user pick and run each tool.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  Bug,
  Copy,
  Check,
  Loader2,
  X,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Terminal,
} from 'lucide-react'
import { toast } from 'sonner'

import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerClose } from '@/components/ui/drawer'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { useOmpCapabilities } from '@/hooks/useOmpCapabilities'
import { useOmpSessionCommand } from '@/hooks/useOmpSessionCommand'
import { OmpCapabilityGate } from './OmpCapabilityGate'
import type {
  OmpDebugToolDefinition,
  OmpDebugToolParameter,
  OmpDebugResult,
} from '@craft-agent/shared/protocol'

interface OmpDebugToolsProps {
  sessionId: string
  open: boolean
  onClose: () => void
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ParameterLabel({ param }: { param: OmpDebugToolParameter }): React.ReactElement {
  return (
    <span className="text-xs text-muted-foreground">
      <code className="bg-foreground/5 px-1 rounded">{param.name}</code>
      {param.required && <span className="text-destructive ml-0.5">*</span>}
      {param.description && <span className="ml-1">— {param.description}</span>}
      {param.options && (
        <span className="ml-1 text-foreground/40">
          ({param.options.join(', ')})
        </span>
      )}
    </span>
  )
}

function CopyBlock({ text, label }: { text: string; label?: string }): React.ReactElement {
  const [copied, setCopied] = React.useState(false)

  const handleCopy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Failed to copy to clipboard')
    }
  }, [text])

  return (
    <div className="relative group">
      <button
        type="button"
        onClick={handleCopy}
        className="absolute top-2 right-2 p-1.5 rounded-md bg-background/80 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-foreground/10"
        aria-label={label ?? 'Copy to clipboard'}
      >
        {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
      <pre className="text-xs bg-foreground/5 rounded-lg p-3 pr-8 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap break-all">
        {text}
      </pre>
    </div>
  )
}

function ResultPanel({ result }: { result: OmpDebugResult }): React.ReactElement {
  const { t } = useTranslation()

  return (
    <div className="space-y-2 mt-3 border border-border/40 rounded-lg p-3 bg-foreground/[0.02]">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {result.success ? (
            <span className="text-xs font-medium text-green-600 dark:text-green-400">Success</span>
          ) : (
            <span className="text-xs font-medium text-destructive flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> Failed
            </span>
          )}
          {result.sanitized && (
            <span className="text-[10px] text-muted-foreground bg-foreground/5 px-1.5 py-0.5 rounded">
              {t('omp.debug.sanitized')}
            </span>
          )}
        </div>
        {result.error && (
          <span className="text-xs text-destructive/80 max-w-[60%] truncate" title={result.error}>
            {result.error}
          </span>
        )}
      </div>
      {Object.keys(result.output).length > 0 && (
        <CopyBlock text={JSON.stringify(result.output, null, 2)} label="Copy result JSON" />
      )}
    </div>
  )
}

function ToolCard({
  tool,
  onRun,
  running,
  result,
}: {
  tool: OmpDebugToolDefinition
  onRun: (toolId: string) => void
  running: boolean
  result: OmpDebugResult | null
}): React.ReactElement {
  const [expanded, setExpanded] = React.useState(false)
  const hasParams = tool.parameters.length > 0
  const hasResult = result?.toolId === tool.id

  return (
    <div className="border border-border/30 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-start gap-3 p-3 text-left hover:bg-foreground/[0.02] transition-colors"
      >
        <Terminal className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">{tool.name}</span>
            <div className="flex items-center gap-2 shrink-0">
              {tool.dangerous && (
                <span className="text-[10px] text-destructive bg-destructive/10 px-1.5 py-0.5 rounded font-medium">
                  Dangerous
                </span>
              )}
              {hasParams && (
                expanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                  : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{tool.description}</p>
        </div>
      </button>

      {expanded && hasParams && (
        <div className="px-3 pb-2 space-y-1">
          {tool.parameters.map((param) => (
            <ParameterLabel key={param.name} param={param} />
          ))}
        </div>
      )}

      <div className={cn('px-3 pb-3 flex items-center gap-2', expanded && hasParams ? '' : '')}>
        <Button
          size="sm"
          variant="outline"
          disabled={running}
          onClick={(e) => { e.stopPropagation(); onRun(tool.id) }}
        >
          {running ? (
            <>
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              Running...
            </>
          ) : (
            'Run'
          )}
        </Button>
      </div>

      {hasResult && <ResultPanel result={result} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function OmpDebugTools({ sessionId, open, onClose }: OmpDebugToolsProps): React.ReactElement | null {
  const { t } = useTranslation()
  const { execute: runCommand, loading: commandLoading } = useOmpSessionCommand(sessionId)

  const [tools, setTools] = React.useState<OmpDebugToolDefinition[]>([])
  const [toolsLoading, setToolsLoading] = React.useState(false)
  const [toolsError, setToolsError] = React.useState<string | null>(null)
  const [runningToolId, setRunningToolId] = React.useState<string | null>(null)
  const [results, setResults] = React.useState<Map<string, OmpDebugResult>>(new Map())

  // Fetch available debug tools when the drawer opens
  React.useEffect(() => {
    if (!open || !sessionId) return

    let cancelled = false
    setToolsLoading(true)
    setToolsError(null)

    runCommand({ type: 'getDebugTools' })
      .then((data) => {
        if (cancelled) return
        if (Array.isArray(data)) {
          setTools(data as OmpDebugToolDefinition[])
        } else {
          setToolsError('Unexpected response format')
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setToolsError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setToolsLoading(false)
      })

    return () => { cancelled = true }
  }, [open, sessionId, runCommand])

  // Reset state when closing
  React.useEffect(() => {
    if (!open) {
      setTools([])
      setToolsError(null)
      setRunningToolId(null)
      setResults(new Map())
    }
  }, [open])

  const handleRunTool = React.useCallback(
    async (toolId: string) => {
      setRunningToolId(toolId)
      try {
        const data = await runCommand({ type: 'runDebugTool', toolId })
        const result = data as OmpDebugResult
        setResults((prev) => {
          const next = new Map(prev)
          next.set(toolId, result)
          return next
        })
      } catch (err: unknown) {
        const errorResult: OmpDebugResult = {
          toolId,
          success: false,
          output: {},
          error: err instanceof Error ? err.message : String(err),
          sanitized: false,
        }
        setResults((prev) => {
          const next = new Map(prev)
          next.set(toolId, errorResult)
          return next
        })
        toast.error(`Debug tool failed: ${errorResult.error}`)
      } finally {
        setRunningToolId(null)
      }
    },
    [runCommand],
  )

  return (
    <OmpCapabilityGate sessionId={sessionId} feature="tools.debug" command="get_debug_tools">
      <Drawer open={open} onOpenChange={(next) => { if (!next) onClose() }}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader className="flex flex-row items-center justify-between gap-3 !text-left border-b border-border/40 px-4 py-3">
            <div className="flex items-center gap-2">
              <Bug className="h-4 w-4 text-muted-foreground" />
              <DrawerTitle className="text-sm font-medium">
                {t('omp.debug.tools', 'Debug Tools')}
              </DrawerTitle>
            </div>
            <DrawerClose asChild>
              <button
                type="button"
                className="p-1.5 rounded-md hover:bg-foreground/10 transition-colors"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </DrawerClose>
          </DrawerHeader>

          <ScrollArea className="flex-1 px-4 py-3">
            {toolsLoading && (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                {t('omp.debug.loading', 'Loading debug tools...')}
              </div>
            )}

            {toolsError && (
              <div className="flex items-start gap-2 p-3 bg-destructive/5 rounded-lg text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium">{t('omp.debug.error', 'Failed to load tools')}</p>
                  <p className="text-xs mt-1 text-destructive/80">{toolsError}</p>
                </div>
              </div>
            )}

            {!toolsLoading && !toolsError && tools.length === 0 && (
              <div className="py-12 text-center text-sm text-muted-foreground">
                {t('omp.debug.noTools', 'No debug tools available')}
              </div>
            )}

            {!toolsLoading && tools.length > 0 && (
              <div className="space-y-2">
                {tools.map((tool) => (
                  <ToolCard
                    key={tool.id}
                    tool={tool}
                    onRun={handleRunTool}
                    running={runningToolId === tool.id}
                    result={results.get(tool.id) ?? null}
                  />
                ))}
              </div>
            )}
          </ScrollArea>
        </DrawerContent>
      </Drawer>
    </OmpCapabilityGate>
  )
}
