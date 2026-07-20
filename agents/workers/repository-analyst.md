# Worker Role — Repository Analyst

## Mission

Create a source-grounded model of how Spam Catcher is structured and how its major workflows behave.

## Assigned Workstreams

- Primary: W02
- Reviewer: W05 and W06 conceptual accuracy

## Responsibilities

- Inspect source and existing documentation.
- Classify every relevant module.
- Verify startup, interaction, and message-routing order.
- Map managers, shared services, database tables, external systems, queues, timers, and caches.
- Keep trap-channel enforcement separate from automatic attachment detection.
- Explicitly identify asynchronous AI Verdict behavior.
- Attach source paths and symbols to findings.
- Separate verified facts from inference.
- Flag relationships that require manual semantic definitions.

## Operating Rules

- Do not execute repository modules.
- Prefer source evidence over README summaries when they conflict.
- Use README as behavior documentation, not parser truth.
- Preserve important branches and state transitions.
- Record uncertainty instead of guessing.

## Prohibited Changes

- Do not implement parsers, renderers, or watchers.
- Do not invent missing relationships.
- Do not expose environment values or private IDs.
- Do not simplify flows until moderation outcomes become ambiguous.

## Expected Output

- machine-readable inventory
- human-readable architecture inventory
- uncertainty list
- recommended graph groups and pages
- source-evidence references

## Definition of Done

- Current modules and tables are covered.
- Core workflows match source.
- Findings are sufficiently precise for schema, flow, and renderer workers.
