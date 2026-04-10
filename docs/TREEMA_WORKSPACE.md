# Treema Workspace

## Purpose

Define the on-disk `.treema` workspace contract created and loaded by TreeMA.

## Canonical For

- Workspace layout and file roles
- Which workspace artifacts are canonical versus derived
- Required rules for initialization and updates

## Not Canonical For

- Product scope beyond the workspace contract
- Repository module responsibilities beyond [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md)

## Contract

Treema creates a per-project workspace inside the target project directory.

- The real project remains the primary source of reality.
- `.treema/project_state.json` is the canonical structured state artifact.
- `.treema/analysis/project-structure.json` is the canonical structured analysis root manifest.
- Stage artifacts under `.treema/analysis/**` are canonical when they are referenced by the root manifest.
- Markdown in `.treema/` is context, guidance, plans, and logs around the canonical JSON artifacts.
- The canonical analysis contract is manifest-shaped, but workspace loading should degrade gracefully if an older flat analysis payload is still present in an existing workspace.

## Layout

```text
.treema/
  README.md
  AGENTS.md
  project_state.json
  analysis/
    project-structure.json
    inventory/
      project_inventory.json
      file_index.json
      entrypoints.json
      candidate_components.json
      scan_priorities.json
      evidence_bundles.json
      scan_rationale.json
      domain_hypotheses.json
    analysis/
      system_map.json
      component_hierarchy.json
      dependency_graph.json
      analysis_gaps.json
      component_reports/
        <component_id>.json
    architecture/
      architecture_blueprint.json
      interface_contracts.json
      module_boundaries.json
      implementation_strategy.json
      validation_report.json
    execution/
      execution_plan.json
      task_specs/
        <task_id>.json
  context/
    project-brief.md
    current-focus.md
    next-tasks.md
    operating-rules.md
  logs/
    decisions.md
    status-updates.md
  tasks/
    task-index.md
  plans/
    active/
      README.md
    completed/
      README.md
  ai/
    proposals/
```

## File Roles

### Canonical state files

- `project_state.json`: structured canonical state for projects, tracks, tasks, decisions, risks, and metadata
- `analysis/project-structure.json`: canonical root analysis manifest with run metadata, top-level summary, artifact paths, stage status, and validator gate status

### Canonical analysis stage artifacts

- `analysis/inventory/*.json`: Scanner outputs for raw repo evidence, candidate components, scan priorities, evidence bundles, scan rationale, and domain hypotheses
- `analysis/analysis/component_reports/*.json`: Junior outputs for per-component analysis
- `analysis/analysis/system_map.json`, `component_hierarchy.json`, `dependency_graph.json`, `analysis_gaps.json`: Senior outputs
- `analysis/architecture/*.json`: Architect outputs plus Validator report
- `analysis/execution/*.json`: PM outputs, present only when validator blocking findings are absent

### Guidance and logs

- `AGENTS.md`: workspace map for humans and AI
- `context/project-brief.md`: purpose, desired outcome, constraints, and current reality
- `context/current-focus.md`: narrow active set
- `context/next-tasks.md`: short immediate queue
- `context/operating-rules.md`: local definitions of done, editing rules, and project-specific constraints
- `logs/decisions.md`: durable decision record with rationale and impact
- `logs/status-updates.md`: chronological snapshots of current state
- `tasks/task-index.md`: human-readable task view grouped by board status
- `plans/active/README.md`: active-plan usage rules
- `plans/completed/README.md`: archived-plan usage rules

## Analysis Rules

- `project-structure.json` must stay manifest-shaped. It is not the place for full component dumps or execution task bodies.
- Every non-trivial analysis artifact must include `observed`, `inferred`, `uncertain`, `unknowns`, and `confidence`.
- Quick Scan outputs remain deterministic for a given repo state apart from timestamps. Full Project Scan is AI-native and records provenance and grounding metadata.
- `execution/` artifacts must be omitted when `validation_report.json` contains blocking findings.
- Consumers should load analysis through `analysis/project-structure.json` first and follow its artifact paths.
- Consumers may synthesize the fixed artifact paths when loading a legacy flat payload, but newly written analysis must continue to emit the manifest-shaped root.

## Update Rules

- Workspace initialization must create every documented required directory and markdown/state file.
- Workspace loading must tolerate a missing analysis manifest before the first analyze run.
- Workspace loading must also tolerate a legacy pre-manifest `project-structure.json` by degrading gracefully instead of throwing.
- Snapshot writes may update canonical state metadata and selected context/log files, but they must not redefine file roles.
- If a new workspace file becomes part of the contract, update this doc, the generator, the loader, docs validation, and schemas in the same change.

## Recommended Flow

1. Real code and project reality change.
2. The operator or AI updates brief, focus, tasks, plans, or logs as needed.
3. Treema scans the project and refreshes the canonical analysis manifest plus stage artifacts.
4. Validator gate status decides whether execution-plan artifacts are emitted.
5. Canonical state and workspace context stay aligned enough for review and handoff.
