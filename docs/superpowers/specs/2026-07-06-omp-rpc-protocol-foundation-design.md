# OMP RPC Protocol Foundation Design

Date: 2026-07-06

## Status

Design approved; written specification awaiting final review.

## Objective

Make the existing OMP backend protocol-correct and lifecycle-safe before adding more OMP features. This batch must eliminate local-only slash-command hangs, decode standard OMP responses correctly, bind each running backend to the real OMP session state, and introduce a typed protocol boundary that later batches can extend.

## Scope

This batch includes:

- A repository-local, minimal snapshot of the OMP RPC types required by the current backend.
- Correct decoding of `ready`, `response`, `prompt_result`, and the session state returned by `get_state`.
- Runtime `get_state` synchronization on the same OMP process that handles chat.
- Correct completion behavior when a prompt invokes no agent.
- Idempotent turn completion when frames arrive in different valid orders.
- State resynchronization after the OMP subprocess restarts.
- Focused unit and subprocess lifecycle tests.

This batch does not include:

- Image payloads.
- Thinking-level RPC commands.
- Dynamic slash-command UI.
- Session switching, branching, handoff, or export.
- Subagent, Todo, Host Tool, or Host URI support.
- Renderer changes beyond behavior already driven by existing `AgentEvent` values.

## Constraints

- `ohmypi-craft` must remain independently buildable and must not import source files through an absolute path to `oh-my-pi-upstream`.
- The protocol snapshot must contain only the shapes used by this batch, not a copy of the full 500-line upstream file.
- The existing stdio JSONL transport remains in place.
- Existing model discovery behavior must continue to work.
- A turn must emit at most one Craft `complete` event.
- Unknown future frames must not crash the backend.

## Approaches Considered

### 1. Independent protocol module

Create a small OMP RPC protocol module and keep process orchestration, frame adaptation, and turn completion as separate responsibilities.

Advantages:

- Clear ownership of wire shapes.
- Compile-time checks for command and response handling.
- Easy to extend toward the complete 39-command protocol.
- Focused contract tests can detect upstream drift.

Cost:

- Adds a small module and a few explicit conversion functions.

### 2. Patch the existing backend and adapter in place

Advantages:

- Fewer files in the immediate change.

Rejected because:

- The adapter already mixes event translation with response parsing.
- Adding more commands would continue growing untyped `Record<string, unknown>` paths.
- Completion races would remain difficult to reason about and test.

### 3. Import OMP upstream protocol types directly

Advantages:

- Exact type synchronization when the upstream source is present.

Rejected because:

- The desktop repository would depend on an adjacent checkout or an unpublished package export.
- Windows packaging and CI could not rely on the local upstream path.
- Upstream types import many OMP-internal types that the desktop product does not otherwise need.

## Architecture

### Protocol module

Add a module under `packages/shared/src/agent/backend/omp/` that defines:

- The first-batch outbound commands: `prompt`, `steer`, `abort`, `set_model`, `get_state`, and the existing extension UI side-channel response.
- A base response frame with `id`, `command`, `success`, `data`, and `error`.
- `RpcSessionState` fields required by the host: `sessionId`, `sessionFile`, `sessionName`, current model, thinking level, streaming/compaction flags, queue modes, auto-compaction state, message count, queued count, Todo phases, and context usage. Fields not yet consumed remain optional and are preserved in the raw state.
- `prompt_result` with `id` and `agentInvoked`.
- Structural parsing helpers that reject malformed response envelopes without throwing on unknown event frames.

The snapshot will cite the upstream source path and scan date in a comment. It will not expose an unstable public package API outside the OMP backend folder.

### Frame adapter

`OmpRpcEventAdapter` remains responsible for converting asynchronous OMP events to Craft `AgentEvent` values. It will:

- Read `raw.data` as the response payload instead of wrapping the remaining envelope fields.
- Surface a typed response object to the backend.
- Surface `prompt_result` as turn-control metadata rather than a chat message.
- Continue translating text, tools, notices, extension UI, and compaction events.
- Stop treating a non-standard `ready.sessionId` as the primary session identity, while retaining it as compatibility metadata.

### Backend process and request layer

`OmpRpcBackend` remains responsible for:

- Subprocess creation and destruction.
- Request IDs, timeouts, and pending request settlement.
- Runtime state synchronization.
- Model selection.
- Turn completion.

The request helper becomes generic over a typed command and expected data shape. Side-channel frames remain separate because they do not receive a correlated response.

### Runtime state

After the backend receives `ready`, it immediately sends `get_state` to that same subprocess. The backend does not resolve its ready promise until the state request succeeds.

