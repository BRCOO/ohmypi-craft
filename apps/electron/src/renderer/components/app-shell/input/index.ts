// Main components
export { InputContainer } from './InputContainer'
export { ChatInputZone } from './ChatInputZone'
export { FreeFormInput } from './FreeFormInput'
export { StructuredInput } from './StructuredInput'

// Structured input components
export { PermissionRequest } from './structured/PermissionRequest'
export { ExtensionUiRequest } from './structured/ExtensionUiRequest'

// Hooks
export { useAutoGrow } from './useAutoGrow'

// Types
export { PromptHistoryPicker, usePromptHistory } from './PromptHistoryPicker'
export {
  addPrompt,
  removePrompt,
  clearPromptHistory,
  getPromptHistory,
  setPromptHistoryEnabled,
  type PromptHistoryData,
} from './prompt-history'
export type {
  InputMode,
  StructuredInputType,
  StructuredInputState,
  StructuredInputData,
  StructuredResponse,
  PermissionResponse,
    AdminApprovalResponse,
    ExtensionUiStructuredResponse,
} from './structured/types'
