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

The public `treesma.com` deployment is a Vercel-hosted static site with dedicated hosted OAuth ingress routes. The hosted `app.treesma.com` deployment is a separate control-plane surface for account UX and auth completion.

## Subsystems

### UI

- Entry: `index.html` and `styles.css`
- Controller/render layer: `src/main.js`
- Responsibilities: load workspace data, validate state, derive view models, render tabs, manage local settings, and read staged analysis artifacts through the root manifest

### Electron desktop shell

- `electron/main.cjs`
- `electron/preload.cjs`
- Responsibilities: create the desktop window, expose safe IPC handlers, use native folder selection, register the `treesma://` protocol, host loopback OAuth completion listeners plus desktop token-handoff bridges, and reuse workspace and analysis modules without the main browser HTTP layer

### Shared domain logic

- `src/lib/validate-state.js`: runtime validation and summary metrics
- `src/lib/derive-view-model.js`: tree, board, timeline, and focus derivations

### Local server

- `scripts/app-server.mjs`
- Responsibilities: serve static files, expose `/api/*`, start hosted OAuth flows for local browser or desktop targets, bridge native directory selection, return loaded workspace payloads, and persist local AI account settings outside `.treema`

#### Local server HTTP contract

- `GET /api/settings/accounts`
  Returns masked local provider settings plus `defaultAnalysisProvider`, scan-readiness metadata, OAuth callback receipts, and the local settings file path.
- `POST /api/settings/accounts/openai`
  Saves OpenAI API-key settings.
- `POST /api/settings/accounts/openai/test`
  Verifies OpenAI API-key connectivity without mutating `.treema`.
- `POST /api/settings/accounts/github-copilot`
  Saves GitHub token-backed provider settings.
- `POST /api/settings/accounts/github-copilot/test`
  Verifies GitHub inference access and scan readiness.
- `POST /api/settings/accounts/chatgpt-codex`
  Saves experimental ChatGPT Codex OAuth credentials or model preferences.
- `POST /api/settings/accounts/chatgpt-codex/test`
  Verifies ChatGPT OAuth token usability for Project Scan.
- `POST /api/settings/accounts/chatgpt-codex/oauth/start`
  Creates the local or desktop ChatGPT OAuth start payload and authorize URL.
- `POST /api/settings/accounts/chatgpt-codex/connect`
  Accepts hosted web handoff payloads from `app.treesma.com` and persists them into local settings.
- `POST /api/settings/accounts/preferences`
  Persists `defaultAnalysisProvider` for `auto`, `openai`, `github-copilot`, or `chatgpt-codex`.
- `POST /api/settings/accounts/disconnect`
  Removes saved credentials for a provider from local settings.
- `GET /api/workspace?projectPath=...`
  Loads `.treema` workspace state and analysis artifacts for one project root.
- `POST /api/workspace/init`
  Initializes a `.treema` workspace for a target project path.
- `POST /api/workspace/snapshot`
  Persists snapshot summary, focus, next, and risk markdown around canonical state.
- `POST /api/project/analyze`
  Runs Project Scan or Quick Scan, persists `.treema/analysis` if present, and returns the in-memory analysis plus saved artifact paths.
- `POST /api/system/select-directory`
  Opens the local native folder picker and returns a selected project path.

#### Persistence ownership

- `scripts/lib/treema-workspace.mjs` is the canonical reader and writer for `.treema` workspace state and snapshot markdown.
- `scripts/lib/project-analysis.mjs` plus `scripts/lib/analysis/persist.mjs` are the canonical writers for `.treema/analysis/**`.
- `scripts/lib/account-settings.mjs` is the canonical writer for `~/.treema/settings/accounts.json`.
- `scripts/app-server.mjs`, `scripts/treema.mjs`, and `electron/main.cjs` are transport or entrypoint layers. They invoke the canonical readers and writers but do not define alternate persistence formats.

### Hosted OAuth routes

- `api/auth/github/start.mjs`
- `api/auth/github/callback.mjs`
- `api/auth/openai/start.mjs`
- `api/auth/openai/callback.mjs`
- `vercel.json`
- Responsibilities: start hosted OAuth for web and desktop targets, set PKCE state cookies, exchange authorization codes for provider tokens on the hosted callback when required, and route users into `app.treesma.com` or the desktop loopback plus `treesma://`

### Hosted app surface

