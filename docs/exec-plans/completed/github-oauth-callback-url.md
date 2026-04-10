# GitHub OAuth Callback URL

## Purpose

Track the coordinated implementation needed to expose a stable GitHub OAuth authorization callback URL in the local TreeMA runtime.

## Canonical For

- Scope and validation for the GitHub OAuth callback route work

## Not Canonical For

- Long-term auth product design beyond this change

## Summary

- Change: add a GitHub OAuth callback endpoint and surface its URL in Settings
- Goal: give operators a concrete Authorization callback URL they can register in GitHub OAuth settings and a minimal local receipt path for callback payloads
- Current state: TreeMA supports manual GitHub token entry only and has no OAuth callback route or surfaced callback URL

## Key Changes

- Product or workflow:
  Operators can copy a stable local callback URL from Settings and use it when configuring GitHub OAuth.
- Code or contract:
  Add a browser-server callback route, store recent callback metadata outside `.treema`, and expose callback details through account settings APIs.
- Docs or workspace:
  Update repo docs that describe server responsibilities, settings workflow, and runtime structure.

## Interfaces And Contracts

- Public API or CLI impact:
  Add a GitHub OAuth callback route and related settings API data for callback URL and last callback receipt metadata.
- Workspace file impact:
  None. Callback data remains outside project workspaces.
- Data model impact:
  Extend local account settings persistence for GitHub callback metadata.

## Validation

- Commands to run:
  - `npm run validate`
- Manual scenarios to verify:
  - Start `npm run serve` and confirm Settings shows the GitHub OAuth callback URL.
  - Open the callback URL with sample `code` and `state` query params and confirm the success page renders.
  - Reload Settings and confirm recent callback metadata is visible.

## Assumptions And Risks

- Assumptions:
  - The immediate requirement is the callback endpoint and URL, not the full OAuth code exchange flow.
- Risks:
  - The callback stores masked receipt metadata only, so a later token exchange flow still needs explicit implementation.
