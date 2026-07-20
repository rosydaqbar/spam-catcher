# W08 — Testing, Documentation, and Handoff

## Objective

Prove that the graph pipeline is accurate, deterministic, safe for manual edits, isolated from production behavior, and maintainable by a new contributor.

## Owner

QA and Documentation Engineer

## Prerequisites

W01–W07 complete or explicitly waived.

## Inputs

- all implementation outputs
- W02 expected architecture inventory
- W03 graph schema
- W05 semantic flows
- W06 renderer and layout contract
- W07 watcher and recovery contract

## Owned Files

- `tools/codegraph/test/`
- `tools/codegraph/fixtures/`
- `tools/codegraph/src/validate-graph.mjs`
- test-only configuration
- `docs/architecture/README.md`
- `docs/architecture/troubleshooting.md`
- graph-related root README additions
- final updates to `agents/STATUS.md`

## Required Test Categories

### Schema and Stable IDs

- valid graph
- duplicate entity ID
- duplicate edge ID
- dangling reference
- invalid type
- stable-ID collision
- schema migration fixture

### Parsing

- CommonJS imports
- exported factories
- nested handlers
- Discord events
- configuration-store calls
- environment variables
- SQL tables
- unsupported syntax diagnostics

### Determinism

- repeated full builds
- changed filesystem enumeration order
- cache enabled and disabled
- full rebuild versus incremental accumulation

### Rendering and Layout

- stable managed shape IDs
- no duplicate shapes
- unmanaged note preservation
- manual generated-node position preservation
- new-node placement
- removed-node handling
- atomic-write or backup recovery
- invalid graph rejection

### Watching

- debounce
- rapid saves
- add, modify, rename, and delete
- ignored generated files
- no recursive loop
- graceful shutdown
- recovery after a failed build

### Architecture Accuracy

- manager creation and routing
- trap-channel exclusion from automatic detection
- Alert to Danger state transition
- asynchronous AI Verdict
- shared appeal workflow
- PostgreSQL table coverage
- evidence deletion and delayed-ban behavior

## Required Documentation

1. Purpose and scope.
2. Prerequisites, including tldraw Offline.
3. Installation.
4. Full build.
5. Watch mode.
6. Validation.
7. Architecture pages and visual legend.
8. Manual-edit guarantees.
9. Resetting generated layout.
10. Recovery from parser, watcher, bridge, or document errors.
11. Updating semantic flows.
12. Adding entity or edge types.
13. Generated versus committed files.
14. Security and privacy constraints.
15. Known limitations.
16. Contributor workflow.

## Deliverables

- `npm run graph:validate`
- unit and integration tests
- representative fixtures
- architecture accuracy checklist
- known-limitations report
- architecture README
- troubleshooting guide
- root README entry point
- completed status ledger
- maintainer handoff checklist

## Acceptance Criteria

- Existing `npm run check` passes.
- Graph tests pass on Node.js 18.
- Two full builds are semantically equivalent.
- No test requires Discord, PostgreSQL, OpenRouter, Gemini, or internet access.
- Fixtures contain no secrets.
- Validation errors identify the affected file or entity.
- Manual notes and positions are proven to survive regeneration.
- Watcher recovery and recursive-loop protection are proven.
- A new contributor can build, open, watch, validate, and maintain the graph from documentation.
- Documentation distinguishes verified bridge behavior from assumptions.
- Commands match `package.json`.

## Validation Commands

```text
npm run check
npm run graph:build
npm run graph:validate
```

Include any additional test command introduced during W01.

## Final Handoff

Provide the coordinator with:

- exact commands and results
- supported environments
- failed or waived checks
- known limitations
- clean-checkout documentation verification
- release-readiness conclusion
- recommended next improvements

## Non-Goals

- adding Discord bot product features
- live external API tests
- hiding technical limitations
- rewriting unrelated README content
