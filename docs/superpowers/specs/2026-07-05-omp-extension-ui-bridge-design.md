# OMP extension UI bridge for Craft

Date: 2026-07-05

## Status

Proposed. This spec covers the next product-hardening gap after the OMP RPC backend and dynamic model discovery: OMP extension UI requests currently degrade to plain `info` messages in Craft, so blocking OMP extension interactions can stall or become invisible.

## Objective

Make OMP RPC `extension_ui_request` frames usable inside Craft's existing desktop shell without rewriting the renderer.

The first production-grade version should:

- preserve OMP's request ids exactly;
- surface blocking OMP dialogs as native Craft inline/overlay interactions;
- return `extension_ui_response` frames to the OMP subprocess;
- convert fire-and-forget OMP UI actions into suitable Craft UI feedback;
- keep unknown/custom widget payloads visible and debuggable instead of silently dropping them.

## Source facts

OMP upstream declares these request methods in `packages/coding-agent/src/modes/rpc/rpc-types.ts`:

- blocking dialogs: `select`, `confirm`, `input`, `editor`;
- cancellation: `cancel`;
- host actions / notifications: `notify`, `setStatus`, `setWidget`, `setTitle`, `set_editor_text`, `open_url`.

OMP upstream accepts these responses:

```ts
{ type: "extension_ui_response", id: string, value: string }
{ type: "extension_ui_response", id: string, confirmed: boolean }
{ type: "extension_ui_response", id: string, cancelled: true, timedOut?: boolean }
```

The existing standalone OMP desktop prototype already proves a minimal useful UI with `select`, `confirm`, `input`, and fallback raw payload display, responding through `{ type: "extension_ui_response", id, value }`.

The current Craft adaptation handles `extension_ui_request` in `packages/shared/src/agent/backend/omp/omp-rpc-adapter.ts` by emitting:

```ts
{ type: "info", message: "OMP extension UI request is not supported yet: ..." }
```

That is acceptable for early smoke tests but not mature enough for a real product.

## Decision

Implement a typed OMP extension UI bridge as a first-class runtime event, modeled after Craft's existing permission and credential response flow.

Do not implement arbitrary extension-provided React widgets in v1. OMP RPC mode itself does not support custom component factories; it only exposes structured request frames plus string-array widgets. The bridge should therefore support the structured RPC methods fully, and preserve unknown payloads for fallback/debug.

## Proposed shape

### 1. Shared protocol types

Add shared types near Craft's existing protocol/session DTOs:

```ts
export type ExtensionUiMethod =
  | "select"
  | "confirm"
  | "input"
  | "editor"
  | "cancel"
  | "notify"
  | "setStatus"
  | "setWidget"
  | "setTitle"
  | "set_editor_text"
  | "open_url"
  | string;

export interface ExtensionUiRequest {
  requestId: string;
  method: ExtensionUiMethod;
  title?: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
  promptStyle?: boolean;
  timeoutMs?: number;
  targetId?: string;
  notifyType?: "info" | "warning" | "error" | string;
  statusKey?: string;
  statusText?: string;
  widgetKey?: string;
  widgetLines?: string[];
  widgetPlacement?: "aboveEditor" | "belowEditor" | string;
  text?: string;
  url?: string;
  launchUrl?: string;
  instructions?: string;
  raw: Record<string, unknown>;
}

export type ExtensionUiResponse =
  | { value: string }
  | { confirmed: boolean }
  | { cancelled: true; timedOut?: boolean };
```

Use `requestId` in Craft-facing types while mapping from/to OMP's wire field `id` at the backend boundary.

### 2. Core AgentEvent

Extend `packages/core/src/types/message.ts`:

```ts
| { type: "extension_ui_request"; request: ExtensionUiRequest }
| { type: "extension_ui_cancel"; requestId: string; targetId: string }
```

`extension_ui_request` is emitted for blocking requests and for host-action requests that need renderer behavior.

`notify` can also be mapped to `info` when no richer UI is needed, but keeping the raw request available lets the renderer style it accurately.

### 3. OMP adapter

Replace the current info-only mapping in `OmpRpcEventAdapter`.

Behavior by method:

| OMP method | Craft event behavior | Response needed |
| --- | --- | --- |
| `select` | `extension_ui_request` with options | yes, `{ value }` or `{ cancelled }` |
| `confirm` | `extension_ui_request` with message | yes, `{ confirmed }` or `{ cancelled }` |
| `input` | `extension_ui_request` with placeholder | yes, `{ value }` or `{ cancelled }` |
| `editor` | `extension_ui_request` with multiline prefill | yes, `{ value }` or `{ cancelled }` |
| `cancel` | `extension_ui_cancel` for target id | no |
| `notify` | styled info/toast event, plus optional raw event if needed | no |
| `setStatus` | update an OMP status strip/state map | no |
| `setWidget` | update a compact widget panel using `widgetLines` | no |
| `setTitle` | optional session/title hint; low priority | no |
| `set_editor_text` | prefill composer text if safe | no |
| `open_url` | auth/link action card with copy/open buttons | no |
| unknown | fallback request card with raw JSON and dismiss/cancel | maybe; default cancel if user dismisses |

