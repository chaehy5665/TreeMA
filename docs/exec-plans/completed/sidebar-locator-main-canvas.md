# Sidebar Locator Main Canvas Shift

## Purpose

Record the shipped change that reduces the sidebar to navigation and moves operational content into the main canvas.

## Canonical For

- The implementation intent behind the sidebar locator change
- Validation and risk notes for the shipped UI restructuring

## Not Canonical For

- Product scope outside this layout adjustment
- Detailed UI copy that remains defined in running code

## Summary

- Change: Convert the sidebar into a locator-only rail and move workspace operations, imports, focus, and snapshot editing into the main tab canvas.
- Goal: Keep the sidebar lightweight while making the center panel the single place where users read and edit workspace information.
- Current state: The sidebar now routes between main views, and the new `Workspace` tab contains the previously sidebar-bound operational panels.

## Key Changes

- Product or workflow: Users navigate from the left rail but read and edit all operational content in the main pane.
- Code or contract: Reworked sidebar config to target main tabs, added a `Workspace` tab, and moved the form and summary DOM anchors into main-panel workspace cards.
- Docs or workspace: Updated `docs/PROJECT_STRUCTURE.md` to describe the sidebar as navigation and the main canvas as the operational surface.

## Interfaces And Contracts

- Public API or CLI impact: None.
- Workspace file impact: None.
- Data model impact: None.

## Validation

- Commands to run: `npm run validate`
- Manual scenarios to verify: Use the left rail to change main tabs, load a workspace from the `Workspace` tab, run analyze, import/export state, and save a snapshot without using the sidebar for content interaction.

## Assumptions And Risks

- Assumptions: Keeping both the left rail and top tab bar is acceptable because both are navigation surfaces and the center pane remains the only information surface.
- Risks: The new `Workspace` tab is denser than other views, so future additions should be grouped carefully to avoid turning the main pane into another sidebar-shaped stack.
