import * as React from 'react'
import type { OmpFeatureId } from '@craft-agent/shared/protocol'
import { useOmpCapabilities } from '@/hooks/useOmpCapabilities'

interface OmpCapabilityGateProps {
  sessionId: string
  feature: OmpFeatureId
  command?: string
  children: React.ReactNode
  fallback?: React.ReactNode
}

/**
 * Renders children only when the active OMP session advertises support for
 * the requested feature/command. Provides a disabled/informational fallback
 * when the capability is missing.
 */
export function OmpCapabilityGate({
  sessionId,
  feature,
  command,
  children,
  fallback,
}: OmpCapabilityGateProps): React.ReactElement {
  const { loading, isFeatureSupported, isCommandSupported, getFeatureReason } = useOmpCapabilities(sessionId)

  const supported = React.useMemo(() => {
    const featureOk = isFeatureSupported(feature)
    const commandOk = command ? isCommandSupported(command) : true
    return featureOk && commandOk
  }, [isFeatureSupported, isCommandSupported, feature, command])

  if (loading) {
    return (
      <span className="text-muted-foreground text-sm" aria-busy="true" aria-label="Checking OMP capability">
        …
      </span>
    )
  }

  if (!supported) {
    const reason = getFeatureReason(feature)
    return (
      <span className="text-muted-foreground text-sm" title={reason ?? 'This feature is not supported by the current OMP runtime'}>
        {fallback ?? reason ?? 'Not supported'}
      </span>
    )
  }

  return <>{children}</>
}