For timeout-enabled blocking requests, the host should auto-expire the UI and send `{ cancelled: true, timedOut: true }` before removing it. OMP also has internal timeout handling, but host-side cleanup prevents stale UI.

### 4. Backend response method

Add an optional backend method to `AgentBackend`:

```ts
respondToExtensionUiRequest?(
  requestId: string,
  response: ExtensionUiResponse
): void;
```

`OmpRpcBackend` implements it by sending one of:

```ts
{ type: "extension_ui_response", id: requestId, value }
{ type: "extension_ui_response", id: requestId, confirmed }
{ type: "extension_ui_response", id: requestId, cancelled: true, timedOut }
```

The method should log but not throw on stale/missing subprocess state, matching `respondToPermission`.

### 5. SessionManager bridge

Add:

```ts
respondToExtensionUiRequest(
  sessionId: string,
  requestId: string,
  response: ExtensionUiResponse
): boolean
```

Implementation mirrors `respondToPermission`:

1. find the managed session;
2. verify the active agent exposes `respondToExtensionUiRequest`;
3. optionally remove pending request metadata;
4. forward response to backend;
5. return false if the session or backend is gone.

Keep a small `pendingExtensionUiRequests` map so stale responses and cancel frames can be handled cleanly.

### 6. Transport / IPC

Expose a renderer-callable channel/API similar to permission and credential responses:

```ts
respondToExtensionUiRequest(
  sessionId: string,
  requestId: string,
  response: ExtensionUiResponse
): Promise<boolean>
```

Also extend renderer event types to include:

```ts
{
  type: "extension_ui_request";
  sessionId: string;
  request: ExtensionUiRequest;
}
{
  type: "extension_ui_cancel";
  sessionId: string;
  requestId: string;
  targetId: string;
}
```

### 7. Renderer UX

Add a small structured interaction component rather than a full widget system:

- `select`: button list / dropdown style choices;
- `confirm`: primary/secondary action buttons;
- `input`: single-line input;
- `editor`: textarea with prefill and submit/cancel;
- `open_url`: card with Open, Copy, and instructions;
- `notify`: existing info/toast styling;
- `setStatus`: compact status chip, scoped to the session;
- `setWidget`: compact string-lines widget panel;
- unknown: raw JSON fallback card with Cancel/Dismiss.

The component should be inline near the chat composer or structured input area so it feels like a normal session pause, not a random system modal.

### 8. Persistence

Do not persist extension UI request cards as normal chat messages in v1.

They are runtime controls, closer to permission prompts than assistant content. If a session reloads while a request is pending, the request is probably invalid because the OMP subprocess context is gone. The UI should clear pending extension requests on session switch/reload/subprocess restart.

### 9. Remote/mobile clients

Messaging/remote clients may initially render extension UI requests as text prompts with conservative default actions:

- blocking request: send a message saying the desktop app needs input;
- notify/open_url: show the message/link if safe;
- unknown request: display a short unsupported notice.

This avoids silently approving or fabricating values from remote clients.

## Non-goals for v1

- Arbitrary extension-provided React/TUI custom widget rendering.
- Full theme or editor component APIs from OMP.
- Persisting extension UI controls as long-lived transcript messages.
- Rebuilding the old standalone OMP desktop renderer.
- Making non-OMP backends produce extension UI requests.

## Implementation order

1. Add shared request/response types.
2. Add `AgentEvent` variants and renderer event variants.
3. Update `OmpRpcEventAdapter` to normalize `extension_ui_request`.
4. Add `OmpRpcBackend.respondToExtensionUiRequest`.
5. Add `SessionManager.respondToExtensionUiRequest`.
6. Register transport/IPC API and channel-map tests.
7. Add renderer request queue/component.
8. Add timeout cleanup and cancel handling.
9. Verify with OMP smoke flow.

## Tests

Add focused tests before broad Electron testing:

- adapter maps `select`, `confirm`, `input`, and `editor` frames into typed extension UI request events;
- adapter maps `cancel` into a cancel event;
- adapter maps `notify` to appropriate info-level UI feedback;
- adapter preserves raw payloads and unknown methods;
- OMP backend sends exact `extension_ui_response` frames for value, confirmed, cancelled, and timed-out responses;
- SessionManager returns false when no backend/session exists;
- transport channel-map parity includes the new API;
- renderer component calls the API with correct response shapes;
- timeout removes the pending request and sends `timedOut: true`.

## Rollout checklist

- Existing OMP prompt/model/permission smoke tests still pass.
- `bun run typecheck:all` passes.
- `bun run smoke:omp-hardening` still passes.
- Manual OMP extension flow can complete a select/confirm/input/editor request without touching the terminal.
- Unknown extension UI request does not hang invisibly.

