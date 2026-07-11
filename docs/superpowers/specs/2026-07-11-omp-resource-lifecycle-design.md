# OMP MCP, Skills, and Agents lifecycle

Date: 2026-07-11

## Status

Approved design. This specification turns OMP extension discovery into a safe configuration and diagnostics lifecycle.

## Objective

Allow users to discover, inspect, create, edit, enable, disable, refresh, diagnose, and remove MCP servers, Skills, and Agents inside the desktop application. The UI must explain effective scope and preserve existing valid configuration when an edit is invalid.

## Alternatives considered

### 1. Read-only discovery

It is simple but forces users back to files for every correction and provides no reliable error recovery. It is not selected.

### 2. Generic raw YAML editor

It exposes every upstream option but cannot validate intent, protect secrets, or explain scope safely. It is not selected as the primary workflow.

### 3. Typed resource directory with constrained editors (chosen)

Provide one resource model and shared lifecycle operations, with type-specific forms for the stable configuration subset. Preserve an explicit path-opening escape hatch for advanced upstream-only options.

## Information architecture

### Resource directory

The Feature Center provides MCP, Skills, and Agents categories. Each row shows name, source (`bundled`, `user`, or `project`), effective status, last refresh time, capability/tool count where applicable, and a warning badge.

Filtering supports type, source, enabled/disabled state, and problems. Search matches display name, identifier, and description. Refresh updates the current category atomically; stale data remains visible with a clearly marked refresh error.

### Detail panel

A selected resource opens a detail panel with effective configuration, override chain, source path, last validation result, and recent diagnostics. Sensitive values are never shown. Users can copy or reveal a path and open the upstream file, but raw content is not sent to telemetry.

### Typed editors

- **MCP:** name, transport, command or URL, arguments, environment key names, enablement, and scope. It supports connection testing before save.
- **Skills:** name, description, source path, enablement, and project override. Definition-file edits remain file-based and open from the detail panel.
- **Agents:** name, description, model role, instructions reference, enablement, and scope. The editor validates the chosen role and source ownership.

No marketplace or remote arbitrary-code installer is included.

## Backend contract

The server exposes a versioned `OmpResourceSnapshot` containing categories, effective entries, source metadata, diagnostics, and revision values. Operations are typed and return the authoritative updated snapshot:

```ts
list(scope): OmpResourceSnapshot
create(type, scope, draft): OmpResourceOperationResult
update(type, id, scope, expectedRevision, patch): OmpResourceOperationResult
setEnabled(type, id, scope, expectedRevision, enabled): OmpResourceOperationResult
testMcp(id, scope): OmpResourceOperationResult
remove(type, id, scope, expectedRevision): OmpResourceOperationResult
refresh(scope): OmpResourceSnapshot
```

The renderer does not derive effective state from file names or mutate local data optimistically beyond a visible pending indicator.

## Scope and persistence

Resources have `bundled`, `user`, and `project` sources. Project settings override user settings; bundled entries are immutable and may only be disabled through a supported user/project override. The detail panel explains the winning source and which edit target will change it.

Writes validate a type-specific schema, compare `expectedRevision`, write a temporary file in the same directory, re-parse it, then atomically replace the target. If validation, parsing, or revision comparison fails, the old configuration remains untouched. External change detection marks the snapshot stale and requires refresh before a conflicting write.

Secrets are accepted only through dedicated secret fields, stored through the existing secure configuration mechanism where available, and returned as a boolean `hasValue`; neither snapshots nor logs include plaintext values.

## Diagnostics and error handling

All failures contain a stable localizable code, short explanation, original upstream error where safe, source path, and next action. Examples include `CONFIG_INVALID`, `SCOPE_READ_ONLY`, `REVISION_CONFLICT`, `MCP_CONNECT_FAILED`, and `SOURCE_MISSING`. A failed MCP test never changes enabled state.

## Non-goals

- Installing marketplace plugins or arbitrary remote code.
- Supporting every experimental OMP configuration key in forms.
- Cross-device synchronization or credential sharing.
- Replacing OMP's advanced TUI editor.

## Test plan

- Unit-test scope precedence, schema validation, secret redaction, revision conflicts, atomic write rollback, and diagnostics mapping.
- Integration-test create/edit/enable/disable/remove/refresh against temporary global and project configuration roots.
- Test MCP connection success, timeout, invalid command, and a test failure that preserves existing configuration.
- Renderer-test directory filtering, detail diagnostics, pending actions, read-only bundled rows, and conflict recovery.

## Acceptance criteria

1. Users can complete each supported lifecycle action for MCP, Skills, and Agents without manually editing configuration files.
2. Global/project precedence and source path are visible before every write.
3. Invalid edits, failed MCP tests, and revision conflicts do not corrupt working configuration.
4. Secrets are never exposed in UI snapshots, reports, or logs.
