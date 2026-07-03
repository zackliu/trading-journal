# Agent Operating Guide

This repository is the design and future implementation workspace for **Trading Journal (Option B)** — a purpose-built app for capturing annotated trading-chart reviews and classifying them with a flexible, many-to-many tag model. It replaces a PowerPoint-based journaling workflow where the same annotated chart had to be physically copied into every category it belonged to.

## Source of Truth

- Treat `trading-journal-brief-ch.md` as the current product boundary, domain model, and thesis.
- The user's existing PowerPoint journal is design *input only*. Do not assume the app must replicate PowerPoint's full drawing surface. Replicate the workflow the user actually performs: paste a chart screenshot, annotate it, tag any annotation (or the whole chart) with values from user-defined groups, and later retrieve by any tag combination.
- Tool comparisons (PowerPoint add-in / Obsidian+Excalidraw / custom web app) are background context. Only what the brief states is settled.

## How to Work in This Repo

- Treat product / model / UX design discussion as design work, **not** as permission to change implementation. During design discussion, clarify the domain model, tradeoffs, terminology, and target-state docs first. Do not create app source, build config, or tests until the user explicitly asks to implement, or the design has clearly converged into an implementation slice.
- For domain decisions (Entry, Annotation, groups/tags, view rendering), use the `trading-journal-domain` skill.
- For tag and group naming conventions, use the `tagging-conventions` skill. Which groups exist and what values each holds is user-defined domain vocabulary, not part of any skill.
- For product architecture or MVP scope review, use the `product-design-review` skill.
- For future implementation work, use the `implementation-planning` skill to split changes into small, reviewable slices. The current slice plan lives in `specs/implementation-plan-ch.md`.
- Record implementation status as an **实现状态** note inside each slice's section in `specs/implementation-plan-ch.md`, not here — what each slice/iteration builds; the toolchain, verified commands, and tech decisions live in the Slice 0 note. Keep `AGENTS.md` limited to general, durable guidance (source-of-truth, how-to-work, product invariants, code guidelines); do not let iteration detail accumulate in it.
- Write specs as finished target-state documents. When discussion changes the design, rewrite the affected sections into their final form instead of appending revision notes, addenda, or "based on the latest discussion" paragraphs.
- Prefer precise edits to the smallest coherent set of files. If a design change affects multiple docs, update all of them or explicitly say why one is intentionally left alone.

## Product Invariants

- **Three separate things.** The annotated review artifact, its classification tags, and the source chart are distinct. Never conflate "which category a review belongs to" with "where the drawing physically lives."
- **Entry is the durable artifact.** An Entry = a review **page** (a white canvas of a stored size) + one or more **screenshots** (as movable/stackable image objects) + annotations + entry-level tags. It is stored exactly once and never duplicated to appear in a second category. `Entry.image` is now an optional **cover hash** used only for the list thumbnail; the page composition (screenshots + annotations) lives in `canvas_json`.
- **No special annotation type.** Any annotation (box, text box, arrow, …) can carry tags from any group. Tagging an entry-point box with a setup tag is just one case; tagging a text box with an intraday-structure tag is another — same mechanism. "The tagged element is briefly highlighted when you browse that tag" is general behavior; setup is not special.
- **Notes are taggable text-box annotations.** A note is a text-box annotation whose text is the note and which can itself carry tags. There is no separate note field.
- **Classification is grouped tags, not folders.** A "section" is a saved query over tags, not a physical container. A tag is `group:value`; tags attach at Entry level or annotation level; annotation-level tags decide which element is highlighted; `date` is the one structural, always-present group.
- **Outcome is a typed annotation result, not a tag.** A trade's outcome is an optional, multi-dimensional, typed `result` on an annotation (each dimension a `string` or a `number`; dimensions are user-defined). It exists only for statistics, never enters the browse navigation or the highlight transform, and must not be modeled as an `outcome` group/tag.
- **User owns the vocabulary and reusable components.** Which groups exist, their values, and which reusable stamps exist are all user-defined/user-designed. The app ships the mechanism (grouped tags, drawing primitives, a stamp library), never a fixed default catalog. Names in these docs are illustrative examples, not built-in defaults.
- **One Entry, many views, zero copies.** The same Entry renders under any group/tag browse without a second stored copy. Daily Review is just browsing the `date` group.
- **Highlight is a non-destructive render transform.** Browsing a tag briefly highlights the annotations carrying it (no viewport fit, no persistent dimming) — computed at render time from the active tag and annotation bounds, never persisted.
- **V1 annotates static chart screenshots on a page.** The white page is the review surface; screenshots are image objects on it (paste/stack/resize/reorder), referenced in `canvas_json` by `tj-image://<hash>` (bytes live in `images/<hash>`, never base64 in JSON). Annotation and object geometry is stored in page-pixel coordinates. Do not bind annotations to price/time axes until a live/replayable chart source is an explicit product goal.
- **Scope guard.** Do not turn the app into a charting platform, a broker/execution tool, a live-market-data feed, a backtesting engine, or a general-purpose drawing tool.

## Future Code Guidelines

- Do not start implementation from an unresolved design conversation. Confirm the design decision or implementation slice first, then edit code.
- Define stable data-model contracts before UI: `Entry`, `Annotation`, `Tag` (`group:value`), the annotation-level typed `Result` (string/number dimensions, stats-only), `SavedView`/query. Keep them typed and schema-checked, not ad hoc strings.
- Before placing any module, decide its ownership boundary first: **Ingest** (screenshot import), **Entry store** (durable persistence), **Annotation-Tag index** (denormalized annotations + tags + typed results for querying), **Tag & query engine** (group/tag parsing, boolean tag queries, counts, result statistics), **Canvas/annotation layer** (drawing + shapes with attached tags/results/links), or **Render/view layer** (browse by group/tag; brief-highlight transform). A module that reads/writes Entry, Annotation, Tag, Result, or SavedView state belongs to one of these boundaries, not scattered across the UI.
- Never satisfy a view by duplicating an artifact. A view is a query plus a render mode.
- Keep highlight/browse state out of persistence. It is derived from the active tag and the annotation bounds.
- Prefer structured payloads, typed groups, and schemas over free-form tag strings. A tag is `group:value` with a stable, kebab-cased value.
- Avoid hidden special cases that encode a desired net effect. A category is not a hardcoded branch; it is a tag value matched by the query engine.
- The app is pre-release with no external users or stored data to preserve: do not write any compatibility-purpose code — fallback branches, compatibility shims, legacy layers, dual behavior paths, or "just in case" handling — unless the user explicitly asks for a migration/compatibility plan. When the model changes, change the model and its callers/tests outright; disposable local dev data may simply be deleted.
- Fix at the root cause, never a symptom or an opportunistic workaround. When something misbehaves, debug in this order — is the domain model wrong, is the implementation violating the model, or is an explicit domain validation missing — and fix that cause. Do not special-case to force a green result, loosen or delete a test to make it pass, hardcode an expected value, or add sleeps/retries to hide a race; if the proper fix is large or unclear, surface it instead of hacking around it.
- Tests must assert domain behavior and public contracts: an annotation tagged `group:<value>` appears in that tag query; an Entry appears under any browsed tag without a second stored row; highlight geometry is derived, not stored. Do not assert source-code shape.

## Implementation Status

Each slice's implementation status lives as an **实现状态** note inside that slice's section in `specs/implementation-plan-ch.md` (the toolchain, tech decisions, and verified commands are in the Slice 0 note). Record what each iteration builds there — keep this file limited to general, durable guidance and do not let iteration detail accumulate here.
