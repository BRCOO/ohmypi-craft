# OMP release quality gates

Date: 2026-07-11

## Status

Approved design. This specification makes a Windows release candidate reproducible, verifiable, and traceable. It does not add an end-user feature.

## Objective

Only create a distributable Oh My Pi installer after static checks, relevant tests, packaged-runtime checks, and release evidence have passed. The same quality contract must work on a developer workstation and in CI.

## Current facts

- The application packages a protocol-enabled OMP binary in `resources/omp/<platform>-<arch>/omp[.exe]`.
- The release installer currently builds through Electron Builder, while the full root `bun run build` can still be stopped by unrelated lint failures.
- A valid package must contain exactly one OMP executable, use its application icon, and expose the native Plan RPC capability from that embedded executable.

## Alternatives considered

### 1. Documentation-only release checklist

This is easy to start but relies on memory and permits bypassing failures. It is not selected.

### 2. Separate local and CI scripts

This can optimize each environment but tends to produce incompatible checks and unclear ownership. It is not selected.

### 3. One quality contract with tiered commands (chosen)

Use one shared validator library and a small set of entry commands. Fast local checks provide rapid feedback; the release command always performs the complete contract and emits evidence.

## Design

### Quality contract

The contract has four required layers:

1. **Static quality.** Root and Electron type checks, ESLint, and `git diff --check` must pass. Existing lint violations are fixed rather than excluded or suppressed.
2. **Targeted correctness.** OMP protocol, backend, session transport, Feature Center, and renderer tests run through a named test manifest. A failing test blocks the release.
3. **Packaging integrity.** Validate `win-unpacked` and the NSIS installer: application executable exists, icon is present, only one embedded OMP binary exists in the expected resource path, and no duplicate runtime is bundled in application assets.
4. **Runtime capability.** Start the embedded OMP binary in RPC mode and verify `get_state` advertises `capabilities.planMode`, then verify `set_plan_mode` can enter `planning` in an isolated temporary workspace.

### Commands

Expose three public commands, backed by shared TypeScript validation functions:

| Command | Purpose | Produces an installer |
| --- | --- | --- |
| `quality:quick` | Formatting, type checks, and affected targeted tests | No |
| `quality:verify` | Full static, test, package-integrity, and embedded-runtime validation | No |
| `release:win` | Builds the runtime and application, runs `quality:verify`, then creates NSIS output | Yes, only on success |

The release command invokes validation before and after Electron Builder. It must never silently substitute a smaller release-only checkset.

### Release evidence

Each `release:win` run writes a JSON report next to the installer. It contains:

- application version, Git commit and dirty-tree status;
- OMP runtime version, source and negotiated capabilities;
- names and results of every validation step;
- installer path, byte length, SHA-256 checksum, and embedded runtime path;
- timestamps, operating system, and Node/Bun versions.

Failures retain their report with a failed status, command output summary, and a non-zero exit code. No report may claim success when an installer was not produced.

### CI behavior

CI calls the same scripts with an isolated data directory. It archives the report, logs, and any screenshots on failure. Credentials and user configuration are not read; external OMP is never preferred over the freshly built bundled runtime.

## Failure handling

- A missing or duplicate runtime is a hard failure, not a warning.
- An unavailable Plan capability is a hard failure for a release candidate.
- A code-signing absence is recorded as an explicit unsigned state; signing itself is outside this specification.
- Transient file locks show the locked path and suggest a retry; the command must not delete a running application or user data.

## Non-goals

- Code signing, notarization, automatic updates, upload to a distribution channel, or crash telemetry.
- Replacing the existing test runner or changing product behavior.
- Testing third-party MCP services or paid model providers; those are Release QA work.

## Test plan

- Unit-test report creation, failed-step propagation, checksum generation, and duplicate-runtime detection.
- Fixture-test valid, missing, and duplicated packaged resource trees.
- Run the embedded OMP RPC check against the built Windows executable.
- Verify a lint failure, a unit-test failure, and a runtime capability failure each prevent `release:win` from returning success.

## Acceptance criteria

1. A clean checkout can execute `release:win` and obtain an installer plus a successful report.
2. Any static, test, integrity, or Plan runtime failure prevents a successful release result.
3. The installed application contains exactly one OMP runtime and it can enter native Plan Mode.
4. CI and local release use the same command and report schema.
