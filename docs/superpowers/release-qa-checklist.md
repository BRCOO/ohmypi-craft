# Oh My Pi Release QA Checklist

Use this template for every release candidate. Fill in all metadata, attach evidence, and do not sign off while any P0/P1 defect is open.

## Metadata

| Field | Value |
|---|---|
| Version | |
| Candidate date | |
| Tester | |
| OS / build | |
| Installer SHA-256 | |
| Automated smoke report | link: |
| Automated quality report | link: |

## Acceptance gates

- [ ] Automated smoke suite passed
- [ ] No open P0/P1 defects
- [ ] P2 defects have an owner and explicit release decision
- [ ] This checklist is complete and signed

## Conversation & model behavior

| # | Scenario | Expected result | Pass / Fail | Evidence |
|---|----------|-----------------|-------------|----------|
| 1 | Real-model greeting | OMP responds and renderer shows assistant text | | |
| 2 | Model-role change | New role is saved and used for the next prompt | | |
| 3 | Long response | Streaming completes without truncation or stale state | | |
| 4 | Cancellation | User cancel stops generation and UI returns to idle | | |
| 5 | Session restore | Re-opening the workspace restores the last session | | |

## Native Plan Mode

| # | Scenario | Expected result | Pass / Fail | Evidence |
|---|----------|-----------------|-------------|----------|
| 6 | Plan draft | `/plan <topic>` enters `planning` and shows a draft | | |
| 7 | Refine plan | Feedback regenerates the plan without losing context | | |
| 8 | Cancel plan | Plan returns to `inactive`; no execution starts | | |
| 9 | Approve plan | Approved plan dispatches execution and updates todos | | |
| 10 | Subsequent execution | Execution follows the approved plan | | |

## Advisor

| # | Scenario | Expected result | Pass / Fail | Evidence |
|---|----------|-----------------|-------------|----------|
| 11 | Enable advisor | Toggle on persists and advisor appears in composer | | |
| 12 | Advisor with configured model | Advisor uses its assigned model role | | |
| 13 | Disable advisor | Toggle off removes advisor from composer | | |

## MCP, Skills, Agents

| # | Scenario | Expected result | Pass / Fail | Evidence |
|---|----------|-----------------|-------------|----------|
| 14 | Authenticated MCP connection | MCP server connects and tools are listed | | |
| 15 | MCP tool invocation | Tool is called and result is rendered | | |
| 16 | Unavailable MCP server | Failure is reported; existing config is preserved | | |
| 17 | Redacted secret display | Secrets show as configured/masked, never plaintext | | |
| 18 | Skill activation (user source) | Skill is enabled and available via `/skill` | | |
| 19 | Skill activation (project source) | Project skill overrides user skill as designed | | |
| 20 | Agent activation | Agent is enabled and selectable | | |

## Localization & accessibility

| # | Scenario | Expected result | Pass / Fail | Evidence |
|---|----------|-----------------|-------------|----------|
| 21 | Chinese default on first launch | UI renders `zh-Hans` copy correctly | | |
| 22 | English selection | Switching to `en` updates all visible copy | | |
| 23 | Visual/copy review | No truncation, overlaps, or untranslated user-facing strings | | |
| 24 | Keyboard navigation | All primary actions reachable without a mouse | | |

## Permissions, errors, offline

| # | Scenario | Expected result | Pass / Fail | Evidence |
|---|----------|-----------------|-------------|----------|
| 25 | Permission prompt | Blocked action waits for user approval | | |
| 26 | Offline error | Clear offline/error state without crash | | |
| 27 | Slow OMP startup | App shows loading state and eventually connects | | |

## Installation & upgrade

| # | Scenario | Expected result | Pass / Fail | Evidence |
|---|----------|-----------------|-------------|----------|
| 28 | Fresh install | Installer succeeds; app and OMP runtime exist | | |
| 29 | Upgrade from previous candidate | User data and settings are preserved | | |
| 30 | Uninstall | Product files removed; user workspace content remains | | |
| 31 | Windows Defender / unknown publisher | Behavior observed and recorded | | |

## Sign-off

| Role | Name | Date | Decision |
|---|---|---|---|
| QA Lead | | | Pass / Fail / Conditional |
| Engineering Lead | | | Pass / Fail / Conditional |
| Product Lead | | | Pass / Fail / Conditional |

## Notes

- Record any P0/P1 defects here with issue links.
- Attach screenshots or screen recordings for every Fail or Conditional item.
