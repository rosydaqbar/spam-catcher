# W01 — Foundation and Repository Integration

## Objective

Create the isolated project skeleton and shared conventions required by every later workstream.

## Owner

Coordinator

## Prerequisites

None.

## Inputs

- `AGENTS.md`
- current `package.json`
- current `.gitignore`
- existing repository conventions

## Owned Files

- `tools/codegraph/` skeleton
- `docs/architecture/` skeleton
- `.codegraph/` policy and ignore rules
- graph-related changes to `package.json`
- graph-related changes to `.gitignore`
- coordination updates to `agents/STATUS.md`

## Required Tasks

1. Confirm canonical paths:
   - `tools/codegraph/`
   - `.codegraph/`
   - `docs/architecture/spam-catcher-architecture.tldraw`
2. Decide which generated files are committed and which are ignored.
3. Add placeholder entry points for build, watch, and validation commands.
4. Keep graph dependencies development-only and outside the bot runtime path.
5. Record Node.js 18 compatibility requirements.
6. Add a configuration file for included and ignored paths.
7. Define file ownership for later workers.
8. Record approved path and script contracts in `agents/STATUS.md`.

## Deliverables

- stable directory structure
- package-script placeholders or explicit stubs
- generated-file policy
- approved graph-tool configuration shape
- updated status ledger

## Acceptance Criteria

- `npm start` behavior is unchanged.
- Existing `npm run check` still passes.
- Graph tooling is outside `src/`.
- Generated output cannot trigger the watcher recursively.
- No graph-only dependency enters the bot runtime dependency path.
- Later workers can implement their work without renaming directories.
- Placeholder commands fail clearly when implementation is incomplete.

## Validation

```text
npm run check
npm run graph:build
npm run graph:validate
```

During W01, graph commands may report an explicit not-implemented result. They must not silently succeed.

## Handoff

Provide W02 and W03 with:

- final paths
- config-file format
- committed/generated file policy
- dependency policy
- package-script names
- shared-file ownership rules

## Non-Goals

- parsing source files
- defining graph entities
- rendering tldraw shapes
- implementing live updates
