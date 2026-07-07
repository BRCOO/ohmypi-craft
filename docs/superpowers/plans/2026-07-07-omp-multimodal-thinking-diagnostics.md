# OMP Multimodal, Thinking, and Diagnostics Implementation Plan

**Date:** 2026-07-07

**Batch:** 2 of 8

**Design:** `docs/superpowers/specs/2026-07-07-omp-multimodal-thinking-diagnostics-design.md`

## Goal

Complete OMP's protocol-fidelity foundation by transporting native images, applying and presenting thinking levels/content correctly, and exposing redacted runtime diagnostics without weakening batch 1's lifecycle guarantees.

## Task 1: Add native attachment conversion

Files:

- Add `packages/shared/src/agent/backend/omp/omp-rpc-attachments.ts`.
- Add `packages/shared/src/agent/backend/omp/__tests__/omp-rpc-attachments.test.ts`.
- Modify `packages/shared/src/agent/backend/omp/omp-rpc-protocol.ts`.
- Modify `packages/shared/src/agent/backend/omp/omp-rpc-backend.ts`.
- Modify `packages/shared/src/agent/backend/types.ts`.

Steps:

1. Define the local OMP `ImageContent` shape and add `images` plus `streamingBehavior` to prompt/steer command types.
2. Build a converter that separates native images from non-image prompt descriptions.
3. Reuse `IMAGE_LIMITS.MAX_RAW_SIZE`, validate base64 and MIME types, and support injected local-file reads.
4. Preserve explicit text/PDF/Office/audio/unknown fallback descriptions.
5. Reject malformed or oversized supplied image data before the prompt request is written.
6. Emit non-fatal warning events for unreadable path-only images.
7. Serialize `ChatOptions.streamingBehavior` on the prompt.

Tests:

- Base64 image, data-URL normalization, local-path fallback, MIME inference, malformed base64, size limit, unreadable path, and each non-image attachment strategy.
- Exact outbound prompt frame with native images and streaming behavior.
- No base64 appears in prompt text or diagnostics.

## Task 2: Implement OMP thinking-level control

Files:

- Modify `packages/shared/src/agent/backend/omp/omp-rpc-protocol.ts`.
- Modify `packages/shared/src/agent/backend/omp/omp-rpc-backend.ts`.
- Add thinking mapping tests to `packages/shared/src/agent/backend/omp/__tests__/omp-rpc-protocol.test.ts`.
- Extend `packages/shared/src/agent/backend/omp/__tests__/omp-rpc-backend.test.ts`.

Steps:

1. Add `set_thinking_level` command/response shapes and pure Craft↔OMP mapping functions.
2. Track synchronized remote thinking level separately from the persisted Craft preference.
3. Override `setThinkingLevel()` so a connected backend forwards changes.
4. Ensure the selected persistent level is applied after ready/model setup and before every prompt.
5. Apply `thinkingOverride` for one turn and restore the persistent level after every terminal path while the child remains healthy.
6. Clear remote-level state on child replacement and retry a failed restore before the next prompt.
7. Consume `thinking_level_changed` and thinking-related config updates into the remote cache.

Tests:

- All mapping values, including Craft `max` and OMP `minimal`.
- Pre-start selection, connected selection, unchanged-level dedupe, per-turn override, local-only restore, normal restore, abort, failure, and restart.

## Task 3: Carry thinking content through persistence and UI

Files:

- Modify `packages/core/src/types/message.ts`.
- Modify `packages/shared/src/agent/backend/omp/omp-rpc-adapter.ts` and its tests.
- Modify `packages/server-core/src/sessions/SessionManager.ts`.
- Modify `apps/electron/src/renderer/event-processor/types.ts`.
- Modify `apps/electron/src/renderer/event-processor/handlers/text.ts`.
- Modify `packages/ui/src/components/chat/turn-utils.ts`.
- Extend the nearest existing renderer, persistence-parity, and turn-grouping tests.

Steps:

