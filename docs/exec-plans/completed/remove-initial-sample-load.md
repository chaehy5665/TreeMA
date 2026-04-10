# Remove Initial Sample Load

## Purpose

Record the shipped change that stops auto-loading the sample workspace on app startup.

## Canonical For

- The intent behind starting from an empty workspace shell instead of seeded sample data
- Validation and risk notes for removing the sample API path from runtime startup

## Not Canonical For

- The sample files still used for validation fixtures
- General onboarding behavior outside this startup-state refinement

## Summary

- Change: Remove automatic sample-state loading on startup and begin from an empty, unconnected workspace.
- Goal: Ensure the sidebar and main canvas only show real connected project data unless the user explicitly loads something.
- Current state: Startup shows empty project chrome, an idle workspace status, and no sample projects or tasks.

## Key Changes

- Product or workflow: The app now opens with no connected projects and prompts the user to use `Add`.
- Code or contract: Removed runtime sample-loading paths from the renderer, Electron preload and main process, and local server API routing.
- Docs or workspace: Updated repository docs to stop describing sample state as a normal UI entry path.

## Interfaces And Contracts

- Public API or CLI impact: Removed the unused `/api/sample` runtime route.
- Workspace file impact: None.
- Data model impact: None.

## Validation

- Commands to run: `npm run validate`
- Manual scenarios to verify: Open the app, confirm the sidebar is empty on startup, then use `Add` to connect an existing workspace or initialize a new folder.

## Assumptions And Risks

- Assumptions: Sample fixtures remain useful for validation even though they are no longer loaded by default in the UI.
- Risks: Any future feature that expects startup state to contain sample data will need an explicit load action or dedicated fixture wiring.
