# TreeMA Architecture

## Purpose

Describe the runtime shape, subsystem boundaries, and invariants of the current implementation.

## Canonical For

- UI, server, CLI, workspace, and analysis boundaries
- Data flow between repo code and `.treema` workspace files
- Invariants that should survive refactors

## Not Canonical For

- Product scope details that belong in [MVP_SPEC.md](MVP_SPEC.md)
- Exact field definitions that belong in [DATA_MODEL.md](DATA_MODEL.md)
- Exhaustive file inventory that belongs in [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md)

## Runtime Shape

TreeMA runs in two supported local shells:

- a browser app served by a small local Node server
- an Electron desktop shell that loads the same UI from disk and bridges runtime actions over preload IPC

Both shells use the same workspace and analysis modules, and both preserve the same `.treema` file contracts.

The public `treesma.com` deployment is a Vercel-hosted static site with dedicated GitHub OAuth ingress routes. The hosted `app.treesma.com` deployment is a separate control-plane surface for account UX and auth completion.

## Subsystems

### UI

- Entry: `index.html` and `styles.css`
- Controller/render layer: `src/main.js`
- Responsibilities: load workspace data, validate state, derive view models, render tabs, manage local settings, and read staged analysis artifacts through the root manifest

### Electron desktop shell

- `electron/main.cjs`
- `electron/preload.cjs`
- Responsibilities: create the desktop window, expose safe IPC handlers, use native folder selection, register the `treesma://` protocol, host a loopback GitHub OAuth callback plus desktop token-handoff listener, and reuse workspace and analysis modules without the main browser HTTP layer

### Shared domain logic

- `src/lib/validate-state.js`: runtime validation and summary metrics
- `src/lib/derive-view-model.js`: tree, board, timeline, and focus derivations

### Local server

- `scripts/app-server.mjs`
- Responsibilities: serve static files, expose `/api/*`, host the browser-runtime GitHub OAuth callback route, bridge native directory selection, return loaded workspace payloads, and persist local AI account settings outside `.treema`

### Hosted callback route

- `api/auth/github/start.mjs`
- `api/auth/github/callback.mjs`
- `vercel.json`
- Responsibilities: start hosted GitHub OAuth for web and desktop targets, set PKCE state cookies, exchange GitHub authorization codes for user tokens on the hosted callback, and route users into `app.treesma.com` or the desktop loopback plus `treesma://`

### Hosted app surface

- `app/`
- Responsibilities: provide the first hosted `app.treesma.com` control-plane routes for `/auth/complete`, `/settings/accounts`, and `/settings/download`

### Workspace contract

- `scripts/lib/treema-workspace.mjs`
- Responsibilities: initialize `.treema`, load existing workspace files, persist snapshot updates, generate markdown templates

### Analysis pipeline

- `scripts/lib/project-analysis.mjs`
- `scripts/lib/analysis/*.mjs`
- Responsibilities: orchestrate AI-native Project Scan and deterministic Quick Scan; persist/load stage artifacts; expose stage availability and gate status through the root manifest

### Local account settings

- `scripts/lib/account-settings.mjs`
- Responsibilities: persist local provider credentials plus masked GitHub OAuth callback receipts under `~/.treema/settings/accounts.json`, store exchanged desktop GitHub tokens locally, mask secrets before returning them to the UI, and keep credentials out of project workspaces

### CLI

- `scripts/treema.mjs`
- Responsibilities: `init`, `snapshot`, and `analyze` commands for local workflows

## Core Invariants

- Real project files remain the source of operational reality.
- `.treema/project_state.json` is the canonical structured state document.
- `.treema/analysis/project-structure.json` is the canonical analysis root manifest.
- Stage artifacts referenced by the root manifest are canonical analysis data.
- Markdown under `.treema/context`, `.treema/logs`, and `.treema/plans` is guidance around canonical JSON, not a replacement for it.
- Local provider credentials live in `~/.treema/settings/accounts.json`, not in `.treema`.
- Existing runtime paths should remain stable unless all readers and docs are migrated together.

## Analysis Pipeline

The analysis engine is split into explicit module boundaries:

1. `Scanner`: deterministic evidence collection plus AI evidence prioritization, component bundling, rationale, and domain hypothesis generation
2. `Junior`: AI-grounded per-component structured analysis
3. `Senior`: AI-assisted hierarchy, critical-path, and gap synthesis with deterministic dependency graph assembly
4. `Architect`: AI-assisted module, interface, and build-order design
5. `Validator`: deterministic-first validation with optional AI critique
6. `PM`: AI-assisted execution plan and task spec generation when the gate is clear

Every non-trivial artifact produced by these stages includes:

- `observed`
- `inferred`
- `uncertain`
- `unknowns`
- `confidence`

## Data Flow

1. A user opens the local app or CLI.
2. The browser shell calls `/api/*` on the local server, or the Electron shell calls preload IPC handlers and listens for `treesma://` auth completion.
3. The server, desktop shell, or CLI loads `.treema/project_state.json` and workspace markdown.
4. The UI validates state and derives view models from canonical JSON.
5. The analysis engine scans the real project and writes `.treema/analysis/project-structure.json` plus stage artifacts.
6. Validator gate status determines whether execution artifacts are emitted.
7. Snapshot actions update canonical state metadata and selected markdown context files.
8. Hosted OAuth starts on `treesma.com` or `app.treesma.com`, completes on `treesma.com/auth/github/callback`, exchanges the code for a token using hosted secrets plus PKCE, then routes to `app.treesma.com/auth/complete` or the desktop loopback handoff before focusing `treesma://auth/complete`.

## Refactor Guardrails

- Keep view derivation pure relative to the input state.
- Keep workspace template generation centralized in `scripts/lib/treema-workspace.mjs`.
- Keep root-manifest persistence and stage persistence centralized in the analysis modules.
- Keep analysis JSON and workspace JSON serializable without UI-only fields.
- If a new analysis artifact becomes contractually important, add it to [TREEMA_WORKSPACE.md](TREEMA_WORKSPACE.md), schemas, initialization rules, and docs validation in the same change.
