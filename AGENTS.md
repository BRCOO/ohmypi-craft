# Project Memory: OMP adaptation

Last updated: 2026-07-11

## Current direction

This repository is a fresh second-development Git repository based on `craft-agents-oss`. It adapts Craft into an OMP desktop base by integrating Oh My Pi as a first-class backend/provider.

The first backend seam is proven. The four 2026-07-11 specs (release quality gates, resource lifecycle, packaged-app smoke tests, and Chinese-default localization governance) have been implemented and verified.

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

- Branch: `codex/omp-rpc-backend`
- Phase: OMP release hardening — quality gates, resource lifecycle, packaged-app smoke tests, and Chinese-default localization governance implemented and verified
- Specs:
  - `docs/superpowers/specs/2026-07-05-omp-rpc-backend-design.md`
  - `docs/superpowers/specs/2026-07-05-omp-extension-ui-bridge-design.md`
  - `docs/superpowers/specs/2026-07-11-omp-release-quality-gates-design.md`
  - `docs/superpowers/specs/2026-07-11-omp-e2e-release-qa-design.md`
  - `docs/superpowers/specs/2026-07-11-omp-resource-lifecycle-design.md`
  - `docs/superpowers/specs/2026-07-11-omp-localization-design.md`
  - `docs/superpowers/specs/2026-07-11-omp-release-reliability-followup-design.md`

## Implementation status

- Added a pure OMP RPC frame adapter under `packages/shared/src/agent/backend/omp/`.
- Added a minimal `OmpRpcBackend` that extends Craft `BaseAgent`, starts `omp --mode rpc`, sends JSONL commands, and drains OMP events through Craft's `EventQueue`.
- Registered `omp` as a separate backend/provider slug in shared model/provider/factory code.
- Kept `omp/default` as a startup fallback and added dynamic model discovery through RPC `get_available_models` plus `get_state`; Craft receives provider-qualified model IDs such as `deepseek/deepseek-v4-flash`.
- Explicit OMP model strings such as `deepseek/deepseek-v4-flash` are translated into an RPC `set_model` call before the next prompt; a real DeepSeek smoke test completed successfully.
- Added an onboarding/provider-select entry for Oh My Pi / OMP. It creates a keyless `omp-local` connection through the normal setup handler, refreshes OMP models immediately, and lets Craft's existing model selector display the full OMP model list.
- Added a typed OMP extension UI bridge across backend, session manager, transport, and renderer. Blocking `select`/`confirm`/`input`/`editor` requests now render inline controls with cancel/timeout responses; host actions cover notifications, status chips, widgets, composer text, and external links.
- Implemented Chinese-default localization governance: `zh-Hans` default, parity/sorted/coverage/string scanners, staged `--strict` lint, and locale tests.
- Implemented release quality gates: `quality:quick`, `quality:verify`, and `release:win` commands; package-integrity and embedded-runtime capability checks; JSON reports next to the installer.
- Implemented MCP/Skills/Agents lifecycle backend contract, DTOs, routing channels, and Feature Center settings UI with directory management (install/uninstall/refresh).
- Implemented end-to-end packaged-app smoke runner with runtime-resolution, session-handshake, plan-mode, feature-discovery, language, and installation scenarios; produces JSON Release QA reports.
- Implemented release reliability follow-up: resource mutations carry active `workspaceId`; quality reports use probed OMP binary version (not Pi dependency pin); CI i18n-changed lint requires explicit merge baseline (`I18N_BASE_REF` / CI target branch) and never falls back to `HEAD~1`.

## Verification expectations

- Keep `quality:quick` green before every commit.
- Re-run `bun run quality:verify` before any release build.
- Run `bun run scripts/smoke/runner.ts` against the installer produced by `release:win` for Release QA sign-off.
- Avoid touching unrelated Craft surfaces while the backend seam is still being proven.
