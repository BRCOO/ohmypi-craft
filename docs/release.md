# Electron release guide

Oh My Pi Desktop builds production installers for Windows, macOS, and Linux in GitHub Actions.

## Release flow

- A push to `main` builds platform artifacts without creating a Release.
- A `v*` tag creates or updates a GitHub Release after all platform jobs pass.
- A manual `workflow_dispatch` run can create a Release when `release_tag` matches the Electron package version.

The tag and `apps/electron/package.json` version must match. For example, `v0.10.5` requires version `0.10.5`.

```bash
git tag v0.10.5
git push origin v0.10.5
```

## Published assets

Each Release contains the platform installers, update metadata, blockmaps, and `SHA256SUMS.txt`:

- Windows: NSIS `.exe`
- macOS: arm64 and x64 `.dmg` and `.zip`
- Linux: x64 `.AppImage`

Build reports remain available as short-lived Actions artifacts for debugging. They are not published as Release assets.

## OMP runtime

The workflow embeds a pinned OMP runtime. The pinned version lives in `apps/electron/resources/omp/VERSION` and can be fetched locally with:

```bash
bun run scripts/ci/fetch-omp-runtime.ts --targets=win32-x64
bun run scripts/ci/fetch-omp-runtime.ts --targets=darwin-arm64,darwin-x64
bun run scripts/ci/fetch-omp-runtime.ts --targets=linux-x64
```

## Signing

Signing is optional. Without signing credentials, the workflow produces testable unsigned packages and labels their status honestly in the Release notes.

Supported GitHub Actions secrets include Windows Authenticode credentials and macOS signing/notarization credentials. Secret values are consumed only by the workflow and are never written to the repository or Release notes.

## Local verification

```bash
bun run scripts/ci/release-meta.ts
bun run scripts/ci/verify-platform-artifacts.ts --platform=windows
bun test scripts/ci/__tests__
```

If any platform job fails, the Release job is skipped. Inspect the failed platform job and its Actions artifact before retrying the tag.
