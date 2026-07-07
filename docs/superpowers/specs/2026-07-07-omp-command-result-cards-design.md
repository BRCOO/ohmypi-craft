# OMP Command Result Cards Design

Date: 2026-07-07  
Repo: `D:\ALL PROJECT\ohmypi-craft`  
Branch: `codex/omp-rpc-backend`

## Context

The OMP RPC backend now supports dynamic slash command discovery and can run pure slash commands such as `/stats` without hanging. Today, OMP `command_output` frames are adapted into plain `info` events. That keeps the session safe, but the result feels like an incidental system notice instead of an OMP product feature.

This design upgrades command results into lightweight command cards while keeping the implementation bounded and compatible with Craft's existing message/event flow.

## Goals

- Show OMP slash command results as recognizable command output, not generic info text.
- Preserve Markdown and code blocks returned by OMP commands.
- Show command failures with enough context to retry or diagnose.
- Avoid a broad renderer rewrite or a new persistence model.
- Keep compatibility with existing `info` rendering where possible.

## Non-goals

- Do not implement a full command center or side panel in this batch.
- Do not add per-command custom renderers for `/stats`, `/context`, `/model`, etc.
- Do not change OMP upstream RPC protocol.
- Do not solve all slash command validation and argument-schema UI in this batch.

## Proposed approach

Use a lightweight OMP command result message/card.

At the backend boundary, the OMP adapter will preserve command-output metadata from RPC frames where available:

- command name or inferred command label;
- output content;
- output format when available;
- success/error level;
- raw diagnostic details for errors.

The server/renderer event shape should stay small. The preferred shape is an enriched info-like event or a narrow new event whose renderer output is a system-style card. The UI should not pretend command output is assistant prose.

## Data flow

1. OMP emits `command_output` or an error `response`.
2. `OmpRpcEventAdapter` converts it into a structured event:
   - command result content becomes a command-card event;
   - error responses become a command error event with command, message, and raw details.
3. `SessionManager` forwards the event through the existing session event pipeline.
4. The renderer event processor adds a system-like message with command metadata.
5. Chat rendering displays an OMP Command card using the existing Markdown renderer for the body.

## UI behavior

The first version should be intentionally modest:

- Header: `Oh My Pi · /command` when command is known, otherwise `Oh My Pi Command`.
- Body: Markdown-rendered output, including fenced code blocks.
- Error state: same card shell, warning/error styling, with concise error message and optional details collapsed or visually secondary.
- Empty output: show `Command completed` instead of a blank card.

The card should use the existing dark theme tokens and the OMP blue/purple accent already introduced in the app theme work. It should feel native to the current chat stream.

## Error handling

- If OMP returns `response.success:false`, surface the command and error message.
- If the command is unknown, still display `Oh My Pi Command`.
- If output content is not a string, safely stringify it as fenced JSON.
- If command output arrives without a matching prompt result, still render it; command output should not be dropped.
- Do not duplicate completion: pure commands with `agentInvoked:false` should still finish exactly once.

## Testing

Add or update tests at the adapter/backend seam:

- `command_output` with plain text becomes a structured command result.
- `command_output` with Markdown/code remains intact.
- error `response` preserves command, id, error, and raw frame.
- `/stats`-style `agentInvoked:false` still completes without duplicate `complete`.

Manual smoke after implementation:

- run real `omp --mode rpc`;
- verify `/stats` produces command output;
- verify the renderer event shape can display the command card;
- confirm TypeScript checks still pass for shared/server-core and touched renderer files.

## Scope boundary for this batch

This batch stops at generic OMP command cards. Per-command rich views, command retry buttons, copy-diagnostics actions, and argument-schema rendering remain in the feature-parity backlog for later batches.
