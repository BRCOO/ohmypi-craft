# Decision: Craft Sources vs OMP MCP Ownership

Date: 2026-07-10  
Status: Approved for implementation

## Context

`ohmypi-craft` currently has two independent data-source systems:

1. **Craft Sources** — managed by the desktop app, activated per session, and exposed to
   agent backends through the existing MCP client pool and source registry.
2. **OMP MCP** — managed by the OMP CLI through its own `config.yml`, discovered at
   startup, and used by OMP tools/extensions internally.

Both can start MCP servers, advertise tools, and read workspace data. Without an
ownership decision, the same server can be started twice, permissions can diverge,
and the user sees two unrelated configuration surfaces.

## Decision

**Craft Sources remain the desktop product's single source of truth for user-visible,
user-controllable data sources.**

OMP's own MCP configuration is respected for OMP-internal tools and extensions, but
Craft does not mirror or duplicate it. Instead, Craft exposes a sanitized, read-only
snapshot of active sources to OMP through the existing Host URI bridge.

### Why this direction

- Craft already owns the session-scoped source picker, permission UI, and credential
  manager. Re-asking the user to configure sources inside OMP would create two
  permission dialogs and two credential stores.
- OMP is running as a backend provider; its value is reasoning and tool execution,
  not source lifecycle management.
- A read-only bridge lets OMP extensions reason about available sources without
  receiving secrets or gaining write access to source configuration.

### Scope rules

| Capability | Owner | OMP access |
|---|---|---|
| Add / remove / configure sources | Craft (desktop UI/settings) | Read-only via `craft-workspace://current/sources` |
| Activate / deactivate sources for a session | Craft (per-session `enabledSourceSlugs`) | Observed through the same snapshot |
| MCP server lifecycle (start/stop/restart) | Craft pool | Not exposed to OMP directly |
| Credentials, tokens, headers, raw config | Craft credential manager | Never exposed |
| OMP-internal MCP servers (OMP plugins/extensions) | OMP CLI config | OMP manages its own; Craft does not duplicate |
| Tool discovery / BM25 activation | OMP, with results visible in UI | Read-only status via diagnostics |

### Consequences

- OMP `/mcp` commands that mutate MCP configuration are not directly supported in
  the desktop UI. Users manage sources through Craft's source panel and settings.
- If a user has an OMP-managed MCP server that Craft does not know about, OMP can
  still use it, but it will not appear in Craft's source picker and will not be
  subject to Craft's per-source permissions.
- The Host URI `craft-workspace://current/sources` endpoint is the only supported
  cross-system read path. Arbitrary workspace/source/Todo writes remain rejected.

### Future work

- If upstream OMP exposes RPC commands to list/register MCP servers, we can add a
  read-only "OMP MCP status" panel and let users decide whether to import an OMP
  MCP server into Craft Sources.
- A future protocol extension could allow OMP to request activation of a Craft
  source by slug, subject to the normal Craft permission flow.

## Related documents

- `docs/superpowers/specs/2026-07-09-omp-host-uri-artifacts-design.md`
- `docs/agent-batches/06-omp-sources-mcp-permissions-e2e.md`
- `packages/shared/src/sources`
- `packages/shared/src/mcp`
