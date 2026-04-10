# GitHub OAuth Token Exchange

## Purpose

Track the shipped implementation that upgrades GitHub OAuth from callback receipt capture to real authorization-code token exchange.

## Canonical For

- Scope and validation for hosted PKCE start, hosted token exchange, web token handoff, and desktop loopback token delivery

## Not Canonical For

- Long-term hosted account/session storage beyond the current browser-local web placeholder

## Summary

- Change: add PKCE-backed hosted OAuth start, hosted `code -> token` exchange, desktop loopback token POST handoff, and web browser-local token persistence
- Goal: make GitHub OAuth produce a usable connected account instead of only recording callback receipts
- Current state: `treesma.com` performs the exchange, `app.treesma.com` stores web tokens in browser local storage, and TreeMA Desktop stores desktop tokens in `~/.treema/settings/accounts.json`

## Key Changes

- Product or workflow:
  Hosted GitHub OAuth now completes an exchanged connection for both web and desktop targets instead of stopping at receipt capture.
- Code or contract:
  Add hosted PKCE cookies, hosted token exchange using `TREEMA_GITHUB_OAUTH_CLIENT_SECRET`, local desktop token-handoff POST route, browser-local hosted web token storage, and local `.env.local` loading for development.
- Docs or workspace:
  Update environment setup and architecture docs for the new client-secret requirement and handoff flow.

## Interfaces And Contracts

- Public API or CLI impact:
  `GET /api/auth/github/start` now sets a PKCE cookie and redirects to GitHub with a code challenge. `GET /auth/github/callback` now exchanges the code before redirecting to the hosted web app or handing off to the desktop loopback bridge.
- Workspace file impact:
  None.
- Data model impact:
  Local account settings continue storing masked callback receipts plus the connected GitHub token and verification result. Hosted web token persistence is browser-local only in this phase.

## Validation

- Commands to run:
  - `node --check scripts/lib/env-loader.mjs`
  - `node --check scripts/lib/account-settings.mjs`
  - `node --check api/auth/github/start.mjs`
  - `node --check api/auth/github/callback.mjs`
  - `node --check electron/main.cjs`
  - `node --check scripts/app-server.mjs`
  - `node --check app/app.js`
  - `npm run validate`
  - `npm run validate:docs`
- Manual scenarios to verify:
  - Start hosted web OAuth and confirm `/api/auth/github/start` sets a PKCE cookie before redirecting to GitHub.
  - Complete hosted web OAuth with valid cookie and confirm `app.treesma.com/auth/complete` stores the exchanged token in browser local storage.
  - Complete hosted desktop OAuth while TreeMA Desktop is running and confirm the hosted callback POSTs to `127.0.0.1:48152/auth/github/complete`, the local settings update, and the app refreshes connected-account state.
  - Complete hosted desktop OAuth while TreeMA Desktop is not running and confirm the hosted page reports that the local runtime is unavailable without leaking the exchanged token into the URL.
  - Open the hosted callback with invalid state or missing PKCE cookie and confirm the request is rejected safely.

## Assumptions And Risks

- Assumptions:
  - Vercel provides `TREEMA_GITHUB_OAUTH_CLIENT_SECRET` for hosted token exchange.
  - Hosted web account storage remains browser-local until a server-backed session layer ships.
- Risks:
  - Hosted web token persistence is not yet backed by a server-side session or encrypted browser storage.
