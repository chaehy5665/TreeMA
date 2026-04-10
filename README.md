# TreeMA

TreeMA is an internal project operating system for structured project state.

The concrete target is project externalization for vibe coding and programming workflows:

- capture the main purpose of a project
- make current state visible
- keep decisions and status updates legible
- give AI a stable folder and file structure to read from
- visualize the structured state in the Treema UI

The initial scope is intentionally narrow:

- Represent projects, subprojects, and tracks as a map
- Store tasks, decisions, and risks in a structured JSON state
- Analyze a real project folder into staged structured IR artifacts
- Let AI propose state updates
- Let a human review and approve changes
- Visualize current structure, status, and recent history

This repository starts from the deterministic core, not from automation-heavy behavior.

## Initial artifacts

- `AGENTS.md`: repo map for agents and humans
- `docs/README.md`: knowledge-base index
- `docs/MVP_SPEC.md`: product scope and workflows for the first usable version
- `docs/DATA_MODEL.md`: core entities and constraints
- `docs/ARCHITECTURE.md`: runtime boundaries and invariants
- `docs/PLANS.md`: execution-plan rules and lifecycle
- `docs/QUALITY_SCORE.md`: compact quality rubric
- `docs/TECH_DEBT.md`: tracked implementation and docs debt
- `examples/project_state.example.json`: example state file
- `examples/ai_proposal.example.json`: example AI proposal payload
- `schemas/project_state.schema.json`: JSON Schema draft for validation
- `schemas/project_structure.schema.json`: JSON Schema for the analysis root manifest
- `index.html`: dependency-free MVP interface
- `landing.html`: public-facing landing page for product positioning and local run entry
- `app/`: hosted `app.treesma.com` control-plane pages for auth completion, account settings, and desktop handoff guidance
- `landing.css`: landing page styling and responsive editorial layout
- `privacy.html`: public-facing privacy policy for the website and current MVP distribution
- `support.html`: public-facing customer support page for the website and current MVP distribution
- `terms.html`: public-facing terms of service for the website and current MVP distribution
- `legal.css`: shared styling for legal pages
- `vercel.json`: Vercel routing config that enables extensionless public URLs and redirects the deployed root to the landing page
- `api/auth/github/start.mjs`: Vercel-hosted GitHub OAuth starter for the hosted web app surface
- `api/auth/github/callback.mjs`: Vercel-hosted GitHub OAuth callback function for the public `treesma.com` route
- `electron/main.cjs`: Electron desktop shell and IPC handlers
- `electron/preload.cjs`: safe renderer bridge for desktop runtime actions
- `scripts/validate-state.mjs`: lightweight runtime validator
- `scripts/treema.mjs`: per-project `.treema` workspace initializer and snapshot updater
- `docs/TREEMA_WORKSPACE.md`: on-disk workspace contract

## Product principle

The system is split into four layers:

- Reality: code, database, git, documents, logs
- Structured state: `.treema/project_state.json`
- Structured analysis: `.treema/analysis/project-structure.json` plus stage artifacts
- Human context: `.treema/*.md`
- UI: views for humans
- AI: proposal engine, never the source of truth

The analysis root manifest stays compact and points to stage artifacts rather than embedding all detail inline.

## Phase 1 target

Build a personal internal tool that makes project state legible and reviewable.

## Run

