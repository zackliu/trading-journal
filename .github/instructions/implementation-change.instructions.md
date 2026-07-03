---
description: "Use when adding or modifying Trading Journal implementation code: data model, ingest, entry store, annotation-tag index, tag/query engine, canvas/annotation layer, view/render layer, or tests."
applyTo: "src/**,app/**,packages/**,**/*.ts,**/*.tsx,**/*.js,**/*.jsx,**/*.css,tests/**"
---
# Implementation Change Guidelines

- Do not treat design discussion as an implementation request. If the user is still deciding the model, tag scheme, UX, or tech stack, stay in design/spec mode. Edit code only after the user explicitly asks to implement, or the design has converged into a clear slice.
- Start from the data-model contract. Identify whether the change belongs to Ingest, Entry Store, Annotation-Tag Index, Tag & Query Engine, Canvas/annotation, Render/view, or tests.
- Define types and schema before UI: `Entry`, `Annotation`, `Tag` (`group:value`), the annotation-level typed `Result` (string/number dimensions), `SavedView`, image-asset ref. UI reads/writes contracts; it does not invent storage shape.
- Keep the artifact stored once. Never duplicate an Entry to make it appear in a second category or a second view. A view is a query plus a render mode.
- Any annotation can carry tags; there is no special marker type. A tagged annotation is a shape with attached tags/links, not a separate store.
- Keep tags placed at the right level: annotation-level tags (e.g. setup) on annotations, entry-level tags on entries; annotation-level tags decide which element is highlighted; `date` is the one structural group. Which groups exist is user-defined — do not hardcode a fixed set. Do not store the same fact twice, and do not fuse two groups into one value. A trade's outcome is not a tag: it is an annotation-level, optional, typed `result` (string/number dimensions) used only for statistics, never a browsable `outcome` group.
- Keep the Annotation-Tag Index in sync with the Entry Store; run tag queries and statistics against the index, not raw canvas JSON.
- Keep highlight/browse state derived from the active tag at render time (brief highlight; no viewport fit, no dim). Do not persist it.
- Do not encode a category as a branch. It is a tag value matched generically by the query engine.
- Keep V1 annotation geometry in image-pixel coordinates on static screenshots. Do not bind to price/time axes.
- The app is pre-release: there is no external user or stored data to stay compatible with. Do not write any compatibility-purpose code — no fallback branches, compatibility shims, legacy layers, dual behavior paths, or "just in case" handling — unless the user explicitly asks for a migration/compatibility plan. When the model changes, change the model, its callers, and its tests outright; disposable local dev data may simply be deleted.
- Fix at the root cause, never a symptom, and never with an opportunistic workaround. Investigate in this order — domain-model flaw, implementation flaw, missing explicit domain validation — and fix that cause; add a branch only when the domain rule requires it. Do not add a special case just to get a green result, loosen or delete a test to make it pass, hardcode an expected value, or add sleeps/retries to paper over a race. If the correct fix is large or unclear, say so instead of shipping a hack.
- Prefer failing fast with a clear error over silently recovering into a state that hides a broken contract.
- Add tests at the boundary touched by the change. Tests must assert domain behavior: query membership (an annotation tagged `group:<value>` appears in that query), one-artifact-many-views (an Entry appears under any browsed tag with no second row), derived highlight, and result statistics (typed `result` aggregated over a tag-filtered population). Do not assert canvas serialization shape or private helper structure.
- Update `AGENTS.md` with any newly verified bootstrap, build, test, lint, or run commands, and record the chosen canvas library and storage form once decided.
