# Active Execution Plans

## Purpose

Define how active execution plans are stored while work is in progress.

## Canonical For

- Location and lifecycle of active plan files

## Not Canonical For

- The plan contents for any specific change

Store active multi-step implementation plans in this directory.

- Use one markdown file per coordinated change set.
- Prefer short, decision-complete plans based on the template in [../TEMPLATE.md](../TEMPLATE.md).
- Move the file to `../completed/` when the change ships.
