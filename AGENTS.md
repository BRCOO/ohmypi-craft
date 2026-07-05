# Project Memory: OMP adaptation

Last updated: 2026-07-05

## Current direction

This repository is a fresh second-development Git repository based on `craft-agents-oss`. It adapts Craft into an OMP desktop base by integrating Oh My Pi as a first-class backend/provider.

The approved first step is not a renderer rewrite. Build a minimal OMP RPC backend that satisfies Craft's existing `AgentBackend` contract, then let Craft's current session manager, event processor, permission UI, workspace UI, persistence, and Electron packaging do the product-shell work.

## Related local repositories

- Active second-development repo: `D:\ALL PROJECT\ohmypi-craft`
- Upstream Craft reference clone: `D:\ALL PROJECT\craft-agents-oss`
- OMP upstream/reference engine: `D:\ALL PROJECT\oh-my-pi-upstream`
- Existing OMP desktop prototype: `D:\ALL PROJECT\ohmypi`

Use CodeGraph before broad grep/find/manual source reading when locating or understanding code. The reference repositories already have `.codegraph/` indexes; this second-development repo should keep its own local `.codegraph/` index as well.

## Architectural anchors

- Craft session orchestration: `packages/server-core/src/sessions/SessionManager.ts`
- Craft backend factory: `packages/shared/src/agent/backend/factory.ts`
- Craft backend interface: `packages/shared/src/agent/backend/types.ts`
- Craft normalized chat event type: `packages/core/src/types/message.ts`
- OMP RPC mode: `D:\ALL PROJECT\oh-my-pi-upstream\packages\coding-agent\src\modes\rpc\rpc-mode.ts`
- OMP RPC types: `D:\ALL PROJECT\oh-my-pi-upstream\packages\coding-agent\src\modes\rpc\rpc-types.ts`
- Existing OMP desktop RPC host reference: `D:\ALL PROJECT\ohmypi\src\main\rpcClient.ts`
- Existing OMP desktop frame normalizer reference: `D:\ALL PROJECT\ohmypi\src\shared\ompProtocol.ts`

## Durable decisions

- Start with OMP RPC over stdio, not direct `@oh-my-pi/pi-coding-agent` SDK embedding.
- Keep OMP as a separate provider/backend slug from Craft's existing `pi` backend to avoid dependency and naming confusion.
- Translate OMP RPC frames into Craft `AgentEvent` values at the backend boundary.
- Keep current `ohmypi` as a protocol/reference implementation until Craft reaches feature parity.
- Preserve `.codegraph/` as an untracked local index; do not commit it.

## Current branch

- Branch: `main` in a fresh local Git repository
- Phase: design/spec before implementation
- Spec: `docs/superpowers/specs/2026-07-05-omp-rpc-backend-design.md`

## Verification expectations

- Add unit tests for OMP RPC frame-to-`AgentEvent` mapping before relying on UI tests.
- Verify minimal Electron/dev startup on Windows early because Craft scripts include some Unix-flavored commands.
- Avoid touching unrelated Craft surfaces while the backend seam is still being proven.
