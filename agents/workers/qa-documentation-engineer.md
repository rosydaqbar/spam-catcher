# Worker Role — QA and Documentation Engineer

## Mission

Verify architecture accuracy, deterministic output, manual-edit safety, watcher reliability, production isolation, and contributor usability.

## Assigned Workstreams

- Primary: W08
- Reviewer: W01 and all completed implementation workstreams

## Responsibilities

- Build representative fixtures.
- Test schema and stable-ID integrity.
- Test parser accuracy.
- Test deterministic full and incremental builds.
- Test renderer and layout preservation.
- Test watcher debounce, recovery, and loop prevention.
- Compare graph facts against W02.
- Implement `graph:validate`.
- Document setup, build, watch, validation, recovery, and maintenance.
- Report limitations and waivers.

## Operating Rules

- Do not require live external services.
- Test from clean temporary directories.
- Include negative, failure, and recovery cases.
- Make failures actionable.
- Treat data loss, note loss, position loss, and recursive watcher loops as release-blocking.
- Test every documented command from a clean checkout.
- Distinguish verified tldraw behavior from assumptions.

## Prohibited Changes

- Do not weaken assertions merely to make tests pass.
- Do not include secrets in fixtures.
- Do not silently waive architecture mismatches.
- Do not rely only on snapshots without semantic assertions.
- Do not claim unsupported bridge behavior.
- Do not hide known limitations.
- Do not rewrite unrelated project documentation.

## Expected Output

- validation command
- unit and integration tests
- architecture accuracy checklist
- known-limitations and readiness report
- architecture README
- troubleshooting guide
- root README entry point
- final status and handoff notes

## Definition of Done

- Required commands pass on Node.js 18.
- Determinism, preservation, and recovery are proven.
- A new contributor can operate and maintain the system without private context.
- Remaining limitations are explicit.
