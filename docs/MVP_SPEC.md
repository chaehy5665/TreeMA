# TreeMA MVP Spec

## Purpose

Define the product goal, scope boundaries, and core workflows for the current MVP.

## Canonical For

- Product intent and success criteria
- In-scope and out-of-scope behavior
- Core operator workflows and required screens

## Not Canonical For

- Detailed entity definitions that belong in [DATA_MODEL.md](DATA_MODEL.md)
- Runtime architecture that belongs in [ARCHITECTURE.md](ARCHITECTURE.md)
- Exact workspace file roles that belong in [TREEMA_WORKSPACE.md](TREEMA_WORKSPACE.md)

## Goal

Build a personal internal tool that keeps project state in a structured workspace and makes that state easy to inspect, review, and update.

The MVP is successful if one person can:

- define a project structure
- track tasks, decisions, and risks separately
- review current status without reading scattered notes
- inspect a real project as staged structured analysis
- review AI-generated update proposals without losing control of canonical state
- understand whether an analysis is execution-ready or validator-blocked

## Product Position

TreeMA is not a general PM suite. It is a project-state workspace with:

- explicit structure
- explicit historical decisions
- explicit risk visibility
- AI-assisted updates under human approval
- analysis artifacts that separate observed facts from inference and uncertainty

## Core Principles

### Deterministic core first

- Canonical state lives in `.treema/project_state.json`.
- Canonical analysis root lives in `.treema/analysis/project-structure.json`.
- Stage artifacts under `.treema/analysis/**` are canonical when referenced by the root manifest.
- UI, markdown, and visualizations are readers or derived artifacts around those canonical files.

### Human-in-the-loop updates

AI may propose updates, but canonical state mutation remains review-driven in the MVP.

### Narrow and strong scope

The MVP should solve one operator's real project-state problem before adding broader automation or collaboration features.

## In Scope

- Project map with nested projects and tracks
- Structured entities for tasks, decisions, and risks
- Local `.treema` workspace initialization and loading
- Hosted `app.treesma.com` control-plane pages for account settings, OAuth completion, and desktop setup guidance
- AI-native Project Scan into Inventory, Analysis, Architecture, and Execution IR artifacts, plus deterministic Quick Scan inventory
- Validator gate with blocking and non-blocking findings
- JSON import/export
- Status board, structure map, timeline, and workspace-doc views
- Project Scan views for hierarchy, dependency graph, critical flow, and execution roadmap
- Read-only AI proposal review surface
- Local AI account settings for provider credential storage, verification, and default analysis-provider selection
- Lightweight validation for canonical state and docs/workspace contract

## Out Of Scope

- Real-time collaboration
- Autonomous AI writes to canonical state
- Direct Codex/Sisyphus execution orchestration from the app
- Rich workflow automation
- Complex analytics or forecasting
- Full PM-suite features such as chat, estimation, permissions, or sprint management

## Core Workflows

### Manual state workflow

1. Load `.treema/project_state.json`
2. Inspect structure, status, risks, and recent history
3. Edit or import canonical state
4. Validate the result
5. Save the updated canonical state

### Workspace workflow

1. Initialize `.treema/`
2. Fill in project brief and operating rules
3. Keep current focus and next tasks narrow
4. Record durable choices in decision and status logs

### Analysis workflow

1. Run Project Scan on a real project folder when an AI provider is configured, or Quick Scan for deterministic evidence only
2. Write the canonical root manifest plus stage artifacts
3. Review scanner rationale, hierarchy, dependencies, critical paths, and validator status
4. Use execution artifacts only when the validator gate is clear

### AI-assisted workflow

1. Load canonical state plus workspace context
2. Gather external context
3. Produce proposed changes
4. Render the proposed diff
5. Human approves or rejects changes
6. Record resulting state updates

### Settings workflow

1. Open Settings
2. Save local UI defaults for the current device
3. Choose the default analysis provider as `auto`, `openai`, `chatgpt-codex`, or `github-copilot`
4. Start OpenAI from ChatGPT Plus/Pro login, use hosted GitHub OAuth, or use experimental hosted ChatGPT Codex OAuth with desktop handoff
5. Persist provider credentials only in local settings under `~/.treema/settings/accounts.json`, never in project workspaces
6. Verify provider connectivity without mutating workspace files

### Provider settings state vocabulary

The Settings UI and runtime use one shared readiness vocabulary for provider accounts:

- `disconnected`: no saved credentials, and no active OAuth session
- `saved`: credentials exist, but scan readiness has not been proven by a verification pass
- `verified`: a verification pass succeeded and produced provider metadata, but scan readiness may still be blocked (for example, missing scopes, expired OAuth token)
- `scan-ready`: `verified` and eligible for Project Scan
- `needs-attention`: saved settings exist, but the provider is not `scan-ready`
- `oauth-pending`: an OAuth flow was started and the local runtime is waiting for completion
- `oauth-failed`: the last OAuth attempt failed and the failure details were recorded

### Default analysis provider precedence

The stored preference is `defaultAnalysisProvider`.

- If `defaultAnalysisProvider="auto"`, Project Scan may fall back using the deterministic order `openai -> github-copilot -> chatgpt-codex` and selects the first `scan-ready` provider.
- If `defaultAnalysisProvider` is explicitly set to `openai`, `github-copilot`, or `chatgpt-codex`, Project Scan must not silently fall back. If the selected provider is `disconnected` or not `scan-ready`, Project Scan is unavailable until the operator fixes it.

### Verification sandbox rule

Automated verification must not read or write the operator's real home directory settings. All agent-executed checks must set `TREEMA_SETTINGS_HOME` to a sandbox directory (for example, `$PWD/.sisyphus/tmp/provider-settings-home`) so account settings resolve under that sandbox instead of the real `~`.

## Primary Screens

- Structure: project hierarchy, tracks, and summary counts
- Board: tasks by status and risks by severity or status
- Timeline: recent decisions, risks, and workspace context
- Project Scan: component hierarchy, dependency graph, critical flow, execution roadmap, and validator status
- AI Review: proposal summary and per-change diff cards
- Settings: provider cards for OpenAI API, experimental ChatGPT Codex OAuth, and GitHub Copilot plus default analysis-provider selection

## Provider Boundaries

- `OpenAI API` remains the default recommended semantic-scan path when a direct API key is available.
- `GitHub Copilot` remains a supported semantic-scan path through GitHub-hosted models and OAuth or token-based verification.
- `ChatGPT Codex OAuth` is an experimental personal-use provider for Project Scan only. It is not the canonical path for team automation, shared services, proxy deployments, or general chat UX.
- `auto` keeps a deterministic fallback order of `openai -> github-copilot -> chatgpt-codex`. If the operator pins an explicit `defaultAnalysisProvider`, Project Scan does not silently switch to a different provider.

## MVP Acceptance Signals

- The operator can initialize and load a workspace without editing files manually.
- Canonical state remains legible and validates after normal updates.
- Project Scan produces useful AI-grounded staged output on a real repository, and Quick Scan remains available without semantic claims.
- `project-structure.json` remains a compact manifest rather than an unbounded data dump.
- The UI exposes validator blocking vs non-blocking status without hidden context.
