# TreeMA Planning Rules

## Purpose

Define how execution plans are created, stored, and archived.

## Canonical For

- When work requires a plan
- Where plan files live
- What a plan must contain before implementation starts

## Not Canonical For

- Product requirements outside [MVP_SPEC.md](MVP_SPEC.md)
- Workspace runtime behavior outside [TREEMA_WORKSPACE.md](TREEMA_WORKSPACE.md)

## Rule

Any active work that requires multiple coordinated changes across subsystems should have a plan file under [exec-plans/active/](exec-plans/active/README.md). When the change ships, move the plan to [exec-plans/completed/](exec-plans/completed/README.md).

## Create A Plan When

- the change affects both code and workspace contract
- the change spans UI, server, CLI, analysis, or docs together
- the change introduces a new public or on-disk contract
- the work is large enough that another engineer or agent should be able to execute it from the plan alone

## Plan Format

Use [exec-plans/TEMPLATE.md](exec-plans/TEMPLATE.md). Plans should be decision complete and cover:

- goal and current state
- key implementation changes
- interface or contract changes
- validation steps
- assumptions and open risks

## File Lifecycle

- Draft or active plan: `docs/exec-plans/active/<slug>.md`
- Shipped plan: `docs/exec-plans/completed/<slug>.md`
- One file per coordinated change set

## Maintenance Rules

- Keep plans concrete enough for handoff.
- Update the plan if implementation scope changes materially.
- Do not leave stale active plans after the change ships or is abandoned.
