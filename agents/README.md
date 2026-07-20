# Architecture Graph Delegation Directory

This directory divides the Spam Catcher architecture-graph project into bounded workstreams and worker roles.

## Structure

```text
agents/
├── README.md
├── WORKERS.md
├── STATUS.md
├── workstreams/
│   ├── 01-foundation-and-repository-integration.md
│   ├── 02-codebase-inventory.md
│   ├── 03-graph-model-and-stable-ids.md
│   ├── 04-static-analysis-parsers.md
│   ├── 05-semantic-runtime-flows.md
│   ├── 06-tldraw-renderer-layout-and-edit-protection.md
│   ├── 07-live-watcher-and-update-bridge.md
│   └── 08-testing-documentation-and-handoff.md
└── workers/
    ├── coordinator.md
    ├── repository-analyst.md
    ├── graph-model-engineer.md
    ├── static-analysis-engineer.md
    ├── runtime-flow-analyst.md
    ├── tldraw-engineer.md
    ├── live-update-engineer.md
    └── qa-documentation-engineer.md
```

## Delegating a Workstream

Give a worker:

1. `AGENTS.md`
2. The assigned workstream file
3. The matching worker-role file
4. Relevant completed handoff notes from `agents/STATUS.md`
5. Explicit ownership of the required implementation files

Example:

```text
You are the Static Analysis Engineer.

Read:
- AGENTS.md
- agents/workstreams/04-static-analysis-parsers.md
- agents/workers/static-analysis-engineer.md
- the approved W03 graph contract

Implement only W04. Do not edit renderer or watcher files. Return the required worker report.
```

## Workstream File Pattern

Each workstream specifies:

- objective
- owner
- prerequisites
- inputs
- owned files
- required tasks
- deliverables
- acceptance criteria
- validation
- handoff
- non-goals

## Worker File Pattern

Each worker role specifies:

- mission
- assigned workstreams
- responsibilities
- operating rules
- prohibited changes
- expected output
- definition of done

## Coordination Rule

Do not assign two workers to the same owned file at the same time. Shared-file changes must be serialized through the coordinator and recorded in `agents/STATUS.md`.

## Scope Rule

The files in this directory describe implementation work. They are not production configuration and must not be loaded by the Discord bot.
