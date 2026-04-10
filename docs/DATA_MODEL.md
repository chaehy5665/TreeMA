# TreeMA Data Model

## Purpose

Define the canonical entity model for project state, AI proposals, and project analysis.

## Canonical For

- Top-level state collections and key fields
- Modeling rules for ids, references, timestamps, and proposals
- Canonical analysis manifest and stage artifact shapes

## Not Canonical For

- Product scope and workflows that belong in [MVP_SPEC.md](MVP_SPEC.md)
- Runtime loading behavior that belongs in [ARCHITECTURE.md](ARCHITECTURE.md)
- Workspace file layout that belongs in [TREEMA_WORKSPACE.md](TREEMA_WORKSPACE.md)

## Canonical State Document

The canonical state is a JSON document centered on these top-level groups:

- `projects`
- `tracks`
- `tasks`
- `decisions`
- `risks`
- `meta`

## Project

Represents a project or subproject.

- Required: `id`, `name`, `status`
- Recommended: `parentId`, `description`, `trackIds`, `tags`
- Expected statuses: `active`, `paused`, `archived`

## Track

Represents a stream of work within a project.

- Required: `id`, `projectId`, `name`, `status`
- Recommended: `goal`, `owner`

## Task

Represents executable work.

- Required: `id`, `projectId`, `title`, `status`, `updatedAt`
- Recommended: `trackId`, `description`, `priority`, `assignee`, `dependsOn`, `blockedBy`, `dueAt`
- Expected statuses: `backlog`, `ready`, `in_progress`, `blocked`, `done`

## Decision

Represents a resolved or pending judgment that changes project direction.

- Required: `id`, `projectId`, `title`, `status`, `updatedAt`
- Recommended: `trackId`, `summary`, `rationale`, `impact`, `relatedTaskIds`, `relatedRiskIds`
- Expected statuses: `proposed`, `accepted`, `rejected`, `superseded`

## Risk

Represents a possible or active threat to progress or quality.

- Required: `id`, `projectId`, `title`, `status`, `severity`, `updatedAt`
- Recommended: `trackId`, `description`, `mitigation`, `trigger`, `relatedTaskIds`
- Expected statuses: `open`, `monitoring`, `mitigated`, `realized`, `closed`
- Expected severities: `low`, `medium`, `high`, `critical`

## Meta

State-level metadata for versioning and focus.

Common fields:

- `schemaVersion`
- `workspaceVersion`
- `projectName`
- `createdAt`
- `updatedAt`
- `lastApprovedUpdateAt`
- `lastSnapshotAt`
- `lastSnapshotSummary`
- `currentFocusTrackIds`
- `currentFocusTaskIds`
- `sourceFiles`

## AI Proposal Model

AI output must stay separate from canonical state.

Suggested proposal fields:

- `proposalId`
- `basedOnStateVersion`
- `summary`
- `changes`

Each change should include:

- `entityType`
- `entityId`
- `operation`
- `before`
- `after`
- `reason`

## Analysis Root Manifest

Project scan output is stored canonically in `.treema/analysis/project-structure.json`.

The root manifest is intentionally summary-shaped. It should contain:

- `run`
- `summary`
- `artifacts`
- `stageStatus`
- `gate`

It must not embed full component report bodies, dependency graphs, or task specs inline.

## Shared Analysis Evidence Metadata

Every non-trivial analysis artifact must include:

- `artifactType`
- `analysisVersion`
- `generatedAt`
- `observed`
- `inferred`
- `uncertain`
- `unknowns`
- `confidence`
- optional `provenance`
- optional `evidenceRefs`
- optional `claimRefs`

The purpose is to keep facts, inference, and uncertainty separate.

Confidence should be signal-based rather than arbitrary. Typical inputs include candidate source quality, resolved local dependency coverage, grouping consistency, nearby test evidence, and critical-path evidence coverage.

## Analysis IR Levels

### Inventory IR

Scanner outputs that describe what exists:

- files
- services
- modules
- configs
- routes
- entrypoints
- candidate components
- scan priorities
- evidence bundles
- scan rationale
- domain hypotheses

### Analysis IR

Junior and Senior outputs that describe meaning and structure:

- responsibility
- inputs
- outputs
- dependencies
- normalized dependency details
- component grouping metadata
- risks
- missing pieces
- hierarchy
- critical paths
- gaps

### Architecture IR

Architect and Validator outputs that describe implementable structure:

- modules
- interfaces
- flows
- boundaries
- implementation strategy
- validation findings

### Execution IR

PM outputs that describe execution:

- tasks
- dependencies
- owner agent
- acceptance criteria
- validation checks

## Validator Model

Validator findings must be machine-readable.

Required concepts:

- severity: `blocking` or `non_blocking`
- category
- title
- detail
- related artifacts

Blocking findings should cover at least:

- project-scan-unavailable when semantic scan is requested without a configured AI provider
- responsibility collision
- missing or ambiguous interface contract
- invalid execution ordering or dependency cycle
- non-testable execution task or phase
- inference-only critical claim without observed evidence

Non-blocking findings should cover at least:

- moderate confidence contracts or critical claims
- open analysis gaps that do not prevent bounded execution
- weak but still usable testability signals

Gate summary must expose:

- `status`: `ready` or `blocked`
- `blockingCount`
- `nonBlockingCount`

## Modeling Rules

- ids must be stable
- references must use ids, not names
- timestamps should use ISO 8601 strings
- canonical state must validate without AI artifacts
- AI proposals must be reviewable independently from canonical state
- analysis root and stage artifacts must stay serializable without UI-only fields
- `project-structure.json` must remain a manifest, not a detailed dump
- analysis JSON must describe the real project and exclude `.treema` from the scanned inventory
