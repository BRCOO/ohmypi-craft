# OMP Host Tool Cooperative Abort Design

Date: 2026-07-09  
Status: Approved for implementation

## Goal

Finish the remaining Host Tool cancellation gap in the OMP RPC backend.

The previous Host Tool lifecycle work added per-call controllers, timeout,
silent explicit cancellation, and isolated `call_llm` process termination. The
remaining weakness is that non-isolated registry and browser handlers can keep
running after OMP cancels or a host-side timeout fires. Their late result is
already suppressed, but local work may continue longer than necessary.

This batch makes cancellable host calls stop earlier by:

- passing a per-call `AbortSignal` into Craft registry tool context;
- passing the same signal into browser tool execution;
- checking that signal around browser batch steps, waits, polling loops, and
  long command branches;
- keeping the existing one-terminal-result and no-orphan-result guarantees.

Host URI writes, additional URI schemes, renderer UI, and deep desktop IPC
abort propagation are outside this batch.

## Current behavior

`OmpRpcBackend` creates a pending execution record for each `host_tool_call`.
That record owns an `AbortController`, timeout, settled state, and update
writer. Explicit `host_tool_cancel` aborts the controller and removes the
pending entry without sending a result. Timeout aborts the controller and sends
one error result.

`call_llm` listens to the abort signal through its isolated child backend and
can be terminated. Registry handlers and browser commands do not receive the
signal today, so they can continue awaiting internal callbacks after the host
call has already been settled.

## Considered approaches

### Selected: boundary-level signal plus browser runtime checks

Expose the existing per-call `AbortSignal` to the two non-isolated execution
paths:

- registry tools receive it as an optional field on `SessionToolContext`;
- browser tools receive it through `executeBrowserToolCommand`.

This preserves existing tool contracts because the field is optional. Current
handlers that do not use the signal keep working, while cancellation-aware
handlers can opt in. The browser runtime can immediately benefit because it
owns its batch loop, polling delays, and command dispatch.

### Rejected: add `AbortSignal` to every browser desktop callback

This would be stronger for in-flight native/browser IPC calls, but it touches a
large UI callback surface and every implementation of `BrowserPaneFns`. It is
better handled as a later browser runtime hardening batch if still needed.

### Rejected: isolate every host tool in a child process

Process isolation would allow hard termination, but registry and browser tools
depend on in-process SessionManager and desktop callbacks. Recreating those
over IPC would be broad and risky for this phase.

## Architecture

### Registry tool context

Extend `SessionToolContext` with an optional abort contract:

```ts
interface SessionToolContext {
  abortSignal?: AbortSignal
}
```

The backend keeps its base session context cache, but it does not cache the
abort-bearing context. For each host call it creates a shallow per-call context
that reuses the base methods and attaches `execution.controller.signal`.

This avoids leaking one call's signal into later tool calls and gives future
registry handlers a stable place to check cancellation.

### Browser tool runtime

`executeBrowserToolCommand` receives an optional `signal`.

The runtime checks cancellation:

- before executing a browser command;
- between commands in a batch;
- before and after awaited browser callbacks;
- inside polling loops such as select-result verification;
- inside internal sleep/delay helpers.

If cancellation is detected, the runtime throws an abort-style error. The OMP
backend already treats cancelled executions as settled, so the error does not
produce an orphan `host_tool_result`.

Already-started desktop callbacks are not forcibly interrupted in this batch.
The runtime stops waiting where it controls the wait and does not begin further
commands after the signal is aborted.

### Settlement behavior

The existing settlement rules remain unchanged:

- explicit OMP cancel aborts the controller and sends no result;
- timeout aborts the controller and sends exactly one timeout error result;
- late success or late failure after settlement is ignored;
- cleanup aborts all pending controllers and clears timers.

The new signal checks only reduce local work after settlement. They do not
change the external frame contract.

## Error handling

- Abort errors from explicitly cancelled calls are ignored because the request
  has already been removed by OMP.
- Abort errors from timeouts are secondary to the timeout result and are
  ignored after settlement.
- Non-abort browser or registry errors still return one error result when the
  call is still pending.
- Registry handlers that ignore `abortSignal` remain safe because late output is
  still suppressed.
- A missing browser callback or invalid command continues to behave as a normal
  tool error.

## Testing

Add deterministic coverage for:

- registry host tool execution receiving the per-call `AbortSignal`;
- browser command polling stopping after cancellation;
- browser batch execution not starting later commands after the signal is
  aborted;
- timeout/cancel behavior still producing the correct terminal frame behavior;
- existing Host Tool quota, rich result, `call_llm`, URI, session action, and
  protocol tests continuing to pass.

Run:

- OMP backend tests;
- OMP protocol tests;
- OMP SessionManager action tests;
- shared typecheck;
- server-core typecheck;
- Electron typecheck;
- `git diff --check`.

## Acceptance criteria

- Registry handlers can inspect the active host call's `AbortSignal`.
- Browser host tools stop polling or batching promptly after cancel or timeout.
- Explicitly cancelled host calls still produce no orphan terminal result.
- Timed-out host calls still produce exactly one timeout error result.
- No host tool cancellation leaks into a later host tool call.
- No broad renderer, Host URI, or desktop IPC callback rewrite is required for
  this batch.
