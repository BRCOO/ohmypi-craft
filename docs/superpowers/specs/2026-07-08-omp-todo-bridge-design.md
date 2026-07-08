# OMP Todo Bridge Design

Date: 2026-07-08

## Goal

Expose Oh My Pi's phased Todo system as a first-class desktop workflow while keeping OMP as the only authoritative Todo store. OMP Todo items remain separate from Craft's session-status labels such as Todo, In Review, and Complete.

This batch covers:

- restoring `get_state.todoPhases`
- writing complete snapshots through `set_todos`
- append, start, done, drop, reopen, edit, and remove actions
- phase creation, rename, and removal
- `todo_reminder` and `todo_auto_clear` events
- Markdown import and export
- refresh after Todo tool execution, session completion, branch, handoff, and session switch
- an OMP-only collapsible Todo card above the composer

Subagent Todo display is deliberately not merged into the main card. The following subagent batch will render each subagent's Todo separately.

## Domain model

Craft adds a repository-local typed snapshot of OMP's Todo protocol:

```ts
type OmpTodoStatus = 'pending' | 'in_progress' | 'completed' | 'abandoned'

interface OmpTodoItem {
  content: string
  status: OmpTodoStatus
  details?: string
  notes?: string[]
}

interface OmpTodoPhase {
  name: string
  tasks: OmpTodoItem[]
}
```

Current OMP TypeScript RPC shapes do not provide durable item IDs. Craft therefore never invents IDs that are written back to OMP. Renderer keys may use an ephemeral phase/task position plus content fingerprint, while all mutations identify the expected phase index, task index, and Todo revision.

Optional `details` and `notes` fields are not editable in this batch, but protocol parsers, serializers, and ordinary UI mutations preserve them when present. A legacy string-valued `notes` field is normalized to a one-element array at the compatibility boundary. Markdown import/export is the only intentionally lossy path for these fields, and the UI warns before replacing a snapshot that currently contains hidden `details` or `notes`.

The desktop snapshot contains:

- phases
- monotonically increasing local revision
- active OMP session ID
- pending action
- last synchronization error
- reminder attempt/max-attempts and open-task summary
- availability and update timestamp

The revision is a Craft-side concurrency token, not an OMP protocol field.

## Architecture

### Protocol boundary

Extend the repository-local OMP RPC protocol with strict Todo parsers, the `set_todos` command, its `{ todoPhases }` response, and the two Todo event frames. Malformed phases, items, statuses, or events are rejected and recorded through existing OMP diagnostics rather than partially accepted.

### Pure Todo reducer

Add a focused reducer beside the runtime reducer. It implements all desktop Todo operations without process, transport, or React dependencies. Every action takes a confirmed snapshot and returns a complete candidate snapshot for `set_todos`.

The reducer enforces OMP-like transitions:

- **Start** sets the target to `in_progress` and demotes any existing in-progress task to `pending`.
- **Done** sets the target to `completed` and promotes the next pending task, searching the current phase before later phases.
- **Drop** sets the target to `abandoned` and uses the same promotion rule.
- **Reopen** changes a closed task to `pending` without changing the current in-progress task.
- **Remove** physically deletes a task; Drop remains the non-destructive alternative.

Empty phases are allowed while editing. Removing a non-empty phase requires confirmation in the UI.

### Backend snapshot

`OmpRpcBackend` owns one Todo snapshot per live OMP process. Startup `get_state` seeds it. `set_todos` accepts an expected revision and complete phase snapshot, rejects stale revisions before writing, sends the typed RPC command, and replaces local state only with OMP's parsed response.

The backend refreshes Todo state after:

- a Todo tool execution completes
- an agent turn completes
- `todo_auto_clear`
- branch, handoff, new-session, and switch-session operations

`todo_reminder` updates reminder metadata immediately and schedules an authoritative `get_state` refresh. Its flat task list never replaces the phased snapshot.

Changing OMP session ID clears the previous Todo snapshot before applying new state, preventing cross-session leakage.

### Session and renderer bridge

SessionManager publishes a dedicated `omp_todo_state_changed` event and stores the runtime-only Todo DTO on the matching session. Todo state is not persisted into Craft JSONL because OMP already persists it.

Session commands cover refresh, replace snapshot, and Markdown import/export. SessionManager validates that the session is OMP-backed and blocks mutation while the session is processing. It does not duplicate Todo transition logic.

