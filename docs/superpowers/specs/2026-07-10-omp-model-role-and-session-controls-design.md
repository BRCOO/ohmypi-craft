# OMP Model Role Selector and Session Controls Design

Status: Implemented; acceptance hardening verified
Date: 2026-07-10
Related spec: `docs/superpowers/specs/2026-07-10-omp-feature-center-design.md`

## 1. Purpose

The OMP Feature Center already exposes model roles, Advisor configuration, Skills, MCP servers, Agents, and RPC command discovery. Two product gaps remain:

1. A model-role row currently renders both a synchronized model picker and a free-form text input. The two controls edit the same value, so the row looks unfinished and makes the primary interaction unclear.
2. The session `/` menu exposes permission modes, Compact Context, and raw runtime-discovered OMP commands, but it does not present a stable, curated overview of OMP controls such as Plan Mode status, Advisor state, MCP, Skills, Agents, and Models.

This design makes model selection single-purpose and turns the `/` menu into the primary session-level discovery surface for OMP without claiming support for TUI-only commands that the current RPC protocol cannot execute.

## 2. Goals

- Use one primary control per model role.
- Preserve custom or previously configured model IDs without showing a permanent duplicate input.
- Keep the existing `provider/model[:thinking]` storage format and thinking-level behavior.
- Add a concise, Codex-style curated OMP section to the session `/` menu.
- Show whether Advisor is enabled and allow safe global toggling.
- Show MCP, Skills, Agents, and Models as discoverable product capabilities.
- Show native Plan Mode honestly: actionable only when OMP RPC exposes a real toggle/state contract.
- Keep raw runtime-discovered OMP commands available for power users without letting them dominate the zero-query menu.
- Continue hiding commands that are known to be TUI-only or unavailable over RPC.

## 3. Non-goals

- Do not invent a host-side `/plan` implementation.
- Do not send textual TUI commands and assume they changed hidden OMP state.
- Do not make project-level OMP configuration editable from the session menu.
- Do not edit MCP server definitions, Skills, or Agent files from the session menu.
- Do not replace the full OMP Feature Center with the session menu.
- Do not redesign the global model selector used by ordinary chat sessions.
- Do not change OMP model-role precedence or the YAML schema.

## 4. Considered Approaches

### 4.1 Keep the picker and free-form input side by side

This preserves maximum flexibility but keeps two controls for one value. It also allows the text field and picker label to appear inconsistent while the user is typing. This approach is rejected.

### 4.2 Make model roles select-only

This is visually simple, but it would make unknown, newly introduced, or manually configured OMP model IDs impossible to preserve or enter when model discovery is stale. This approach is rejected.

### 4.3 Select-first with an explicit custom state

This is the recommended approach. A normal role row shows only the synchronized model picker. `Custom model…` reveals a text field only when the user explicitly requests it, and an unknown current value automatically enters that state. This keeps the common path clean without sacrificing compatibility.

### 4.4 Show only raw RPC-discovered commands in the `/` menu

This accurately mirrors the runtime but produces an unstable and noisy information architecture. Important product capabilities disappear when the runtime does not expose a matching slash command. This approach is rejected as the only discovery mechanism.

### 4.5 Show only fixed desktop shortcuts

This creates a predictable menu but hides OMP extensions, Skills, MCP prompts, and other runtime-discovered commands. This approach is rejected.

### 4.6 Curated desktop controls plus searchable runtime commands

This is the recommended command-menu approach. Stable desktop rows expose product concepts and current status. Runtime commands remain searchable and are rendered only when the backend reports them. Known TUI-only commands remain filtered out.

## 5. Model Role Selector

### 5.1 Component boundary

Keep the behavior local to the OMP Feature Center. `ModelRolePicker` should own:

- selecting a synchronized OMP model;
- switching to and from the custom-model state;
- selecting a thinking suffix;
- preserving unknown configured values;
- clearing the global binding so OMP can inherit its default.

Do not change `SearchableModelInput`, because that component is intended for API setup and other contexts where direct typing is the primary interaction.

### 5.2 Normal state

Each role row contains:

- the role label and source badge;
- the effective-value summary;
- one full-width searchable model picker;
- thinking-level chips below the picker;
- the read-only global/effective metadata already shown by the row.

The permanent `provider/model[:thinking]` input is removed.

The picker list has this order:

1. `Use OMP default` when clearing the global binding is valid;
2. synchronized OMP models;
3. configured values not present in the synchronized model list;
4. `Custom model…` as the final action.

Selecting `Use OMP default` clears the global role value. It must not remove or edit a project override.

### 5.3 Custom state

Selecting `Custom model…` replaces the picker trigger with a compact custom editor containing:

- one text input for the base `provider/model` ID;
- a `Choose model` action that returns to the picker;
- the same thinking-level chips used by normal state.

