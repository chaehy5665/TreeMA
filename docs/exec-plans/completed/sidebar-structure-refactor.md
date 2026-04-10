# Sidebar Structure Refactor

## Purpose

Record the shipped plan for restructuring the MVP sidebar into a section-based navigation surface.

## Canonical For

- The implementation intent behind the sidebar refactor
- Validation and risk notes for the shipped change

## Not Canonical For

- General product scope outside the sidebar change
- Detailed UI copy that lives in running code

## Summary

- Change: Refactor the left sidebar from static placeholder navigation into section-aware navigation backed by shared configuration.
- Goal: Make the sidebar easier to scan, maintain, and extend without duplicating section structure across HTML and JavaScript.
- Current state: The sidebar nav now renders from `src/lib/sidebar.js`, tracks visible sections, and scrolls to real sidebar regions instead of showing disconnected placeholder buttons.

## Key Changes

- Product or workflow: The left rail now exposes real sidebar destinations that map to Connect, Imports, Live Focus, and Snapshot.
- Code or contract: Added `src/lib/sidebar.js`, annotated sidebar sections in `index.html`, and bound active-section behavior in `src/main.js`.
- Docs or workspace: Updated `docs/PROJECT_STRUCTURE.md` to document the new sidebar module and surface responsibilities.

## Interfaces And Contracts

- Public API or CLI impact: None.
- Workspace file impact: None.
- Data model impact: None.

## Validation

- Commands to run: `npm run validate`
- Manual scenarios to verify: Click each sidebar nav item, confirm the sidebar scrolls to the matching section, and confirm the active nav state follows section focus while interacting with sidebar controls.

## Assumptions And Risks

- Assumptions: Browser support includes `IntersectionObserver`, with focus-based fallback preserving active state if section visibility tracking is limited.
- Risks: Very small sidebar heights may make visibility-based active-state changes feel jumpy, so future layout changes should retune the observer margins if section density changes materially.
