# OMP Multimodal, Thinking, and Diagnostics Design

**Date:** 2026-07-07

**Status:** Approved design, pending written-spec review

**Batch:** 2 of 8
**Depends on:** `2026-07-06-omp-rpc-protocol-foundation-design.md`

## 1. Objective

Finish the remaining protocol-trust work needed before adding higher-level OMP product features. After this batch, Craft must send native OMP image prompts, control and display OMP thinking without mixing it into the final answer, and retain enough protocol diagnostics to explain compatibility and lifecycle failures.

This batch uses OMP's RPC protocol as the source of truth while preserving Craft's existing session, persistence, and TurnCard architecture.

## 2. Scope

### Included

- Native OMP `ImageContent[]` transport for image attachments.
- Safe fallback loading for image attachments that have a local path but no in-memory base64 payload.
- Explicit handling strategies for text, PDF, Office, audio, and unknown attachments.
- OMP prompt `streamingBehavior` transport.
- Persistent and one-turn OMP thinking-level control.
- Thinking delta/final-content mapping, persistence, IPC transport, and TurnCard activity presentation.
- Runtime frame/request counters, bounded unknown-frame samples, request latency, timeout, orphan-response, exit, stderr, and active-command diagnostics.
- OMP executable version discovery and an explicit unversioned-protocol compatibility state.
- Focused unit, integration, and real-runtime verification.

### Excluded

- Dynamic slash-command discovery and autocomplete.
- Tool streaming/progress and structured tool-result rendering.
- Todo, subagents, Host Tools, and Host URI.
- Session resume/branch/handoff/export.
- Compact/retry/context/stat controls.
- Login/provider management and advanced OMP modes.

Those remain in later batches of the eight-batch roadmap.

## 3. Chosen approach

Use protocol-native transport at the backend boundary and extend existing Craft concepts only where OMP carries information Craft cannot currently represent.

Rejected alternatives:

- Mapping thinking into generic `info` events would lose streaming, persistence, and semantic grouping.
- Building a separate OMP renderer channel would duplicate Craft's session and event infrastructure and create two persistence models.

The selected approach carries image and thinking semantics through the existing backend → SessionManager → renderer → TurnCard path.

## 4. Attachment transport

### 4.1 Conversion module

Add an OMP attachment converter beside the RPC backend. It returns:

- `message`: the prompt text plus non-image attachment descriptions.
- `images`: native OMP image blocks shaped as `{ type: "image", data, mimeType }`.
- `warnings`: safe, user-readable degradation messages.

The converter is pure except for a narrow injected file-reader used when an image has no base64 payload.

### 4.2 Image rules

For `FileAttachment.type === "image"`:

1. Prefer `attachment.base64`.
2. Otherwise read `storedPath`, then `path`, when the path names a real local file.
3. Reject empty or malformed base64.
4. Require an `image/*` MIME type; infer from the filename only when the supplied type is absent or generic.
5. Reuse Craft's `IMAGE_LIMITS.MAX_RAW_SIZE` guard so an oversized JSONL frame is rejected before writing to OMP.
6. Never place image base64 in the textual prompt or diagnostics.

If an attachment has no bytes and its fallback path is missing or unreadable, the prompt continues with a textual attachment warning and path reference when available. The failure is also emitted as a non-fatal `info`/warning event; it must not silently omit the attachment. Supplied-but-malformed base64 and oversized image data reject the prompt before writing its RPC frame because silently dropping those bytes would misrepresent what the user sent.

### 4.3 Other attachment rules

- Text: inline existing extracted text, preserving the current size-limited extraction behavior.
- PDF: provide its stored path and identify it as a PDF so OMP can use its own tools.
- Office: prefer the converted `markdownPath`, then the stored original path.
- Audio: provide the stored path and MIME type; do not pretend it is natively embedded.
- Unknown: provide only its name, MIME type, and safe stored path.

No non-image attachment is encoded into OMP's `images` array.

### 4.4 Prompt options

Extend `ChatOptions` with optional `streamingBehavior: "steer" | "followUp"` and include it on OMP `prompt` frames. Existing backends may ignore this optional field.

## 5. Thinking control

### 5.1 Level mapping

Craft levels map to OMP levels as follows:

| Craft | OMP |
|---|---|
| `off` | `off` |
| `low` | `low` |
| `medium` | `medium` |
| `high` | `high` |
| `xhigh` | `xhigh` |
| `max` | `xhigh` |

OMP `minimal` maps back to Craft `low` for display because Craft has no `minimal` level. The full raw OMP level remains in the synchronized session state and diagnostics.

### 5.2 Persistent level

`OmpRpcBackend.setThinkingLevel()` updates the Craft value and, when connected, sends `set_thinking_level`. Before every prompt the backend compares the desired mapped level with the synchronized OMP state and applies it when needed. This also covers a level selected before the subprocess starts.

`thinking_level_changed` and configuration frames update the backend's remote-state cache. They do not overwrite the user's persisted Craft preference unless the change originated from Craft.

### 5.3 One-turn override

When `ChatOptions.thinkingOverride` is present:

1. Apply the override after process/model readiness and before `prompt`.
2. Run the turn using the override.
3. Restore the persistent session level after local-only completion, normal `agent_end`, abort, or request failure while the child remains healthy.
4. If the child exits, clear the remote-level cache; the next process reapplies the persistent level during startup.

