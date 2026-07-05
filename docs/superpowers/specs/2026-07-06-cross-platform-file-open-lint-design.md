# Cross-platform file-open lint rule fix

## Problem

The Electron `craft-links/no-direct-file-open` rule intentionally permits direct `electronAPI.openFile()` calls in `App.tsx`, where the platform callback is injected into `useLinkInterceptor`. The rule derives the basename with `filename.split('/')`, so the exemption fails when ESLint supplies a Windows path containing backslashes.

## Design

Keep the existing architectural exception and make only its path normalization cross-platform. Split the ESLint filename on both `/` and `\\` before checking whether the basename is `App.tsx` or `useLinkInterceptor.ts`. Do not add an inline suppression and do not broaden the allowed file set.

Add focused rule tests that verify:

- `App.tsx` is exempt with a Windows path;
- `App.tsx` is exempt with a POSIX path;
- an ordinary renderer component still reports a direct `electronAPI.openFile()` call.

## Verification

Run the focused rule test, Electron lint, and Electron TypeScript checking. The fix is complete when the existing `App.tsx` error disappears without weakening enforcement elsewhere.
