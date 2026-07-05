# Oh My Pi release-readiness design

## Goal

Turn the current OMP-enabled Craft fork from a late beta into a release-ready Oh My Pi desktop product. The approved public identity is:

- product name: `Oh My Pi`;
- application identifier: `com.ohmypi.desktop`;
- artifact prefix: `Oh-My-Pi`;
- copyright owner: `Oh My Pi contributors`.

Internal workspace package names such as `@craft-agent/*` remain unchanged in this phase. Renaming them would create broad dependency churn without changing the installed product identity.

## Completion requirements

Release readiness requires all of the following evidence:

1. The repository validation suite has no errors.
2. OMP subprocess lifecycle, concurrency, malformed output, abort, timeout, and stale-response behavior have automated coverage.
3. OMP extension UI response shapes, timeout cleanup, session ownership, and remote-client fallback behavior have automated coverage.
4. Desktop OMP controls use translated copy, keyboard controls, focus management, accessible labels, and actionable recovery states.
5. Installed product metadata, icons, artifact names, copyright, update configuration, and user-facing descriptions identify Oh My Pi rather than Craft Agents.
6. CI validates Linux, Windows, and macOS build paths, with Windows packaging and launch smoke as a required gate. Signing and notarization configuration must fail clearly when a production release lacks its required secrets.
7. A real Windows Electron flow verifies OMP detection, model discovery, model selection, chat, permission handling, extension UI, restart, and update configuration without using the terminal for interaction.

## 1. Quality gates

Fix existing Electron lint errors rather than suppressing the rules. Keep current warnings visible but do not expand this release-readiness phase into a repository-wide hooks-warning rewrite.

Add focused tests to the normal validation commands and keep `validate:ci` authoritative. Windows-specific path and packaging behavior receives a Windows CI job rather than being inferred from Linux success.

## 2. OMP runtime resilience

`OmpRpcBackend` remains the protocol boundary. Harden it with these invariants:

- one backend instance owns one child process and one pending-request map;
- every child `error`, unexpected `exit`, startup timeout, and explicit shutdown settles all pending requests exactly once;
- stale stdout and exit callbacks from an older process generation cannot mutate a restarted backend;
- malformed JSONL is logged and skipped without corrupting later frames;
- a new idle operation may restart a dead OMP child;
- an interrupted in-flight prompt is never replayed automatically, because tool effects may already have occurred;
- side-channel extension responses fail safely when the process is gone;
- concurrent backend instances cannot resolve or cancel each other's requests.

Introduce the smallest test seam needed to inject a fake child-process factory and deterministic timers. Do not replace stdio RPC or embed the OMP SDK.

## 3. Extension UI verification

Keep extension UI controls runtime-only. Add testable helpers around response construction, queue removal, timeout expiration, and host-state updates so the following are proven:

- `select`, `confirm`, `input`, and `editor` emit the exact OMP response frame;
- Escape/cancel and timeout remove only the matching session request;
- timeout sends `{ cancelled: true, timedOut: true }` once;
- unknown request dismissal is conservative;
- `setStatus` and `setWidget` update or clear session-scoped host state without blocking the composer;
- a stale session or missing backend returns failure without cross-session delivery.

## 4. Desktop UX and localization

Move new OMP strings into the existing i18n catalogs and preserve locale parity. English is the source locale; all bundled locales receive intentional translations or an explicit English fallback through the normal catalog mechanism.

The structured request component must support:

- initial focus on the first actionable control;
- Enter for the primary action where safe;
- Escape for cancellation;
- arrow-key movement for selection choices;
- labelled inputs and textareas;
- `role="status"`/`aria-live` for non-blocking status updates;
- visible error and retry guidance when a response cannot be delivered.

OMP runtime diagnostics in onboarding and settings remain the recovery entry point. A failed session response should link or route users toward those diagnostics rather than only showing a generic toast.

## 5. Remote and messaging fallback

The messaging gateway handles extension events before response-mode routing:

- blocking requests send a concise message that desktop input is required;
- notifications send their safe message text;
- `open_url` sends a sanitized `http`/`https` URL and instructions, never `file:`, script, or custom schemes;
- unknown requests send an unsupported-control notice;
- status/widget/title/editor-control methods remain desktop-local and do not leak raw payloads;
- cancel events do not send a second user-facing message.

Remote clients must never fabricate approvals, confirmations, or input values.

## 6. Product identity and updates

Replace user-facing Craft identity in Electron packaging and root metadata with Oh My Pi identity. Rebuild platform icon assets from an Oh My Pi source SVG and keep the source asset committed.

Remove the Craft production update URL. Update behavior follows this contract:

- development and unsigned local builds do not contact a production updater;
- production packaging requires an explicit `OH_MY_PI_UPDATE_URL` pointing to an owned HTTPS endpoint;
- the build emits update manifests compatible with `electron-updater`;
- missing release URL or signing credentials produces an actionable release-validation failure rather than silently publishing a broken artifact.

No third-party endpoint is invented in source control. The release workflow accepts the owned endpoint and signing material through repository environment/secrets.

## 7. Cross-platform release pipeline

Keep the existing Linux validation job and add platform evidence:

- Windows: install dependencies, run OMP-focused tests, typecheck, lint, build main/preload/renderer, create the NSIS package, silently install it in an isolated directory, launch smoke, then uninstall;
- macOS: build both supported architectures where runners permit, validate bundle metadata, and run signing/notarization only for protected release jobs;
- Linux: build the configured distributable and launch it under a virtual display when available;
- upload unsigned artifacts only from explicitly labelled non-release workflows;
- production release jobs validate update metadata, checksums, signatures, and artifact names before publishing.

Add local scripts for release configuration validation and packaged-app smoke so CI and developer verification use the same commands.

## 8. End-to-end acceptance

The Windows acceptance flow uses a disposable Oh My Pi profile and records logs/screenshots for each checkpoint:

1. install and launch Oh My Pi;
2. locate a valid OMP command or show actionable recovery;
3. create the keyless `omp-local` connection;
4. display all discovered models and select a provider-qualified model;
5. complete a normal prompt and a permission-gated tool action;
6. complete select, confirm, input, editor, cancellation, and timeout extension flows;
7. restart the app and verify persisted connection/model state without stale runtime controls;
8. validate update configuration without contacting the former Craft endpoint;
9. uninstall cleanly.

## Delivery sequence

1. Make lint/CI green and add missing OMP tests.
2. Harden runtime lifecycle and extension state helpers.
3. Implement messaging fallback and localized accessible desktop UX.
4. Apply product metadata and icon rebrand.
5. Add release validation, platform workflows, and packaged smoke scripts.
6. Run the full validation matrix and Windows acceptance flow.

Each phase is committed separately so failures can be isolated and reverted without losing unrelated progress.
