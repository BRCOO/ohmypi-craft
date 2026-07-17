import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Target, SkipBack, SkipForward, X, Check } from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useOmpSessionCommand } from '@/hooks/useOmpSessionCommand'

type GuidedGoalStep =
  | { phase: 'loading'; assistantMessage?: string }
  | { phase: 'question'; assistantMessage: string; turnIndex: number }
  | { phase: 'summary'; objective: string; tokenBudget?: number; mode?: string }
  | { phase: 'done' }

interface GuidedGoalTurnData {
  /** The assistant's question / next prompt for the user */
  assistantMessage?: string
  /** When present, this turn signals the final round */
  isFinal?: boolean
  /** Final objective once guided goal completes */
  objective?: string
  tokenBudget?: number
  mode?: string
}

export interface GuidedGoalModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessionId: string
  /** Called when guided goal completes with the final objective/budget/mode */
  onComplete?: (objective: string, tokenBudget?: number) => void
}

/**
 * GuidedGoalModal — multi-turn guided goal setup dialog.
 *
 * Sends `guided_goal_turn` RPC commands to the OMP backend. Each turn
 * exchanges an assistant question and a user answer. The OMP backend drives
 * the conversation until it has enough context to finalize; at that point the
 * modal shows a summary with objective/budget/mode and a Finish button.
 *
 * Gated behind the `goal.guided` capability — callers should wrap with
 * `OmpCapabilityGate` or inline capability check.
 */