1. Add optional `isThinking` to text delta/complete events and runtime/stored messages.
2. Give the adapter a separate thinking buffer and per-content-block completion tracking.
3. Map thinking start/delta/end and use `message_end` only as a duplicate-safe fallback.
4. Propagate `isThinking` through SessionManager's delta batch and completion event.
5. Flush a pending batch whenever stream kind changes so thinking and answer text never merge.
6. Persist thinking as intermediate assistant messages without updating final-answer metadata.
7. Preserve the flag in renderer streaming handlers and ensure stream lookup distinguishes thinking from answer text.
8. Map thinking messages to `ActivityItem.type === "thinking"` and prohibit final-response promotion.
9. Include thinking content in turn-detail/export output under a distinct heading.

Tests:

- Thinking-only, text-only, thinking→text, multiple thinking blocks, message-end fallback, and duplicate end frames.
- Main/renderer ID and timestamp parity with `isThinking` preserved.
- Persist/reload and turn grouping produce thinking activities, never final responses.

## Task 4: Add redacted protocol diagnostics and version detection

Files:

- Add `packages/shared/src/agent/backend/omp/omp-rpc-diagnostics.ts`.
- Add `packages/shared/src/agent/backend/omp/__tests__/omp-rpc-diagnostics.test.ts`.
- Modify `packages/shared/src/agent/backend/omp/omp-rpc-backend.ts` and its tests.
- Modify `packages/shared/src/agent/backend/omp/omp-runtime-diagnostics.ts` and its tests.
- Modify `packages/shared/src/protocol/dto.ts` where `OmpRuntimeStatus` is defined.
- Modify OMP exports in `packages/shared/src/agent/backend/omp/index.ts`.

Steps:

1. Implement a non-throwing diagnostics accumulator with immutable snapshots.
2. Count frames, requests, latencies, malformed lines, timeouts, orphan/duplicate responses, write failures, and exits.
3. Keep bounded unknown-frame samples containing only type and sorted keys; sample logs at first/power-of-two occurrences.
4. Record only allowlisted session metadata and bounded stderr.
5. Expose `getDiagnostics()` from the backend and reset only process-local state on restart while preserving cumulative counters.
6. Add a short-timeout `--version` probe using the resolved command and injected spawn seam.
7. Add parsed runtime version and explicit `protocolVersion: "unversioned"` to runtime status/diagnostics.
8. Treat successful ready/get_state as the compatibility handshake; version probe failure remains non-fatal.

Tests:

- Counter accuracy, latency updates, timeouts, orphan/duplicate responses, malformed input, exit details, restart behavior, bounded sampling, power-of-two logging, and snapshot immutability.
- Secret redaction for prompts, images, response data, arguments, environment values, and unknown frames.
- Version parsing, timeout, malformed output, configured command arguments, and healthy runtime behavior.

## Task 5: Update acceptance records and verify

Files:

- Modify `docs/omp-feature-parity-todo.md` only for evidence-backed completed items.

Commands and checks:

1. Run all OMP shared tests.
2. Run affected core, server-core, renderer event-processor, and UI turn-grouping tests.
3. Run typechecks for core, shared, server-core, UI, and Electron.
4. Run ESLint on every changed TypeScript/TSX file.
5. Build Electron main and renderer bundles.
6. Run `omp --version` and the existing runtime/model smoke test.
7. Run a real backend thinking-level smoke test.
8. Run a real image prompt when a vision-capable authenticated model is available; otherwise record the authenticated-model limitation and retain mandatory serialization/integration evidence.
9. Verify `git diff --check` and inspect the final worktree for unrelated generated changes.

Exit criteria:

- Native image bytes appear only in OMP `images` frames.
- OMP uses the selected persistent or per-turn thinking level.
- Thinking is distinct, persisted, and correctly grouped in live and reloaded UI state.
- Diagnostics explain unknown/malformed/timeout/orphan/exit behavior without retaining payload secrets.
- Batch 1 lifecycle tests remain green.
- All available checks above pass and the Todo reflects only proven completion.
