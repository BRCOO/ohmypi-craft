export type OmpFeatureCenterSection = 'models' | 'advisor' | 'native-plan' | 'skills' | 'mcp' | 'agents'

export const OMP_FEATURE_CENTER_SECTION_EVENT = 'craft:focus-omp-section'

let pendingSection: OmpFeatureCenterSection | null = null

export function requestOmpFeatureCenterSection(section: OmpFeatureCenterSection): void {
  pendingSection = section
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<{ section: OmpFeatureCenterSection }>(OMP_FEATURE_CENTER_SECTION_EVENT, {
    detail: { section },
  }))
}

export function consumePendingOmpFeatureCenterSection(): OmpFeatureCenterSection | null {
  const section = pendingSection
  pendingSection = null
  return section
}

export function clearPendingOmpFeatureCenterSectionForTests(): void {
  pendingSection = null
}
