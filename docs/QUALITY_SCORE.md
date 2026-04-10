# TreeMA Quality Score

## Purpose

Provide a compact rubric for reviewing the quality of the current implementation and future changes.

## Canonical For

- Quality expectations across product, workspace, analysis, validation, and UI
- Review language for "good enough" versus "needs work"

## Not Canonical For

- Detailed test scripts or release procedures
- Specific bug lists that belong in [TECH_DEBT.md](TECH_DEBT.md)

## Scoring Scale

- `0`: missing or broken
- `1`: partial and unreliable
- `2`: usable but incomplete
- `3`: strong and consistent for the MVP phase

## Rubric

| Area | 0 | 1 | 2 | 3 |
| --- | --- | --- | --- | --- |
| Product clarity | Goal and scope are unclear | Goal exists but boundaries drift | Scope is mostly stable with minor ambiguity | Goal, scope, and workflows are explicit and current |
| Workspace contract | Files are ad hoc | Contract exists but generators and docs diverge | Contract is documented and mostly enforced | Contract is documented, generated, and validated together |
| Analysis quality | No scan output | Scan is noisy or not actionable | Scan is useful but misses structure in edge cases | Scan reliably produces canonical JSON and useful derived views |
| Validation quality | Invalid state can pass silently | Basic shape checks only | Most important field and reference rules are enforced | Validation catches shape, status, timestamp, and key reference errors |
| UI legibility | State is hard to inspect | Main screens exist but are confusing | Core state is reviewable | Core state, docs, and scan output are all easy to inspect |
| Docs hygiene | No clear source of truth | Docs exist but conflict | Canonical docs exist with some drift risk | Repo map, canonical docs, and workspace docs stay aligned |

## Current Target

TreeMA should aim for a minimum score of `2` in every area and `3` for workspace contract clarity before expanding scope.
