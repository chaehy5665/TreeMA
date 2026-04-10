# Legacy Analysis Load Tolerance

## Purpose

Record the coordinated fix that keeps workspace loading from crashing when an existing `.treema` directory still contains the older flat analysis payload.

## Canonical For

- The implementation intent behind tolerating legacy `project-structure.json` payloads during workspace load
- Validation and risk notes for compatibility between pre-manifest analysis data and the current staged-analysis loader

## Not Canonical For

- The canonical staged analysis contract beyond what is already defined in [TREEMA_WORKSPACE.md](../../TREEMA_WORKSPACE.md)
- Detailed implementation logic that remains defined in running files

## Summary

- Change: Make `loadAnalysisBundle()` synthesize artifact paths and normalize summary metadata when `project-structure.json` is still the older flat analysis payload.
- Goal: Prevent `treema:workspace:load` from throwing on existing workspaces whose analysis root predates the manifest-based loader.
- Current state: Workspace load assumed `manifest.artifacts.inventory.*` exists unconditionally, but the repository’s checked-in `.treema/analysis/project-structure.json` was still a flat `0.1.0` payload.

## Key Changes

- Product or workflow: Opening an existing workspace no longer fails just because its analysis root has not been regenerated since the manifest migration.
- Code or contract: `scripts/lib/analysis/persist.mjs` now falls back to the fixed staged-artifact paths, enumerates component reports and task specs from disk, and normalizes a legacy manifest into the shape expected by current consumers.
- Docs or workspace: Update `docs/TREEMA_WORKSPACE.md` to clarify that manifest shape remains canonical for new writes while workspace loading degrades gracefully on legacy analysis payloads.

## Interfaces And Contracts

- Public API or CLI impact: None.
- Workspace file impact: None to the canonical file layout; only workspace-loading tolerance changes.
- Data model impact: None to the current canonical manifest schema; legacy payloads are adapted at load time only.

## Validation

- Commands to run: `npm run validate`
- Manual scenarios to verify: Load a workspace whose `.treema/analysis/project-structure.json` is a flat legacy payload and confirm the app opens without throwing; rerun Analyze Project and confirm the new manifest-shaped analysis still loads normally.

## Assumptions And Risks

- Assumptions: Legacy workspaces either still have the staged artifact files in their fixed locations or can safely degrade to partial analysis data without blocking workspace load.
- Risks: If a legacy workspace is missing both the artifact index and the staged files themselves, the UI will load with partial or empty analysis rather than reconstructing data that no longer exists.