- `app/`
- Responsibilities: provide the first hosted `app.treesma.com` control-plane routes for `/auth/complete`, `/settings/accounts`, and `/settings/download`

### OAuth handoff contract

- `scripts/lib/oauth-handoff-contract.js`
- Responsibilities: define the shared desktop deep-link URL and loopback handoff endpoints used by hosted OAuth completion pages, hosted control-plane UX, and the desktop runtime

### Workspace contract

- `scripts/lib/treema-workspace.mjs`
- Responsibilities: initialize `.treema`, load existing workspace state and markdown docs, persist snapshot updates, and generate markdown templates

### Analysis pipeline

- `scripts/lib/project-analysis.mjs`
- `scripts/lib/analysis/*.mjs`
- Responsibilities: orchestrate AI-native Project Scan and deterministic Quick Scan; persist/load stage artifacts; expose stage availability and gate status through the root manifest

### Local account settings

- `scripts/lib/account-settings.mjs`
- Responsibilities: persist local provider credentials, default analysis-provider selection, masked OAuth callback receipts, and pending local OAuth sessions under `~/.treema/settings/accounts.json`; store exchanged desktop tokens locally; mask secrets before returning them to the UI; and keep credentials out of project workspaces

#### Account settings contract

- Storage location: `~/.treema/settings/accounts.json`
- File permissions: best-effort `0600` after atomic write on supported platforms
- Top-level fields:
  - `version`
  - `updatedAt`
  - `defaultAnalysisProvider`
  - `providers.openai`
  - `providers.githubCopilot`
  - `providers.chatgptCodex`
- `providers.openai` stores `apiKey`, `baseUrl`, `defaultModel`, `accountLabel`, and last verification metadata.
- `providers.githubCopilot` stores `githubToken`, API base URL, login or label metadata, token type, billing or scan-readiness metadata, OAuth callback receipts, and pending desktop-session state.
- `providers.chatgptCodex` stores `accessToken`, `refreshToken`, `expiresAt`, `accountId`, `accountEmail`, `accountLabel`, `defaultModel`, last verification metadata, and OpenAI OAuth callback or pending desktop-session state.
- Public settings returned to the UI always mask secrets and expose only previews plus verification metadata.

##### Provider state vocabulary

The UI and runtime treat provider settings as a small explicit state machine:

- `disconnected`: no saved credentials, and no active OAuth session
- `saved`: credentials exist, but scan readiness has not been proven by a verification pass
- `verified`: a verification pass succeeded and produced provider metadata, but scan readiness may still be blocked (for example, missing scopes, expired OAuth token)
- `scan-ready`: `verified` and eligible for Project Scan
- `needs-attention`: saved settings exist, but the provider is not `scan-ready`
- `oauth-pending`: an OAuth flow was started and the local runtime is waiting for completion
- `oauth-failed`: the last OAuth attempt failed and the failure details were recorded

##### Default provider precedence

Provider selection is driven by `defaultAnalysisProvider`:

- If `defaultAnalysisProvider="auto"`, Project Scan may fall back using the deterministic order `openai -> github-copilot -> chatgpt-codex` and selects the first `scan-ready` provider.
- If `defaultAnalysisProvider` is explicitly set to `openai`, `github-copilot`, or `chatgpt-codex`, Project Scan must not silently fall back. If the selected provider is `disconnected` or not `scan-ready`, Project Scan is unavailable until the operator fixes it.

##### QA sandbox rule for verification

Agent-executed verification must not touch the operator's real home directory settings.

- All automated checks must set `TREEMA_SETTINGS_HOME` to a sandbox directory.
- When `TREEMA_SETTINGS_HOME` is set, the settings home is that directory and the account settings file path is treated as `${TREEMA_SETTINGS_HOME}/.treema/settings/accounts.json`.

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
- Project Scan resolves a single provider at runtime from explicit user preference first and the deterministic `auto` fallback order second.
- `defaultAnalysisProvider="auto"` may fall back, but an explicitly pinned provider must not silently fall back when `disconnected` or not `scan-ready`.
- Hosted OAuth start, callback receipt storage, and local token persistence are separate concerns. Hosted control-plane pages must not write credentials into `.treema`.
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
2. The browser shell calls `/api/*` on the local server, or the Electron shell calls preload IPC handlers exposed on `window.treemaDesktop` and listens for `treesma://` auth completion.
3. The server, desktop shell, or CLI loads `.treema/project_state.json` and workspace markdown.
4. The UI validates state and derives view models from canonical JSON.
5. The analysis engine scans the real project and writes `.treema/analysis/project-structure.json` plus stage artifacts.
6. Validator gate status determines whether execution artifacts are emitted.
7. Snapshot actions update canonical state metadata and selected markdown context files.
8. Hosted OAuth starts on `treesma.com` or `app.treesma.com`, completes on the provider-specific hosted callback such as `treesma.com/auth/github/callback` or `treesma.com/auth/openai/callback`, exchanges the code for a token when the provider requires hosted exchange, then routes to `app.treesma.com/auth/complete` or the desktop loopback handoff before focusing `treesma://auth/complete`.

