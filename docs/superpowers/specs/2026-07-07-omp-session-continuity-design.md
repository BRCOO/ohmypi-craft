# OMP Session Continuity Design

Date: 2026-07-07  
Repo: `D:\ALL PROJECT\ohmypi-craft`  
Branch: `codex/omp-rpc-backend`

## Context

Craft and OMP currently maintain separate session identities. Craft owns the desktop session shell, persistence, sidebar, message rendering, permissions, and workspace metadata. OMP owns the real agent transcript, session file, branching semantics, handoff/export commands, todo state, memory context, and provider session continuity.

The current OMP backend synchronizes `get_state` at startup and reports the OMP `sessionId` through Craft's existing SDK session id callback. That is enough for a first prompt, but not enough for mature product use: reopening a Craft session can start a fresh OMP session unless the backend explicitly switches back to the original OMP transcript.

This batch makes the Craft session reliably return to the same OMP session and adds the narrow control surface needed for later branch, handoff, and export UX.

## Goals

- Persist a stable Craft session ↔ OMP session mapping.
- Reopen existing OMP-backed Craft sessions by switching OMP to the stored session file.
- Detect obvious Craft/OMP transcript mismatches instead of silently continuing in the wrong session.
- Add a typed backend control surface for OMP session RPC commands:
  - `new_session`
  - `switch_session`
  - `get_messages`
  - `get_branch_messages`
  - `branch`
  - `set_session_name`
  - `handoff`
  - `export_html`
- Keep Craft as the desktop product shell and OMP as the agent/session authority for OMP-backed sessions.
- Leave advanced branch-tree UI, todo migration, MCP selection restore, and memory synchronization to later batches.

## Non-goals

- Do not rewrite Craft's JSONL session storage.
- Do not replace Craft message rendering with OMP's raw transcript format.
- Do not implement full branch tree visualization in this batch.
- Do not fully synchronize OMP todo phases, MCP selections, memory context, or artifacts after branch; this batch only preserves the hooks and metadata needed to do that later.
- Do not add new upstream OMP RPC commands unless a tested command is missing from the current protocol.

## Source of truth

For OMP-backed sessions, the authority split is:

- Craft remains the source of truth for desktop metadata:
  - Craft session id;
  - workspace id/root;
  - sidebar status/labels/archive state;
  - Craft-rendered messages;
  - selected connection/model display;
  - attachments managed by Craft.
- OMP is the source of truth for provider transcript continuity:
  - OMP session id;
  - OMP session file;
  - OMP branch entry ids;
  - OMP transcript used for the next model turn;
  - OMP handoff/export outputs.

The bridge stores enough OMP metadata in the Craft session header to recover OMP's transcript before a new prompt is sent.

## Persistent metadata

Add OMP-specific optional fields to Craft's persisted session shape. The fields should be harmless for non-OMP sessions.

```ts
interface OmpSessionLink {
  provider: 'omp';
  sessionId: string;
  sessionFile?: string;
  sessionName?: string;
  messageCount?: number;
  lastSyncedAt: number;
  lastCheckedAt?: number;
  lastMismatch?: OmpSessionMismatch;
}

interface OmpSessionMismatch {
  reason: 'missing-session-file' | 'message-count' | 'last-message-role' | 'last-message-content' | 'invalid-response';
  detail: string;
  detectedAt: number;
}
```

Implementation can either embed this as `managed.ompSessionLink` or flatten the first fields as `ompSessionId`, `ompSessionFile`, and companions. The preferred shape is a single nested object because it makes future OMP-only metadata safer to extend.

## Backend API

Extend the OMP controllable agent seam with a second, session-focused interface. This keeps queue controls separate from session continuity.

```ts
interface OmpSessionAgent {
  getOmpSessionLink(): OmpSessionLink | null;
  restoreOmpSession(link: OmpSessionLink): Promise<OmpSessionRestoreResult>;
  refreshOmpSessionLink(): Promise<OmpSessionLink>;
  getOmpMessages(): Promise<OmpAgentMessage[]>;
  getOmpBranchMessages(): Promise<Array<{ entryId: string; text: string }>>;
  branchOmpSession(entryId: string): Promise<OmpBranchResult>;
  newOmpSession(parentSession?: string): Promise<OmpCancellationResult>;
  setOmpSessionName(name: string): Promise<void>;
  handoffOmpSession(customInstructions?: string): Promise<OmpHandoffResult | null>;
  exportOmpSessionHtml(outputPath?: string): Promise<{ path: string }>;
}
```

The concrete TypeScript names can be adjusted to match existing conventions. The important boundary is that `SessionManager` should call intent-level methods, not arbitrary raw RPC frames.

## Data flow: opening an existing OMP session

