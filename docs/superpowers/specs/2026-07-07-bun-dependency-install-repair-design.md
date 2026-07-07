# Bun Dependency Install Repair Design

Date: 2026-07-07  
Repo: `D:\ALL PROJECT\ohmypi-craft`  
Branch: `codex/omp-rpc-backend`

## Problem

The repository tracks `bun.lock` and its scripts use Bun, but the current local `node_modules` contains a partial pnpm installation. Direct packages resolve to Tiptap 3.20.0 and ProseMirror Model 1.25.4, while pnpm junctions resolve related packages to Tiptap 3.27.1 and ProseMirror Model 1.25.9. TypeScript therefore sees two incompatible copies of nominal editor types and Electron typechecking fails.

`pnpm-lock.yaml` is not tracked by Git and no `pnpm-workspace.yaml` exists, so pnpm is not a supported package-manager source for this repository.

## Decision

Use Bun as the only dependency installer and `bun.lock` as the only lockfile authority. Repair the local installation without changing application source, dependency ranges, or the tracked lockfile.

## Implementation

1. Verify the worktree and record any user-owned changes.
2. Remove the untracked pnpm lockfile and the mixed local `node_modules` tree.
3. Reinstall dependencies from the tracked Bun lockfile with a frozen lockfile.
4. Confirm the installed Tiptap and ProseMirror packages resolve to one coherent version set.
5. Run Electron and UI TypeScript checks.
6. Run the focused OMP session-continuity regression tests to confirm the environment repair did not affect the previous batch.

## Safety

- Do not edit `package.json` or `bun.lock` unless the frozen install proves they are internally inconsistent.
- Do not commit generated dependencies or package-manager caches.
- Preserve all tracked and unrelated user files.
- If the frozen Bun install fails, stop and diagnose the lockfile rather than silently regenerating it.

## Acceptance Criteria

- No pnpm junctions remain in the active dependency tree.
- All direct Tiptap packages resolve to the version recorded in `bun.lock`.
- Electron and UI TypeScript checks pass without duplicate Tiptap/ProseMirror type errors.
- Core/shared/server-core typechecks and focused OMP tests remain green.
- The Git worktree contains no unintended lockfile or application-source changes.
