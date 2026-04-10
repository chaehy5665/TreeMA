# Sidebar Project Add Picker

## Purpose

Record the shipped follow-up that removes the sidebar add composer and replaces it with a one-click native folder picker flow.

## Canonical For

- The implementation intent behind direct project add from the sidebar
- Validation and risk notes for automatic load-or-init behavior after folder selection

## Not Canonical For

- General product scope outside this project connection refinement
- Detailed visual styling that remains defined in running code

## Summary

- Change: Make the sidebar `Add` button open the native folder picker immediately, then load an existing `.treema` workspace or initialize one with the selected folder name.
- Goal: Collapse project connection into one action without a sidebar composer or manual name entry.
- Current state: The sidebar owns project connection through a direct picker flow, and the scan action now lives in the `Project Scan` panel.

## Key Changes

- Product or workflow: Users add a project by selecting a folder once, with no separate path or name form.
- Code or contract: The renderer now routes `Add` through folder selection, automatic workspace load-or-init, and current-workspace path tracking for scan and snapshot actions.
- Docs or workspace: Updated `docs/PROJECT_STRUCTURE.md` to describe the one-click add flow.

## Interfaces And Contracts

- Public API or CLI impact: None.
- Workspace file impact: None.
- Data model impact: None.

## Validation

- Commands to run: `npm run validate`
- Manual scenarios to verify: Click `Add`, cancel the picker, select a folder with an existing `.treema` workspace, then select a plain folder and confirm it initializes with the folder name.

## Assumptions And Risks

- Assumptions: Direct folder selection is the default and manual project-name overrides are not needed in the MVP UI.
- Risks: The load-or-init fallback keys off the missing-state error shape, so future workspace-load error changes should preserve that distinction or replace it with an explicit existence check.
