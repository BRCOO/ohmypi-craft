# Contributing to Oh My Pi Desktop

Thanks for helping make Oh My Pi a better visual home for agent work. Contributions are welcome across the desktop UI, OMP integration, runtime tooling, documentation, and release engineering.

## Before you start

- Read the [Code of Conduct](CODE_OF_CONDUCT.md).
- For security issues, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.
- Check existing issues and pull requests before starting larger changes.
- For substantial behavior changes, open an issue first so the design and scope are clear.

## Development setup

### Prerequisites

- [Bun 1.3.14](https://bun.sh/)
- Node.js 18+
- Git
- macOS, Windows, or Linux for the relevant development target

### Clone and run

```bash
git clone https://github.com/BRCOO/ohmypi-craft.git
cd ohmypi-craft
bun install
bun run electron:dev
```

Provider credentials are configured locally. Never commit `.env` files, API keys, OAuth secrets, credentials, or private workspace data.

## Workflow

1. Create a focused branch from the current development branch.
2. Make the smallest change that solves the problem.
3. Add or update tests for behavior changes.
4. Update user-facing documentation when commands or workflows change.
5. Run the relevant quality gates before opening a pull request.

Use descriptive branch names such as:

- `feat/omp-model-picker`
- `fix/session-reconnect`
- `docs/first-run-guide`
- `test/rpc-frame-parser`

## Quality gates

Run the fastest relevant checks while iterating:

```bash
bun run quality:quick
```

Before a substantial pull request or release-related change, run:

```bash
bun run quality:verify
bun run typecheck:all
bun test
```

For Electron UI changes, also include a manual smoke test and screenshots or a short recording in the pull request description when useful.

## Pull requests

Please use the pull request template and include:

- what changed and why;
- the user-visible behavior;
- tests and commands run;
- screenshots for visual changes;
- follow-up work or known limitations.

Keep commits readable and focused. Conventional prefixes such as `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, and `chore:` are encouraged.

## Project orientation

- `apps/electron/` — desktop shell and renderer
- `packages/shared/src/agent/backend/omp/` — OMP RPC adapter
- `packages/server-core/` — session orchestration and runtime services
- `packages/ui/` — shared UI primitives
- `scripts/` — build, release, and smoke-test automation
- `docs/superpowers/` — architecture decisions and release QA plans

Keep OMP behavior at the backend boundary when possible. Avoid duplicating runtime state in the renderer, and preserve explicit permission and error states instead of silently falling back.

## License

By contributing, you agree that your contributions will be licensed under the Apache License 2.0.
