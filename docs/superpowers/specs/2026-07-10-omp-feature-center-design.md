# OMP Feature Center Design

Status: Approved for implementation planning
Date: 2026-07-10

## Purpose

Craft now connects to OMP as an RPC backend, but OMP-specific product capabilities are still hard for a desktop user to discover or configure. The first version of the OMP Feature Center makes those capabilities visible and safely configurable from Craft Settings without pretending that every OMP TUI feature already has a desktop RPC equivalent.

The feature should answer four user questions:

- Which OMP runtime and configuration is this desktop using?
- Which model roles are active, especially default, plan, task, and advisor?
- How do I enable the basic Advisor flow?
- What OMP Skills, MCP servers, and agent definitions are available, and how are they invoked?

## Scope

In scope for v1:

- Add a single Oh My Pi / OMP page under Settings.
- Read OMP global configuration from `~/.omp/agent/config.yml`.
- Read project-level OMP configuration when present and mark values that are project-overridden.
- Write only global OMP configuration in v1.
- Let users edit common model roles directly: `default`, `plan`, `task`, and `advisor`.
- Show other discovered model roles in an advanced collapsed section.
- Let users edit basic Advisor settings: enabled state, advisor model role, and `subagents`.
- Show Advisor roster status and the `WATCHDOG.yml` path when present, but do not edit the roster in v1.
- Show read-only Skills, MCP, and Agents inventories with source paths, counts, and usage hints.
- Explain that native OMP `/plan` desktop control is not available until OMP exposes stable desktop/RPC support for that mode.

Out of scope for v1:

- Editing project-level OMP configuration.
- Building a full `WATCHDOG.yml` editor for multiple advisors.
- Editing OMP Skills, MCP server definitions, or agent definition files.
- Implementing native OMP `/plan` mode in Craft desktop.
- Replacing Craft Sources with OMP MCP. Craft Sources remain the desktop source-of-truth; OMP MCP is displayed as an independent OMP capability.
- Extending or forking the OMP RPC protocol for configuration APIs.

## Architecture

Add a host-side OMP capability/config service and keep the renderer away from raw YAML and filesystem details.

The service owns:

- Resolving the OMP executable and version when available.
- Resolving global and project OMP configuration paths.
- Reading effective OMP settings with source metadata.
- Updating allowed global settings.
- Scanning Skills, MCP, Agents, and Advisor roster files.
- Returning a stable DTO to the renderer.

The renderer owns:

- A Settings page entry for Oh My Pi / OMP.
- Loading, empty, error, dirty, saving, and saved states.
- Field-level source labels so users can see whether a value comes from global config, project config, or defaults.
- Save and refresh actions backed by the service DTO.

Recommended implementation boundary:

- Put filesystem/config parsing in server-side code near existing Settings or OMP runtime support.
- Expose a narrow API such as `getOmpFeatureCenterState()` and `saveOmpFeatureCenterConfig(input)`.
- Keep the DTO serializable and UI-oriented; do not leak parser internals or raw YAML ASTs.

## Data Model

The state DTO should include these groups:

- Runtime:
  - `available`
  - `version`
  - `executablePath`
  - `globalConfigPath`
  - `projectConfigPath`
  - `lastRefreshedAt`
  - diagnostics or errors
- Model roles:
  - common roles: `default`, `plan`, `task`, `advisor`
  - advanced roles: any additional keys discovered under `modelRoles`
  - each role includes value, source, global value, project override value, and validation errors
- Advisor:
  - `enabled`
  - `subagents`
  - advisor model role value
  - roster path
  - roster summary or parse error
- Skills:
  - count
  - discovered names
  - source paths
  - usage hint: `/skill:<name>`
- MCP:
  - count
  - discovered server names when available
  - source paths
  - usage hint: `/mcp list`, `/mcp test`, `/mcp resources`, `/mcp prompts`, `/mcp reload`
- Agents:
  - count
  - discovered names
  - source paths
  - usage hint for OMP custom agent definitions
- Native plan:
  - plan model role value
  - support status explaining that desktop native `/plan` control is not implemented in v1

The save input should only include fields v1 can mutate:

- global `modelRoles.default`
- global `modelRoles.plan`
- global `modelRoles.task`
- global `modelRoles.advisor`
- optional advanced global model role values if the UI allows editing them
- global `advisor.enabled`
- global `advisor.subagents`

## UI Design

The page should behave like an operational settings console, not a marketing page.

