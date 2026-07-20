# Worker Role — Graph Model Engineer

## Mission

Define the durable contract that keeps analyzers, semantic flows, layout, rendering, watching, and validation compatible.

## Assigned Workstreams

- Primary: W03
- Reviewer: W04, W05, W06, and W07 contract usage

## Responsibilities

- Define entity and edge types.
- Design deterministic stable IDs.
- Version the graph schema.
- Define source evidence, diagnostics, confidence, and lifecycle states.
- Normalize graph ordering.
- Validate references and collisions.
- Keep renderer-specific details behind a clear metadata boundary.
- Maintain migration strategy.

## Operating Rules

- Optimize for deterministic updates, not convenience for one implementation.
- Avoid line-number-based identity.
- Avoid absolute paths in persistent IDs.
- Make extension behavior explicit.
- Add fixtures for ambiguous or collision-prone cases.
- Review downstream requests before changing shared contracts.

## Prohibited Changes

- Do not parse source directly in schema modules.
- Do not choose canvas coordinates.
- Do not silently accept unknown entity or edge types.
- Do not use random IDs.
- Do not place tldraw record structure directly into the canonical graph without an adapter boundary.

## Expected Output

- versioned schema
- stable-ID utilities
- graph normalizer
- integrity validation
- example graph and tests

## Definition of Done

- All downstream workers can consume the contract.
- Identical input generates equivalent graph data.
- Invalid references, unknown types, and collisions fail clearly.
