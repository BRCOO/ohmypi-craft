import type { Message } from '@craft-agent/core/types'
import type { OmpBranchOption } from '@craft-agent/shared/protocol'

export interface OmpBranchMessageLike {
  entryId: string
  text: string
}

interface CraftUserBranchMessage {
  id: string
  text: string
}

interface OmpConversationMessage {
  role: 'user' | 'assistant'
  text: string
  providerMessageId?: string
}

function normalizeActionText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function conversationTextsMatch(left: string, right: string): boolean {
  if (left === right) return true
  if (!left || !right) return true
  return left.includes(right) || right.includes(left)
}

function textFromUnknownContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  return content
    .filter((block): block is Record<string, unknown> => !!block && typeof block === 'object')
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text as string)
    .join('\n')
}

function craftUserBranchMessages(messages: readonly Message[]): CraftUserBranchMessage[] {
  return messages
    .filter(message => message.role === 'user')
    .filter(message => !message.isIntermediate && !message.isThinking)
    .map(message => ({
      id: message.id,
      text: normalizeActionText(message.content),
    }))
}

function textPreview(text: string, maxLength = 160): string {
  const normalized = normalizeActionText(text)
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
}

export function mapOmpBranchMessagesToCraftOptions(
  ompBranchMessages: readonly OmpBranchMessageLike[],
  craftMessages: readonly Message[],
): OmpBranchOption[] {
  const craftUsers = craftUserBranchMessages(craftMessages)

  if (craftUsers.length !== ompBranchMessages.length) {
    throw new Error(
      `Cannot map OMP branch points: Craft has ${craftUsers.length} user messages while OMP returned ${ompBranchMessages.length}.`,
    )
  }

  return ompBranchMessages.map((message, index) => {
    const craft = craftUsers[index]
    const ompText = normalizeActionText(message.text)
    if (!craft) {
      throw new Error(`Cannot map OMP branch point ${index + 1}: missing Craft user message.`)
    }
    if (!conversationTextsMatch(craft.text, ompText)) {
      throw new Error(
        `Cannot map OMP branch point ${index + 1}: Craft and OMP user message text differ.`,
      )
    }

    return {
      entryId: message.entryId,
      craftMessageId: craft.id,
      ordinal: index + 1,
      textPreview: textPreview(message.text),
    }
  })
}

export function truncateMessagesBeforeBranch(
  messages: readonly Message[],
  craftMessageId: string,
): Message[] {
  const index = messages.findIndex(message => message.id === craftMessageId)
  if (index < 0) {
    throw new Error(`Cannot branch: Craft message ${craftMessageId} was not found.`)
  }
  return messages.slice(0, index)
}

function extractOmpConversationMessage(value: unknown): OmpConversationMessage | null {
  if (!value || typeof value !== 'object') return null
  const message = value as Record<string, unknown>
  if (message.role !== 'user' && message.role !== 'assistant') return null

  return {
    role: message.role,
    text: textFromUnknownContent(message.content),
    providerMessageId: typeof message.id === 'string' ? message.id : undefined,
  }
}

export function createCraftMessagesFromOmpMessages(
  ompMessages: readonly unknown[],
  createId: () => string,
  createTimestamp: () => number,
): Message[] {
  return ompMessages
    .map(extractOmpConversationMessage)
    .filter((message): message is OmpConversationMessage => message !== null)
    .map((message): Message => ({
      id: createId(),
      role: message.role,
      content: message.text,
      timestamp: createTimestamp(),
      ...(message.role === 'assistant' && message.providerMessageId
        ? { turnId: message.providerMessageId }
        : {}),
    }))
}
