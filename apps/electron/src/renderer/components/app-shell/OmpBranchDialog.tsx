import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { GitBranch } from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { OmpBranchOption } from '../../../shared/types'

export interface OmpBranchDialogProps {
  open: boolean
  options: OmpBranchOption[]
  onClose: () => void
  onSelect: (option: OmpBranchOption) => void
}

export function OmpBranchDialog({ open, options, onClose, onSelect }: OmpBranchDialogProps) {
  const { t } = useTranslation()

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitBranch className="size-4 text-violet-300" />
            {t('sessionMenu.ompBranch')}
          </DialogTitle>
          <DialogDescription>{t('sessionMenu.ompBranchPrompt')}</DialogDescription>
        </DialogHeader>

        {options.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            {t('sessionMenu.ompNoBranchPoints')}
          </div>
        ) : (
          <ScrollArea className="max-h-[50vh]">
            <div className="space-y-2 pr-3">
              {options.map((option) => (
                <button
                  key={option.entryId}
                  type="button"
                  onClick={() => onSelect(option)}
                  className="w-full rounded-lg border border-foreground/10 bg-foreground/[0.02] p-3 text-left transition-colors hover:bg-foreground/[0.04]"
                >
                  <div className="flex items-center gap-2">
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-violet-500/10 text-[10px] font-medium text-violet-100">
                      {option.ordinal}
                    </span>
                    <span className="text-xs font-medium text-foreground/80">
                      {t('sessionMenu.ompBranchUserMessage', { ordinal: option.ordinal })}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">
                    {option.textPreview}
                  </p>
                </button>
              ))}
            </div>
          </ScrollArea>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
