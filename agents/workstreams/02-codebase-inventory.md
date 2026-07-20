# W02 — Codebase Inventory

## Objective

Produce a verified inventory of the current Spam Catcher architecture before automation is built.

## Owner

Repository Analyst

## Prerequisites

W01 complete.

## Inputs

- repository source
- README behavior documentation
- W01 path and configuration decisions

## Owned Files

- `tools/codegraph/fixtures/repository-inventory.json`
- `docs/architecture/codebase-inventory.md`
- analysis updates to `agents/STATUS.md`

## Required Tasks

1. Inventory JavaScript modules under `src/` and `scripts/`.
2. Identify startup entry points and package scripts.
3. Map CommonJS imports and exports.
4. Verify Discord event handlers and interaction-routing order.
5. Keep the two moderation systems separate:
   - trap-channel enforcement
   - automatic attachment detection
6. Identify shared services:
   - configuration store
   - moderation workflow
   - i18n
   - environment parsing
   - logging
   - PostgreSQL SSL handling
7. Inventory PostgreSQL tables and their responsibilities.
8. Identify OpenRouter and Gemini boundaries.
9. Record queues, caches, timers, and background loops that materially affect behavior.
10. Separate verified facts from inferred relationships.

## Required Runtime Flows

The inventory must cover:

- startup and graceful shutdown
- `InteractionCreate` routing
- `MessageCreate` routing
- guild setup and configuration
- trap-channel timeout and ban flow
- automatic Alert to Danger flow
- AI Verdict enrichment
- appeal and administrator review
- evidence deletion
- delayed bans
- super-admin reset and quota controls

## Deliverables

- machine-readable repository inventory
- human-readable architecture inventory
- list of uncertain or manually maintained relationships
- recommended graph page boundaries
- source evidence for every important item

## Acceptance Criteria

- Every current `src/**/*.js` file is classified.
- Every documented PostgreSQL table is included.
- Message routing order matches `src/index.js`.
- Active trap channels are recorded as excluded from automatic detection.
- AI Verdict is recorded as asynchronous evidence enrichment.
- No code is executed to discover metadata.
- Each inventory item includes source path and symbol or table evidence.

## Validation

- Compare inventory against `src/index.js`.
- Compare table inventory against schema creation code and SQL scripts.
- Compare feature flows against README behavior descriptions.
- Request Runtime Flow Analyst review for ambiguous relationships.

## Handoff

Provide W03, W05, and W06 with:

- canonical module list
- canonical external-system list
- canonical table list
- verified flow summaries
- uncertainty list
- recommended visual groups

## Non-Goals

- building parsers
- defining final graph schema
- creating tldraw shapes
