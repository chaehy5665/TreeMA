# TreeMA Repo Map

## Purpose

Give humans and agents a short entrypoint into the canonical docs for this repository.

## Canonical For

- Repo entrypoint routing
- Source-of-truth order across canonical docs

## Not Canonical For

- Detailed product, data, architecture, or workspace rules that belong in linked docs

## Current Phase

- Phase: MVP foundation for a deterministic project workspace contract
- Primary target: a local app plus workspace contract that keeps project state explicit and durable
- Default rule: update matching docs in the same change when behavior or contract changes

## Source Of Truth Order

1. Running code and repository files
2. [docs/README.md](docs/README.md)
3. [docs/MVP_SPEC.md](docs/MVP_SPEC.md)
4. [docs/DATA_MODEL.md](docs/DATA_MODEL.md)
5. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
6. [docs/TREEMA_WORKSPACE.md](docs/TREEMA_WORKSPACE.md)
7. [docs/PROJECT_STRUCTURE.md](docs/PROJECT_STRUCTURE.md)
8. [docs/PLANS.md](docs/PLANS.md)
9. [docs/QUALITY_SCORE.md](docs/QUALITY_SCORE.md)
10. [docs/TECH_DEBT.md](docs/TECH_DEBT.md)

## Entrypoints

- UI entry: `index.html` -> `src/main.js`
- Desktop shell: `electron/main.cjs` -> `electron/preload.cjs`
- Shared domain logic: `src/lib/*.js`
- Local server: `scripts/app-server.mjs`
- Workspace contract and CLI helpers: `scripts/lib/treema-workspace.mjs`
- CLI entry: `scripts/treema.mjs`
- Analysis engine: `scripts/lib/project-analysis.mjs`
- Docs validation: `scripts/check-docs.mjs`

## Commands

- `npm run serve`: start the local app server
- `npm run desktop`: start the Electron desktop app
- `npm run validate`: validate sample state and docs/workspace contract
- `npm run validate:state`: validate canonical sample state only
- `npm run validate:docs`: validate repo and workspace docs contract
- `npm run treema -- init <dir> [name]`: create a `.treema` workspace
- `npm run treema -- analyze <dir>`: scan a real project into `.treema/analysis`
- `npm run treema -- snapshot <dir> --summary "..."`

## Which Doc To Read

- Product intent and MVP boundaries: [docs/MVP_SPEC.md](docs/MVP_SPEC.md)
- Canonical entities and proposal shape: [docs/DATA_MODEL.md](docs/DATA_MODEL.md)
- Runtime boundaries and invariants: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Current file and module map: [docs/PROJECT_STRUCTURE.md](docs/PROJECT_STRUCTURE.md)
- `.treema` layout and file roles: [docs/TREEMA_WORKSPACE.md](docs/TREEMA_WORKSPACE.md)
- Execution-plan lifecycle: [docs/PLANS.md](docs/PLANS.md)
- Quality rubric for review: [docs/QUALITY_SCORE.md](docs/QUALITY_SCORE.md)
- Known debt before refactors: [docs/TECH_DEBT.md](docs/TECH_DEBT.md)

## Working Rules

- Keep repo docs short and canonical; avoid duplicating detailed content across files.
- Preserve existing runtime paths unless the change explicitly migrates all readers.
- Treat `.treema/project_state.json` and `.treema/analysis/project-structure.json` as canonical workspace artifacts.
- Add or update an execution plan for multi-step work that spans multiple subsystems.