The text input edits only the base model ID. Thinking is controlled by the chips and serialized as the existing optional `:thinking` suffix. This avoids two simultaneous ways to edit the same suffix.

If the page loads a role value whose base model is absent from the synchronized and configured options, the row automatically renders the custom state and preserves the value exactly. Loading the page must never silently normalize or replace an unknown model ID.

### 5.4 Project overrides

When a project override exists:

- the row continues to edit the global value only;
- the effective-value text and project-override warning remain visible;
- choosing or clearing a global value does not imply that the effective value will change;
- no project configuration is written.

### 5.5 Loading and failure states

- While models are loading, keep the current value visible and disable only opening the model list.
- If model synchronization fails, preserve the current value and keep `Custom model…` usable.
- If no synchronized models exist, the picker still offers configured values, `Use OMP default`, and `Custom model…`.
- An empty custom model is allowed only as the transient editing state; saving it is treated as clearing the global binding.

## 6. Session `/` Menu Information Architecture

The zero-query menu should be short, stable, and grouped in this order:

1. **Modes** — Explore, Ask, Execute.
2. **OMP Controls** — Plan Mode and Advisor for OMP-backed sessions.
3. **Tools & Context** — MCP, Skills, Agents, and Models for OMP-backed sessions.
4. **Commands** — Compact Context and other first-party desktop commands.
5. **Runtime results** — matching runtime-discovered OMP commands, Skills, MCP prompts, and Agents when the user types a filter.
6. **Recent Working Directories** — existing folder navigation.

OMP-specific curated rows are not shown for non-OMP sessions.

### 6.1 Curated row behavior

| Row | Metadata | Selection behavior |
| --- | --- | --- |
| Plan Mode | `On`, `Off`, or `RPC unavailable` | Toggle only when `nativePlan.toggleAvailable` is true and runtime state exposes a supported action. When unsupported, render a disabled status row; do not insert or execute `/plan`. |
| Advisor | `On`, `Off`, or `Project override` | Toggle global `advisor.enabled` through the existing Feature Center save API. When project-overridden, render read-only state with an explicit override explanation and do not issue a global quick-toggle write. |
| MCP | `<count> servers` or `Unavailable` | Open Settings → OMP at the MCP inventory. Runtime `/mcp` commands remain separate and appear only when actually reported by OMP. |
| Skills | `<count> skills` | Open the Skills inventory. Individual runtime Skills remain searchable by name and `/skill:` syntax. |
| Agents | `<count> agents` | Open the Agents inventory. Runtime agent commands remain searchable when reported. |
| Models | `<count> models` | Open the Model Roles section in the OMP Feature Center. |

The Plan Mode status row is a desktop capability indicator, not a synthetic copy of the TUI `/plan` command. Keeping it visible but disabled when RPC support is absent satisfies discoverability without violating the rule that unavailable TUI-only commands must not be executable.

### 6.2 Runtime command visibility

The renderer continues to use `OmpControlStateDto.availableCommands` as the source of truth for executable OMP commands.

- Never add an executable runtime command that is absent from `availableCommands`.
- Filter commands listed by `OmpFeatureCenterStateDto.unavailableCommands` when their status is `hidden` or `needs-upstream-rpc`.
- Do not render a raw command twice when a curated row already performs the same executable action.
- At an empty filter, show curated rows and keep the long runtime list out of the initial viewport.
- Once the user types a filter, include matching runtime commands and source metadata such as `omp`, `skill`, `mcp`, or `agent`.
- Preserve keyboard navigation, Enter/Tab selection, Escape closing, and cursor-relative positioning.

### 6.3 Action model

Extend the menu item model so presentation is not coupled to string insertion. Each item resolves to one of these action categories:

- `permission-mode` — update Craft permission mode;
- `local-command` — execute an existing desktop command such as Compact Context;
- `omp-command` — insert or execute a command reported by OMP RPC;
- `omp-toggle` — invoke a supported typed control such as Advisor enabled state;
- `navigate` — open and focus a section of the OMP Feature Center;
- `disabled-status` — render discoverable state with no executable action.

Disabled items must be excluded from Enter/Tab activation and use a clear muted treatment plus a short reason. They must remain searchable.

## 7. State and Data Flow

### 7.1 Quick-control snapshot

The session menu needs a small renderer-facing snapshot derived from existing state rather than a second configuration system. The snapshot contains:

- whether the current session uses the OMP backend;
- native Plan support and current state when exposed;
- effective/global/project Advisor enabled values;
- Skills, MCP, and Agents counts;
- synchronized OMP model count;
- the current unavailable-command policy.

Use the existing `OmpControlStateDto` for runtime commands and queue/runtime state. Use `OmpFeatureCenterStateDto` for configuration and inventory state. Do not duplicate YAML parsing in the renderer.

