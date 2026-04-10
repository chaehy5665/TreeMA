# Landing Page

## Summary

- Change: Add a public static landing entry at `landing.html` with its own stylesheet, script, and placeholder asset set while keeping the local app rooted at `index.html`.
- Goal: Position TreeMA for AI-native individual builders and route them into the repository overview or the real local app without changing the app runtime contract.
- Current state: The repo only exposes the workspace app shell and has no separate marketing entry, landing copy hierarchy, or landing asset convention.

## Key Changes

- Product or workflow: Introduce a seven-section landing flow covering problem, workflow, capabilities, explicit-state rationale, product maturity, local run guidance, and CTA.
- Code or contract: Add `landing.html`, `landing.css`, `src/landing.js`, and `assets/landing/*` without changing server APIs or Electron routing.
- Docs or workspace: Update `README.md` and `docs/PROJECT_STRUCTURE.md` so the landing route and asset paths are documented with the rest of the repo entrypoints.

## Interfaces And Contracts

- Public API or CLI impact: None.
- Workspace file impact: None.
- Data model impact: None.

## Validation

- Commands to run: `npm run validate:docs`
- Manual scenarios to verify: Confirm `/` still opens the app, `/landing.html` renders the landing page, CTA links reach `README.md`, `#run-locally`, and `index.html`, and the layout remains intact on desktop and mobile widths.

## Assumptions And Risks

- Assumptions: English-first copy and placeholder SVG frames are acceptable for v1 until real product screenshots are exported.
- Risks: Browsers will render `README.md` as a raw markdown document, so the landing keeps the overview CTA lightweight and may later need a richer documentation surface.