Top status band:

- OMP availability and version.
- Global config path.
- Project config path when present.
- Last refreshed time.
- Refresh action.

Model roles section:

- Four common rows are always visible: Default, Plan, Task, Advisor.
- Each row shows current effective value, source, and editable global value.
- If a project override exists, the row clearly says that saving global config will not change the effective value until the project override changes.
- Advanced roles are collapsed by default and can be expanded for power users.

Advisor section:

- Toggle for enabled state.
- Advisor model role field tied to `modelRoles.advisor`.
- Toggle for `subagents`.
- Read-only roster summary and `WATCHDOG.yml` path.
- If no roster is present, show a concise empty state rather than an error.

Skills, MCP, and Agents section:

- Three read-only capability cards.
- Each card shows discovered count, source paths, and a short usage hint.
- These cards should not duplicate Craft Sources or imply that OMP MCP can be managed through Craft Sources.

Native plan section:

- Show the configured plan model role.
- State that OMP native `/plan` desktop controls require future RPC/desktop support.
- Do not render a button that starts a native plan flow in v1.

## Data Flow

Initial load:

1. Renderer opens the OMP settings page.
2. Renderer requests OMP Feature Center state.
3. Service reads runtime status, global config, project config, and capability files.
4. Service returns normalized DTO with per-field source metadata.
5. Renderer displays state and partial errors.

Save:

1. User edits allowed global fields.
2. Renderer sends only the changed global settings to the service.
3. Service validates the existing YAML can be parsed.
4. Service updates only allowed keys in the global config.
5. Service writes the global config atomically or through the repository's established safe-write helper.
6. Service re-reads effective state and returns the refreshed DTO.
7. Renderer clears dirty state and shows saved feedback.

Refresh:

1. User clicks refresh.
2. Renderer requests a new DTO.
3. Existing unsaved changes should trigger the app's normal dirty-state confirmation pattern before being discarded.

## Error Handling

- Missing `omp.exe`: keep the page open, show runtime unavailable, and still allow reading or saving OMP config files.
- Missing global config: treat it as an empty config and create it on first save.
- YAML parse failure: block saving, show the file path and parse error, and never overwrite the broken file.
- Project override: show that the field is project-overridden; global save remains allowed but the effective value may stay unchanged.
- Unknown `WATCHDOG.yml` shape: show roster as unreadable with the path and parse error; do not block basic Advisor editing.
- Skills, MCP, or Agents scan failure: show a card-local error and keep the rest of the page usable.
- Unsupported native plan: display a limitation message and no action button.

## Testing

Back-end tests:

- Reads missing global config as empty defaults.
- Creates global config on first save.
- Preserves unrelated YAML fields when saving allowed fields.
- Blocks save when YAML parse fails and leaves the file unchanged.
- Applies project override source metadata correctly.
- Saves Advisor `enabled` and `subagents` settings.
- Scans Skills, MCP, Agents, and Advisor roster presence, absence, and malformed files.

Renderer tests:

- Displays loading, empty, partial-error, dirty, saving, and saved states.
- Shows project override labels on overridden fields.
- Keeps advanced model roles collapsed by default.
- Shows Skills, MCP, and Agents as read-only capability cards.
- Does not show a native OMP `/plan` action button in v1.

Smoke test:

- Open Settings -> Oh My Pi / OMP.
- Change a global common role or Advisor toggle.
- Save.
- Refresh.
- Confirm the displayed value and source metadata are consistent with the written global config and any project override.

## Acceptance Criteria

- A desktop user can find one OMP-specific Settings page.
- The page explains the current OMP runtime and configuration sources.
- The user can edit global common model roles and basic Advisor settings.
- The user can see how OMP Skills, MCP, and Agents are discovered and invoked.
- The page handles missing or malformed optional OMP files without crashing.
- The implementation does not edit project-level OMP config, `WATCHDOG.yml`, Skills, MCP, or Agents files in v1.
- The UI does not claim native desktop support for OMP `/plan` beyond showing the plan model role.

## Implementation Notes

- Use a structured YAML parser and preserve unrelated configuration keys.
- Keep source metadata explicit in the DTO; the renderer should not infer source precedence.
- Prefer existing Settings navigation and page component patterns.
- Prefer existing toast, inline error, and dirty-state patterns.
- Keep this feature independent from Craft Sources. OMP MCP visibility is useful, but ownership remains separate.
