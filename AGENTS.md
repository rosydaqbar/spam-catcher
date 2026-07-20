# Spam Catcher Architecture Graph Agent Guide

## Purpose

Coordinate the implementation of an automatically updated architecture graph for Spam Catcher using tldraw Offline.

The graph tooling is a development aid. It must remain isolated from the Discord bot production runtime.

## Required Outcome

The completed system must:

1. Analyze the repository without executing application code.
2. Generate a normalized architecture graph with stable entity IDs.
3. Render the graph into `docs/architecture/spam-catcher-architecture.tldraw`.
4. Update the graph after relevant source files change.
5. Preserve manually moved generated nodes and all unmanaged notes.
6. Explain module dependencies, runtime flows, PostgreSQL tables, Discord interactions, and AI-provider boundaries.
7. Provide deterministic build, watch, and validation commands.

## Repository Context

Spam Catcher is a Node.js 18+ Discord bot using CommonJS, `discord.js`, and PostgreSQL.

Important runtime areas:

- `src/index.js`: startup, shutdown, and Discord event routing.
- `src/config-store.js`: PostgreSQL access and persistence.
- `src/bot/spam-catcher.js`: trap-channel enforcement.
- `src/bot/automatic-spam-detection.js`: attachment detection and AI Verdict orchestration.
- `src/bot/moderation-workflow.js`: shared DMs, appeals, and review updates.
- `src/bot/ai-vision-checker.js`: OpenRouter and Gemini image analysis.
- `src/bot/setup-command.js`: guild setup and configuration UI.
- `src/bot/super-admin-command.js`: owner-level maintenance controls.

## Source of Truth

Before changing code, read:

1. `AGENTS.md`
2. `agents/README.md`
3. `agents/WORKERS.md`
4. `agents/STATUS.md`
5. The assigned file in `agents/workstreams/`
6. The matching file in `agents/workers/`
7. Existing implementation files owned by the task

A workstream file defines scope and acceptance criteria. A worker file defines how the role operates. When instructions conflict, priority is:

1. `AGENTS.md`
2. Assigned workstream file
3. Assigned worker file
4. Existing implementation notes

## Workstreams

| ID | Workstream | Primary worker | Depends on |
|---|---|---|---|
| W01 | Foundation and repository integration | Coordinator | None |
| W02 | Codebase inventory | Repository Analyst | W01 |
| W03 | Graph model and stable IDs | Graph Model Engineer | W02 |
| W04 | Static-analysis parsers | Static Analysis Engineer | W03 |
| W05 | Semantic runtime flows | Runtime Flow Analyst | W02, W03 |
| W06 | tldraw renderer, layout, and edit protection | tldraw Engineer | W03, W05 |
| W07 | Live watcher and update bridge | Live Update Engineer | W04, W06 |
| W08 | Testing, validation, documentation, and handoff | QA and Documentation Engineer | W01–W07 |

Detailed specifications are stored in `agents/workstreams/`.

## Delegation Order

### Stage A: Contracts

Run sequentially:

1. W01
2. W02
3. W03

Do not begin parser, renderer, or watcher implementation before the graph contract and stable-ID rules are approved.

### Stage B: Parallel implementation

After W03, W04 and W05 may run in parallel when file ownership does not overlap.

### Stage C: Canvas integration

Run W06 after W03 and the required W05 flow definitions are available.

### Stage D: Live updates

Run W07 after W04 and W06 expose stable integration APIs.

### Stage E: Verification and handoff

Run W08 after W01–W07 are complete or explicitly waived.

## Coordinator Responsibilities

The coordinator must:

- assign one owner to every active workstream
- prevent concurrent edits to the same file
- verify prerequisites before delegation
- keep `agents/STATUS.md` current
- record shared contract decisions
- require every worker to report changed files, commands, validation, risks, and handoff notes
- reject undocumented schema or API changes
- run final integration checks

The coordinator should delegate specialized implementation instead of completing all work personally.

## Shared Paths

Use these paths unless W01 records a justified change:

```text
tools/codegraph/
docs/architecture/
.codegraph/
```

