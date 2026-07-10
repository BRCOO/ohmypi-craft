import type { OmpFeatureCenterStateDto } from '../../shared/types'

export const OMP_FEATURE_CENTER_STATE_EVENT = 'craft:omp-feature-center-state'

export interface OmpFeatureCenterStateEventDetail {
  workspaceKey: string
  state: OmpFeatureCenterStateDto | null
}

type WorkspaceId = string | null | undefined
type StateLoader = (workspaceId?: string | null) => Promise<OmpFeatureCenterStateDto>

const GLOBAL_WORKSPACE_KEY = '__global__'
const stateCache = new Map<string, OmpFeatureCenterStateDto>()
const pendingLoads = new Map<string, Promise<OmpFeatureCenterStateDto>>()
const stateVersions = new Map<string, number>()

export function ompFeatureCenterWorkspaceKey(workspaceId: WorkspaceId): string {
  return workspaceId ?? GLOBAL_WORKSPACE_KEY
}

function dispatchStateUpdate(workspaceKey: string, state: OmpFeatureCenterStateDto | null): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<OmpFeatureCenterStateEventDetail>(OMP_FEATURE_CENTER_STATE_EVENT, {
    detail: { workspaceKey, state },
  }))
}

export function getCachedOmpFeatureCenterState(workspaceId: WorkspaceId): OmpFeatureCenterStateDto | null {
  return stateCache.get(ompFeatureCenterWorkspaceKey(workspaceId)) ?? null
}

export function publishOmpFeatureCenterState(
  workspaceId: WorkspaceId,
  state: OmpFeatureCenterStateDto,
): void {
  const workspaceKey = ompFeatureCenterWorkspaceKey(workspaceId)
  stateVersions.set(workspaceKey, (stateVersions.get(workspaceKey) ?? 0) + 1)
  stateCache.set(workspaceKey, state)
  pendingLoads.delete(workspaceKey)
  dispatchStateUpdate(workspaceKey, state)
}

export function invalidateOmpFeatureCenterState(workspaceId: WorkspaceId): void {
  const workspaceKey = ompFeatureCenterWorkspaceKey(workspaceId)
  stateVersions.set(workspaceKey, (stateVersions.get(workspaceKey) ?? 0) + 1)
  stateCache.delete(workspaceKey)
  pendingLoads.delete(workspaceKey)
  dispatchStateUpdate(workspaceKey, null)
}

export async function loadCachedOmpFeatureCenterState(
  workspaceId: WorkspaceId,
  loader: StateLoader,
): Promise<OmpFeatureCenterStateDto> {
  const workspaceKey = ompFeatureCenterWorkspaceKey(workspaceId)
  const cached = stateCache.get(workspaceKey)
  if (cached) return cached

  const pending = pendingLoads.get(workspaceKey)
  if (pending) return pending

  const requestVersion = stateVersions.get(workspaceKey) ?? 0
  const request = loader(workspaceId)
    .then((state) => {
      if (
        (stateVersions.get(workspaceKey) ?? 0) === requestVersion
        && pendingLoads.get(workspaceKey) === request
      ) {
        stateCache.set(workspaceKey, state)
        dispatchStateUpdate(workspaceKey, state)
      }
      return state
    })
    .finally(() => {
      if (pendingLoads.get(workspaceKey) === request) {
        pendingLoads.delete(workspaceKey)
      }
    })

  pendingLoads.set(workspaceKey, request)
  return request
}

export function clearOmpFeatureCenterStateCacheForTests(): void {
  stateCache.clear()
  pendingLoads.clear()
  stateVersions.clear()
}
