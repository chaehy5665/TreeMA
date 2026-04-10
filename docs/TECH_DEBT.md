# TreeMA Tech Debt

## Purpose

Track known implementation and documentation debt that should influence future changes.

## Canonical For

- Known structural gaps and follow-up work
- Debt that affects refactors, product decisions, or reliability

## Not Canonical For

- Active task tracking inside a real project workspace
- Historical decisions that belong in workspace logs

## Current Debt

| Area | Debt | Impact |
| --- | --- | --- |
| Validation | Runtime validation is custom and lightweight rather than schema-backed end to end | Some invalid state shapes may be missed by the app until deeper checks are added |
| UI composition | `src/main.js` remains a large single-file controller and renderer | UI changes have high coupling and lower local clarity |
| Docs rendering | The workspace docs panel renders raw markdown as text | Rich cross-link navigation is limited in the app |
| AI scan cost and latency | AI-native Project Scan now depends on provider availability, bounded context packing, and cache quality | Large repositories can become slow or expensive without tighter incremental reuse |
| AI grounding trust | Semantic scan quality depends on evidence references and validator enforcement | Weak grounding could still produce plausible but misleading architecture claims if guardrails regress |
| Review flow | AI proposal review is read-only and not yet a full approval/apply pipeline | Human-in-the-loop workflow is incomplete relative to the product goal |

## Debt Rules

- Add new debt when it creates meaningful design or implementation constraints.
- Remove debt only when the underlying cause is actually resolved.
- Prefer linking the relevant canonical doc when a debt item depends on a contract or invariant.
