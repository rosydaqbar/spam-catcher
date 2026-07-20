# W06 — tldraw Renderer, Layout, and Edit Protection

## Objective

Create and update the local tldraw Offline architecture document from the canonical graph while preserving user-controlled canvas content.

## Owner

tldraw Engineer

## Prerequisites

W03 complete. Required W05 flow definitions available.

## Inputs

- graph schema and stable IDs
- example graph fixture
- semantic runtime flows
- W02 visual groups
- installed tldraw Offline behavior
- official tldraw scripting guidance

## Owned Files

- `tools/codegraph/src/render-tldraw.mjs`
- `tools/codegraph/src/tldraw-adapter.mjs`
- `tools/codegraph/src/layout-graph.mjs`
- `tools/codegraph/src/layout-cache.mjs`
- `tools/codegraph/layout/visual-rules.json`
- `tools/codegraph/tldraw/` scripts or templates
- `docs/architecture/spam-catcher-architecture.tldraw`
- renderer and layout fixtures and tests

## Required Pages

1. System Overview
2. Startup and Event Routing
3. Trap Channel Flow
4. Automatic Detection
5. AI Verdict
6. Appeals and Admin Actions
7. PostgreSQL Data Model

## Required Visual Distinctions

- external systems
- entry points and routers
- domain managers
- shared services
- database tables
- user and administrator actions
- background operations
- asynchronous relationships
- database reads and writes
- newly added, changed, and removed entities

## Required Tasks

1. Verify the installed tldraw Offline file and scripting interfaces before locking the adapter.
2. Map graph entities and edges to tldraw records.
3. Create stable pages, shapes, and bindings.
4. Upsert managed records by stable entity ID.
5. Attach managed-shape metadata.
6. Preserve unmanaged shapes, comments, arrows, and assets.
7. Preserve manually moved generated-node positions.
8. Create deterministic initial layout.
9. Place new nodes near their strongest related node.
10. Re-layout only affected groups by default.
11. Mark removed entities in a dedicated area before cleanup.
12. Support an explicit reset of generated layout only.
13. Support full graph input and incremental patch input.
14. Keep all tldraw-specific assumptions inside the adapter.
15. Write safely so a failure does not corrupt the last valid document.

## Managed Shape Rules

- Existing managed shapes update instead of duplicating.
- Unmanaged shapes never change automatically.
- Layout cache is keyed by stable entity ID.
- Manual node movement overrides generated coordinates until reset.
- Source labels favor responsibilities over large symbol dumps.
- Secret values are never rendered.

## Deliverables

- tldraw adapter
- renderer
- layout engine and cache
- visual rule set and legend
- manual-edit preservation policy
- initial architecture document
- compatibility notes for the verified app version
- renderer and layout tests

## Acceptance Criteria

- Opening the document shows all required pages.
- Rebuilding does not duplicate generated shapes.
- Unmanaged sticky notes survive regeneration.
- Manually moved generated nodes remain in place.
- One changed module does not move unrelated groups.
- New nodes are placed without normal-case overlap.
- Removed nodes are visibly distinguished.
- Invalid graph references fail before document mutation.
- The adapter contains all tldraw-specific assumptions.
- A renderer failure leaves the previous valid document recoverable.

## Validation

- Render the same fixture twice and compare managed IDs.
- Add an unmanaged note, rebuild, and confirm it remains.
- Move a generated node, rebuild, and confirm position remains.
- Change one entity label and confirm one shape updates.
- Add and remove nodes and inspect incremental placement.
- Test backup or atomic-write behavior.
- Open the result in tldraw Offline.

## Handoff

Provide W07 and W08 with:

- full-render API
- patch-render API
- managed-shape metadata contract
- layout-cache contract
- reset behavior
- removed-node behavior
- backup and recovery behavior
- verified bridge options and limitations

## Non-Goals

- source parsing
- filesystem watching
- production runtime integration