The synchronized state is stored on the backend and used to:

- Call `onSdkSessionIdUpdate` with the real OMP session ID.
- Preserve session file and name for diagnostics and later feature batches.
- Confirm the backend is usable before accepting the first prompt.

If `get_state` fails, startup fails with a specific state-synchronization error. A ready process without readable state is not considered healthy.

On subprocess replacement, cached state and selected-model state are cleared and rebuilt.

## Turn Completion State Machine

Each call to `chatImpl` creates a turn-local completion state with an idempotent `finishTurn()` operation.

The turn can finish through one of these paths:

1. OMP emits `agent_end`.
2. OMP emits `prompt_result` with `agentInvoked:false`.
3. The correlated `prompt` response includes `agentInvoked:false` in a compatible response shape.
4. The request fails or the child process exits.
5. The user aborts the turn.

Rules:

- `finishTurn()` enqueues at most one `complete` event and closes the queue once.
- `agentInvoked:true` never completes the turn by itself; the backend waits for `agent_end`.
- `prompt_result` and `agent_end` may arrive in either order without duplicate completion.
- Command output received before a local-only completion is emitted normally.
- An uncorrelated `prompt_result` is logged and ignored unless it belongs to the active prompt request.
- A late response from an invalidated subprocess generation cannot affect the current turn.

## Request and Response Data Flow

### Normal agent prompt

1. Ensure the OMP process is ready and state-synchronized.
2. Ensure the selected model is applied.
3. Send a typed `prompt` command and retain its generated request ID as the active prompt request.
4. Stream message and tool events through the adapter.
5. Settle the request when its `response` arrives.
6. Wait for `agent_end`, then complete once.

### Local-only slash command

1. Send the command through the normal `prompt` command.
2. Render any `command_output` events.
3. Receive either a response or `prompt_result` indicating `agentInvoked:false`.
4. Complete the Craft turn immediately and exactly once.

### Startup

1. Spawn `omp --mode rpc`.
2. Receive `ready`.
3. Send `get_state` on the same process.
4. Validate the required `sessionId`.
5. Publish the session ID and resolve readiness.

## Error Handling

- Malformed JSON remains a debug log and does not crash the process.
- A malformed correlated response rejects that request with a protocol error.
- A successful `get_state` response without a valid `sessionId` fails startup.
- A `get_state` timeout reports a state-synchronization timeout, not a generic ready timeout.
- Unknown frames are ignored with sampled debug logging.
- Child failure rejects ready and all pending requests, clears cached runtime state, and completes an active turn once.
- A response from an old process generation cannot settle a new process request.

## Test Design

### Protocol tests

- Decode a standard success response and return exactly `raw.data`.
- Decode an error response.
- Preserve empty or absent data without fabricating nested payloads.
- Decode `prompt_result`.
- Decode a valid and invalid session state.

### Adapter tests

- Standard response data is not double-wrapped.
- `prompt_result` produces turn-control metadata and no visible chat event.
- Unknown frames remain harmless.
- Existing text, tool, extension UI, and compaction fixtures continue passing.

### Backend lifecycle tests

- `ready` triggers `get_state` before the ready promise resolves.
- Real session ID reaches `onSdkSessionIdUpdate`.
- Missing session ID fails readiness.
- Local-only prompt completes without `agent_end`.
- Normal prompt does not complete at the initial response and waits for `agent_end`.
- `prompt_result` followed by `agent_end` completes once.
- `agent_end` followed by `prompt_result` completes once.
- Child exit during state synchronization rejects startup.
- Child restart clears state and repeats synchronization.
- Model selection still occurs after synchronization.

### Verification

- Shared package typecheck.
- OMP backend unit tests.
- Existing OMP model-discovery tests.
- A real local OMP RPC smoke test running `get_state` and a local-only command.
- Electron startup smoke test to ensure session creation still works.

## Compatibility and Rollout

- Keep compatibility parsing for legacy response frames only where it does not change standard semantics.
- Do not silently accept a ready process with no valid session state.
- No persistence schema migration is required in this batch; session file/name are held for diagnostics and later persistence work.
- The protocol module is internal, allowing later batches to add commands without changing external backend interfaces.

## Completion Criteria

This batch is complete when:

- Standard OMP response data is decoded correctly.
- `/stats` or another local-only OMP command returns output and leaves the session idle.
- A normal prompt still streams and completes once.
- The backend publishes the real runtime OMP session ID obtained from `get_state`.
- Restart paths resynchronize state.
- Typecheck, focused unit tests, real OMP smoke tests, and Electron startup all pass.
