---
name: implementation-planning
description: "Use when turning the Trading Journal design into code work: decomposing features, planning implementation slices, defining data-model contracts (Entry, Annotation, Tag, Result, SavedView), mapping tests, or preparing a low-risk coding task."
argument-hint: "feature or design to implement"
---
# Implementation Planning

Use this skill before writing non-trivial code, especially for the data model, tag/query engine, annotation-tag index, canvas annotations, or browse-by-group/tag views.

## Procedure

1. Link the implementation to a section of `trading-journal-brief-ch.md`.
2. Map affected boundaries: Ingest, Entry Store, Annotation-Tag Index, Tag & Query Engine, Canvas/annotation, Render/view, docs, tests.
3. Establish the root-cause stance: fix the underlying cause, never a symptom or an opportunistic workaround — domain-model flaw first, implementation flaw second, missing explicit validation third.
4. Identify existing patterns and reusable helpers before creating new abstractions.
5. Define the contract first: `Entry`, `Annotation`, `Tag` (`group:value`), the annotation-level typed `Result` (string/number dimensions), `SavedView`/query, image-asset ref — types and schema before UI.
6. Define the smallest coherent slice that can be reviewed independently.
7. Define validation before editing: domain-behavior tests, then build/lint/run.
8. Implement one slice, validate it, then record verified commands in `AGENTS.md`.
9. Retire scaffolding the slice replaces: placeholder screens, stub stores, demo half-paths, stale field names.

## Suggested Slice Order (MVP)

1. **Data-model contracts** — `Entry`, `Annotation`, `Tag` (`group:value`), the annotation-level typed `Result`, `SavedView`. Pure types + schema + persistence shape. No UI.
2. **Ingest** — paste/import a screenshot, create an Entry, store the image asset by hash.
3. **Canvas annotate** — base primitives (rect, line, arrow, hline, text, freehand) + a user-defined stamp library (users design/save their own; no fixed default set); serialize onto the Entry.
4. **Annotation tagging, result & inspector** — attach group tags to any annotation (e.g. setup) and set an optional typed `result` (user-defined string/number dimensions, stats-only, not browsable); notes are taggable text-box annotations; annotation links; keep the Annotation-Tag Index (tags + result) in sync.
5. **Entry tags** — user-defined entry-level group tags; `date` is structural.
6. **Tag & query engine** — boolean tag queries, live per-tag counts, saved views.
7. **Browse by group/tag** — two-level collapsible nav (group → tag) → vertical thumbnails → full chart; brief-highlight the annotations carrying the browsed tag (no viewport fit, no dim).
8. **Statistics** — slice by a boolean tag query, then aggregate annotations' typed `result` (counts/ratios for string dimensions; averages and threshold hit-rates for number dimensions), optionally grouped by classification tags, from the Annotation-Tag Index.

The canvas library and storage form are decided (Fabric.js + Electron + SQLite; see the brief's 技术决策 section).

## Slice Rules

- Keep each slice focused on one durable behavior or contract.
- Define types and schema before UI. UI reads/writes contracts, it does not invent storage shape.
- Never satisfy a view by duplicating an artifact. A view is a query plus a render mode.
- Keep highlight/browse state derived, never persisted.
- Keep annotation-level tags off the Entry and entry-level tags off annotations; do not store the same fact twice.
- Read tag queries and statistics from the Annotation-Tag Index, not raw canvas JSON.
- Do not add fallback code, compatibility shims, or dual behavior paths unless a migration is explicitly requested.
- Do not encode a category as a branch; it is a tag value matched generically by the query engine.
- Plan tests from domain behavior (query membership, view rendering, statistics), not canvas serialization shape.
- For large changes, propose a sequence of slices rather than one massive diff.

## Output Format

```markdown
## Implementation Plan
- Source design section:
- Root-cause stance:
- Affected boundaries:
- Proposed slices:
- First slice:
- Contract changes (Entry / Annotation / Tag / SavedView):
- Domain-behavior tests:
- Validation commands:
- Risks:
- Docs to update:
```