The Feature Center state should be loaded lazily the first time an OMP session opens the `/` menu, cached per workspace, and invalidated after a successful Feature Center save or explicit refresh. Menu opening must not synchronously scan the filesystem on every keystroke.

### 7.2 Advisor toggle

1. User selects Advisor in an OMP session.
2. Renderer verifies that the effective value is globally editable.
3. Renderer applies an optimistic `On`/`Off` state and sends a partial save containing only `advisor.enabled` and the workspace ID.
4. The host service updates the existing OMP global config through the safe-write path and returns refreshed Feature Center state.
5. Renderer replaces the optimistic snapshot with returned state and shows concise saved feedback.
6. On failure, renderer rolls back the optimistic state and shows the host error.

No model-role, roster, or unrelated Advisor field is included in this quick-toggle write.

### 7.3 Plan Mode

The current known state is `rpc-unavailable`, so the first implementation renders Plan Mode as a disabled status row with `RPC unavailable`. A future OMP RPC version may make the row interactive only after both conditions are true:

- `nativePlan.toggleAvailable` is true; and
- the session runtime exposes typed state and an executable toggle/review action.

The implementation must not infer Plan state from `modelRoles.plan`, because that value selects the Architect model and does not mean Plan Mode is active.

### 7.4 Navigation rows

MCP, Skills, Agents, and Models open Settings → OMP and focus the corresponding section. The settings page should support a small section key such as `models`, `mcp`, `skills`, or `agents`; unknown keys fall back to the page top. Navigation does not mutate configuration.

## 8. Error Handling

- If Feature Center state cannot be loaded, keep ordinary permission modes and Compact Context usable. Show OMP curated rows with `Unavailable` metadata only when the session is known to be OMP-backed.
- If the Advisor save fails, roll back optimistic state and keep the menu usable.
- If a project override controls Advisor, do not issue a global quick-toggle write.
- If the current model-role value is unknown, preserve it in custom state.
- If OMP model discovery is empty or stale, never clear a configured role automatically.
- If a runtime command disappears between render and selection, abort the action and show a concise “command no longer available” message.
- If Plan RPC support is absent, the disabled row must not have an activation handler.

## 9. Accessibility and Visual Rules

- Use the existing dark OMP surface, blue-violet accent, spacing, and typography tokens.
- Do not introduce a second bordered field beside the model picker in normal state.
- Keep one-line labels and descriptions in the menu; truncate long runtime metadata.
- Provide visible keyboard focus for picker options, thinking chips, and menu rows.
- Expose `aria-checked` for interactive toggle rows and `aria-disabled` for unavailable Plan or project-overridden Advisor rows.
- Do not communicate On/Off, override, or error state by color alone.
- Keep touch targets at least 32 px high in dense desktop layouts.
- Put all new user-facing labels, descriptions, status text, and errors behind the existing i18n system; English strings in this document describe behavior rather than authorizing hard-coded copy.

## 10. Implementation Boundaries

Expected renderer surfaces:

- `apps/electron/src/renderer/pages/settings/OmpFeatureCenterSettingsPage.tsx`
  - simplify `ModelRolePicker`;
  - add custom-state handling;
  - support section focus for navigation rows.
- `apps/electron/src/renderer/components/ui/slash-command-menu.tsx`
  - add curated action types, disabled state, grouping, and runtime-result visibility rules.
- `apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx`
  - provide OMP quick-control state and route selected actions.
- the nearest app-shell/session owner
  - lazy-load and cache Feature Center state by workspace;
  - perform Advisor partial saves and settings navigation.

Expected shared/host changes are limited to a small quick-control DTO or cache/invalidation hook if the existing DTO wiring cannot be reused cleanly. No new YAML schema, OMP protocol extension, or duplicate filesystem scanner is permitted.

## 11. Testing Strategy

### 11.1 Model-role unit tests

- Known model renders one picker and no permanent text input.
- Selecting a model preserves the chosen thinking suffix unless the selected option explicitly contains one.
- Selecting a thinking chip serializes the expected suffix.
- `Use OMP default` clears only the global binding.
- `Custom model…` reveals the custom input.
- Unknown configured values automatically render and remain intact in custom state.
- Failed or empty model discovery still permits custom entry and preserves the current value.
- Project override copy remains visible and global edits do not modify project state.

### 11.2 Slash-menu unit tests

- Non-OMP sessions do not show OMP Controls or OMP Tools & Context.
- OMP sessions show Plan Mode, Advisor, MCP, Skills, Agents, and Models.
- Plan Mode is disabled and non-activatable while `toggleAvailable` is false.
- Advisor shows effective On/Off state and emits only the intended toggle action.
- Project-overridden Advisor does not emit a global save action.
- MCP, Skills, Agents, and Models emit the correct navigation actions.
- Empty-filter menus prioritize curated rows; filtered menus include matching runtime commands.
- TUI-only unavailable commands never become executable menu items.
- Keyboard selection skips disabled rows.

