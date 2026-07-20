# W05 — Semantic Runtime Flows

## Objective

Encode important behavior that cannot be explained clearly through import relationships alone.

## Owner

Runtime Flow Analyst

## Prerequisites

W02 and W03 complete.

## Inputs

- verified repository inventory
- graph schema and stable-ID rules
- current README behavior documentation
- relevant runtime handlers

## Owned Files

- `tools/codegraph/semantic/flows.json`
- `tools/codegraph/src/load-semantic-flows.mjs`
- semantic-flow fixtures and validation tests
- `docs/architecture/runtime-flow-notes.md`

## Required Flows

1. Startup and graceful shutdown.
2. Discord interaction routing.
3. Discord message routing.
4. Trap-channel enforcement.
5. Automatic attachment Alert to Danger.
6. Follow-up messages updating an existing Danger incident.
7. Immediate timeout and asynchronous AI Verdict.
8. AI quota, provider selection, OCR matching, and card update.
9. Appeal submission and administrator review.
10. Remove Timeout.
11. Ban User.
12. Delete Evidence.
13. Delayed-ban loop.
14. Guild configuration invalidation.
15. Super-admin user and guild resets.

## Modeling Rules

- Every flow has a stable ID.
- Every step references graph entities when possible.
- Branch conditions are explicit.
- Asynchronous steps are labeled.
- Important error and unavailable-user paths are represented.
- Inferred steps include source evidence and confidence.
- Manual definitions supplement parser output instead of duplicating it blindly.
- Trap-channel and automatic-detection flows remain separate.

## Required Behavior Details

The definitions must preserve these distinctions:

- Automatic Detection ignores active trap channels.
- The first qualifying attachment message opens an Alert window without moderation.
- The second qualifying message inside the window creates one Danger incident.
- Later qualifying messages update the same incident.
- Moderation occurs before AI Verdict completes.
- AI Verdict enriches evidence and does not independently apply, repeat, cancel, or reverse moderation.
- Appeals use the shared moderation workflow.

## Deliverables

- versioned semantic-flow file
- loader and validator
- source references for each flow step
- human-readable runtime notes
- recommended grouping into tldraw pages

## Acceptance Criteria

- Every required flow is represented.
- Every branch terminates or links to another defined step.
- Asynchronous work is visually classifiable.
- Flow references validate against W03 entities.
- Verified facts and inferences are distinguishable.
- Source changes that invalidate a manual flow produce a diagnostic or validation failure.

## Validation

- Review flow steps against source handlers.
- Review behavior against README documentation.
- Cross-review with Repository Analyst.
- Validate all entity references through W03 tooling.

## Handoff

Provide W06 and W08 with:

- page grouping
- ordered steps
- branch labels
- asynchronous markers
- visual emphasis recommendations
- source-evidence links

## Non-Goals

- AST extraction
- canvas coordinates
- runtime telemetry
