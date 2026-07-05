import type {
  PermissionRequest,
  CredentialRequest,
  CredentialResponse,
  ExtensionUiRequest,
  ExtensionUiResponse,
} from '../../../../../shared/types'
import type { AdminApprovalRequestData } from './AdminApprovalRequest'

/**
 * Input mode determines which component is rendered in InputContainer
 */
export type InputMode = 'freeform' | 'structured'

/**
 * Types of structured input UIs
 */
export type StructuredInputType = 'permission' | 'credential' | 'admin_approval' | 'extension_ui'

/**
 * Union type for structured input data
 */
export type StructuredInputData =
  | { type: 'permission'; data: PermissionRequest }
  | { type: 'credential'; data: CredentialRequest }
  | { type: 'admin_approval'; data: AdminApprovalRequestData }
  | { type: 'extension_ui'; data: ExtensionUiRequest }

/**
 * State for structured input
 */
export interface StructuredInputState {
  type: StructuredInputType
  data: PermissionRequest | CredentialRequest | AdminApprovalRequestData | ExtensionUiRequest
}

/**
 * Response from permission request
 */
export interface PermissionResponse {
  type: 'permission'
  allowed: boolean
  alwaysAllow: boolean
}

/**
 * Response from admin approval request
 */
export interface AdminApprovalResponse {
  type: 'admin_approval'
  approved: boolean
  rememberForMinutes?: number
}

/**
 * Response from an OMP extension UI request
 */
export interface ExtensionUiStructuredResponse {
  type: 'extension_ui'
  response: ExtensionUiResponse
}

/**
 * Union type for all structured responses
 */
export type StructuredResponse =
  | PermissionResponse
  | CredentialResponse
  | AdminApprovalResponse
  | ExtensionUiStructuredResponse

// Re-export CredentialResponse for convenience
export type { CredentialResponse }
