# Scan Inspector Interaction Polish

## Purpose

Record the active work to make the Project Scan surfaces interactive and easier to read.

## Canonical For

- The implementation intent behind interactive scan cards and inspector details
- Validation and risk notes for this UI polish change

## Not Canonical For

- Product requirements outside this UI refinement
- Detailed copy that remains defined in running code

## Summary

- Change: Turn the `Project Scan` hierarchy, dependency, flow, and roadmap cards into selectable UI with a shared inspector panel and stronger blocker or warning emphasis.
- Goal: Make scan output actionable instead of static so users can verify analysis relationships and execution phases from one canvas.
- Current state: The scan view renders four static card lists with no shared selection state and only light visual differentiation for warnings or blockers.

## Key Changes

- Product or workflow: Users can click or keyboard-select scan cards and inspect richer details without losing context across sections.
- Code or contract: Add scan selection state and inspector rendering in `src/main.js`, extend the scan layout in `index.html`, and add interaction plus emphasis styling in `styles.css`.
- Docs or workspace: Update the repository structure map to note the interactive scan inspector responsibility.

## Interfaces And Contracts

- Public API or CLI impact: None.
- Workspace file impact: None.
- Data model impact: None.

## Validation

- Commands to run: `npm run validate`
- Manual scenarios to verify: Load a workspace, run Analyze Current Project, select cards in hierarchy, dependency, flow, and roadmap, confirm the inspector updates for each selection, and confirm blocked or warning cards read as higher-priority surfaces than default cards.

## Assumptions And Risks

- Assumptions: Existing analysis payloads already provide enough metadata to populate an inspector without changing the analysis schema.
- Risks: If future analysis artifacts become much denser, the inspector may need collapsing sections or pagination to avoid becoming another long scroll region.
