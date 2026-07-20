# W04 — Static-Analysis Parsers

## Objective

Build deterministic analyzers that extract structural architecture data without importing or executing bot modules.

## Owner

Static Analysis Engineer

## Prerequisites

W03 complete.

## Inputs

- approved graph schema and stable-ID utilities
- W02 inventory as the expected-output reference
- W01 include and ignore configuration

## Owned Files

- `tools/codegraph/src/scan-files.mjs`
- `tools/codegraph/src/parse-javascript.mjs`
- `tools/codegraph/src/parse-package.mjs`
- `tools/codegraph/src/parse-environment.mjs`
- `tools/codegraph/src/parse-sql.mjs`
- parser fixtures and tests

## Required Extraction

### JavaScript

- CommonJS `require()` dependencies
- `module.exports` and exported factories
- named function declarations
- selected nested runtime handlers
- Discord event registrations
- manager factory creation
- `configStore` method calls
- environment variable references
- external `fetch()` boundaries without stored secrets
- relevant timers, queues, caches, and constants

### Package Metadata

- entry point
- npm scripts
- runtime dependencies
- development dependencies
- Node engine requirement

### SQL and Persistence

- table names
- create, alter, and index relationships where practical
- source evidence for each discovered table
- links from configuration-store operations to tables when statically verifiable

## Parser Rules

- Use an AST parser for JavaScript.
- Do not use regular expressions as the primary JavaScript parser.
- Do not execute source files.
- Normalize path separators.
- Ignore generated and dependency directories.
- Report unsupported syntax as diagnostics.
- Keep false positives visible instead of inventing certainty.
- Do not include environment values, tokens, URLs containing secrets, or private local paths.

## Required Tasks

1. Build the file scanner.
2. Build per-file intermediate representations.
3. Convert extracted facts into W03 graph fragments.
4. Add changed-file cache keys based on content and parser version.
5. Add diagnostics with file and location evidence.
6. Add deterministic combination and sorting.
7. Verify output against the W02 inventory.

## Deliverables

- file scanner
- JavaScript analyzer
- package and environment analyzer
- SQL analyzer
- per-file intermediate representation
- deterministic structural graph fragment
- parser diagnostics
- fixtures and tests

## Acceptance Criteria

- Parses all current project JavaScript without execution.
- Identifies the managers created by `src/index.js`.
- Captures interaction and message-routing registrations.
- Detects PostgreSQL access through `configStore`.
- Detects OpenRouter and Gemini boundaries without exposing credentials.
- A changed import produces a changed edge.
- Unchanged files can reuse cache safely.
- Parser failures identify file and location.

## Validation

- Fixture tests for imports, exports, nested handlers, timers, queues, and fetch calls.
- Golden comparison against W02 inventory.
- Run analyzer twice and compare semantic output.
- Verify ignored files cannot enter the graph.

## Handoff

Provide W07 and W08 with:

- parser entry points
- cache-key rules
- changed-file invalidation rules
- diagnostic format
- performance baseline

## Non-Goals

- human-authored runtime-flow semantics
- tldraw rendering
- filesystem watching
