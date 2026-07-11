# OMP Chinese-first localization and copy governance

Date: 2026-07-11

## Status

Approved design. This specification makes Simplified Chinese the default desktop language and provides a persistent English alternative without translating identifiers or user content.

## Objective

Remove unintended Chinese/English mixing from application-owned UI, including Settings, the composer slash menu, OMP Plan/Advisor controls, Feature Center, diagnostics, installation messages, and common failure states.

## Alternatives considered

### 1. Translate only Settings

It addresses the most visible page but leaves menus and errors inconsistent. It is not selected.

### 2. Hard-code Chinese copy in individual components

It is quick but makes language switching, review, and regression detection impractical. It is not selected.

### 3. Application-level locale state and message catalog governance (chosen)

Use one locale store, a typed message catalog, and build/test checks that forbid application-owned hard-coded copy. Present upstream technical names faithfully while supplying localized explanatory text.

## Locale behavior

- First run defaults to `zh-Hans`, regardless of operating system locale.
- Settings exposes `简体中文` and `English` as the supported choices.
- Selecting a language updates already mounted renderer UI immediately and persists in the existing user preference store.
- The persisted locale applies after restart, session changes, and workspace changes. When unavailable or malformed, it safely falls back to `zh-Hans`.

Locale state remains renderer-owned and is available through a single hook/provider. Date, relative-time, plural/quantity, interpolation, and keyboard copy use the locale runtime rather than component-local formatting.

## Message catalog design

All user-visible Craft-owned copy moves behind stable message keys in the existing `zh-Hans` and `en` catalogs. Keys are semantic and component-independent, for example `omp.plan.enable`, not `freeFormInput.enablePlanButton`.

The rollout order is:

1. Settings navigation, OMP runtime, Model Roles, and save/refresh actions.
2. Composer modes, slash menu, Plan, Advisor, MCP, Skills, Agents, and state badges.
3. Runtime diagnostics, permission/errors, installer/release notices, empty states, and accessibility labels.
4. Remaining application-owned renderer copy found by an inventory scan.

A shared glossary defines canonical bilingual terms: `计划模式 / Plan Mode`, `顾问 / Advisor`, `技能 / Skills`, `智能体 / Agents`, and `模型角色 / Model Roles`. Product copy uses Chinese labels first and may include the English product term in parentheses where it materially helps recognition.

## Upstream and diagnostic content

Model IDs, command names, paths, source labels, user prompts, model replies, and raw third-party OMP/MCP errors are not translated or altered. When an upstream failure is surfaced, the app shows:

1. a localized summary and recommended action;
2. an optional details view with original error, error code, and safe diagnostic metadata.

This preserves accuracy while giving Chinese users actionable guidance. Raw errors are sanitized before display and logs redact known secrets.

## Quality controls

- A catalog parity check ensures every supported locale has each required key and rejects duplicate or unused keys.
- A targeted source scan flags new application-owned literal user copy outside catalog files, with allowlists for identifiers and test fixtures.
- Renderer tests assert Chinese first-run rendering, immediate toggle behavior, persistence after reload, English completeness for critical OMP flows, and fallback behavior.
- Screenshot-based Release QA verifies clipping, wrapping, RTL-neutral layouts, and mixed-language exceptions on the settings and composer paths.

## Non-goals

- Adding languages beyond Simplified Chinese and English.
- Translating user-written text, model output, model IDs, commands, file paths, or OMP's independent terminal UI.
- Machine-translating third-party error content.

## Acceptance criteria

1. A fresh installation displays the core desktop experience in Simplified Chinese.
2. Switching to English updates active pages without restart and persists across restart.
3. Core OMP flows contain no accidental mixed-language Craft copy.
4. Every upstream/raw English string has a localizable surrounding explanation where it is actionable.
5. CI detects missing catalog entries and newly introduced hard-coded application copy.
