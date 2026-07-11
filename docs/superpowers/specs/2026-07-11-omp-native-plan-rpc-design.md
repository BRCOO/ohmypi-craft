# Native OMP Plan Mode RPC bridge

Date: 2026-07-11

## Status

Approved design. This specification turns OMP's existing native Plan Mode into a first-class capability of the Craft desktop adaptation without replacing the current stdio RPC architecture.

## Objective

Expose OMP Plan Mode through `omp --mode rpc`, then render and control that native state in Craft.

The resulting desktop behavior must be truthful:

- enabling Plan Mode changes OMP's own session state;
- planning turns use OMP's `plan` model role and its existing plan-mode tool restrictions;
- a completed OMP plan is submitted to Craft for review rather than being auto-approved;
- approve, refine, and cancel choices return to the same OMP process;
- an older or unmodified external `omp` binary remains safely disabled rather than appearing to work.

## Source facts

OMP already implements Plan Mode in its coding-agent package:

- `AgentSession` stores `PlanModeState` through `getPlanModeState` and `setPlanModeState`.
- Native plan turns add OMP's plan prompt and restrict work to plan-safe behavior.
- The interactive shell's `/plan` command enters and leaves that state.
- The plan-approval `resolve` handler validates the plan artifact and gives interactive/ACP hosts a review point.
- OMP supports a `plan` model role and `PI_PLAN_MODEL` / `--plan` model configuration.

The present OMP RPC implementation does not expose Plan Mode. Its command union and `get_available_commands` response omit `/plan`, plan state, and plan review. The current Craft UI deliberately identifies that absence as `rpc-unavailable`.

## Alternatives considered

### 1. Extend OMP RPC and bundle the matching runtime (chosen)

Add a small native Plan Mode RPC surface to OMP, retain `omp --mode rpc` as Craft's process boundary, and ship the matching OMP runtime with the desktop app.

This keeps one authoritative plan state inside OMP and avoids duplicating plan tool policy in Craft.

### 2. Embed the OMP SDK directly

The SDK can directly reach OMP Plan Mode, but it would replace the isolated subprocess contract, complicate lifecycle management, and depart from the established OMP backend architecture. It is not selected.

### 3. Simulate planning in Craft

Craft could present its own plan UI and system prompt. It would not be OMP native, could diverge from OMP tool restrictions and approval behavior, and is explicitly out of scope.

## Protocol design

### Capability negotiation

`get_state` gains a backwards-compatible capability field:

```ts
capabilities?: {
  planMode?: true;
}
```

Craft treats native Plan Mode as available only when `capabilities.planMode === true`. Missing capability data means unsupported; no version-string heuristic is allowed.

### Plan state

Both responses and events use the following wire-safe state:

```ts
interface RpcPlanModeState {
  enabled: boolean;
  phase: "inactive" | "planning" | "awaiting_review" | "executing" | "paused";
  planFilePath?: string;
  planModel?: string;
}
```

`phase` describes host-visible lifecycle only. OMP remains responsible for its full internal `PlanModeState`, tool selection, model restoration, and plan-reference behavior.

### Commands

```ts
{ type: "get_plan_mode_state" }
{ type: "set_plan_mode", enabled: boolean, initialPrompt?: string }
{
  type: "plan_review_result",
  requestId: string,
  action: "approve" | "refine" | "cancel",
  feedback?: string,
}
```

`set_plan_mode` is idempotent. A repeated request for the current state returns the current state without rebuilding the session. It rejects a toggle while an incompatible plan review is being resolved rather than silently changing state.

### Events

```ts
{ type: "plan_mode_state_update", state: RpcPlanModeState }
{
  type: "plan_review_request",
  requestId: string,
  title: string,
  planFilePath: string,
  planMarkdown: string,
  options: Array<"approve" | "refine" | "cancel">,
}
```

OMP emits `plan_mode_state_update` after every transition and immediately after RPC initialization when Plan Mode is active. It emits one `plan_review_request` per validated plan-approval tool invocation and moves to `awaiting_review` before writing the frame.

The pending review remains owned by OMP. Unknown, duplicate, or stale `requestId` values return a failed response and must not approve a plan.

### Approval semantics

- `approve`: OMP finalizes the plan artifact, exits Plan Mode, restores its normal model/tool state, and uses the approved plan as the next-turn reference.
- `refine`: OMP remains in Plan Mode, adds the user feedback to its plan workflow, and returns to `planning`.
- `cancel`: OMP cancels the pending review and returns to `planning`; it does not execute the plan.