1. Craft loads the persisted session header into `ManagedSession`.
2. The first time an OMP agent is created for that session, `SessionManager` passes the persisted OMP link into the backend through config or a post-create restore call.
3. `OmpRpcBackend` starts `omp --mode rpc`.
4. After the ready frame, the backend runs `get_state`.
5. If a persisted `sessionFile` exists and differs from the live OMP state, the backend runs `switch_session`.
6. The backend runs `get_state` again and updates the local `OmpSessionLink`.
7. `SessionManager` persists the refreshed link before accepting a new user prompt.

If `switch_session` fails, the session must not silently continue in a fresh OMP transcript. It should surface an actionable error and keep the Craft session intact.

## Data flow: message reconciliation

Reconciliation is intentionally lightweight in this batch.

1. After restore, `SessionManager` may call `get_messages`.
2. The backend returns OMP messages as opaque parsed objects plus a small summary:
   - message count;
   - last role if available;
   - last text preview hash or prefix if available.
3. Craft compares that summary to its currently loaded messages.
4. If the comparison is consistent, store `lastCheckedAt`.
5. If inconsistent, store `lastMismatch` and emit a diagnostic event/card.

This batch should not attempt automatic transcript rewriting. A mismatch means “warn and avoid silent corruption,” not “merge two histories.”

## Data flow: branch

Branching is supported as a backend operation, but the first UI pass should stay minimal.

1. UI or SessionManager asks for branchable messages through `get_branch_messages`.
2. User selects a branch entry.
3. Backend calls `branch` with OMP `entryId`.
4. Backend refreshes `get_state`.
5. `SessionManager` updates the Craft session's OMP link.
6. Craft persists the new mapping and emits a session metadata update.

Full parent/child visualization, branch-point badges, todo/MCP/memory sync, and rewind/checkpoint combinations remain later work.

## Data flow: handoff and export

`handoff` and `export_html` are narrow action commands in this batch:

- `handoff` returns `savedPath` when OMP creates a handoff artifact. Craft should show that path and keep the current session usable.
- `export_html` returns a path. Craft should show a success card or notification and may offer an “open file” action if an existing file-open helper is available.

No new document viewer is needed in this batch.

## Session naming

When Craft renames an OMP-backed session, `SessionManager` should call `set_session_name` on the live OMP backend when available. If the backend is cold, the new Craft name remains persisted; the next OMP restore can push the name after `switch_session`.

When OMP `get_state` returns `sessionName`, Craft can persist it as OMP link metadata. It should not overwrite an explicit Craft user title unless a later product decision defines two-way title ownership.

## Error handling

- Missing OMP session file: store `lastMismatch.reason = 'missing-session-file'`, show a recoverable diagnostic, and do not auto-create a new OMP session under the same Craft session.
- `switch_session` cancelled: preserve the previous link and show that restore was cancelled.
- Invalid `get_messages` response: store `invalid-response`, include the RPC command name in diagnostics, and continue only if the user starts a new session explicitly.
- Branch cancelled: leave the current mapping unchanged.
- Handoff/export failure: render an OMP command-style error card and keep the active session unchanged.
- Backend crash after restore: on reconnect, attempt one restore from the persisted link before sending another prompt.

## Testing

Add unit coverage around the backend/protocol seam:

- parse `switch_session`, `new_session`, `branch`, `get_branch_messages`, `handoff`, `export_html`, and `get_messages` response shapes;
- backend restore calls `switch_session` when persisted session file differs from startup state;
- backend does not call `switch_session` when startup state already matches;
- failed restore is surfaced as an error, not swallowed;
- branch refreshes state and returns the new OMP session link.

Add SessionManager-level coverage where practical:

- persisted OMP link is copied into `ManagedSession`;
- refreshed OMP link is persisted back to the session header;
- renamed OMP session calls `set_session_name` when the OMP backend is live;
- mismatch diagnostics do not rewrite Craft messages.

Manual smoke:

- create an OMP session, send one prompt, close/reopen, and confirm next prompt continues the same OMP `sessionFile`;
- rename a Craft session and confirm OMP `get_state.sessionName` reflects the change after restore;
- run `get_branch_messages` and branch from a user message;
- run `export_html` and verify the path exists;
- run `handoff` and verify returned `savedPath` is displayed.

## Rollout order

1. Add protocol types/parsers for the session commands.
2. Add `OmpRpcBackend` session-control methods.
3. Persist `OmpSessionLink` in Craft session metadata.
4. Restore OMP session on backend startup before first prompt.
5. Add lightweight reconciliation and diagnostics.
6. Add minimal server/renderer actions for branch, handoff, export, and rename synchronization.

This order keeps every step testable without requiring the final UI to exist first.

## Scope boundary for this batch

This batch is complete when an OMP-backed Craft session can be closed, reopened, and continue against the same OMP session file, with safe diagnostics for mismatches and typed hooks for branch/handoff/export. Rich branch visualization, todo synchronization, subagent session views, and memory-aware handoff workflows remain in later batches.
