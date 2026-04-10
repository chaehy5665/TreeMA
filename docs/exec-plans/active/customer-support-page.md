# Customer Support Page

## Summary

- Change: Add a public `support.html` page and wire support links into the landing and legal pages.
- Goal: Give the public TreeMA surface a stable customer-support route for MVP support expectations and contact guidance.
- Current state: The site has landing, privacy, and terms pages, but no dedicated support page or support route.

## Key Changes

- Product or workflow: Add `/support` as a public extensionless route for support scope, self-serve guidance, and contact expectations.
- Code or contract: Add `support.html` using `legal.css`; update `landing.html`, `privacy.html`, and `terms.html` to link to support.
- Docs or workspace: Update `README.md` and `docs/PROJECT_STRUCTURE.md` so the support page is part of the documented public surface.

## Interfaces And Contracts

- Public API or CLI impact: None.
- Workspace file impact: None.
- Data model impact: None.

## Validation

- Commands to run: `npm run validate:docs`
- Manual scenarios to verify: Open `/support`, confirm landing footer links to support, and confirm privacy/terms contact sections point users to the support page.

## Assumptions And Risks

- Assumptions: Support remains reasonable-effort MVP support with no formal SLA.
- Risks: Contact handling is still generic until a dedicated mailbox or form is published.
