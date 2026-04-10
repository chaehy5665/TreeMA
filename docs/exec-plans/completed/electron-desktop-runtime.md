# Electron Desktop Runtime

## Purpose

Capture the coordinated implementation plan for adding an Electron desktop shell without removing the existing browser server workflow.

## Canonical For

- Scope and validation plan for the Electron runtime addition
- The intended relationship between the Electron shell and the existing local server flow

## Not Canonical For

- Detailed architecture beyond the canonical docs
- Product scope changes outside the desktop runtime addition

## Summary

- Change: Add an Electron desktop runtime that loads the existing UI and performs workspace actions through native IPC.
- Goal: Let TreeMA run as a desktop app while preserving the current `npm run serve` browser workflow.
- Current state: The UI depended on `/api/*` routes served by `scripts/app-server.mjs`; the shipped change adds a desktop shell and native IPC bridge alongside that flow.

## Key Changes

- Product or workflow: Added a desktop launch path alongside the existing local server path.
- Code or contract: Introduced Electron main/preload files and a renderer bridge that routes the current API calls over IPC when running on desktop.
- Docs or workspace: Updated repo maps and runtime docs to include the new desktop entrypoint and command.

## Interfaces And Contracts

- Public API or CLI impact: Added `npm run desktop` to open the desktop shell.
- Workspace file impact: None. `.treema` files stay unchanged.
- Data model impact: None. The same canonical JSON and analysis outputs remain in place.

## Validation

- Commands to run: `npm install`, `npm run validate`, `npm run desktop`
- Manual scenarios to verify: open the app, choose a folder, init or load `.treema`, analyze a project, save a snapshot.

## Assumptions And Risks

- Assumptions: The existing browser UI can run from `file://` when backend calls are bridged through preload IPC.
- Risks: Electron packaging may surface ESM/CommonJS boundary issues or window lifecycle differences that do not appear in the local server path.
