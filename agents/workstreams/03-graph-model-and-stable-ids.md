# W03 — Graph Model and Stable IDs

## Objective

Define the canonical, versioned graph contract used by analyzers, semantic flows, rendering, layout, watching, and validation.

## Owner

Graph Model Engineer

## Prerequisites

W02 complete.

## Inputs

- W02 repository inventory
- W01 path conventions
- renderer requirements supplied by the tldraw Engineer

## Owned Files

- `tools/codegraph/schema/graph-schema.json`
- `tools/codegraph/src/graph-model.mjs`
- `tools/codegraph/src/stable-id.mjs`
- `tools/codegraph/src/normalize-graph.mjs`
- graph-schema fixtures and tests

## Required Entity Types

At minimum:

- repository
- module
- function
- manager
- event
- command
- runtime-flow
- state
- database-table
- environment-variable
- external-system
- queue
- timer
- generated-page
- annotation-anchor

## Required Edge Types

At minimum:

- imports
- exports
- creates
- calls
- routes-to
- reads-from
- writes-to
- emits
- handles
- configures
- queues
- schedules
- enriches
- transitions-to
- excludes
- depends-on
- displays-in
- fallback-to

## Stable ID Requirements

IDs must:

- be deterministic across runs
- survive unrelated line movement
- avoid absolute local paths
- distinguish same-named functions in different modules
- encode relationship type for edges
- use consistent escaping
- support schema-version migration

## Required Graph Sections

```text
schemaVersion
generatedAt
repository
entities
edges
flows
sourceFiles
diagnostics
```

`generatedAt` must not cause deterministic semantic comparisons to fail.

## Required Tasks

1. Define versioned entity and edge schemas.
2. Define source-evidence and confidence fields.
3. Define stable IDs for every entity and edge category.
4. Define deterministic sorting and normalization.
5. Detect duplicate IDs and dangling references.
6. Represent inferred and manually defined relationships.
7. Represent newly added, changed, deprecated, and removed entities.
8. Define renderer metadata without coupling the canonical graph to tldraw internals.
9. Add migration rules for future schema versions.

## Deliverables

- versioned JSON schema
- stable-ID utility
- normalization utility
- duplicate-ID and reference-integrity validation
- example graph fixture representing the core Spam Catcher architecture
- schema tests

## Acceptance Criteria

- Identical input produces semantically identical output.
- Entity and edge order is deterministic.
- Duplicate IDs fail validation.
- Dangling edge references fail validation.
- Unknown entity and edge types fail unless extension rules permit them.
- Same-named functions in different files cannot collide.
- Every entity can include source evidence.
- Removed entities can be represented without immediate deletion.

## Validation

- Unit tests for every ID category.
- Collision tests for same-named functions.
- Snapshot test of the example graph.
- Validation tests for valid and invalid fixtures.

## Handoff

Provide W04, W05, W06, and W07 with:

- schema version
- entity and edge enums
- stable-ID functions
- normalized output rules
- extension policy
- diagnostics format
- removed-entity representation

## Non-Goals

- parsing JavaScript
- choosing tldraw coordinates
- watching files