The renderer stores Todo state per session using the existing session atom/event processor path. Switching sessions immediately switches cards; no global Todo atom is introduced.

## Composer card

The Todo card appears above the composer only for OMP sessions.

Collapsed state shows:

- completed and total actionable task counts
- current in-progress task, when present
- a reminder badge when OMP emitted `todo_reminder`
- loading or error status without replacing the last confirmed summary

Expanded state groups tasks by phase and provides:

- add, rename, and remove phase
- add and edit task content
- Start, Done, Drop, Reopen, and Remove actions
- refresh and overflow actions for Markdown import/export

Text changes save on Enter or blur. Escape restores the last confirmed value. A Todo RPC write locks other Todo edits until OMP responds. All mutation controls are disabled while the session is processing, while a Todo write is pending, or when the snapshot is unavailable.

Destructive removal uses confirmation. Drop does not require confirmation because it preserves the task.

The card uses the existing dark OMP styling and blue-purple accent tokens. Abandoned/error states may use destructive color; ordinary pending and completed states do not use red.

## Markdown import and export

Export uses a deterministic format compatible with OMP's Todo Markdown representation:

```md
# Phase name
- [ ] Pending task
- [~] In-progress task
- [x] Completed task
- [-] Abandoned task
```

Import accepts these four markers, ignores blank lines, and requires every task to follow a phase heading. Invalid input returns line-specific errors. Before replacement, the UI shows a summary of phases/tasks and requests confirmation.

Import runs through the same expected-revision and `set_todos` path as ordinary editing. Export never includes hidden protocol metadata or secrets. Optional notes/details are excluded from Markdown, so export is a human-readable task list rather than a full-fidelity backup. Import is a complete replacement through `set_todos`; when the current confirmed snapshot contains notes/details, the confirmation dialog calls out that those hidden fields will be dropped by the imported Markdown.

## Data flow

1. OMP startup or session restoration returns `todoPhases` in `get_state`.
2. The backend parses phases and publishes a confirmed Todo snapshot.
3. A desktop action sends its expected revision and structural coordinates.
4. The pure reducer builds a complete candidate snapshot.
5. The backend rejects a stale revision or calls `set_todos` with the candidate phases.
6. OMP's response becomes the next confirmed snapshot and increments the revision.
7. SessionManager publishes the new snapshot to only the matching renderer session.

Branch and handoff use the destination OMP session's `get_state`; Craft never copies the source card into a destination without OMP confirmation.

## Concurrency and error handling

- Desktop mutation is disabled while the OMP agent is streaming to avoid racing the Todo tool.
- Only one Todo write may be pending per backend.
- Duplicate refresh requests coalesce.
- A stale expected revision returns a typed conflict error and triggers refresh.
- Failed writes keep the last confirmed snapshot and clear the draft/pending state.
- Process exit marks Todo unavailable and clears pending actions.
- Late responses from a replaced process generation cannot update the new session.
- Invalid imported Markdown does not mutate OMP.
- Unknown future Todo statuses are rejected visibly rather than mapped to Pending.

## Testing

### Protocol and reducer tests

- parse and serialize every status, phase, optional field, command, response, and event
- reject malformed partial snapshots
- cover Start/Done/Drop/Reopen/Remove and next-task promotion across phases
- preserve notes/details through unrelated mutations
- parse and render Markdown deterministically with line-specific errors

### Backend and SessionManager tests

- restore from startup and switched-session `get_state`
- accept a matching revision and reject a stale revision
- roll back on `set_todos` failure
- refresh after Todo tool completion, turn completion, reminder, and auto-clear
- clear state on process/session replacement
- refresh after branch and handoff
- reject non-OMP and processing-session mutations

### Renderer tests

- hide the card for non-OMP sessions
- render collapsed progress, current task, reminder, loading, empty, and error states
- edit phases/tasks and invoke every status action
- lock controls while processing or saving
- confirm destructive removal and import replacement
- isolate Todo cards across session switches

### Real OMP verification

- create a disposable OMP session
- read its empty Todo state
- write a multi-phase snapshot with every status
- read it back and compare structurally
- update and clear it
- verify malformed snapshots fail without corrupting the confirmed state

## Completion criteria

This batch is complete when an OMP session can restore, display, edit, import, export, and clear phased Todos from the desktop; OMP reminders and auto-clear are visible; branch/handoff/session switching cannot leak Todo state; and Craft never persists or presents a competing Todo truth.
