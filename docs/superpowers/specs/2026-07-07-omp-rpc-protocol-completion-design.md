# OMP RPC Protocol Completion Design

Date: 2026-07-07

## Status

Approved for implementation.

## Objective

Close the remaining Phase A/P0 protocol-trust gap without adding new product UI. Craft should have a local, typed view of all 39 standard OMP RPC commands, know each command's response shape and timeout class, and expose diagnostics that make request failures and protocol drift debuggable without leaking payload data.

## Scope

Included:

- Extend the local OMP protocol snapshot to cover all 39 upstream RPC command names.
- Add command metadata for category, response kind, side effects, long-running behavior, and default response timeout.
- Add minimal response data types for commands not yet exposed through desktop UI.
- Route backend request timeouts through command metadata while preserving the existing test override.
- Extend diagnostics with per-command timeout counts and command metadata summary.
- Add focused tests for complete command metadata coverage, response classification, long-operation timeout selection, and payload-safe diagnostics.

Excluded:

- Renderer or settings UI for Todo, login, subagents, Host Tools, Host URI, compaction, retry, bash, or advanced modes.
- Host Tool/URI execution.
- Subagent/Todo reducers.
- Product decisions for TUI-only slash commands.

## Design

The protocol module remains the single compatibility boundary. It will define `OmpRpcCommandType` from the command union and an `OMP_RPC_COMMAND_DEFINITIONS` table keyed by every command type. Each entry records:

- `category`: prompting, state, model, thinking, queue, compaction, retry, bash, session, messages, or login.
- `responseKind`: a stable local label for the successful response payload.
- `timeoutMs`: default correlated-response timeout.
- `longRunning`: true for commands expected to wait on agent work, local execution, compaction, export/handoff, or OAuth.
- `sideEffect`: false only for read-only state/list commands.

The backend will call `getOmpRpcCommandTimeout(command.type, fallback)` when creating a correlated request. If `OmpRpcBackendOptions.requestTimeoutMs` is supplied, it still overrides every command for deterministic tests. Otherwise, per-command defaults are used. Unknown command names are not expected from typed code, but diagnostics fall back to the backend default if a future extension reaches the request layer.

Diagnostics will continue to store only counts, command names, frame types, field names, and redacted stderr. It will add `requestTimeoutsByCommand` and `commandDefinitions` so a snapshot can explain whether a timeout came from a short state query or a long operation such as login.

## Command Coverage

The local command union will cover:

- Prompting: `prompt`, `steer`, `follow_up`, `abort`, `abort_and_prompt`, `new_session`.
- State: `get_state`, `get_available_commands`, `set_todos`, `set_host_tools`, `set_host_uri_schemes`, `set_subagent_subscription`, `get_subagents`, `get_subagent_messages`.
- Model: `set_model`, `cycle_model`, `get_available_models`.
- Thinking: `set_thinking_level`, `cycle_thinking_level`.
- Queue: `set_steering_mode`, `set_follow_up_mode`, `set_interrupt_mode`.
- Compaction: `compact`, `set_auto_compaction`.
- Retry: `set_auto_retry`, `abort_retry`.
- Bash: `bash`, `abort_bash`.
- Session: `get_session_stats`, `export_html`, `switch_session`, `branch`, `get_branch_messages`, `get_last_assistant_text`, `set_session_name`, `handoff`.
- Messages: `get_messages`.
- Login: `get_login_providers`, `login`.

## Tests

Protocol tests will assert that:

- The command definition table has exactly 39 entries.
- Every `OmpRpcCommandType` has metadata.
- Known commands map to the expected category, response kind, side-effect flag, and long-operation flag.
- `login` receives a longer timeout than normal state queries.

Backend and diagnostics tests will assert that:

- A normal command uses the test override when provided.
- Without an override, long-running command metadata controls timeout behavior.
- Timeout diagnostics are counted globally and by command.
- Diagnostics snapshots include command metadata while omitting payload data.

## Acceptance Criteria

- `packages/shared/src/agent/backend/omp/omp-rpc-protocol.ts` locally represents all 39 standard OMP RPC commands.
- Request timeouts are command-aware and still testable with a small override.
- Diagnostics can identify which command timed out.
- Existing OMP backend behavior, session recovery, model switching, extension UI responses, image transport, and thinking controls continue to pass focused tests and shared typecheck.
