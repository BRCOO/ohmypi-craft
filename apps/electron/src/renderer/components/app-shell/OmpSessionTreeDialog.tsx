import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, ChevronDown, GitBranch, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { OmpSessionTreeNode } from '@craft-agent/shared/protocol'
import type { OmpSessionTreeDialogState } from '@/hooks/useSessionMenuActions'

interface OmpSessionTreeDialogProps {
  state: OmpSessionTreeDialogState
  onClose: () => void
  onSwitch: (ompSessionPath: string) => Promise<void>
}

function TreeNode({
  node,
  depth,
  onSwitch,
  currentPath,
}: {
  node: OmpSessionTreeNode
  depth: number
  onSwitch: (path: string) => void
  currentPath?: string
}) {
  const [expanded, setExpanded] = React.useState(depth < 2)
  const hasChildren = node.children && node.children.length > 0

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/50',
          currentPath === node.ompSessionPath && 'bg-accent/30'
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="shrink-0 rounded p-0.5 hover:bg-accent"
          >
            {expanded ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
          </button>
        ) : (
          <span className="w-4" />
        )}
        <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
        <button
          type="button"
          onClick={() => onSwitch(node.ompSessionPath)}
          className="flex-1 truncate text-left"
        >
          {node.sessionName || node.ompSessionPath.split(/[\\/]/).pop() || node.ompSessionPath}
        </button>
        {currentPath === node.ompSessionPath && (
          <span className="shrink-0 text-xs text-muted-foreground">current</span>
        )}
      </div>
      {expanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.ompSessionPath}
              node={child}
              depth={depth + 1}
              onSwitch={onSwitch}
              currentPath={currentPath}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function OmpSessionTreeDialog({
  state,
  onClose,
  onSwitch,
}: OmpSessionTreeDialogProps): React.ReactElement {
  const { t } = useTranslation()

  return (
    <Dialog open={state.open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('sessionMenu.ompTreeTitle', { defaultValue: 'Session Tree' })}</DialogTitle>
        </DialogHeader>
        <div className="max-h-96 overflow-y-auto rounded-md border">
          {state.loading ? (
            <div className="flex items-center justify-center gap-2 p-4 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t('common.loading', { defaultValue: 'Loading' })}
            </div>
          ) : state.error ? (
            <div className="p-4 text-sm text-destructive">{state.error}</div>
          ) : state.tree ? (
            <div className="p-2">
              <TreeNode
                node={state.tree.root}
                depth={0}
                onSwitch={onSwitch}
                currentPath={state.tree.currentOmpSessionPath}
              />
            </div>
          ) : (
            <div className="p-4 text-sm text-muted-foreground">
              {t('sessionMenu.ompTreeEmpty', { defaultValue: 'No session tree available' })}
            </div>
          )}
        </div>
        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>
            {t('common.close', { defaultValue: 'Close' })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
