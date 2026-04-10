# Analysis Pipeline Migration

## Summary

- Change: Redefine TreeMA scan from a deterministic full analysis into an AI-native `Project Scan` with deterministic `Quick Scan` fallback.
- Goal: Preserve the manifest-rooted workspace contract while moving semantic scan quality into AI-assisted Scanner, Junior, Senior, Architect, Validator critique, and PM stages.
- Current state shipped: `.treema/analysis/project-structure.json` remains the canonical entrypoint, inventory gained scanner rationale and evidence artifacts, semantic stages are OpenAI-backed, and UI/API/CLI are mode-aware.

## Key Changes

- Product or workflow: `Project Scan` now requires a connected OpenAI or GitHub-backed provider and produces semantic analysis, architecture, validation, and execution artifacts. `Quick Scan` remains deterministic and inventory-only.
- Code or contract: Scanner now emits `scan_priorities.json`, `evidence_bundles.json`, `scan_rationale.json`, and `domain_hypotheses.json`; artifact metadata now supports provenance and evidence refs.
- Docs or workspace: Canonical docs and workspace guidance now describe AI-native scan semantics, explicit scan modes, and `unavailable` gate behavior.

## Interfaces And Contracts

- Public API or CLI impact: `/api/project/analyze` and `treema analyze` accept scan mode selection; default analyze mode is `project`, and `--quick` or `mode=quick` produces deterministic inventory only.
- Workspace file impact: `.treema/analysis/project-structure.json` now records `scanMode`, `scanCompleteness`, provider/model profile metadata, and stage availability; inventory may include new scanner artifacts.
- Data model impact: analysis artifacts may include `provenance`, `evidenceRefs`, and `claimRefs`; validator gate status can be `ready`, `blocked`, or `unavailable`.

## Validation

- Commands to run: `npm run validate`
- Manual scenarios to verify:
  - Run `Project Scan` with a connected OpenAI or GitHub provider and confirm semantic artifacts populate.
  - Run `Quick Scan` without a provider and confirm only inventory artifacts are present.
  - Open the app and confirm the scan surface distinguishes `Project Scan` from `Quick Scan`.
  - Confirm validator blocking findings suppress execution artifacts.

## Assumptions And Risks

- Assumptions: OpenAI is the first supported provider for semantic scan; raw prompt payloads and cache content remain outside `.treema`.
- Risks: Large repositories may still require tighter context budgets and stronger incremental reuse to control cost and latency.