Transport closure, timeout, or a host restart is treated as cancellation. No approval is inferred.

## OMP runtime implementation

The change belongs in the OMP coding-agent RPC mode, not in the interactive TUI command handler.

1. Introduce a small Plan Mode controller for RPC that drives the existing `AgentSession` Plan Mode state and reuses the existing plan-mode prompt, tool policy, model role, and approval validation.
2. Add the three commands, response validators, event payload types, and capability declaration in OMP RPC types and mode dispatch.
3. Route the existing plan `resolve` approval handler through the controller when RPC Plan Mode is active. The controller reads the validated plan artifact, emits the review request, and awaits only a correlated `plan_review_result`.
4. Clear pending review promises and emit an inactive/paused state during cancellation, reset, and process shutdown.
5. Keep `/plan`, `/plan-review`, `/goal`, and other TUI-only commands hidden from generic RPC slash-command discovery. The Plan toggle is a typed host control, not a fake slash command.

## Craft implementation

### Shared protocol and backend

Add parser types for the capability, Plan Mode state, and plan review frame beside the existing OMP RPC protocol types. `OmpRpcBackend` gains methods to read/toggle state and to send a correlated review result.

The adapter emits typed Craft agent events for state changes and review requests. Command failures surface as a recoverable session info/error message and leave the renderer state unchanged until the next authoritative event.

### Session and transport

Session management retains the most recent OMP plan state and a pending-review map keyed by `requestId`. Renderer transport exposes:

```ts
setOmpPlanMode(sessionId: string, enabled: boolean): Promise<boolean>
respondToOmpPlanReview(
  sessionId: string,
  requestId: string,
  action: "approve" | "refine" | "cancel",
  feedback?: string,
): Promise<boolean>
```

The session manager rejects review responses for absent sessions, unavailable OMP backends, and stale request ids.

### Renderer

The `/` menu shows the Plan row only through the existing curated OMP controls. It becomes interactive only after capability negotiation succeeds.

The row displays current state: inactive, planning, awaiting review, executing, or paused. A pending review uses Craft's existing plan approval visual language and renders:

- plan title and markdown;
- plan artifact path;
- Approve;
- Request changes with required feedback;
- Cancel.

The client waits for OMP's `plan_mode_state_update` before claiming that Plan Mode changed. It clears pending UI controls on session end, backend restart, or an OMP cancellation event.

### Runtime distribution

The packaged desktop app must prefer an OMP runtime built from this protocol-enabled source over a globally installed `omp` command. Settings report runtime source (`bundled` or `external`), OMP version, and negotiated capabilities.

An external runtime remains usable for normal OMP chat. It does not enable Plan Mode unless it advertises `planMode`.

## Non-goals

- Implementing Goal Mode, `/goal`, `/guided-goal`, `/loop`, or generic TUI slash commands.
- Replacing OMP's plan artifact format or plan tool restrictions.
- Reimplementing OMP Plan Mode in Craft.
- Inferring Plan Mode availability from a version number.
- Automatically approving plans after a host restart or request timeout.

## Test plan

### OMP runtime

- `get_state` advertises `planMode` only in the updated runtime.
- `get_plan_mode_state` returns inactive and active state accurately.
- `set_plan_mode` activates and exits native session Plan Mode idempotently.
- Plan model role and plan-safe tool policy are in effect for a planning turn.
- A `resolve` approval produces exactly one correlated review request.
- Approve, refine, cancel, duplicate result, stale result, and shutdown paths are covered.

### Craft backend and UI

- protocol parsers validate all new frames and reject malformed payloads;
- backend sends exact command/result envelopes;
- legacy OMP state without capability keeps the Plan control disabled;
- state events update the feature center without an optimistic false positive;
- review response transport preserves request ids and feedback;
- renderer buttons render only while the matching review is pending.

### Release verification

1. Start the packaged application with its bundled OMP runtime.
2. Verify settings show the bundled runtime and `planMode` capability.
3. Enable Plan Mode from `/`, submit a planning request, and confirm no implementation tools execute.
4. Review a generated plan; test refine, cancel, and approve.
5. Verify execution after approval receives the approved plan reference.
6. Repeat with an old external OMP runtime and verify the control remains safely unavailable.

## Delivery order

1. Add and test the OMP runtime protocol/controller.
2. Build a protocol-enabled OMP runtime for local integration.
3. Add Craft shared parser/backend/session/transport support and tests.
4. Add renderer state and approval UI.
5. Package the bundled runtime and run the release verification matrix.