### 11.3 Integration tests

- Opening the `/` menu in an OMP session lazy-loads Feature Center state once per workspace.
- Advisor quick toggle writes only `advisor.enabled`, refreshes state, and rolls back on failure.
- Settings navigation focuses the requested OMP section.
- A runtime command removed before activation fails safely.

### 11.4 Manual QA

1. Open Settings → OMP and inspect all common model roles.
2. Select a synchronized model and thinking level; verify there is no duplicate text input.
3. Select `Custom model…`, enter an unknown model, save, refresh, and verify it is preserved.
4. Open an OMP session and type `/`.
5. Confirm Plan Mode shows `RPC unavailable`, Advisor shows On/Off, and MCP/Skills/Agents/Models show counts.
6. Toggle Advisor and verify `~/.omp/agent/config.yml` changes without unrelated key changes.
7. Search for a known Skill or MCP command and verify only runtime-reported commands are executable.
8. Open a non-OMP session and confirm OMP-specific curated rows are absent.

## 12. Acceptance Criteria

- Normal model-role rows never show both a picker and a free-form field.
- Every existing model-role value remains representable, including unknown custom IDs.
- Thinking levels remain editable without typing suffixes manually.
- The OMP session `/` menu exposes Plan Mode status, Advisor state, MCP, Skills, Agents, and Models in stable groups.
- Advisor can be toggled globally from the menu unless a project override controls the effective value.
- Plan Mode is not executable until typed RPC support exists.
- Known unavailable TUI-only commands remain non-executable.
- Raw OMP runtime commands remain searchable and are sourced only from live RPC discovery.
- Ordinary non-OMP sessions retain their current menu behavior.
- Targeted renderer, host, typecheck, and manual QA suites pass.

## 13. Delivery Split

This design should be implemented in two independently reviewable changes:

1. **Model role selector cleanup** — single picker, custom state, default clearing, thinking behavior, and focused tests.
2. **OMP session controls** — curated menu actions, quick-control state, Advisor save path, section navigation, runtime filtering, and focused tests.

The first change must not depend on the second. The second may reuse the Feature Center state and save APIs but must not move configuration ownership into the renderer.

## 14. Implementation Status

- **Model role selector cleanup** — implemented in `apps/electron/src/renderer/pages/settings/OmpFeatureCenterSettingsPage.tsx`.
  - `ModelRolePicker` now renders a single searchable picker in normal state.
  - `Use OMP default` clears the global role binding.
  - `Custom model…` enters a compact custom editor that preserves the current value.
  - Unknown configured values automatically render in custom state.
  - Thinking-level chips remain available in both states.
  - Unit tests added to `apps/electron/src/renderer/pages/settings/__tests__/omp-feature-center-settings-page.test.tsx`.
  - Renderer typecheck and the focused test suite pass.
- **OMP session controls** — implemented.
  - Added curated OMP slash-menu groups (`OMP Controls` and `Tools & Context`) in `apps/electron/src/renderer/components/ui/slash-command-menu.tsx`.
  - Plan Mode renders as a disabled status row while `nativePlan.toggleAvailable` is false.
  - Advisor row shows effective On/Off state and is disabled when controlled by a project override.
  - MCP, Skills, Agents, and Models rows navigate to Settings → OMP and focus the corresponding section.
  - Runtime OMP commands remain hidden at empty filter and appear only when a filter matches; commands marked `hidden` or `needs-upstream-rpc` are filtered out.
  - `FreeFormInput.tsx` lazily loads Feature Center state when the `/` menu opens for an OMP session and performs the Advisor quick-toggle through the existing save API.
  - `OmpFeatureCenterSettingsPage.tsx` listens for `craft:focus-omp-section` and scrolls/focuses the requested section.
  - Added focused unit tests in `apps/electron/src/renderer/components/ui/__tests__/slash-command-menu.test.tsx`.
  - Renderer typecheck and the focused test suite pass.
- **Acceptance hardening** — implemented.
  - Feature Center state is cached and deduplicated per workspace, then refreshed across mounted session inputs after settings loads, saves, and Advisor quick toggles.
  - Settings section navigation uses a pending request that survives route mounting and still handles an already-mounted settings panel.
  - Unavailable command matching normalizes leading `/` characters so entries such as `/plan` correctly filter runtime command names such as `plan`.
  - Curated menu rows expose menu roles, `aria-disabled`, Advisor `aria-checked`, and non-activatable disabled behavior.
  - Model-role and curated session-control copy is translated across every supported locale, with locale parity and sorting checks.
  - Synchronized model metadata now reports the active OMP connection's model count instead of the number of configured role slots.
