# OMP RPC backend for Craft

Date: 2026-07-05

## Status

Design approved at direction level. Implementation has not started in this branch.

## Objective

Make `craft-agents-oss` run Oh My Pi sessions through Craft's existing session/UI infrastructure by adding an OMP RPC backend that implements Craft's `AgentBackend` interface.

This gives OMP a mature desktop shell while avoiding a large renderer rewrite.

## Decision

Use OMP's stdio RPC mode for the first integration:

```text
Craft SessionManager
  -> AgentBackend interface
    -> OmpRpcBackend
      -> child process: omp --mode rpc
        -> OMP AgentSession
```

Direct OMP SDK embedding is deferred until the RPC backend works and dependency/version conflicts are understood.

## Goals

- Add a backend/provider path named `omp`.
- Spawn OMP in RPC mode from the selected Craft workspace/working directory.
- Stream OMP output into Craft `AgentEvent` objects.
- Support a minimal useful session loop:
  - prompt/chat
  - abort
  - model read/set
  - thinking level read/set
  - permission response
  - dispose/restart
- Preserve Craft's session persistence, message rendering, permission UI, workspace selection, and Electron packaging.
- Keep OMP-specific protocol logic isolated and unit-tested.

## Non-goals for Phase 1

- Rebranding the full Craft UI.
- Direct SDK embedding of `@oh-my-pi/pi-coding-agent`.
- Full OMP extension UI parity.
- Full session branching, compact, handoff, export, subagent views, or login-provider UI.
- Removing or rewriting Craft's existing `anthropic` or `pi` backends.

## Existing systems

### Craft

Craft already routes user prompts through:

1. Renderer and transport handlers.
2. `SessionManager.sendMessage`.
3. `SessionManager.getOrCreateAgent`.
4. `createBackendFromResolvedContext`.
5. A concrete `AgentBackend.chat()` async event stream.
6. `SessionManager.processEvent`, which persists and broadcasts normalized events.

The key backend contract is `AgentBackend` in `packages/shared/src/agent/backend/types.ts`.

### OMP

OMP already supports:

- `omp --mode rpc`
- newline-delimited JSON commands on stdin
- response, event, state, command, permission, model, thinking, and extension UI frames on stdout
- command types in `packages/coding-agent/src/modes/rpc/rpc-types.ts`

The current `ohmypi` prototype proves that a desktop host can spawn OMP RPC and normalize frames.

## Proposed components

### 1. OMP backend class

Add a backend class under Craft shared agent code, for example:

```text
packages/shared/src/agent/backend/omp/
  index.ts
  omp-rpc-backend.ts
  omp-rpc-adapter.ts
  omp-rpc-types.ts
```

The class implements `AgentBackend` and owns:

- child process lifecycle
- stdin command queue
- stdout line parsing
- response correlation by `id`
- event queue for `chat()`
- cached RPC session state
- shutdown and restart cleanup

### 2. OMP RPC adapter

Add a pure adapter that maps raw OMP RPC frames to Craft `AgentEvent`.

This should be independent from child process code so it can be tested with fixture frames from `ohmypi` and OMP upstream.

Initial mapping:

| OMP frame | Craft event |
| --- | --- |
| `agent_start` or first prompt acceptance | internal turn start / no direct event unless needed |
| assistant text delta/update | `text_delta` |
| assistant final text/message end | `text_complete` |
| tool execution start | `tool_start` |
| tool execution update | status/debug event or ignored if no stable Craft equivalent |
| tool execution end | `tool_result` |
| permission request | `permission_request` |
| error frame | `error` |
| stream/session completion | `complete` |
| state/context usage | `usage_update` when tokens/window data exists |
| command/available-command updates | stored for later UI work, not surfaced as chat events in Phase 1 |
| extension UI request | initially surface as `info` or a typed error for unsupported blocking UI; support select/confirm/input in a later phase |

When OMP emits a frame with no reliable Craft equivalent, Phase 1 should either store it as debug metadata or ignore it explicitly. It should not invent misleading UI events.

### 3. Backend factory/provider registration

Extend Craft's backend resolution path:

- Add `omp` to the backend provider type union if needed.
- Add provider metadata for display and settings.
- Add a driver/build path that returns `OmpRpcBackend`.
- Keep Craft's existing `pi` backend untouched.

The initial runtime config should include:

- `ompCommand`: default `omp`
- `cwd`: session working directory
- optional environment overrides
- startup timeout

### 4. Session behavior

`chat(message, attachments, options)` should:

1. Ensure the child process is started and ready.
2. Send `{ id, type: "prompt", message, images?, streamingBehavior? }`.
3. Yield mapped Craft events until OMP indicates the turn is complete or errors.
4. Yield `complete` once per turn.

`redirect(message)` should use OMP steering only after a basic prompt path works. In the first implementation it may return `false` so Craft queues/resends using its existing behavior.

`abort()` should send `{ type: "abort" }` and then drain or terminate according to OMP response behavior.

### 5. Model and thinking

Phase 1 should implement the minimal backend methods:

- `getModel()`: return cached model id or configured fallback.
- `setModel(model)`: split provider/model only if Craft provides both; otherwise use provider from current OMP state.
- `getThinkingLevel()`: return cached OMP thinking level or Craft default.
- `setThinkingLevel(level)`: send `set_thinking_level`.

If Craft's model picker requires provider-qualified values, normalize OMP models into a stable `provider/modelId` representation at the provider boundary.

### 6. Permissions

Craft expects `respondToPermission(requestId, allowed, alwaysAllow?)`.

OMP RPC accepts permission-style responses in the current prototype through `permission_response`. The adapter should preserve request ids exactly and map Craft's boolean decision to OMP's approved/denied shape.

Remember/always-allow behavior should remain Craft-owned in Phase 1 unless OMP exposes an equivalent TTL field.

## Error handling

- Invalid JSON from stdout becomes a debug message, not a user-facing crash.
- Spawn failure becomes an `error` event and a backend auth/setup message.
- Startup timeout fails backend initialization and tells the user to check the OMP command path.
- Unexpected child exit completes the active event queue with an `error` followed by `complete`.
- Duplicate terminal events should be deduplicated by turn id or local event queue state.

## Tests

Add focused unit tests before UI tests:

- OMP text frames map to `text_delta` and `text_complete`.
- OMP tool start/end frames map to `tool_start` and `tool_result`.
- Permission request/response ids are preserved.
- Error frames produce `error` and do not hang the chat generator.
- Child exit during an active prompt completes the generator.
- Model/thinking command builders produce the expected OMP RPC frames.

Use fixtures derived from:

- `D:\ALL PROJECT\ohmypi\src\shared\ompProtocol.ts`
- `D:\ALL PROJECT\oh-my-pi-upstream\packages\coding-agent\src\modes\rpc\rpc-types.ts`

## Rollout plan

1. Add OMP backend files and adapter tests.
2. Register the provider behind a narrow configuration path.
3. Launch a single Craft session against local `omp --mode rpc`.
4. Verify prompt, text streaming, tool rendering, permission prompt, abort, and model/thinking updates.
5. Only after the backend loop is stable, start UI branding and OMP-specific feature surfacing.

## Review checklist

- No direct SDK dependency is introduced in Phase 1.
- `pi` and `omp` names remain distinct.
- OMP protocol handling is isolated from renderer code.
- Every unsupported OMP frame has an explicit Phase 1 behavior.
- Unit tests cover the adapter before Electron smoke testing.

