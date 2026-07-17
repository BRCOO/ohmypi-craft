# Changelog

All notable changes to Oh My Pi Desktop will be documented here.

The project is currently in active development. Release notes are versioned by desktop release.

## [Unreleased]

## [0.10.6] - 2026-07-17

### Highlights

- Added the OMP CLI workspace and aligned its command surface with the desktop RPC bridge.
- Added OMP session controls, collaboration panels, advanced settings, marketplace, and extension control centers.
- Fixed runtime-discovered OMP skills, MCP servers, and agents being shown as zero items in desktop diagnostics.
- Added provider-aware model capabilities, thinking levels, and compatibility handling.
- Added release validation and synced the workspace lockfile for reproducible CI installs.

- Oh My Pi is exposed as a first-class desktop backend through a typed RPC bridge.
- Sessions can discover and select OMP models without leaving the desktop workspace.
- OMP extension requests can render as inline desktop controls for select, confirm, input, and editor flows.
- Feature Center surfaces lifecycle management for MCP servers, Skills, and Agents.
- Release automation covers macOS, Windows, and Linux artifacts with integrity reports and smoke-test gates.
- The repository now includes a public-project README, contribution workflow, issue templates, and release-oriented documentation.

### Notes

- Packaging, APIs, and provider integrations may continue to change during active development.
