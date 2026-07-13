# Oh My Pi Electron App

The primary desktop interface for Oh My Pi. It combines an Electron shell, a React renderer, durable session orchestration, and the OMP RPC backend into one visual workspace.

## Quick start

From the repository root:

```bash
bun install
bun run electron:dev
```

For a build-and-run flow:

```bash
bun run electron:start
```

## Architecture

```text
apps/electron/
├── src/main/       Electron lifecycle, windows, IPC, runtime services
├── src/preload/    Typed main ↔ renderer bridges
├── src/renderer/   React UI, sessions, chat, settings, feature center
├── src/shared/     Routes and cross-process types
└── resources/      Icons, themes, tool assets, bundled runtime assets
```

The app owns presentation, workspace state, session persistence, permissions, and source/tool management. The OMP backend communicates with the Oh My Pi runtime over JSONL RPC and normalizes runtime frames into the desktop event model.

## Useful commands

```bash
bun run electron:dev       # Vite-powered development loop
bun run electron:start     # Build and launch the app
bun run typecheck:electron # Electron package type checking
bun run lint:electron      # Electron package linting
bun run electron:validate-release
```

## Runtime notes

- The OMP runtime is resolved from the bundled platform asset during packaging and from the configured development environment during local runs.
- Provider credentials are configured through the app or local environment; never commit them.
- Remote/headless mode is opt-in and uses the `CRAFT_SERVER_*` environment contract inherited by the server packages.
- Release packaging is orchestrated from the repository root. See [`docs/superpowers/github-actions-multiplatform-release.md`](../../docs/superpowers/github-actions-multiplatform-release.md).

## UI changes

For renderer changes, include a focused manual smoke test in the pull request. Check both light and dark themes, keyboard focus, loading/error states, and Chinese/English locale parity when user-facing copy changes.
