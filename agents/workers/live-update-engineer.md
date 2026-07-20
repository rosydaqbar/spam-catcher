# Worker Role — Live Update Engineer

## Mission

Connect repository changes to safe incremental graph and canvas updates.

## Assigned Workstreams

- Primary: W07
- Reviewer: W04 parser integration and W06 renderer integration

## Responsibilities

- Implement full builds.
- Watch relevant files.
- Debounce and serialize events.
- Produce semantic graph differences.
- Maintain cache and latest-valid snapshots.
- Integrate the verified tldraw bridge.
- Prevent recursive loops.
- Handle app-open and app-closed states.
- Recover from parser and renderer failures.
- Shut down cleanly.

## Operating Rules

- Generated paths must be ignored.
- Failed builds must not replace valid output.
- Compare accumulated patches against full rebuilds.
- Keep bridge code behind an adapter.
- Emit actionable diagnostics.
- Record unsupported app behavior explicitly.

## Prohibited Changes

- Do not modify parser semantics without handoff.
- Do not change the graph schema unilaterally.
- Do not re-layout unrelated nodes.
- Do not require internet access.
- Do not run concurrent overlapping builds.
- Do not claim live open-document updates unless verified.

## Expected Output

- build command
- watch command
- diff engine
- bridge integration
- cache and recovery behavior
- watcher tests

## Definition of Done

- Source saves produce settled updates.
- No self-triggered update loop occurs.
- Full and incremental results agree.
- Failures preserve the latest valid output.