Expected generated artifacts:

```text
.codegraph/graph.json
.codegraph/layout.json
.codegraph/cache.json
docs/architecture/spam-catcher-architecture.tldraw
```

## Required Package Scripts

The final implementation must expose:

```text
npm run graph:build
npm run graph:watch
npm run graph:validate
```

## Stable ID Contract

Generated entities must use deterministic semantic IDs.

Examples:

```text
module:src/bot/spam-catcher.js
function:src/bot/spam-catcher.js:handleMessage
table:spam_catcher_events
external:discord
flow:automatic-detection
edge:module:src/index.js->module:src/bot/spam-catcher.js:imports
```

Never use random IDs, array indexes, creation order, or line numbers alone as persistent identity.

## Managed Shape Contract

Every generated tldraw shape must include metadata equivalent to:

```json
{
  "managedBy": "spam-catcher-codegraph",
  "entityId": "module:src/index.js",
  "entityType": "module",
  "sourceHash": "..."
}
```

Unmanaged shapes, notes, arrows, assets, and comments must never be deleted or rewritten by automation.

## Update Behavior

- Reparse changed files only where practical.
- Recalculate affected relationships.
- Upsert generated shapes by stable ID.
- Preserve manual positions.
- Place new nodes near related nodes.
- Mark removed entities before permanent cleanup.
- Never re-layout the whole document for a one-file change unless the user explicitly resets generated layout.
- Preserve the last valid graph and tldraw document after a failed build.

## File Ownership

Each workstream lists owned paths. Workers may read any repository file but may only modify owned paths unless the coordinator records an explicit handoff.

Shared files require serialized edits:

- `package.json`
- `.gitignore`
- `AGENTS.md`
- `agents/STATUS.md`
- graph schema files
- the generated `.tldraw` document

## Implementation Rules

- Keep graph tooling outside `src/`.
- Do not import or execute bot modules during analysis.
- Parse source as text or AST.
- Keep generated JSON deterministic and reviewable.
- Prefer explicit schemas over undocumented object shapes.
- Preserve Node.js 18 compatibility.
- Avoid network requirements for normal graph builds.
- Verify tldraw Offline scripting and file behavior against the installed application before relying on it.
- Do not expose tokens, database URLs, webhook URLs, Discord IDs, or private local paths.
- Treat AI Verdict as asynchronous evidence enrichment, never as the moderation trigger.
- Keep trap-channel enforcement and automatic attachment detection visually distinct.

## Minimum Testing

Verify at least:

- existing `npm run check` still passes
- `npm run graph:build` succeeds from a clean checkout
- two consecutive builds are semantically identical
- a changed import updates the corresponding edge
- a new module creates one stable node
- a deleted module is handled without document corruption
- unmanaged notes survive regeneration
- a manually moved generated node keeps its position
- watcher ignores generated output and avoids recursive loops
- `npm run graph:validate` reports duplicate IDs and broken references

## Worker Report Format

Every worker must return:

```text
Workstream:
Status: complete | blocked | partial

Changed files:
- path

Commands run:
- command

Validation:
- result

Decisions:
- decision and reason

Risks or unresolved items:
- item

Handoff:
- what the next worker must know
```

A worker may not claim completion without validation evidence.

## Blocking Conditions

Stop and report to the coordinator when:

- installed tldraw Offline behavior differs from the planned integration
- a schema change would invalidate another active workstream
- a required relationship cannot be inferred reliably
- source code would need to be executed to obtain metadata
- a dependency breaks Node.js 18 support
- generated updates overwrite manual canvas content
- watcher changes create recursive file-update loops

## Definition of Done

The project is complete only when:

- all workstreams in `agents/STATUS.md` are complete or explicitly waived
- acceptance criteria in W01–W08 are satisfied
- the graph is understandable without reading source code first
- major runtime flows and PostgreSQL boundaries are accurate
- the tldraw file can be reopened with the latest generated state
- manual canvas edits are preserved
- setup, build, watch, validation, troubleshooting, and maintenance are documented