1. `npm run serve`
2. Open [http://localhost:4173](http://localhost:4173)

Public landing:

- [http://localhost:4173/landing.html](http://localhost:4173/landing.html): product overview, MVP positioning, and local run guide
- [http://localhost:4173/privacy.html](http://localhost:4173/privacy.html): privacy policy
- [http://localhost:4173/support.html](http://localhost:4173/support.html): customer support
- [http://localhost:4173/terms.html](http://localhost:4173/terms.html): terms of service
- [README.md](README.md): repository overview and local workflow details
- Vercel deployment root `/`: redirects to `/landing`
- Vercel public support and legal paths: `/support`, `/privacy`, and `/terms` map to their `.html` files via `cleanUrls`
- Vercel public GitHub OAuth start: `/api/auth/github/start`
- Vercel public GitHub OAuth callback: `/auth/github/callback` rewrites to `/api/auth/github/callback`
- `app.treesma.com`: host-based rewrites map `/`, `/auth/complete`, `/settings/accounts`, and `/settings/download` into `app/`

`serve` now starts the Treema local app server, not a static file server. The UI can:

- initialize `.treema/` inside a real project directory
- load an existing `.treema/` workspace
- analyze a target project directory into a root manifest plus staged analysis artifacts
- write status snapshots back to markdown and `project_state.json`

Desktop runtime:

1. `npm install`
2. `npm run desktop`

`desktop` opens the same UI inside Electron and routes workspace actions through native IPC instead of the local HTTP server.

Settings now also includes local `AI Accounts` controls for:

- `OpenAI`: start from ChatGPT Plus/Pro login, with API key, base URL, and default model as the manual fallback for direct API access
- `GitHub Copilot`: exposes an Authorization callback URL for GitHub OAuth on the local runtime, with a supported GitHub user token as the manual fallback for direct verification

These credentials are stored outside project workspaces in `~/.treema/settings/accounts.json`. They are never written into `.treema/`.
GitHub OAuth callback receipts are also stored there in masked form, the hosted callback URL is `https://treesma.com/auth/github/callback`, hosted token exchange runs on `treesma.com`, and desktop handoff uses a local loopback POST plus `treesma://auth/complete?...` to focus the app after the token is stored.

Hosted GitHub OAuth requires both a client ID and a client secret in the environments that perform token exchange:

- Local development: copy [`.env.example`](.env.example) to `.env.local` and set `TREEMA_GITHUB_OAUTH_CLIENT_ID`
- Local localhost callback exchange: also set `TREEMA_GITHUB_OAUTH_CLIENT_SECRET`
- Vercel preview/production: add both `TREEMA_GITHUB_OAUTH_CLIENT_ID` and `TREEMA_GITHUB_OAUTH_CLIENT_SECRET` in the project environment variables before deploying
- GitHub OAuth App callback URL: `https://treesma.com/auth/github/callback`
- Hosted web app note: `app.treesma.com` currently stores the exchanged GitHub token in browser local storage until a server-backed account/session layer exists

## Validate

- `npm run validate`

This checks the sample state with the lightweight runtime validator and verifies the repo/workspace docs contract.

## Project Workspace

Initialize a Treema workspace inside a target project:

```bash
npm run treema -- init /path/to/project "My Project"
```

This creates `.treema/` inside the target project with:

- `AGENTS.md`
- `project_state.json`
- `analysis/inventory/`
- `analysis/analysis/component_reports/`
- `analysis/architecture/`
- `analysis/execution/task_specs/`
- `context/project-brief.md`
- `context/current-focus.md`
- `context/next-tasks.md`
- `context/operating-rules.md`
- `logs/decisions.md`
- `logs/status-updates.md`
- `tasks/task-index.md`
- `plans/active/README.md`
- `plans/completed/README.md`

Analyze a project into the canonical analysis root manifest plus stage artifacts:

```bash
npm run treema -- analyze /path/to/project
```

If the target already has a `.treema` workspace, this writes:

- `.treema/analysis/project-structure.json`
- `.treema/analysis/inventory/*.json`
- `.treema/analysis/analysis/*.json`
- `.treema/analysis/architecture/*.json`
- `.treema/analysis/execution/*.json` when validator blocking findings are absent

`project-structure.json` is the canonical analysis root manifest. It stores run metadata, top-level summary, stage status, gate status, and artifact paths. The scan targets the real project files and excludes `.treema` itself from the inventory.

Write a status snapshot:

```bash
npm run treema -- snapshot /path/to/project \
  --summary "Phase 1A analysis is active and alias design is next." \
  --focus "Phase 1A join coverage" \
  --focus "Alias builder design" \
  --next "Finalize safe rule boundaries" \
  --next "Start alias review loop draft" \
  --risk "Precision regression during rule expansion"
```

This updates:

- `.treema/project_state.json` meta timestamps
- `.treema/logs/status-updates.md`
- `.treema/context/current-focus.md` when `--focus` is provided
- `.treema/context/next-tasks.md` when `--next` is provided

## UI Workflow

Inside the app:

1. enter a project path or click `Browse` to choose a folder
2. click `Init .treema` to create the workspace, or `Load Workspace` to open an existing one
3. click `Analyze Project` to generate inventory, analysis, architecture, validator, and execution artifacts
4. review the structure, board, project scan hierarchy/dependency/gate views, decision log, and markdown-backed docs
5. write a snapshot summary and save it back into `.treema`
