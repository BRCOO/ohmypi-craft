# OMP Host URI Artifacts and Source Snapshot Design

Date: 2026-07-09  
Status: Approved for implementation

## Goal

Make the OMP Host URI bridge useful beyond read-only session snapshots while
keeping the first write surface narrow and auditable.

This batch adds:

- a read-only `craft-workspace://current/sources` snapshot that summarizes
  Craft data sources without exposing credentials;
- a path-scoped write endpoint under
  `craft-session://current/artifacts/<name>`;
- permission checks and an audit log for Host URI writes;
- cancellation and bounded write handling that preserves the existing Host URI
  result contract.

Direct writes to Todo state, runtime state, source configuration, arbitrary
workspace files, or credential material are outside this batch.

## Current behavior

`OmpRpcBackend` registers one Host URI scheme:

- `craft-session`

It currently supports read-only snapshots:

- `craft-session://current/summary`
- `craft-session://current/todos`
- `craft-session://current/runtime`

Write requests are rejected with a clear read-only error. Host URI cancellation
is handled by marking the request cancelled and sending a terminal error result
when possible.

## Considered approaches

### Selected: safe artifact writes plus source read snapshots

Add one practical write target: session artifacts. OMP can persist generated
outputs, intermediate data, or small structured payloads into the current Craft
session without being able to overwrite arbitrary workspace files or mutate
runtime state.

Add one read target: a sanitized source catalog. This helps OMP reason about
which Craft sources exist and are active without receiving tokens, headers,
OAuth secrets, local credential cache paths, or raw config blobs.

This gives OMP a real Host URI read/write loop while keeping security and state
ownership simple.

### Rejected: write Todo, runtime, and source config through Host URI

Those writes are attractive, but they can race with active OMP turns, Craft UI
state, and existing command APIs such as `set_todos`. Source config writes also
touch credentials and MCP startup behavior. They deserve their own design.

### Rejected: read-only expansion only

Adding more read URIs is safe but leaves Host URI write semantics unproven. The
product would still lack a representative write path for OMP extensions and
tools.

## URI scheme registration

Register two schemes:

```json
[
  {
    "scheme": "craft-session",
    "description": "Read session snapshots and write scoped session artifacts.",
    "writable": true,
    "immutable": false
  },
  {
    "scheme": "craft-workspace",
    "description": "Read sanitized workspace-level Craft metadata.",
    "writable": false,
    "immutable": false
  }
]
```

`craft-session` remains scoped to the active Craft session. `craft-workspace`
is scoped to the active workspace.

## Read endpoints

### `craft-session://current/summary`

Existing endpoint. Keep the current JSON shape and preserve compatibility.

### `craft-session://current/todos`

Existing endpoint. Keep it read-only in this batch.

### `craft-session://current/runtime`

Existing endpoint. Keep it read-only in this batch.

### `craft-workspace://current/sources`

Return a sanitized source catalog:

```ts
interface WorkspaceSourcesSnapshot {
  workspaceId: string
  workspaceRootPath: string
  activeSourceSlugs: string[]
  sources: Array<{
    slug: string
    name?: string
    type?: string
    enabled: boolean
    active: boolean
    hasCredentials?: boolean
    requiresAuthentication?: boolean
    service?: string
    summary?: string
  }>
  updatedAt: number
}
```

The snapshot must not include:

- API keys, OAuth tokens, headers, cookie values, or refresh tokens;
- MCP command environment variables;
- local credential cache file contents;
- raw source config objects.

If a source field is ambiguous, omit it rather than leaking it.

## Write endpoint

### `craft-session://current/artifacts/<name>`

Write request content into the current session data/artifacts area.

Rules:

- only `operation: "write"` is accepted for this path;
- `<name>` must be a relative safe filename or nested path;
- path traversal, absolute paths, Windows drive prefixes, control characters,
  empty segments, and reserved names are rejected;
- writes are rooted under `<session>/data/omp-artifacts/`;
- parent directories are created as needed;
- existing files are overwritten only when the request targets the same safe
  artifact path;
- response returns JSON with `path`, `relativePath`, `bytes`, `contentType`,
  and `updatedAt`;
- response does not echo full content back to OMP.

Content handling:

- string content is written as UTF-8;
- non-string JSON content is serialized with pretty JSON;
- binary/base64 content is not supported in this batch. Callers should use text
  or JSON.

## Permission and audit

Host URI writes are treated as mutating session operations.

Before writing, the backend performs a permission check using the existing
permission/request path where possible. The permission prompt should identify:

- operation: Host URI write;
- target URI;
- safe relative artifact path;
- content type;
- byte size;
- destination directory.

In permissive modes, the write may proceed without an interactive prompt, but
it is still audited.

Audit records are appended as JSONL under the session data directory, for
example:

```json
{
  "timestamp": 1783590000000,
  "operation": "write",
  "url": "craft-session://current/artifacts/report.json",
  "relativePath": "report.json",
  "contentType": "application/json",
  "bytes": 1204,
  "allowed": true,
  "resultPath": "..."
}
```

Audit records must not include full written content.

## Cancellation and timeout

Host URI requests remain tracked in `pendingHostUriRequests`.

If a request is cancelled before permission or file write begins, no file is
written. If cancellation arrives during a synchronous filesystem write, the
write may complete, but the backend records the cancellation and avoids sending
duplicate terminal frames.

This batch does not add a separate Host URI timeout option unless one already
exists in the backend. The write path is intentionally local and short.

## Error handling

- Unsupported schemes return an explicit Host URI error.
- Unsupported authorities return an explicit Host URI error.
- Unknown paths return an explicit Host URI error listing supported paths.
- Invalid artifact paths return an explicit validation error.
- Permission denial returns one error result and writes an audit record with
  `allowed: false`.
- Filesystem failures return one error result and write an audit record with
  the error message.
- Cancelled requests do not write after cancellation has already been observed.

## Testing

Add deterministic tests for:

- registration including both `craft-session` and `craft-workspace`;
- reading `craft-workspace://current/sources` without leaking secret-like
  fields;
- rejecting Host URI writes outside `/artifacts/`;
- rejecting traversal and absolute artifact paths;
- writing a text or JSON artifact into the session data directory;
- denied permission returning an error and not writing the artifact;
- audit record creation for allowed, denied, and failed writes;
- existing `summary`, `todos`, `runtime`, unknown-path, write-rejection, and
  cancellation tests continuing to pass.

Run:

- OMP backend tests;
- OMP protocol tests;
- OMP SessionManager action tests;
- shared typecheck;
- server-core typecheck;
- Electron typecheck;
- `git diff --check`.

## Acceptance criteria

- OMP can read sanitized Craft source metadata through Host URI.
- OMP can write scoped session artifacts through Host URI.
- Artifact writes cannot escape the session artifact directory.
- Host URI writes use existing permission semantics where available.
- Host URI writes produce audit records without storing full content.
- Existing read-only Host URI behavior remains compatible.
- Todo, runtime, source config, credentials, and arbitrary workspace files stay
  non-writable in this batch.
