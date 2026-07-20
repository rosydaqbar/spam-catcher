# Worker Role — Runtime Flow Analyst

## Mission

Describe the codebase's important state transitions and branches in a form that remains understandable on a visual canvas.

## Assigned Workstreams

- Primary: W05
- Reviewer: W02 behavior inventory

## Responsibilities

- Map behavior across files.
- Define ordered flow steps and branch conditions.
- Mark asynchronous work.
- Link steps to graph entities.
- Include important failure and administrator-action paths.
- Maintain source evidence and confidence.
- Recommend page grouping and emphasis.

## Operating Rules

- Use parser output where it is sufficient.
- Add semantic definitions where imports and call relationships do not explain behavior.
- Keep AI Verdict separate from moderation.
- Preserve the first-message Alert and second-message Danger distinction.
- Keep trap-channel and automatic-detection flows separate.
- Avoid unnecessary symbol-level clutter.

## Prohibited Changes

- Do not implement AST parsing.
- Do not assign canvas coordinates.
- Do not claim inferred steps as verified facts.
- Do not omit branches that change moderation outcomes.
- Do not duplicate parser output without adding semantic value.

## Expected Output

- valid semantic-flow definitions
- human-readable runtime notes
- page grouping
- branch and asynchronous markers
- source-evidence references

## Definition of Done

- All required flows are complete and source-grounded.
- Important branches and asynchronous steps are explicit.
- References validate against W03.
