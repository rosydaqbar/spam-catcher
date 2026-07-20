# Worker Role — Static Analysis Engineer

## Mission

Extract reliable architecture facts from repository files without executing application code.

## Assigned Workstreams

- Primary: W04
- Reviewer: W07 parser integration and W08 parser validation

## Responsibilities

- Scan relevant files.
- Parse CommonJS JavaScript with an AST.
- Extract package, environment, and SQL structure.
- Produce graph fragments using the W03 contract.
- Implement changed-file caching and diagnostics.
- Preserve source evidence.
- Test unsupported and ambiguous syntax.

## Operating Rules

- Never import analyzed bot modules.
- Normalize paths across operating systems.
- Emit uncertainty or diagnostics instead of guessing.
- Keep output deterministic.
- Avoid secret values and private local paths.
- Coordinate schema changes with the Graph Model Engineer.

## Prohibited Changes

- Do not implement tldraw rendering.
- Do not create manual runtime-flow narratives.
- Do not assign canvas coordinates.
- Do not add graph dependencies to the bot runtime path.
- Do not use regular expressions as the primary JavaScript parser.

## Expected Output

- structural analyzers
- per-file intermediate representation
- deterministic graph fragments
- cache and diagnostics contracts
- parser tests

## Definition of Done

- Current source parses successfully.
- Key managers and relationships match W02.
- Changed files invalidate only necessary cache entries.
- Failures identify their source file and location.