## Route Ownership

- Local browser shell:
  - `index.html`
  - `src/main.js`
  - `styles.css`
  - Purpose: local workspace UI, scan UI, settings UI, and renderer state around `.treema` plus local runtime APIs.
- Hosted control-plane routes:
  - `app/index.html`
  - `app/app.js`
  - `app/app.css`
  - `app/auth/complete.html`
  - `app/settings/accounts.html`
  - `app/settings/download.html`
  - Purpose: hosted account connection, auth completion, and desktop setup flows on `app.treesma.com`.
- Shared rule:
  - Hosted control-plane pages may complete auth or account setup, but they do not own local workspace rendering or `.treema` persistence.

## Provider And OAuth Boundaries

- `OpenAI API` is the direct provider path. The local runtime stores an API key, verifies against the models endpoint, and calls `/v1/chat/completions` for Project Scan.
- `GitHub Copilot` is the GitHub Models-backed provider path. The local runtime stores a GitHub token, verifies scan readiness through lightweight model-access probing, and uses the shared chat-completions analysis client.
- `ChatGPT Codex OAuth` is an experimental Project Scan provider only. The local runtime stores access and refresh tokens plus account metadata, refreshes tokens locally when needed, and sends Project Scan requests to the ChatGPT Codex backend adapter.
- The hosted OAuth control plane is provider-agnostic at the flow level: start route, PKCE cookie, hosted callback, optional hosted token exchange, `app.treesma.com/auth/complete`, and desktop loopback or `treesma://` completion.
- Desktop handoff is also contract-driven at the transport level: hosted pages post provider-specific completion payloads to the shared loopback bridge on `127.0.0.1:48152`, then focus `treesma://auth/complete` with the provider plus state or error params.
- The ChatGPT Codex adapter is intentionally narrow. It exists for Project Scan JSON stages, token lifecycle management, and response-text extraction. It is not the architecture for general chat UX, agent orchestration, or shared backend proxying.

## Desktop Bridge Contract

- `electron/preload.cjs` exposes `window.treemaDesktop` as the only renderer-accessible desktop API surface.
- Renderer methods:
  - `openExternal`
  - `loadAccountSettings`
  - `startGitHubOAuthFlow`
  - `startOpenAiOAuthFlow`
  - `saveAccountSettings`
  - `saveAccountPreferences`
  - `testAccountSettings`
  - `disconnectAccountSettings`
  - `selectDirectory`
  - `loadWorkspace`
  - `initWorkspace`
  - `snapshotWorkspace`
  - `analyzeProject`
  - `onOAuthComplete`
- `src/main.js` treats the browser server and Electron preload as alternate implementations of the same runtime contract. Browser mode calls `/api/*`; desktop mode routes matching actions through `window.treemaDesktop`.

## Docs Enforcement

- `scripts/check-docs.mjs` is the canonical docs-contract validator.
- `npm run validate:docs` runs the docs validator directly.
- `npm run validate` runs both sample state validation and docs-contract validation.
- Behavior or contract changes are expected to update matching canonical docs in the same change so the validation path remains meaningful.

## Refactor Guardrails

- Keep view derivation pure relative to the input state.
- Keep workspace template generation centralized in `scripts/lib/treema-workspace.mjs`.
- Keep root-manifest persistence and stage persistence centralized in the analysis modules.
- Keep analysis JSON and workspace JSON serializable without UI-only fields.
- If a new analysis artifact becomes contractually important, add it to [TREEMA_WORKSPACE.md](TREEMA_WORKSPACE.md), schemas, initialization rules, and docs validation in the same change.
