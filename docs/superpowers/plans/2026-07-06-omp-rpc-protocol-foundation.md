# OMP RPC Protocol Foundation Implementation Plan

**Date:** 2026-07-06  
**Status:** Approved for implementation  
**Design:** `docs/superpowers/specs/2026-07-06-omp-rpc-protocol-foundation-design.md`

## Goal

Make the existing OMP RPC backend lifecycle reliable before adding more OMP features. The backend must decode OMP response payloads correctly, synchronize the real OMP session state before becoming ready, and finish every prompt exactly once even when terminal frames race.

## Task 1: Add a minimal local OMP protocol snapshot

Files:

- Add `packages/shared/src/agent/backend/omp/omp-rpc-protocol.ts`
- Add `packages/shared/src/agent/backend/omp/__tests__/omp-rpc-protocol.test.ts`

Implementation:

1. Define only the command and frame shapes used by this batch: `ready`, `response`, `prompt_result`, `get_state`, `prompt`, `abort`, `steer`, `set_model`, and extension UI responses.
2. Define the minimal `RpcSessionState` fields needed to validate and retain the runtime state, with `sessionId` required.
3. Add defensive parsers for response envelopes, prompt-result frames, and session state.
4. Document the upstream source path and snapshot date in the module header.

Verification:

- Response parsing returns `response.data` directly.
- Missing or invalid response fields are rejected without throwing.
- Session state without a non-empty `sessionId` is rejected.
- Unknown extra fields remain forward-compatible.

## Task 2: Move protocol interpretation out of the event adapter

Files:

- Modify `packages/shared/src/agent/backend/omp/omp-rpc-adapter.ts`
- Modify `packages/shared/src/agent/backend/omp/__tests__/omp-rpc-adapter.test.ts`

Implementation:

1. Reuse the new protocol parsers for response and prompt-result frames.
2. Fix the current nested response bug so `{ data: value }` resolves as `value`, not `{ data: value }`.
3. Surface `prompt_result` as control metadata for the backend.
4. Treat `agent_end` as a terminal signal only; the backend will emit the single normalized `complete` event.
5. Preserve tolerant handling of unknown future frames.

Verification:

- Update response fixtures to assert the unwrapped value.
- Add prompt-result coverage for local-only and agent-invoked prompts.
- Confirm `agent_end` no longer creates a second completion event in the adapter.

## Task 3: Synchronize the real OMP session after `ready`

Files:

- Modify `packages/shared/src/agent/backend/omp/omp-rpc-backend.ts`
- Modify `packages/shared/src/agent/backend/omp/__tests__/omp-rpc-backend.test.ts`

Implementation:

1. On a `ready` frame, stop the ready-frame timer and send `get_state` through the same subprocess and request map.
2. Resolve backend readiness only after a valid state response containing `sessionId` is received.
3. Store the synchronized state and publish the real session ID through the existing callback.
4. Reject startup with a state-synchronization-specific error if `get_state` fails, times out, or returns invalid data.
5. Clear synchronized state and synchronization guards whenever the child exits or is replaced.

Verification:

- Assert that `get_state` is sent after `ready` and before readiness resolves.
- Assert that invalid state prevents startup.
- Assert that restart obtains and publishes a fresh session ID.
- Assert that stale callbacks from an old child cannot overwrite new state.

## Task 4: Make prompt completion idempotent

Files:

- Modify `packages/shared/src/agent/backend/omp/omp-rpc-backend.ts`
- Extend `packages/shared/src/agent/backend/omp/__tests__/omp-rpc-backend.test.ts`

Implementation:

1. Track the active prompt request ID and process generation.
2. Add one `finishTurn` path that enqueues exactly one normalized `complete` event and closes the event queue exactly once.
3. Finish immediately when a correlated prompt response or `prompt_result` reports `agentInvoked: false`.
4. Keep streaming when `agentInvoked: true`; finish only on `agent_end`, abort, or failure.
5. Ignore duplicate, late, stale-generation, or mismatched terminal signals.

Verification:

- Local-only prompt response completes without `agent_end`.
- Local-only `prompt_result` completes without `agent_end`.
- Both terminal-frame orders produce one and only one completion event.
- Normal prompts do not finish before `agent_end`.
- Abort and process failure close the active turn without hanging.

## Task 5: Run focused and integration verification

Commands:

1. Run OMP protocol, adapter, and backend unit tests.
2. Run the shared package typecheck or the narrowest available repository typecheck.
3. Run the existing OMP RPC smoke test against the locally installed OMP executable when available.
4. Start the Electron development build long enough to verify that the backend reaches ready state and reports the synchronized session ID.

Exit criteria:

- All focused tests pass.
- No TypeScript errors are introduced in the touched package.
- A local-only OMP command no longer leaves Craft waiting indefinitely.
- Normal streamed prompts still end correctly.
- Restarted subprocesses publish the new OMP session state.

## Explicitly deferred

- Image prompt transport
- Thinking/reasoning fidelity
- Dynamic slash-command UI
- Branching and session-tree UI
- OMP subagents, Todo phases, and host tools
- Full TUI and CLI parity
