# Required Workers

This project uses eight specialized roles. One person or agent may fill multiple roles sequentially, but role boundaries and file ownership still apply.

| Worker | Primary responsibility | Main output |
|---|---|---|
| Coordinator | Sequencing, ownership, shared contracts, and integration | Approved structure, status ledger, final integration |
| Repository Analyst | Verified inventory of modules, flows, tables, and boundaries | Repository inventory and architecture notes |
| Graph Model Engineer | Canonical graph schema, entity types, edge types, and stable IDs | Graph contract and ID utilities |
| Static Analysis Engineer | JavaScript, package, environment, and SQL extraction | Deterministic analyzers |
| Runtime Flow Analyst | Human-readable behavior not explained by imports alone | Semantic runtime-flow definitions |
| tldraw Engineer | Document creation, rendering, layout, and manual-edit preservation | Renderer and `.tldraw` integration |
| Live Update Engineer | File watching, incremental rebuilds, and bridge behavior | Reliable build/watch/update pipeline |
| QA and Documentation Engineer | Validation, fixtures, regression tests, setup, and handoff | Test suite, validation command, and documentation |

## Assignment Matrix

| Workstream | Owner | Required reviewers |
|---|---|---|
| W01 Foundation | Coordinator | QA and Documentation Engineer |
| W02 Inventory | Repository Analyst | Runtime Flow Analyst |
| W03 Graph model | Graph Model Engineer | tldraw Engineer, QA and Documentation Engineer |
| W04 Parsers | Static Analysis Engineer | Graph Model Engineer, QA and Documentation Engineer |
| W05 Runtime flows | Runtime Flow Analyst | Repository Analyst, Graph Model Engineer |
| W06 Renderer and layout | tldraw Engineer | Graph Model Engineer, Repository Analyst |
| W07 Watcher and bridge | Live Update Engineer | Static Analysis Engineer, tldraw Engineer |
| W08 Testing and handoff | QA and Documentation Engineer | All implementation owners |

## Minimum Inputs for Every Worker

- repository state at assignment time
- `AGENTS.md`
- assigned workstream file
- matching worker-role file
- prerequisite deliverables
- explicit file ownership
- known risks and unresolved decisions

## Universal Rules

Every worker must:

- avoid executing repository code during analysis
- preserve production behavior
- keep graph tooling outside `src/`
- use stable IDs and deterministic output
- avoid leaking secrets or private local paths
- report status through the coordinator
- provide validation evidence
- document assumptions instead of hiding them
- stop when an unapproved shared-contract change is required

## Universal Completion Report

```text
Workstream:
Status:

Changed files:
-

Commands run:
-

Validation:
-

Decisions:
-

Risks:
-

Handoff:
-
```
