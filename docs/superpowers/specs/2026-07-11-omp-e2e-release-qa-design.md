# OMP end-to-end smoke testing and Release QA

Date: 2026-07-11

## Status

Approved design. This specification adds repeatable packaged-application smoke coverage and a human release acceptance procedure.

## Objective

Detect integration failures that protocol and renderer unit tests cannot see: packaged runtime resolution, Electron-to-server transport, session state updates, installation behavior, and live external integrations.

## Alternatives considered

### 1. Manual checklist only

It can cover real credentials but is slow, inconsistent, and will miss regressions between releases. It is not selected.

### 2. Full cloud-model end-to-end suite in CI

It is expensive, flaky, and would expose credentials to routine CI. It is not selected.

### 3. Isolated automated smoke suite plus human Release QA (chosen)

Automate deterministic local behavior against the packaged application. Keep live providers, real MCP authentication, visual judgment, and upgrade behavior in a signed manual checklist.

## Automated smoke design

### Execution environment

The runner starts the packaged `win-unpacked` application with a unique temporary user-data directory, workspace, and logs folder. It starts no globally installed OMP process and does not use a real provider credential. Test fixtures supply predictable RPC responses where a model completion would otherwise be required.

Every run records the application log, OMP stderr, diagnostic snapshot, and screenshots at named checkpoints. Cleanup runs even on timeout, but never deletes non-temporary user data.

### Required scenarios

1. **Startup and runtime resolution:** application starts, identifies the bundled runtime, and shows its diagnostic source and version.
2. **Session handshake:** a new OMP session reaches `ready`; model discovery and role state are visible without a stale loading state.
3. **Plan Mode:** the slash entry is actionable before lazy startup completes; the click launches/negotiates OMP, enters `planning`, then returns to inactive after exit. Unsupported fixture runtimes keep the row disabled with an explanatory state.
4. **Advisor:** toggle on and off, assert authoritative state echoes to the renderer, and verify errors leave the prior state intact.
5. **Feature discovery:** MCP, Skills, and Agents lists render populated, empty, loading, and error states; refresh does not duplicate entries.
6. **Language:** Chinese defaults on first launch, English can be selected, and the choice survives restart.
7. **Installation:** install the NSIS artifact into a temporary location, first-launch it, then uninstall it. Assert the app executable and embedded runtime exist after install and that product files are removed after uninstall without removing user-selected workspace content.

## Manual Release QA

Each candidate version receives a dated checklist with tester, environment, and pass/fail evidence. It includes:

- real-model conversation, model-role change, long response, cancellation, and session restore;
- Plan draft, refine, cancel, approve, and subsequent execution;
- Advisor behavior with its configured model;
- authenticated MCP connection, tool invocation, an unavailable server, and redacted secret display;
- Skill and Agent activation from user and project sources;
- Chinese and English visual/copy review, keyboard navigation, permissions, offline errors, and slow OMP startup;
- fresh install, upgrade from the previous candidate, uninstall, and Windows Defender/unknown-publisher observations.

## Gates and defect policy

Automated smoke failure blocks a release. Manual QA blocks for any open P0/P1 defect; P2 defects require an owner, disposition, and explicit release decision. Each report links its build quality report from the release-gates specification.

## Non-goals

- Benchmarking model quality, token cost, or third-party uptime.
- Storing production keys in source control or CI.
- Replacing focused unit tests.
- Full visual regression for every page; the suite targets high-risk release paths.

## Test plan

- Test runner helpers for isolated paths, crash-safe cleanup, bounded waits, and evidence capture.
- Fixture-based success, timeout, malformed RPC, and unsupported-capability cases.
- A dry-run manual QA template validation that confirms every required field is completed before sign-off.

## Acceptance criteria

1. The complete smoke suite runs repeatedly against a fresh packaged application without real credentials.
2. Failures preserve enough evidence to reproduce the failed scenario.
3. Every release candidate has an attached automated report and completed human QA record.
4. No candidate with a smoke failure or unresolved P0/P1 issue is labeled release-ready.
