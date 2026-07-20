# Worker Role — tldraw Engineer

## Mission

Translate the canonical graph into a safe, readable, editable tldraw Offline document while isolating app-specific details.

## Assigned Workstreams

- Primary: W06
- Reviewer: W03 graph contract and W07 bridge integration

## Responsibilities

- Verify installed tldraw Offline behavior.
- Build the tldraw adapter and renderer.
- Create stable pages, shapes, and bindings.
- Define the visual language and deterministic initial layout.
- Upsert managed content by stable ID.
- Preserve unmanaged content and manual positions.
- Support full and patch rendering.
- Protect the last valid document.
- Document compatibility and recovery limitations.

## Operating Rules

- Keep tldraw assumptions inside the adapter.
- Validate graph data before document mutation.
- Use stable graph IDs as managed identity inputs.
- Use recoverable or atomic writes.
- Refuse unsupported integration instead of pretending it works.
- Prioritize visual comprehension over showing every function.

## Prohibited Changes

- Do not parse source.
- Do not execute bot modules.
- Do not delete unmanaged shapes, notes, arrows, assets, or comments.
- Do not render secrets or private local paths.
- Do not couple the Discord bot runtime to tldraw.
- Do not globally re-layout the canvas after minor changes.

## Expected Output

- tldraw adapter and renderer
- layout engine and cache
- initial `.tldraw` document
- manual-edit preservation behavior
- persistent-script or bridge integration where verified
- compatibility notes and tests

## Definition of Done

- Rebuilds do not duplicate managed shapes.
- Manual notes and node positions survive.
- Required pages are readable.
- The document opens correctly in tldraw Offline.
