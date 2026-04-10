# Codex-Style Sidebar Project Thread Layout

## Purpose

Record the shipped change that restructures the TreeMA left rail into a Codex-inspired project and thread sidebar.

## Canonical For

- The implementation intent behind the sidebar layout shift
- Validation and risk notes for the shipped project and thread grouping behavior

## Not Canonical For

- General product scope outside the sidebar and shell presentation change
- Detailed visual tokens that remain defined in running code

## Summary

- Change: Replace the numbered left-rail tab list with a utility action stack plus grouped project threads, while keeping the main canvas as the primary work surface.
- Goal: Make the workspace feel closer to Codex navigation patterns so users can scan projects and recent operational threads from the sidebar instead of reading a generic section list.
- Current state: The sidebar now shows top-level view actions, project groups derived from workspace state, task and decision threads, and a lightweight main-header context summary.

## Key Changes

- Product or workflow: Users can navigate through a project-oriented left rail that surfaces active work items and direct jumps into board, timeline, workspace, and review views.
- Code or contract: Reworked sidebar markup and styling, replaced the previous sidebar tab model with grouped utility and project-thread builders, and synchronized shell header context with loaded workspace state.
- Docs or workspace: Updated `docs/PROJECT_STRUCTURE.md` to reflect the new Codex-style sidebar responsibilities.

## Interfaces And Contracts

- Public API or CLI impact: None.
- Workspace file impact: None.
- Data model impact: None. Sidebar grouping derives from existing `projects`, `tracks`, `tasks`, `decisions`, and `meta.currentFocusTaskIds`.

## Validation

- Commands to run: `npm run validate`
- Manual scenarios to verify: Open the app, confirm the sidebar shows utility actions and project groups, click a project thread and verify the matching tab opens, then load a real workspace and confirm the sidebar header and counts update.

## Assumptions And Risks

- Assumptions: Existing tabs remain the canonical main-view surfaces, so the sidebar can act as a project inbox without adding new data contracts.
- Risks: Project thread selection is tab-oriented rather than entity-deep linking, so future drill-down features may need explicit per-entity focus state in the renderer.
