# OMP Host Tool Lifecycle Design

Date: 2026-07-09  
Status: Approved for implementation

## Goal

Complete the lifecycle of Craft session tools exposed through OMP RPC host tools:

- stream useful `host_tool_update` frames while a tool is running;
- enforce a bounded execution timeout;
- cancel `call_llm` cooperatively by terminating its isolated OMP process;
- suppress late updates and results after cancellation or timeout;
- preserve Craft permission and prerequisite checks.

Host URI writes and additional URI schemes are outside this batch.

## Current behavior

`OmpRpcBackend` registers Craft session tools with OMP and handles
`host_tool_call`, `host_tool_cancel`, and `host_tool_result`.

The current pending-call record only tracks metadata. Cancellation deletes the
record and sends a result back, but the upstream OMP bridge has already removed
the cancelled request, so that result is an orphan. Tool handlers do not receive
an abort signal, there is no host-side execution deadline, and no
`host_tool_update` frames are emitted.

`call_llm` already runs in an isolated OMP RPC process while the main turn is
active. That process boundary is suitable for real cooperative cancellation.

## Considered approaches

### Selected: per-call lifecycle controller

Create one lifecycle controller per host tool call containing an
`AbortController`, timeout, settled state, and update writer. Backend adapters
may honor the signal and emit progress. Registry handlers that do not accept a
signal remain non-cooperative, but their late output is suppressed.

This follows the upstream OMP host-tool contract and adds little overhead.

### Rejected: timeout with `Promise.race` only

This is simpler, but it presents cancellation as successful while all work and
side effects continue. It also provides no reusable update channel.

### Rejected: isolate every tool in a process

This permits hard termination but cannot preserve in-process browser and
SessionManager callbacks without a new IPC layer. The process cost is also
unnecessary for short registry handlers.

## Architecture

### Pending execution state

Each pending call stores:

- tool name and start time;
- an `AbortController`;
- a timeout handle;
- a settled flag;
- whether the underlying adapter is cooperatively cancellable;
- update coalescing state.

The backend option `hostToolExecutionTimeoutMs` controls the deadline and
defaults to 120 seconds. Tests can override it.

All terminal paths use one settlement helper. It clears the timeout, marks the
call settled, removes it from the pending map, and prevents subsequent writes.

### Update channel

Execution receives a callback that writes:

```json
{
  "type": "host_tool_update",
  "id": "<host request id>",
  "partialResult": {
    "content": [{ "type": "text", "text": "<latest progress>" }]
  }
}
```

`call_llm` forwards accumulated assistant text. The first non-empty update is
sent immediately; subsequent updates are coalesced to at most one frame per
100 milliseconds so token deltas do not flood stdio. The latest changed text
is flushed before the final result. Empty or duplicate text is ignored.

Tools without meaningful progress do not emit artificial updates.

### Cooperative cancellation

`host_tool_cancel` performs these actions:

1. find the pending execution by `targetId`;
2. mark it settled and abort its controller;
3. clear timers and queued updates;
4. remove it from the pending map;
5. do not send `host_tool_result`.

OMP already rejects and removes the request before sending
`host_tool_cancel`; sending a result would create an orphan frame.

The isolated `call_llm` completion listens to the abort signal. On abort it
destroys the isolated backend and rejects with an abort error. The main OMP
session remains running.

Browser callbacks, session spawning, and registry handlers currently lack a
cooperative signal contract. Cancellation suppresses their updates and final
results. A debug entry records when non-cooperative work may still be finishing
in the background.

### Timeout

When the deadline expires:

1. settle the pending execution;
2. abort its controller;
3. send exactly one error `host_tool_result` stating the tool and timeout;
4. ignore any later completion or failure.

Unlike explicit cancellation, a timeout sends a result because OMP still has a
live pending request.

### Shutdown and subprocess failure

Backend destruction and child cleanup abort all pending controllers, clear
their timers, and remove queued updates. No side-channel frames are written
after the child is unavailable.

## Execution flow

1. Create the lifecycle controller and deadline as soon as the call arrives.
2. Validate that the tool was registered.
3. Run Craft automation, permission, source, and prerequisite checks.
4. Validate arguments with the canonical session-tool schema.
5. Execute the backend adapter or registry handler with the signal/update
   capabilities available to it.
6. Stream coalesced progress where supported.
7. Settle with one result, one timeout error, or silent cancellation.

Permission prompts are part of the host call lifecycle and are cancellable.
Each pending permission stores its owning host request ID and listens to the
same abort signal. Cancellation resolves that permission wait as denied without
writing an OMP result.

## Error handling

- Validation and permission failures return normal error results.
- Adapter exceptions return one error result unless the call was cancelled or
  timed out first.
- Update write failures are logged and do not fail the tool execution.
- A late completion after settlement is ignored.
- Duplicate cancel frames are harmless.
- Abort errors from a cancelled `call_llm` are not surfaced as tool failures.

## Testing

Add deterministic tests for:

- `call_llm` emitting coalesced `host_tool_update` frames;
- cancellation killing the isolated OMP child;
- cancellation producing no `host_tool_result`;
- timeout producing exactly one error result;
- late success and late failure being ignored after timeout;
- duplicate cancellation;
- backend destruction clearing timers and pending executions;
- existing permission, source activation, browser, spawn, and registry tests
  continuing to pass.

Run the OMP protocol/backend/session action suites and shared, server-core, and
Electron type checks.

## Completion criteria

- OMP receives useful streaming progress from `call_llm`.
- An explicit `call_llm` cancellation terminates its isolated process.
- Every non-cancelled host call has a bounded lifetime.
- Every request produces at most one terminal result.
- Cancelled requests produce no orphan terminal frame.
- No timer, pending execution, or isolated process leaks after completion or
  backend destruction.
