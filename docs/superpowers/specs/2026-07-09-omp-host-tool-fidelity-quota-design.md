# OMP Host Tool Fidelity and Quota Design

Date: 2026-07-09  
Status: Approved for implementation

## Goal

Finish the remaining Host Tool protocol fidelity and governance gaps in the OMP RPC backend without adding new renderer UI.

This batch makes Craft-hosted tools look more like native OMP tools by:

- preserving structured tool result payloads instead of flattening everything into text;
- preserving image content blocks, especially browser screenshots;
- enforcing a bounded concurrent host-tool execution quota;
- avoiding ambiguous tool registration when tool names collide.

Host URI writes, additional URI schemes, and renderer-specific Host Tool UI are outside this batch.

## Current behavior

`OmpRpcBackend` already registers Craft session tools with OMP, executes registry and backend tools, handles permission checks, supports host-tool timeout/cancel, and streams `call_llm` text updates.

The remaining issues are:

- `OmpRpcAgentToolResult` only models text content, while upstream OMP accepts text and image blocks plus optional `details`.
- Registry tool `structuredContent` is discarded, so callers lose machine-readable results.
- Browser screenshots are saved and referenced from markdown, but OMP does not receive the screenshot as a native image content block.
- All host tool calls can start as long as the process accepts frames; there is no explicit host-side concurrency quota.
- Tool registration does not guard against duplicate names between registry and backend adapters.

## Considered approaches

### Selected: narrow protocol-fidelity upgrade

Extend only the OMP host-tool result boundary. Keep Craft's existing session tool registry and browser runtime intact, but convert their results into a richer `AgentToolResult` shape before writing `host_tool_result`.

This is small, testable, and keeps downstream OMP semantics close to upstream.

### Rejected: rewrite session tools around OMP native result types

This would be cleaner long-term but too broad for this batch. It would require touching every session tool handler and risks destabilizing working Craft behavior.

### Rejected: defer images to Host URI only

Host URI is useful for addressable resources, but upstream Host Tool already supports image content blocks. Sending screenshots only as markdown paths keeps OMP less capable than its native tool loop.

## Protocol model

`OmpRpcAgentToolResult` will support:

```ts
type OmpRpcAgentToolContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }

interface OmpRpcAgentToolResult {
  content: OmpRpcAgentToolContent[]
  details?: unknown
  isError?: boolean
}
```

`host_tool_result.isError` remains on the result frame for compatibility with the current OMP RPC contract. When a local result also carries `isError`, the frame-level flag is still the source of truth.

## Result conversion

### Registry tools

Registry `ToolResult.content` text blocks continue to map to text content.

When `ToolResult.structuredContent` is present, it maps to `result.details`. This preserves machine-readable payloads for OMP without changing Craft's registry handler contract.

If a registry tool returns no useful content, the backend returns one text block: `Tool completed`.

### Backend tools

`call_llm` continues returning a text result and streaming text updates.

`spawn_session` continues returning JSON text for now because the current backend helper returns a Craft-specific object whose richer desktop behavior is handled elsewhere.

`browser_tool` keeps its current markdown/file-preview text because that is useful for Craft transcript rendering, but when it captures an image it also adds a native image block:

```json
{
  "type": "image",
  "data": "<base64>",
  "mimeType": "image/png"
}
```

The saved screenshot path remains in the text for local inspection and export compatibility.

## Concurrency quota

Add `hostToolMaxConcurrentExecutions?: number` to `OmpRpcBackendOptions`.

Default: `4`.

When a new `host_tool_call` arrives:

1. If active host-tool executions are already at the limit, do not create a lifecycle controller.
2. Immediately send an error `host_tool_result` explaining that the host tool quota is full.
3. Do not run permission checks, automation hooks, or handlers for the rejected call.

The quota counts active executions only. Completion, timeout, cancellation, backend shutdown, and child cleanup all release the slot through the existing settlement path.

This quota is host-wide per `OmpRpcBackend` instance, not global across all sessions.

## Tool-name conflict protection

Host tool definitions are built from two sources:

- canonical session-tool registry definitions;
- backend-specific adapters such as `call_llm`, `spawn_session`, and `browser_tool`.

Registration will deduplicate by name before calling `set_host_tools`.

If duplicate definitions appear, the backend keeps the first definition, skips later conflicting definitions, and emits a debug diagnostic listing the skipped names. Execution continues to resolve through `SESSION_TOOL_REGISTRY`, so this protection mainly prevents ambiguous registration and future accidental overrides.

The initial implementation does not rename tools or add namespaces. Renaming would be a protocol/product decision because OMP prompts and tool calls must use the exact registered name.

## Error handling

- Invalid or unsupported image content falls back to text instead of crashing the host tool call.
- Oversized screenshots are not newly limited in this batch; existing browser screenshot capture limits remain responsible for size.
- Quota rejection returns one terminal error result and does not leave a pending execution.
- Duplicate tool definitions are non-fatal and logged through backend debug output.
- Existing timeout/cancel behavior remains unchanged: timeout sends one error result, explicit cancel sends no orphan result.

## Testing

Add deterministic tests for:

- `structuredContent` mapping to OMP `result.details`;
- browser screenshot output containing both the markdown/file-preview text and a native image content block;
- host-tool quota rejecting a call before the handler starts;
- timeout and cancellation releasing quota slots;
- duplicate tool names being skipped without preventing valid tools from registering.

Run:

- OMP protocol/backend tests;
- OMP SessionManager action tests;
- shared typecheck;
- server-core typecheck;
- Electron typecheck;
- `git diff --check`.

## Acceptance criteria

- OMP receives structured Host Tool details when Craft registry tools provide them.
- OMP receives native image content for browser screenshots.
- Host Tool execution count is bounded per backend instance.
- Rejected over-quota calls complete with exactly one error result.
- Tool-name collisions do not silently override registered definitions.
- Existing Host Tool permission, timeout, cancellation, source activation, browser, spawn, and registry behavior keeps passing tests.
