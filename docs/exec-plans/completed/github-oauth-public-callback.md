# GitHub OAuth Public Callback

## Purpose

Track the coordinated implementation needed to expose a hosted GitHub OAuth callback on `treesma.com`.

## Canonical For

- Scope and validation for the hosted callback route

## Not Canonical For

- Full OAuth token exchange design

## Summary

- Change: add a Vercel-hosted GitHub OAuth callback at `/auth/github/callback`
- Goal: make `https://treesma.com/auth/github/callback` a valid Authorization callback URL and bridge users back toward the local TreeMA runtime
- Current state: TreeMA only exposes loopback callback URLs from the local browser server and Electron shell

## Key Changes

- Product or workflow:
  Operators can register `https://treesma.com/auth/github/callback` in GitHub OAuth and land on a hosted callback page with continuation links back into local TreeMA runtimes.
- Code or contract:
  Add a Vercel function under `api/`, rewrite `/auth/github/callback` to that function, and share masked callback receipt formatting with local runtimes.
- Docs or workspace:
  Update deployment and architecture docs for the hosted callback path.

## Interfaces And Contracts

- Public API or CLI impact:
  Add public GET route `https://treesma.com/auth/github/callback`.
- Workspace file impact:
  None.
- Data model impact:
  None for workspace data; hosted callback reuses masked receipt formatting only.

## Validation

- Commands to run:
  - `npm run validate`
  - `npm run validate:docs`
- Manual scenarios to verify:
  - Open `/auth/github/callback?code=...&state=...` through the hosted route locally as rewritten function output and confirm the callback page renders.
  - Confirm the page offers continuation links for local browser and desktop runtimes.

## Assumptions And Risks

- Assumptions:
  - The immediate need is a valid hosted callback URL and a human-guided continuation path, not automatic background relay to localhost.
- Risks:
  - Browsers may not auto-forward safely from HTTPS hosted pages to localhost, so the first shipped version relies on explicit continuation links.
