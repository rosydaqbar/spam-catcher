# Architecture Graph Workstream Status

Update this file whenever a workstream starts, becomes blocked, changes ownership, enters review, or completes.

## Status Legend

- `not-started`
- `in-progress`
- `blocked`
- `review`
- `complete`
- `waived`

## Workstreams

| ID | Status | Owner | Dependencies satisfied | Reviewed | Notes |
|---|---|---|---|---|---|
| W01 | not-started | Coordinator | N/A | No | |
| W02 | not-started | Repository Analyst | No | No | |
| W03 | not-started | Graph Model Engineer | No | No | |
| W04 | not-started | Static Analysis Engineer | No | No | |
| W05 | not-started | Runtime Flow Analyst | No | No | |
| W06 | not-started | tldraw Engineer | No | No | |
| W07 | not-started | Live Update Engineer | No | No | |
| W08 | not-started | QA and Documentation Engineer | No | No | |

## Shared Contracts

| Contract | Decision | Owner | Date |
|---|---|---|---|
| Tool directory | `tools/codegraph/` | Coordinator | Pending |
| Generated state directory | `.codegraph/` | Coordinator | Pending |
| tldraw document | `docs/architecture/spam-catcher-architecture.tldraw` | Coordinator | Pending |
| Graph schema version | Pending | Graph Model Engineer | Pending |
| Stable-ID format | Pending | Graph Model Engineer | Pending |
| tldraw bridge mechanism | Pending installed-app verification | tldraw Engineer | Pending |
| Removed-node retention | Pending | tldraw Engineer | Pending |

## Active File Locks

| Path | Worker | Workstream | Started | Notes |
|---|---|---|---|---|
| None | | | | |

## Blockers

| Workstream | Blocker | Owner | Resolution needed |
|---|---|---|---|
| None | | | |

## Handoffs

### W01 → W02/W03

Pending.

### W02 → W03/W05/W06

Pending.

### W03 → W04/W05/W06

Pending.

### W04/W06 → W07

Pending.

### W01–W07 → W08

Pending.

## Decision Log

Record decisions that affect more than one workstream.

| Date | Decision | Reason | Affected workstreams |
|---|---|---|---|
| Pending | | | |