export function GuidedGoalModal({
  open,
  onOpenChange,
  sessionId,
  onComplete,
}: GuidedGoalModalProps) {
  const { t } = useTranslation()
  const { loading: commandLoading, execute } = useOmpSessionCommand(sessionId)

  const [step, setStep] = React.useState<GuidedGoalStep>({ phase: 'loading' })
  const [messages, setMessages] = React.useState<Array<{ role: 'user' | 'assistant'; content: string }>>([])
  const [userInput, setUserInput] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [sending, setSending] = React.useState(false)

  // Reset state when modal opens
  React.useEffect(() => {
    if (open) {
      setStep({ phase: 'loading' })
      setMessages([])
      setUserInput('')
      setError(null)
      setSending(false)
    }
  }, [open])

  // Dispatch initial turn when modal opens
  React.useEffect(() => {
    if (!open) return
    if (step.phase === 'loading' && !sending) {
      startConversation()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step.phase])

  const startConversation = React.useCallback(async () => {
    setSending(true)
    setError(null)
    try {
      const result = await execute({ type: 'guidedGoalTurn', messages: [] })
      const data = parseTurnData(result)
      if (data?.isFinal) {
        setStep({
          phase: 'summary',
          objective: data.objective ?? '',
          tokenBudget: data.tokenBudget,
          mode: data.mode,
        })
      } else if (data?.assistantMessage) {
        setStep({ phase: 'question', assistantMessage: data.assistantMessage, turnIndex: 0 })
        setMessages([{ role: 'assistant', content: data.assistantMessage }])
      } else {
        // No question and not final — treat as done
        setStep({ phase: 'done' })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
    } finally {
      setSending(false)
    }
  }, [execute])

  const handleNext = React.useCallback(async () => {
    if (!userInput.trim() || sending) return
    setSending(true)
    setError(null)

    const newMessages = [...messages, { role: 'user' as const, content: userInput.trim() }]
    setMessages(newMessages)
    setUserInput('')

    try {
      const result = await execute({ type: 'guidedGoalTurn', messages: newMessages })
      const data = parseTurnData(result)

      if (data?.isFinal) {
        setStep({
          phase: 'summary',
          objective: data.objective ?? '',
          tokenBudget: data.tokenBudget,
          mode: data.mode,
        })
      } else if (data?.assistantMessage) {
        const currentStep = step
        if (currentStep.phase === 'question') {
          const updatedMessages = [...newMessages, { role: 'assistant' as const, content: data.assistantMessage }]
          setMessages(updatedMessages)
          setStep({ phase: 'question', assistantMessage: data.assistantMessage, turnIndex: currentStep.turnIndex + 1 })
        }
      } else {
        // No response — conversation done
        setStep({ phase: 'done' })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      // Restore messages on error so retry has the full context
      setMessages(newMessages)
    } finally {
      setSending(false)
    }
  }, [userInput, sending, messages, step, execute])

  const handleSkip = React.useCallback(async () => {
    setSending(true)
    setError(null)

    const skipMessage = [...messages, { role: 'user' as const, content: '' }]
    setMessages(skipMessage)

    try {
      const result = await execute({ type: 'guidedGoalTurn', messages: skipMessage })
      const data = parseTurnData(result)

      if (data?.isFinal) {
        setStep({
          phase: 'summary',
          objective: data.objective ?? '',
          tokenBudget: data.tokenBudget,
          mode: data.mode,
        })
      } else if (data?.assistantMessage) {
        const currentStep = step
        if (currentStep.phase === 'question') {
          const updatedMessages = [...skipMessage, { role: 'assistant' as const, content: data.assistantMessage }]
          setMessages(updatedMessages)
          setStep({ phase: 'question', assistantMessage: data.assistantMessage, turnIndex: currentStep.turnIndex + 1 })
        }
      } else {
        setStep({ phase: 'done' })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      setMessages(skipMessage)
    } finally {
      setSending(false)
    }
  }, [messages, step, execute])

  const handleBack = React.useCallback(() => {
    // Go back one user/assistant pair if possible
    if (messages.length >= 2) {
      const withoutLastPair = messages.slice(0, -2)
      setMessages(withoutLastPair)
      const prevAssistant = withoutLastPair[withoutLastPair.length - 1]
      if (prevAssistant?.role === 'assistant') {
        setStep({ phase: 'question', assistantMessage: prevAssistant.content, turnIndex: (step.phase === 'question' ? step.turnIndex - 1 : 0) })
      } else {
        setStep({ phase: 'loading' })
      }
      setUserInput('')
    }
  }, [messages, step])

  const handleFinish = React.useCallback(() => {
    const currentStep = step
    if (currentStep.phase === 'summary') {
      onComplete?.(currentStep.objective, currentStep.tokenBudget)
      setStep({ phase: 'done' })
      onOpenChange(false)
    }
  }, [step, onComplete, onOpenChange])

  const handleCancel = React.useCallback(() => {
    onOpenChange(false)
  }, [onOpenChange])

  // --- Render ---
  const currentStep = step

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && step.phase !== 'done') onOpenChange(next) }}>
      <DialogContent className="sm:max-w-[540px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Target className="size-4 text-amber-400" />
            {t('omp.guidedGoal.title', { defaultValue: 'Guided Goal Setup' })}
          </DialogTitle>
          <DialogDescription>
            {t('omp.guidedGoal.description', {
              defaultValue: 'Answer a few questions to define your goal. OMP will guide you through the process.',
            })}
          </DialogDescription>
        </DialogHeader>

        {/* Error message */}
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Conversation area */}
        <div className="min-h-[200px] space-y-3">
          {currentStep.phase === 'loading' && (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              <span className="animate-pulse">{t('common.loading', { defaultValue: 'Loading…' })}</span>
            </div>
          )}

          {(currentStep.phase === 'question' || currentStep.phase === 'summary') && messages.length > 0 && (
            <ScrollArea className="max-h-[280px]">
              <div className="space-y-3 pr-3">
                {messages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`rounded-lg px-3 py-2 text-sm ${
                      msg.role === 'assistant'
                        ? 'bg-foreground/5 text-foreground'
                        : 'bg-amber-500/10 text-foreground ml-8'
                    }`}
                  >
                    {msg.role === 'assistant' ? (
                      <div className="font-medium text-xs text-amber-400/70 mb-1">
                        {t('omp.guidedGoal.assistant', { defaultValue: 'Assistant' })}
                      </div>
                    ) : (
                      <div className="font-medium text-xs text-amber-400/70 mb-1">
                        {t('omp.guidedGoal.you', { defaultValue: 'You' })}
                      </div>
                    )}
                    <div className="whitespace-pre-wrap break-words">{msg.content || <em className="text-muted-foreground/50">(skipped)</em>}</div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}

          {currentStep.phase === 'summary' && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 space-y-2">
              <div className="text-sm font-medium text-amber-300">
                {t('omp.guidedGoal.summaryTitle', { defaultValue: 'Goal Summary' })}
              </div>
              <div className="space-y-1 text-sm">
                <div className="flex items-start gap-2">
                  <span className="text-muted-foreground shrink-0">
                    {t('omp.guidedGoal.objective', { defaultValue: 'Objective' })}:
                  </span>
                  <span className="text-foreground">{currentStep.objective}</span>
                </div>
                {currentStep.tokenBudget !== undefined && (
                  <div className="flex items-start gap-2">
                    <span className="text-muted-foreground shrink-0">
                      {t('omp.guidedGoal.tokenBudget', { defaultValue: 'Token budget' })}:
                    </span>
                    <span className="text-foreground">{currentStep.tokenBudget.toLocaleString()}</span>
                  </div>
                )}
                {currentStep.mode && (
                  <div className="flex items-start gap-2">
                    <span className="text-muted-foreground shrink-0">
                      {t('omp.guidedGoal.mode', { defaultValue: 'Mode' })}:
                    </span>
                    <span className="text-foreground">{currentStep.mode}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* User input (only during question phase) */}
          {currentStep.phase === 'question' && (
            <Textarea
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              placeholder={t('omp.guidedGoal.inputPlaceholder', {
                defaultValue: 'Type your answer…',
              })}
              disabled={sending}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleNext()
                }
              }}
              className="min-h-[60px] text-sm"
            />
          )}
        </div>

        <DialogFooter className="items-center gap-2 sm:justify-between">
          {/* Left-side back button */}
          <div className="flex items-center gap-1">
            {currentStep.phase === 'question' && messages.length >= 2 && (
              <Button variant="ghost" size="sm" onClick={handleBack} disabled={sending}>
                <SkipBack className="mr-1 h-3.5 w-3.5" />
                {t('common.back', { defaultValue: 'Back' })}
              </Button>
            )}
          </div>

          {/* Right-side action buttons */}
          <div className="flex items-center gap-2">
            {currentStep.phase === 'question' && (
              <>
                <Button variant="ghost" size="sm" onClick={handleSkip} disabled={sending}>
                  <SkipForward className="mr-1 h-3.5 w-3.5" />
                  {t('common.skip', { defaultValue: 'Skip' })}
                </Button>
                <Button variant="ghost" size="sm" onClick={handleCancel} disabled={sending}>
                  <X className="mr-1 h-3.5 w-3.5" />
                  {t('common.cancel', { defaultValue: 'Cancel' })}
                </Button>
                <Button
                  size="sm"
                  onClick={handleNext}
                  disabled={!userInput.trim() || sending}
                >
                  {sending ? (
                    <span className="animate-pulse">{t('common.sending', { defaultValue: 'Sending…' })}</span>
                  ) : (
                    <>
                      {t('common.next', { defaultValue: 'Next' })}
                      <SkipForward className="ml-1 h-3.5 w-3.5" />
                    </>
                  )}
                </Button>
              </>
            )}

            {currentStep.phase === 'summary' && (
              <>
                <Button variant="ghost" size="sm" onClick={handleCancel}>
                  <X className="mr-1 h-3.5 w-3.5" />
                  {t('common.cancel', { defaultValue: 'Cancel' })}
                </Button>
                <Button size="sm" onClick={handleFinish}>
                  <Check className="mr-1 h-3.5 w-3.5" />
                  {t('common.finish', { defaultValue: 'Finish' })}
                </Button>
              </>
            )}

            {currentStep.phase === 'loading' && (
              <Button variant="ghost" size="sm" onClick={handleCancel} disabled={sending}>
                <X className="mr-1 h-3.5 w-3.5" />
                {t('common.cancel', { defaultValue: 'Cancel' })}
              </Button>
            )}

            {currentStep.phase === 'done' && (
              <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
                {t('common.close', { defaultValue: 'Close' })}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Parse the guided_goal_turn response from the command result.
 * The OMP backend returns a JSON object that may contain:
 * - assistantMessage: the OMP assistant's question/prompt
 * - isFinal: signals the final round
 * - objective / tokenBudget / mode: summary fields when final
 */
function parseTurnData(result: unknown): GuidedGoalTurnData | null {
  if (!result || typeof result !== 'object') return null

  const obj = result as Record<string, unknown>

  const assistantMessage = typeof obj.assistantMessage === 'string'
    ? obj.assistantMessage
    : typeof obj.question === 'string'
      ? obj.question
      : undefined

  const isFinal = obj.isFinal === true || obj.complete === true || obj.finished === true
  const objective = typeof obj.objective === 'string' ? obj.objective : undefined
  const tokenBudget = typeof obj.tokenBudget === 'number' ? obj.tokenBudget : undefined
  const mode = typeof obj.mode === 'string' ? obj.mode : undefined

  // If there's no data at all, return null
  if (!assistantMessage && !isFinal && !objective) return null

  return { assistantMessage, isFinal, objective, tokenBudget, mode }
}
