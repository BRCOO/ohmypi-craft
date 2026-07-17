import * as storage from '@/lib/local-storage'

export const MAX_PROMPT_HISTORY = 200

export interface PromptHistoryData {
  prompts: string[]
  enabled: boolean
}

const PROMPT_HISTORY_KEY = storage.KEYS.promptHistory

/**
 * Add a prompt to history.
 * - Deduplicates existing entries (case-sensitive)
 * - Inserts at top
 * - Caps list length
 * - Skips empty prompts
 */
export function addPromptToHistory(
  history: string[],
  prompt: string,
  maxEntries = MAX_PROMPT_HISTORY,
): string[] {
  const normalized = prompt.trim()
  if (!normalized) return [...history]

  const filtered = history.filter(p => p !== normalized)
  return [normalized, ...filtered].slice(0, maxEntries)
}

/** Remove a prompt from history. */
export function removePromptFromHistory(history: string[], prompt: string): string[] {
  const normalized = prompt.trim()
  if (!normalized) return [...history]
  return history.filter(p => p !== normalized)
}

/**
 * Normalize a prompt history list:
 * - Trims entries
 * - Drops empty values
 * - Deduplicates while preserving first-seen order
 * - Caps length
 */
export function normalizePromptHistory(
  prompts: string[],
  maxEntries = MAX_PROMPT_HISTORY,
): string[] {
  const unique: string[] = []
  const seen = new Set<string>()

  for (const value of prompts) {
    const normalized = value.trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    unique.push(normalized)
    if (unique.length >= maxEntries) break
  }

  return unique
}

/** Read prompt history from local storage (workspace-scoped when workspaceId provided). */
export function getPromptHistory(workspaceId?: string): PromptHistoryData {
  return storage.get<PromptHistoryData>(
    PROMPT_HISTORY_KEY,
    { prompts: [], enabled: true },
    workspaceId,
  )
}

/** Persist a full prompt history data. */
export function setPromptHistoryData(
  data: PromptHistoryData,
  workspaceId?: string,
): PromptHistoryData {
  const normalized = {
    prompts: normalizePromptHistory(data.prompts),
    enabled: data.enabled,
  }
  storage.set(PROMPT_HISTORY_KEY, normalized, workspaceId)
  return normalized
}

/** Add one prompt to history and persist. */
export function addPrompt(
  prompt: string,
  workspaceId?: string,
): string[] {
  const current = getPromptHistory(workspaceId)
  const updated = addPromptToHistory(current.prompts, prompt)
  storage.set(PROMPT_HISTORY_KEY, { ...current, prompts: updated }, workspaceId)
  return updated
}

/** Remove one prompt from history and persist. */
export function removePrompt(prompt: string, workspaceId?: string): string[] {
  const current = getPromptHistory(workspaceId)
  const updated = removePromptFromHistory(current.prompts, prompt)
  storage.set(PROMPT_HISTORY_KEY, { ...current, prompts: updated }, workspaceId)
  return updated
}

/** Clear all prompt history. */
export function clearPromptHistory(workspaceId?: string): void {
  storage.set(PROMPT_HISTORY_KEY, { prompts: [], enabled: true }, workspaceId)
}

/** Set whether prompt history tracking is enabled. */
export function setPromptHistoryEnabled(enabled: boolean, workspaceId?: string): void {
  const current = getPromptHistory(workspaceId)
  storage.set(PROMPT_HISTORY_KEY, { ...current, enabled }, workspaceId)
}
