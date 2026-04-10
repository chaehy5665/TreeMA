# Execution Plan

## Purpose

Ship settings-driven AI account integrations for OpenAI API and GitHub Copilot across the shared UI, browser server, and Electron shell.

## Canonical For

- The implementation plan for adding account settings storage, verification, and UI wiring
- The coordinated subsystem changes required for this feature

## Not Canonical For

- The long-term product roadmap beyond this change
- Detailed runtime behavior that belongs in the shipped canonical docs

## Summary

- Change: Add `AI Accounts` settings support for `OpenAI API` and `GitHub Copilot`
- Goal: Let operators save, inspect, connect, test, and disconnect the two account types from Settings without leaking secrets into workspace files
- Current state: Settings only stores local display preferences, and there is no shared runtime path for durable account configuration or provider verification

## Key Changes

- Product or workflow:
  Add an `AI Accounts` section in Settings with separate cards for OpenAI and GitHub Copilot, masked connection state, test actions, and disconnect actions.
- Code or contract:
  Introduce a shared account-settings module, new server routes, new Electron IPC bridge methods, and renderer logic for load/save/test flows.
- Docs or workspace:
  Document the non-workspace account settings storage boundary and update repository structure docs for the new module and runtime responsibilities.

## Interfaces And Contracts

- Public API or CLI impact:
  Add local runtime settings APIs for loading account settings, saving provider credentials, testing provider credentials, and disconnecting a provider.
- Workspace file impact:
  None. Credentials must not be written into `.treema`.
- Data model impact:
  Add a local user settings JSON contract for provider metadata and secrets outside the workspace.

## Validation

- Commands to run:
  `npm run validate`
- Manual scenarios to verify:
  Open Settings, connect OpenAI, test the key, connect GitHub Copilot with a token, test the token, reload the app, confirm masked state persists, disconnect either provider, and confirm the state clears.

## Assumptions And Risks

- Assumptions:
  OpenAI verification can use the models endpoint with a bearer key, and GitHub Copilot setup can use a supported GitHub user token plus GitHub API verification.
- Risks:
  GitHub Copilot account entitlement signals vary by token type and account plan, so the UI may need to distinguish between token validity and billing-surface availability.
