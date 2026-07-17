/**
 * CopyPicker — Dropdown overlay for selecting message copy format.
 *
 * Offers format choices (Plain Text, Markdown) before writing to clipboard.
 * Gated by `copy.picker` capability in the parent.
 *
 * Pattern: matches BranchDropdown / AcceptPlanDropdown (Radix DropdownMenu +
 * StyledDropdownMenuContent from @craft-agent/ui).
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Check, FileText, Text } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
} from '@/components/ui/styled-dropdown'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

const SIZE_CONFIG = {
  iconSize: 'h-3 w-3',
  fontSize: 'text-xs',
} as const

/**
 * Strips leading/trailing whitespace and normalizes internal blank lines
 * to a single blank line between paragraphs.
 */
function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Strip markdown syntax, returning plain text.
 */
function stripMarkdown(text: string): string {
  return text
    // Remove images: ![alt](url)
    .replace(/!\[.*?\]\(.*?\)/g, '')
    // Remove links: [text](url) → text
    .replace(/\[([^\]]*)\]\(.*?\)/g, '$1')
    // Remove bold/italic: **text** or *text*
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '$1')
    // Remove inline code backticks
    .replace(/`([^`]+)`/g, '$1')
    // Remove headings markers
    .replace(/^#{1,6}\s+/gm, '')
    // Remove horizontal rules
    .replace(/^[-*_]{3,}\s*$/gm, '')
    // Remove blockquote markers
    .replace(/^>\s+/gm, '')
    // Remove list markers
    .replace(/^[\s]*[-*+]\s+/gm, '')
    .replace(/^[\s]*\d+\.\s+/gm, '')
    // Remove code fences
    .replace(/```[\s\S]*?```/g, '')
    // Remove HTML tags
    .replace(/<[^>]*>/g, '')
    .trim()
}

interface CopyFormat {
  id: string
  label: string
  description: string
  icon: React.ReactNode
  /** Transform the text before copying */
  format: (text: string) => string
}

interface CopyPickerProps {
  /** The turn/response text content to copy */
  text: string
  /** Optional icon size override (default: h-3 w-3) */
  iconSize?: string
}

/**
 * CopyPicker — Shows a dropdown with format options (Plain Text, Markdown) for
 * copying message content. Uses the same DropdownMenu + Styled pattern as
 * BranchDropdown / AcceptPlanDropdown in TurnCard.
 */
export function CopyPicker({ text, iconSize = SIZE_CONFIG.iconSize }: CopyPickerProps) {
  const { t } = useTranslation()
  const [copied, setCopied] = React.useState<string | null>(null)
  const [open, setOpen] = React.useState(false)

  const formats: CopyFormat[] = React.useMemo(
    () => [
      {
        id: 'markdown',
        label: t('copyPicker.copyAsMarkdown', 'Copy as Markdown'),
        description: t('copyPicker.copyAsMarkdownDesc', 'Preserves all formatting'),
        icon: <FileText className={iconSize} />,
        format: (src: string) => normalizeText(src),
      },
      {
        id: 'plain-text',
        label: t('copyPicker.copyAsPlainText', 'Copy as Plain Text'),
        description: t('copyPicker.copyAsPlainTextDesc', 'Strip all formatting'),
        icon: <Text className={iconSize} />,
        format: (src: string) => normalizeText(stripMarkdown(src)),
      },
    ],
    [t, iconSize],
  )

  const handleCopy = React.useCallback(
    async (format: CopyFormat) => {
      try {
        const content = format.format(text)
        await navigator.clipboard.writeText(content)
        setCopied(format.id)
        setOpen(false)
        setTimeout(() => setCopied(null), 2000)
      } catch (err) {
        toast.error(t('toast.copyFailed', 'Failed to copy to clipboard'))
        console.error('CopyPicker: copy failed', err)
      }
    },
    [text, t],
  )

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            'turn-action-btn flex items-center gap-1.5 transition-colors select-none',
            copied ? 'text-success' : 'text-muted-foreground hover:text-foreground',
            'focus:outline-none focus-visible:underline',
          )}
        >
          {copied ? (
            <>
              <Check className={iconSize} />
              <span>{t('common.copied')}</span>
            </>
          ) : (
            <>
              <Copy className={iconSize} />
              <span>{t('common.copy')}</span>
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <StyledDropdownMenuContent align="start" minWidth="min-w-56" sideOffset={6}>
        <div className="px-2 py-1.5 text-[11px] font-medium text-muted-foreground">
          {t('copyPicker.selectFormat', 'Copy as...')}
        </div>
        <StyledDropdownMenuSeparator />
        {formats.map((fmt) => (
          <StyledDropdownMenuItem
            key={fmt.id}
            onSelect={() => void handleCopy(fmt)}
            className="items-start py-2"
          >
            <div className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0 text-muted-foreground">{fmt.icon}</span>
              <div className="flex flex-col gap-0.5">
                <span className="text-[13px] leading-tight">{fmt.label}</span>
                <span className="max-w-[200px] whitespace-normal text-xs leading-tight text-muted-foreground">
                  {fmt.description}
                </span>
              </div>
            </div>
          </StyledDropdownMenuItem>
        ))}
      </StyledDropdownMenuContent>
    </DropdownMenu>
  )
}
