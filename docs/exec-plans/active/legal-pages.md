# Legal Pages

## Summary

- Change: Add public `privacy.html` and `terms.html` pages, wire them into the landing surface, and document the new static entrypoints.
- Goal: Provide baseline legal pages for the public TreeMA website without changing the local app runtime or adding backend handling.
- Current state: The public surface has a landing page but no linked Privacy Policy or Terms of Service.

## Key Changes

- Product or workflow: Add footer-level legal navigation from the public landing page and dedicated legal page templates for privacy and terms.
- Code or contract: Add `privacy.html`, `terms.html`, and `legal.css`; update `landing.html` and `landing.css` for legal links and footer treatment.
- Docs or workspace: Update `README.md` and `docs/PROJECT_STRUCTURE.md` so the public static surface includes the new legal pages.

## Interfaces And Contracts

- Public API or CLI impact: None.
- Workspace file impact: None.
- Data model impact: None.

## Validation

- Commands to run: `npm run validate:docs`
- Manual scenarios to verify: Open `landing.html`, `privacy.html`, and `terms.html`, verify footer links resolve correctly, and confirm Vercel can serve the new static pages directly.

## Assumptions And Risks

- Assumptions: Generic MVP-first legal text is acceptable until jurisdiction-specific review is needed.
- Risks: These pages are product-aligned baseline documents, not counsel-reviewed legal advice.
