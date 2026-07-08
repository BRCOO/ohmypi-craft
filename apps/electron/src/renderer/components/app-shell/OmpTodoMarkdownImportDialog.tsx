import * as React from 'react'
import { AlertTriangle, CheckCircle2, FileText, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

interface OmpTodoMarkdownImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessionId: string
  expectedRevision: number
  hasHiddenMetadata: boolean
}

interface MarkdownIssue {
  line: number
  message: string
}

interface MarkdownPreview {
  phaseCount: number
  taskCount: number
  errors: MarkdownIssue[]
}

const EXAMPLE_MARKDOWN = [
  '# First phase',
  '- [~] Current task',
  '- [ ] Pending task',
  '- [x] Completed task',
  '- [-] Dropped task',
].join('\n')

function parseMarkdownPreview(markdown: string): MarkdownPreview {
  const errors: MarkdownIssue[] = []
  let phaseCount = 0
  let taskCount = 0
  let hasPhase = false

  markdown.split(/\r?\n/).forEach((line, index) => {
    const lineNumber = index + 1
    const trimmed = line.trim()
    if (!trimmed) return

    if (/^#{1,6}\s+.+$/.test(trimmed)) {
      phaseCount += 1
      hasPhase = true
      return
    }

    const task = /^[-*]\s+\[([ xX~-])\]\s+(.+)$/.exec(trimmed)
    if (!task) {
      errors.push({ line: lineNumber, message: 'Expected a phase heading or Todo item' })
      return
    }

    if (!hasPhase) {
      errors.push({ line: lineNumber, message: 'Todo item must appear under a phase heading' })
      return
    }

    taskCount += 1
  })

  if (markdown.trim().length > 0 && phaseCount === 0 && errors.length === 0) {
    errors.push({ line: 1, message: 'Markdown must contain at least one phase heading' })
  }

  return { phaseCount, taskCount, errors }
}

export function OmpTodoMarkdownImportDialog({
  open,
  onOpenChange,
  sessionId,
  expectedRevision,
  hasHiddenMetadata,
}: OmpTodoMarkdownImportDialogProps) {
  const [markdown, setMarkdown] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const preview = React.useMemo(() => parseMarkdownPreview(markdown), [markdown])
  const trimmed = markdown.trim()
  const canImport = trimmed.length > 0 && preview.errors.length === 0 && !saving

  React.useEffect(() => {
    if (!open) {
      setMarkdown('')
      setSaving(false)
    }
  }, [open])

  const insertExample = React.useCallback(() => {
    setMarkdown(EXAMPLE_MARKDOWN)
  }, [])

  const importMarkdown = React.useCallback(async () => {
    if (!canImport) return
    setSaving(true)
    try {
      await window.electronAPI.sessionCommand(sessionId, {
        type: 'importOmpTodosMarkdown',
        expectedRevision,
        markdown,
      })
      toast.success('OMP Todos imported')
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }, [canImport, expectedRevision, markdown, onOpenChange, sessionId])

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!saving) onOpenChange(nextOpen)
    }}>
      <DialogContent className="sm:max-w-[760px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="size-4 text-blue-400" />
            Import OMP Todo Markdown
          </DialogTitle>
          <DialogDescription>
            Replace the current OMP Todo snapshot with phased Markdown. OMP remains the source of truth after import.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_240px]">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-medium text-foreground/75">
                Markdown
              </label>
              <button
                type="button"
                onClick={insertExample}
                disabled={saving}
                className="text-xs text-blue-300 hover:text-blue-200 disabled:pointer-events-none disabled:opacity-50"
              >
                Insert example
              </button>
            </div>
            <Textarea
              value={markdown}
              onChange={(event) => setMarkdown(event.target.value)}
              placeholder={EXAMPLE_MARKDOWN}
              rows={12}
              disabled={saving}
              className="min-h-[260px] resize-y bg-[#080A16]/80 font-mono text-[12px] leading-5 text-foreground/90 shadow-none focus-visible:ring-blue-400/35"
            />
          </div>

          <aside className="rounded-xl border border-blue-300/15 bg-[#080A16]/80 p-3">
            <div className="mb-3 text-xs font-medium text-blue-100/90">Preview</div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-blue-400/10 px-2 py-2">
                <div className="text-lg font-semibold text-blue-100">{preview.phaseCount}</div>
                <div className="text-[11px] text-blue-100/60">phases</div>
              </div>
              <div className="rounded-lg bg-violet-400/10 px-2 py-2">
                <div className="text-lg font-semibold text-violet-100">{preview.taskCount}</div>
                <div className="text-[11px] text-violet-100/60">tasks</div>
              </div>
            </div>

            {hasHiddenMetadata && (
              <div className="mt-3 rounded-lg border border-amber-400/20 bg-amber-400/10 px-2.5 py-2 text-xs text-amber-100">
                <div className="mb-1 flex items-center gap-1.5 font-medium">
                  <AlertTriangle className="size-3.5" />
                  Hidden metadata
                </div>
                Current Todos contain details or notes. Markdown import drops those hidden fields.
              </div>
            )}

            <div className="mt-3">
              {trimmed.length === 0 ? (
                <div className="rounded-lg border border-dashed border-foreground/10 px-2.5 py-2 text-xs text-muted-foreground">
                  Paste Markdown to preview the replacement.
                </div>
              ) : preview.errors.length === 0 ? (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-2 text-xs text-emerald-100">
                  <CheckCircle2 className="size-3.5" />
                  Ready to import
                </div>
              ) : (
                <div className="space-y-1.5">
                  {preview.errors.slice(0, 5).map((error) => (
                    <div
                      key={`${error.line}-${error.message}`}
                      className="rounded-lg border border-destructive/20 bg-destructive/10 px-2.5 py-2 text-xs text-destructive"
                    >
                      Line {error.line}: {error.message}
                    </div>
                  ))}
                  {preview.errors.length > 5 && (
                    <div className="text-xs text-muted-foreground">
                      {preview.errors.length - 5} more errors
                    </div>
                  )}
                </div>
              )}
            </div>
          </aside>
        </div>

        <DialogFooter className="items-center">
          <Button
            variant="outline"
            size="sm"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!canImport}
            onClick={importMarkdown}
            className={cn('bg-gradient-to-r from-blue-500 to-violet-500 text-white hover:from-blue-400 hover:to-violet-400')}
          >
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            Replace OMP Todos
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