Restoration failures are diagnostic warnings and do not create a second turn completion.

## 6. Thinking event transport and UI

### 6.1 Backend mapping

OMP `message_update.assistantMessageEvent` values are handled distinctly:

- `thinking_start`: reset the adapter's thinking buffer for that content block.
- `thinking_delta`: emit a Craft text delta marked `isThinking: true` and append to the thinking buffer.
- `thinking_end`: emit text complete marked `isThinking: true` and `isIntermediate: true`.
- Text events continue to use the existing text buffer and are never merged into thinking content.

`message_end` may contain thinking blocks. It is a fallback source only when no matching `thinking_end` arrived, preventing duplicate persisted activities.

### 6.2 Shared event and persistence shape

Add optional `isThinking` to Craft `text_delta` and `text_complete` events and to runtime/stored assistant messages. This is deliberately additive: Claude and Pi behavior remains unchanged.

SessionManager carries the flag through batched deltas, persists completed thinking messages as intermediate assistant messages, and never treats them as the final assistant response. A change between thinking and text flushes the current delta batch so the two streams cannot be merged.

### 6.3 Renderer behavior

The renderer preserves `isThinking` while creating/updating streaming messages. Turn grouping maps a thinking message to `ActivityItem.type === "thinking"`; other intermediate assistant content remains `intermediate`.

TurnCard uses its existing activity expansion model. Thinking content is:

- visible while streaming;
- collapsed with other completed activities by default;
- available in turn-detail/export output;
- never promoted to the final answer when a turn finishes without final text.

## 7. Protocol diagnostics

### 7.1 Snapshot

The backend exposes an immutable `OmpRpcDiagnosticsSnapshot` containing:

- executable command source and detected OMP version;
- protocol state (`unversioned`, ready/state synchronized, session ID present);
- total and per-type received frame counts;
- malformed stdout count;
- unknown frame counts by type and bounded samples of frame keys only;
- sent request counts by command;
- last/max request latency by command;
- timeout, orphan-response, duplicate-response, and write-failure counts;
- last command, last frame type, last exit code/signal, and recent bounded stderr;
- synchronized session metadata with secret-bearing/free-form fields omitted.

Snapshots never contain prompt text, response payloads, image data, tool arguments, environment variables, credentials, or full unknown frames.

### 7.2 Sampling and logs

Unknown frame types are not user-facing chat errors. The backend logs a debug sample on the first occurrence and then at power-of-two counts. Each sample contains only the frame type and sorted field names.

Malformed JSON, unknown correlated responses, duplicate responses, timeouts, and child exits increment separate counters. Fatal lifecycle errors continue through the existing typed/error path.

### 7.3 Version and compatibility

Runtime diagnostics invoke the resolved OMP command with `--version` under a short timeout and parse outputs such as `omp/16.3.0`. Failure to obtain a version is reported as `unknown` but does not prevent RPC startup.

The current OMP RPC stream has no protocol-version handshake. Diagnostics therefore report `protocolVersion: "unversioned"` rather than inventing a number. Compatibility is proven by successful `ready` plus valid `get_state`; failure of that handshake is the actionable incompatibility signal.

## 8. Error handling

- Invalid or oversized images fail before any prompt frame is written and produce a clear attachment-specific message.
- A missing local image path degrades that attachment only; other attachments and the prompt continue.
- A failed persistent thinking-level command prevents the prompt because the UI would otherwise misrepresent the active level.
- A failed one-turn restore is logged and retried before the next prompt.
- Unknown frames are counted and ignored unless they correlate to a pending request or represent a known terminal condition.
- Diagnostic collection must never throw from the stdout frame-processing path.

## 9. Testing

### Unit tests

- Base64 image conversion, local-path fallback, MIME inference, size rejection, malformed data, and non-image strategies.
- Prompt serialization with images and `streamingBehavior`.
- All Craft↔OMP thinking-level mappings, including `max` and OMP `minimal`.
- Persistent level application, one-turn override, restoration, restart, and failure paths.
- Thinking start/delta/end, text/thinking interleaving, `message_end` fallback, and duplicate suppression.
- SessionManager/renderer propagation of `isThinking` and TurnCard activity grouping.
- Unknown, malformed, orphan, duplicate, timeout, latency, and secret-redaction diagnostics.

### Integration tests

- A fake RPC child verifies exact JSONL frames and event ordering.
- A real local OMP process verifies `ready/get_state`, version discovery, thinking-level switching, and an image prompt against a vision-capable configured model when credentials are available.
- Electron shared/server/renderer typechecks and main/renderer builds verify the end-to-end event contract.

Tests that require a paid or authenticated vision model may be explicitly skipped when no suitable model is configured, but serialization, lifecycle, and UI propagation tests are mandatory and may not be skipped.

## 10. Acceptance criteria

- Image attachments reach OMP through native `images`, never only as prompt paths when usable image bytes exist.
- Text, PDF, Office, audio, and unknown attachments have explicit non-silent behavior.
- Craft's selected thinking level controls OMP, including pre-start changes and per-turn overrides.
- Thinking text appears as a distinct, persisted TurnCard activity and never contaminates the final response.
- Unknown or malformed protocol traffic can be diagnosed without exposing payload data.
- Restart, abort, local-only prompts, and racing terminal frames retain the exactly-once completion guarantee from batch 1.
- Focused tests, affected package typechecks, real OMP smoke checks, and Electron builds pass.
