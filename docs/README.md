# Docs Knowledge Base

## Purpose

Route humans and agents to the right canonical document quickly.

## Canonical For

- Which doc is responsible for which kind of truth
- When to read each doc
- Documentation ownership and maintenance rules

## Not Canonical For

- Detailed runtime behavior beyond what the linked docs define
- UI copy, implementation specifics, or generated workspace content

## Ownership

All contributors own docs for the parts they change. A code or workspace contract change is incomplete until the matching canonical doc is updated in the same change.

## Read Order

| Read when you need | Canonical doc |
| --- | --- |
| Product goal, scope, and user workflows | [MVP_SPEC.md](MVP_SPEC.md) |
| Entity shapes, state rules, and AI proposal model | [DATA_MODEL.md](DATA_MODEL.md) |
| Runtime boundaries, invariants, and data flow | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Current repository shape and entrypoints | [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md) |
| `.treema` on-disk workspace contract | [TREEMA_WORKSPACE.md](TREEMA_WORKSPACE.md) |
| How execution plans are created and archived | [PLANS.md](PLANS.md) |
| Quality review rubric | [QUALITY_SCORE.md](QUALITY_SCORE.md) |
| Known gaps and follow-up work | [TECH_DEBT.md](TECH_DEBT.md) |

## Planning Docs

- Plan template: [exec-plans/TEMPLATE.md](exec-plans/TEMPLATE.md)
- Active-plan rules: [exec-plans/active/README.md](exec-plans/active/README.md)
- Completed-plan rules: [exec-plans/completed/README.md](exec-plans/completed/README.md)

## Maintenance Rules

- Start each canonical doc with `Purpose / Canonical for / Not canonical for`.
- Prefer cross-links over repeated explanations.
- Keep `AGENTS.md` short and route to canonical docs rather than duplicating them.
- When workspace files change, update both [TREEMA_WORKSPACE.md](TREEMA_WORKSPACE.md) and the generators in `scripts/lib/treema-workspace.mjs`.
