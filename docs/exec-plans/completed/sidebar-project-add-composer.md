# Sidebar Project Add Composer

## Purpose

Record the shipped change that removes the main-canvas connect card and collapses project add and load actions into the sidebar.

## Canonical For

- The implementation intent behind moving project connection into the sidebar
- Validation and risk notes for the shipped sidebar-only project add flow

## Not Canonical For

- General product scope outside this workspace entry-flow change
- Detailed visual tokens that remain defined in running code

## Summary

- Change: Remove the `Connect` card from the `Workspace` tab and move project path, browse, load, init, and analyze controls into a sidebar project composer opened from the `Projects` add button.
- Goal: Reduce the main canvas to operational reading and editing while keeping project connection and onboarding inside the sidebar that owns project navigation.
- Current state: The `Workspace` tab starts with imports and operational summaries, and the left sidebar now contains the only UI for adding or loading a project.

## Key Changes

- Product or workflow: Users add or load projects from the sidebar without using a dedicated connect card in the main canvas.
- Code or contract: Moved connection controls into sidebar markup, introduced open and close composer state in the renderer, and preserved existing workspace API routes.
- Docs or workspace: Updated `docs/PROJECT_STRUCTURE.md` to describe the sidebar add-project composer as part of the UI shell.

## Interfaces And Contracts

- Public API or CLI impact: None.
- Workspace file impact: None.
- Data model impact: None.

## Validation

- Commands to run: `npm run validate`
- Manual scenarios to verify: Open the app, confirm the `Workspace` tab no longer shows a connect card, click `Add` in the sidebar, load or initialize a workspace from the composer, and confirm the sidebar updates while the composer closes.

## Assumptions And Risks

- Assumptions: Project connection is a sidebar concern and does not need to occupy primary canvas space once project navigation is already sidebar-driven.
- Risks: Moving all connection controls into the sidebar reduces available width for long paths, so future additions should avoid making the composer materially denser.
