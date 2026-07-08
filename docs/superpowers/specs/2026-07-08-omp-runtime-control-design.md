# OMP Runtime Control and Session Statistics Design

Date: 2026-07-08

## Goal

Expose Oh My Pi's runtime context, compaction, retry, fallback, and session statistics in Craft without creating a second source of truth. OMP remains authoritative for runtime behavior; Craft maintains a typed, read-only projection plus explicit RPC controls.

This batch covers:

- `get_state.contextUsage`
- `get_session_stats`
- `compact`
- `set_auto_compaction`
- `set_auto_retry`
- `abort_retry`
- `auto_compaction_start` and `auto_compaction_end`
- `auto_retry_start` and `auto_retry_end`
- `retry_fallback_applied` and `retry_fallback_succeeded`
- the OMP-only runtime section in the existing session information popover

It does not add compaction strategy editing, raw prompt/tool dumps, retry-policy editing, or a permanent status bar in the chat composer.

## Product behavior

The existing session information popover gains an OMP runtime section for OMP-backed sessions only. Non-OMP sessions keep their current UI and transport behavior.

The section contains three groups:

1. **Context** — used tokens, context-window size, percentage, and a progress indicator. Missing usage is shown as unavailable rather than as zero.
2. **Session statistics** — user/assistant messages, tool calls/results, input/output/reasoning/cache-read/cache-write/total tokens, premium requests, and cost. Opening the popover refreshes this data; the last successful snapshot remains visible during refresh.
3. **Runtime controls** — manual compact, auto-compaction toggle, a tri-state auto-retry control, and cancel-retry while a retry delay is active.

Active compaction displays reason, action, and outcome. Active retry displays attempt, maximum attempts, delay, and the latest error. Fallback events display the source model, target model, role, and success state. Completed transient activity remains visible as the latest runtime result until replaced by a newer event or session switch.

Manual compact accepts no custom instructions in this batch. The protocol method retains optional `customInstructions` support so a later UI can add it without changing the backend boundary.

The automatic compaction and retry switches edit OMP's own persistent settings; they are not Craft session options. The information popover makes this global OMP scope explicit. A successful mutation invalidates cached values for other live OMP sessions so they cannot continue presenting a stale setting as authoritative.

## Architecture

### Protocol boundary

Extend the repository-local OMP protocol snapshot with the five commands and strict parsers for:

- context usage
- session statistics
- compaction results
- compaction lifecycle frames
- retry lifecycle frames
- retry fallback frames

Parsers validate the fields Craft consumes and preserve optional upstream fields where useful. Invalid payloads are rejected and recorded by the existing OMP diagnostics path; they are never silently converted to zero-valued statistics.

### Runtime reducer

Add a focused OMP runtime-state reducer beside the RPC adapter. It owns no process or UI behavior. Given a previous snapshot and one parsed state/response/event, it produces the next immutable snapshot.

The snapshot contains:

- context usage and session statistics
- `isCompacting`, compaction phase/reason/action/result/error
- auto-compaction enabled state
- auto-retry enabled state when known
- retry phase/attempt/max attempts/delay/error/result
- latest model fallback transition
- refresh flags, last error, and update timestamp

`get_state` is authoritative for context usage and auto-compaction. Upstream currently does not expose auto-retry in `RpcSessionState`; therefore Craft treats auto-retry as an optional known value. A successful `set_auto_retry` response updates the local projection, but a new process/session starts with the value unknown until the user changes it or upstream exposes it. In the unknown state the UI presents explicit Enable and Disable actions; after either succeeds it can render the normal switch value. It never guesses that unknown means disabled.

### Backend and session bridge

`OmpRpcBackend` owns one runtime snapshot per live backend instance. It initializes it from `get_state`, refreshes statistics on demand, and reduces lifecycle events as frames arrive. Backend methods expose only the supported operations and return typed results.

`SessionManager` checks that the active backend is OMP, delegates the operation, and publishes the resulting snapshot through the existing session command/update transport. The manager does not reproduce compaction or retry state machines.

The renderer stores the snapshot per session so switching sessions cannot leak runtime state. Disposing or recreating an OMP backend clears transient activity and repopulates authoritative state from the new process.

## Data flow

1. Starting or restoring an OMP backend requests `get_state` and seeds the runtime snapshot.
2. Opening the information popover requests a runtime refresh. Context comes from `get_state`; statistics come from `get_session_stats`.
3. The user invokes a control through the normal session-command IPC route.
4. The backend sends the typed OMP command and waits for its correlated response.
5. The reducer applies the response and any asynchronous lifecycle events.
6. SessionManager emits the updated snapshot; only the matching renderer session atom changes.
7. After compaction finishes, the backend refreshes state and statistics so context usage and counts are not stale.

Compaction and statistics use a longer command timeout than ordinary control commands. Toggle and abort commands use the normal short timeout.

## Concurrency and errors

- Manual compact is disabled while streaming or compacting.
- Toggle controls are disabled while their request is pending, preventing duplicate writes.
- Cancel retry is visible only during an active retry wait and is safe to repeat.
- Closing the popover does not cancel an OMP operation.
- A failed refresh preserves the last successful data and shows a scoped retry action.
- A failed mutation rolls back the pending UI state and surfaces the OMP error.
- Process exit clears pending flags, marks the snapshot unavailable, and lets the existing OMP restart/session-restoration path recover it.
- Late responses are correlated by request ID and cannot overwrite a newer session instance.
- Unknown or malformed runtime frames increment diagnostics and do not crash the chat event stream.

## UI details

The runtime section reuses the existing dark OMP visual language and blue-purple accent tokens. Destructive red is reserved for actual failures; retry waiting, compaction progress, and model fallback use neutral or blue-purple status treatments.

Large token and cost values use locale-aware compact formatting while accessible labels retain exact values. The context progress indicator includes text and is not color-only. Buttons and switches expose pending, disabled, and error states to keyboard and assistive-technology users.

All new copy is added to the existing English and Chinese locale files.

## Testing

### Unit tests

- serialize all five commands with their optional arguments
- parse valid and invalid context, statistics, and compaction responses
- reduce every compaction, retry, and fallback event transition
- preserve the last successful snapshot on refresh failure
- reject stale responses from a replaced backend/session generation

### Backend and SessionManager tests

- initialize state from `get_state`
- refresh `get_state` and `get_session_stats` together
- run manual compaction and refresh post-compaction data
- toggle auto-compaction and auto-retry
- abort an active retry
- reject controls for non-OMP, missing, or processing-incompatible sessions
- propagate correlated errors without leaving pending flags set

### Renderer tests

- hide the runtime section for non-OMP sessions
- render known, unknown, loading, and error states
- disable conflicting controls during streaming/compaction/pending mutations
- render retry progress and fallback results
- keep snapshots isolated while switching sessions

### Verification

- run the focused Bun test suites
- run TypeScript checks for shared, server-core, and Electron renderer packages
- perform a real local OMP smoke flow: state/stats, toggle round trips, and manual compact on a disposable session
- manually verify the information popover in the dev Electron app

## Completion criteria

This batch is complete when an OMP session can inspect current context and statistics, manually compact, control automatic compaction/retry, cancel a waiting retry, and observe compaction/retry/fallback lifecycle state without stale cross-session data or silent protocol failures.
