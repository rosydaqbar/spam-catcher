# W07 — Live Watcher and Update Bridge

## Objective

Detect relevant repository changes, rebuild affected graph data, and update the tldraw document without recursive loops or data loss.

## Owner

Live Update Engineer

## Prerequisites

W04 and W06 complete.

## Inputs

- parser entry points and cache rules
- renderer full-build and patch APIs
- W01 include and ignore configuration
- verified tldraw Offline bridge capabilities

## Owned Files

- `tools/codegraph/src/build-graph.mjs`
- `tools/codegraph/src/watch-graph.mjs`
- `tools/codegraph/src/diff-graph.mjs`
- `tools/codegraph/src/tldraw-bridge.mjs`
- watcher, diff, and bridge fixtures and tests

## Watched Inputs

- `src/**/*.js`
- `scripts/**/*.js`
- `scripts/**/*.sql`
- `package.json`
- `.env.example`
- semantic flow files
- selected architecture configuration files

## Required Ignores

- `node_modules/`
- `.git/`
- `.codegraph/`
- generated `.tldraw` output
- logs
- temporary files
- editor swap files

## Required Tasks

1. Implement the initial full build.
2. Debounce bursty filesystem events.
3. Serialize overlapping build requests.
4. Reparse changed files only where safe.
5. Build semantic graph differences:
   - added entities and edges
   - updated entities and edges
   - removed entities and edges
6. Persist the latest valid graph snapshot.
7. Send patches to an open tldraw document when the verified bridge supports it.
8. Fall back to safe local document update when the app is closed.
9. Prevent generated writes from retriggering builds.
10. Recover from parser or renderer failures without deleting valid output.
11. Rebuild from repository state after watcher restart.
12. Stop cleanly on termination signals.

## Update Rules

- Use a configurable debounce, initially around 750 milliseconds.
- Never run two graph builds concurrently.
- Keep the latest queued rebuild request.
- Compare the final incremental result with a full rebuild in tests.
- Do not claim real-time open-document updates unless verified against the installed app.
- Keep bridge-specific behavior behind an adapter.

## Deliverables

- `graph:build` implementation
- `graph:watch` implementation
- deterministic graph diff
- tldraw bridge adapter
- cache and latest-valid snapshot behavior
- watcher diagnostics
- recovery tests

## Acceptance Criteria

- One source save produces one settled update.
- Generated writes do not create a new build loop.
- Rapid saves are serialized.
- A parser error leaves the previous graph and tldraw document intact.
- Restarting the watcher rebuilds current repository state.
- Imports, modules, tables, and semantic-flow changes update the graph.
- App-open and app-closed behavior is explicit and tested where supported.
- Watch mode stops cleanly.

## Validation

- temporary-directory watcher tests
- rapid multi-save test
- add, modify, rename, and delete tests
- recursive-loop test
- parser-failure recovery test
- renderer-failure recovery test
- app-open and app-closed bridge tests where supported
- full rebuild compared with accumulated incremental result

## Handoff

Provide W08 with:

- exact operational commands
- supported watch behavior
- recovery procedure
- known bridge limitations
- diagnostic messages
- performance observations

## Non-Goals

- parser implementation
- visual design
- production runtime integration
