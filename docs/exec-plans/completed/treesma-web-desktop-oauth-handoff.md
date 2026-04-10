# Treesma Web Desktop OAuth Handoff

## Purpose

Track the shipped implementation for the hosted web surface split and GitHub OAuth desktop handoff.

## Canonical For

- Scope and validation for the hosted `app.treesma.com` surface, public callback routing, and `treesma://` handoff

## Not Canonical For

- Long-term backend session design beyond the first hosted control-plane cut

## Summary

- Change: add `app.treesma.com` control-plane pages, hosted GitHub OAuth start/callback routes, and desktop deep-link handoff
- Goal: separate public site, hosted account/auth UX, and local-first desktop runtime while keeping TreeMA Desktop the primary workspace surface
- Current state: local browser and Electron surfaces already existed; this change adds hosted app routes plus `treesma://` return handling

## Key Changes

- Product or workflow:
  `treesma.com` remains the public site and OAuth ingress, `app.treesma.com` owns account/auth pages, and Electron remains the local-first workspace app.
- Code or contract:
  Add host-based Vercel rewrites, hosted OAuth starter and callback routes, desktop deep-link registration, pending OAuth desktop session validation, and hosted app pages.
- Docs or workspace:
  Update repo docs for `app/`, hosted auth routes, and `treesma://` runtime behavior.

## Interfaces And Contracts

- Public API or CLI impact:
  Add `/api/auth/github/start`, `https://treesma.com/auth/github/callback`, `https://app.treesma.com/auth/complete`, `https://app.treesma.com/settings/accounts`, `https://app.treesma.com/settings/download`, and `treesma://auth/complete?...`.
- Workspace file impact:
  None.
- Data model impact:
  Extend local account settings persistence with pending desktop OAuth session metadata and masked callback receipts.

## Validation

- Commands to run:
  - `node --check scripts/lib/account-settings.mjs`
  - `node --check api/auth/github/start.mjs`
  - `node --check api/auth/github/callback.mjs`
  - `node --check electron/main.cjs`
  - `node --check electron/preload.cjs`
  - `node --check src/main.js`
  - `npm run validate`
- Manual scenarios to verify:
  - Start desktop OAuth from Electron and confirm the authorize URL opens in the system browser.
  - Open `https://treesma.com/auth/github/callback` with a valid web-target state and confirm redirect to `app.treesma.com/auth/complete`.
  - Open the hosted callback with a valid desktop-target state and confirm `treesma://` handoff plus renderer refresh.
  - Open the hosted callback with invalid or expired state and confirm the safe hosted error page.

## Assumptions And Risks

- Assumptions:
  - Hosted web auth is control-plane only in this phase; desktop remains the local-first execution surface.
- Risks:
  - Web-target state is structurally validated and age-bounded, but not backed by a hosted nonce store yet.
