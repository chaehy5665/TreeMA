# Remove Main Tabbar Duplication

## Purpose

Record the shipped layout cleanup that removes the duplicate main-pane tab bar and leaves view switching to the sidebar.

## Canonical For

- The implementation intent behind removing redundant top-level navigation from the main pane
- Validation and risk notes for the sidebar-only view switching flow

## Not Canonical For

- Broader navigation redesign outside this duplication cleanup
- Detailed styling that remains defined in running code

## Summary

- Change: Remove the main-pane top tab bar that duplicated the sidebar view navigation.
- Goal: Keep one canonical navigation surface for view switching and reduce repeated UI in the content layer.
- Current state: Primary view changes now happen from the sidebar only, while the main pane focuses on the active panel content.

## Key Changes

- Product or workflow: Users switch between `Workspace`, `Structure`, `Board`, `Timeline`, `Project Scan`, and `AI Review` from the sidebar without a second tab strip in the main pane.
- Code or contract: Removed the top tab bar markup, deleted the renderer click binding that depended on it, and dropped the unused tab-bar styles while keeping the existing panel switching state model.
- Docs or workspace: Updated `docs/PROJECT_STRUCTURE.md` to describe the main pane as sidebar-driven rather than tab-bar-driven.

## Interfaces And Contracts

- Public API or CLI impact: None.
- Workspace file impact: None.
- Data model impact: None.

## Validation

- Commands to run: `npm run validate`
- Manual scenarios to verify: Open the app, confirm the top tab bar is gone, use the sidebar utility items to switch views, and confirm each main panel still opens correctly.

## Assumptions And Risks

- Assumptions: The sidebar utility navigation is the canonical primary-view control and is visible enough to replace the removed top tab strip.
- Risks: If future layouts reduce sidebar prominence, view discoverability may need a different non-duplicated affordance.
