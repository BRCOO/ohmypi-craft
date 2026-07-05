import type {
  PermissionRequest as PermissionRequestType,
  CredentialRequest as CredentialRequestType,
  ExtensionUiRequest as ExtensionUiRequestType,
} from '../../../../shared/types'
import { PermissionRequest } from './structured/PermissionRequest'
import { CredentialRequest } from './structured/CredentialRequest'
import { AdminApprovalRequest } from './structured/AdminApprovalRequest'
import { ExtensionUiRequest } from './structured/ExtensionUiRequest'
import type { StructuredInputState, StructuredResponse } from './structured/types'

interface StructuredInputProps {
  state: StructuredInputState
  onResponse: (response: StructuredResponse) => void
  /** When true, removes container styling (shadow, bg, rounded) - used when wrapped by InputContainer */
  unstyled?: boolean
}

/**
 * StructuredInput - Router component for structured input UIs
 *
 * Routes to the appropriate component based on the input type:
 * - permission: PermissionRequest (bash command approval)
 * - credential: CredentialRequest (secure auth input)
 */
export function StructuredInput({ state, onResponse, unstyled = false }: StructuredInputProps) {
  switch (state.type) {
    case 'permission':
      return (
        <PermissionRequest
          request={state.data as PermissionRequestType}
          onResponse={onResponse}
          unstyled={unstyled}
        />
      )
    case 'credential':
      return (
        <CredentialRequest
          request={state.data as CredentialRequestType}
          onResponse={onResponse}
          unstyled={unstyled}
        />
      )
    case 'admin_approval':
      return (
        <AdminApprovalRequest
          request={state.data as import('./structured/AdminApprovalRequest').AdminApprovalRequestData}
          onApprove={({ rememberForMinutes }) => onResponse({ type: 'admin_approval', approved: true, rememberForMinutes })}
          onCancel={() => onResponse({ type: 'admin_approval', approved: false })}
          unstyled={unstyled}
        />
      )
    case 'extension_ui':
      return (
        <ExtensionUiRequest
          request={state.data as ExtensionUiRequestType}
          onResponse={(response) => onResponse({ type: 'extension_ui', response })}
          unstyled={unstyled}
        />
      )
    default:
      return null
  }
}
