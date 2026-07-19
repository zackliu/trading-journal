---
name: trading-journal-domain
description: "Use when designing or implementing Trading Journal (Option B) domain work: Entry artifacts, taggable annotations, grouped tags, saved-query views, browse-by-group/tag rendering, brief-highlight, screenshot ingest, or migration from the PowerPoint journal."
argument-hint: "design or implementation topic"
---
# Trading Journal Domain

Use this skill for domain decisions in this repo. Load `trading-journal-brief-ch.md` before making modeling claims.

## Domain Invariants

- **Artifact, tags, and source are three separate things.** Never conflate "which category a review belongs to" with "where the drawing physically lives" or with "the chart the screenshot came from."
- **Entry is the durable object; it is stored once.** An Entry = a fixed white review page + 0..n movable/stackable screenshot objects + annotations + entry-level tags. It is never duplicated to appear in a second category or a second view.
- **No special annotation type.** Any annotation (box, text box, arrow, group of shapes …) can carry tags from any group. A tagged entry-point box (setup tag) and a tagged text box (intraday-structure tag) are the same mechanism. "Browse a tag → briefly highlight the annotations carrying it" is general behavior; setup is not special and must not be special-cased.
- **Notes are taggable text-box annotations.** A note is a text-box annotation whose text is the note; it can itself carry tags. There is no separate note field.
- **Internal references are stable targets plus text hyperlinks.** Every journal has a persistent `journalId`; every Entry and annotation exposes an immutable-id internal address. Editable title/text-box character ranges may carry typed `TextLinkSpan`s to same-journal Entry or annotation targets; display text remains the underlying text. Public fields are `textLinks`; only Fabric JSON uses `tjTextLinks`. There is no annotation-to-annotation `links[]`, app-only link clipboard, or object-level Links popover.
- **Classification is grouped tags, not folders.** A tag is `group:value` with a stable kebab-case value. Tags attach at Entry level or annotation level. Which groups exist and what values each holds is user-defined; `date` is the one structural, always-present group.
- **A view is a query plus a render mode, never a copy.** Browsing any group/tag renders the same Entry differently. Daily Review is browsing the `date` group. No second stored artifact is created to satisfy a view.
- **Highlight is derived, not stored.** Browsing a tag briefly highlights the annotations carrying it (no viewport fit, no persistent dimming), computed from the active tag and annotation bounds at render time.
- **V1 geometry is page-pixel coordinates on a fixed white review page.** Screenshots are movable/stackable image objects on that page. Do not bind annotation geometry to screenshot pixels or price/time axes until a live/replayable chart source is an explicit goal.
- **Tag placement.** Annotation-level tags decide which element is highlighted when that tag is browsed; entry-level tags just include the whole chart (no highlight target). Never store the same fact on both the Entry and its annotations. A trade's outcome is not a tag/group: it is an annotation-level, optional, typed `result` (see below), never fused into a `setup` value or modeled as an `outcome` group.
- **Result is a typed annotation property, not a tag.** Any annotation may optionally carry a `result`: a multi-dimensional, typed record of what happened (each dimension's value is a `string` or a `number`; the dimensions are user-defined). It exists only for statistics and never enters the browse navigation (group→tag nav) or the highlight transform. A text-box note may have none; a trade/entry annotation may carry several dimensions (e.g. an R-multiple number plus a pullback-depth string). Do not model outcome as a browsable `outcome` group.

## Component Boundaries

Decide a module's ownership boundary before placing it.

### Ingest
Owns screenshot import (paste/file/drag), image asset storage, and Entry creation. Produces an Entry page with one or more hash-referenced screenshot objects; does not know about tags or views.

### Entry Store
Owns durable persistence of Entries: image ref, annotations (canvas serialization, including each annotation's tags and optional typed `result`), editable-text `textLinks`, entry-level tags, internal-link target resolution, and the text-link projection. Single source of truth for artifact content.

### Annotation-Tag Index
Owns a denormalized, queryable projection of every annotation and its tags and typed `result` measures (`annotationId`, `entryId`, geometry/bounds, tags, result dimensions/values) plus entry-level tags. Tag queries and result statistics read this index, not raw canvas JSON. Kept in sync with the Entry Store. Text hyperlinks use the Entry Store's separate structured projection and never enter classification or statistics.

### Tag & Query Engine
Owns group/tag parsing, boolean tag queries across entry-level and annotation-level tags, live per-tag counts, saved views, and result statistics: slice a population by a boolean tag query, then aggregate the annotations' typed `result` measures (counts/ratios for string dimensions; averages and threshold hit-rates for number dimensions), optionally grouped by one or more classification tags. A "section" is a saved query here, not a folder.

### Canvas / Annotation Layer
Owns drawing primitives, editable-text `TextLinkSpan`s, and the stamp library. The stamp library is user-defined — users design and save their own reusable components; the app ships no fixed default set. Every shape is an annotation; attaching tags is structured custom data on the shape, while only editable text carries hyperlink ranges. A tagged annotation is not a distinct type — it just has tags.

### Render / View Layer
Owns browse-by-group/tag: two-level collapsible nav (group → tag) → vertical thumbnail gallery → full chart. Applies the brief-highlight transform (briefly highlight the annotations carrying the browsed tag; no viewport fit, no dim) from the active tag. Holds no durable state.

## Design Checks

For any proposal or implementation, answer:

1. What object is being changed: Entry, Annotation, tag/group, saved view, image asset, or link?
2. Which boundary owns it: Ingest, Entry Store, Annotation-Tag Index, Tag & Query Engine, Canvas, or Render?
3. Is a fact being stored twice (e.g., the same tag on both entry and annotation, or a copied artifact for a second view)? If so, remove the duplication.
4. Does this preserve "one Entry, many views, zero copies"?
5. Is highlight/browse state being persisted instead of derived from the active tag?
6. Is a category being encoded as a hardcoded branch instead of a tag value matched generically by the query engine?
7. Is any annotation kind being special-cased (a "setup marker" type) instead of "an annotation that has tags"?
8. Are annotation-level tags kept off the Entry, and entry-level tags kept off annotations, with no duplicated fact?
9. Is a trade's outcome modeled as an annotation-level typed `result` (kept out of the browse nav) rather than an `outcome` tag/group?
10. For a query or statistic, does it read the Annotation-Tag Index and entry tags (and result measures) without scanning raw canvas JSON?
11. Does the change keep V1 on static-screenshot pixel coordinates rather than sneaking in price/time-axis binding?
12. Is the smallest MVP slice that validates this identified?
13. Does every internal reference use an immutable-id Entry/annotation target plus a text range, with display text derived from the text object — rather than an object-level `links[]`, duplicated label, or app-only clipboard?

## Anti-Patterns

- Reintroducing a special "TradeMarker"/"setup marker" type instead of "any annotation can carry tags".
- Duplicating an Entry so it can appear in a second category or a second view.
- Making highlight a viewport-fit + persistent-dim transform instead of a brief highlight, or persisting highlight/browse state instead of deriving it.
- Adding a separate note field instead of treating notes as taggable text-box annotations.
- Storing the same fact on both the Entry and its annotations.
- Encoding a category as an `if (category === '...')` branch instead of a `group:value` tag matched generically by the query engine.
- Free-form tag strings that drift (mixed casing, spaces, or fused suffixes for the same idea) instead of `group:value` with stable kebab-case.
- Shipping a hardcoded default catalog of stamps or groups instead of providing the mechanism for the user to define and design their own.
- Modeling a trade's outcome as a browsable `outcome` group/tag, or fusing a result into a `setup` value, instead of an annotation-level typed `result` (string/number dimensions) that stays out of the browse nav.
- Putting `result` into the browse navigation or the highlight transform, or storing it as free-form strings, instead of user-defined typed (string/number) dimensions used only for statistics.
- Running tag queries or statistics by scanning canvas JSON instead of the Annotation-Tag Index.
- Binding V1 annotation geometry to price/time axes before a live-chart source exists.
- Reintroducing annotation-to-annotation `links[]`, a hidden app link clipboard, or a Links property popover instead of stable target addresses plus character-range text hyperlinks.
- Turning the app into a charting/broker/backtesting/live-data platform, or a general drawing tool.
- Adding fallback/compatibility branches for an undecided design instead of fixing the model.
- Tests that assert canvas serialization shape instead of domain behavior (query membership, view rendering, statistics).

## Output Format

```markdown
## Domain Decision Summary
- Decision:
- Objects affected (Entry / Annotation / tag / group / result / view / link):
- Owning boundary:
- Duplication check (one artifact, derived highlight):
- Tag placement (entry-level vs annotation-level):
- Result impact (typed string/number dimensions; stats-only, not browsable):
- Query/index impact:
- MVP validation:
- Risks or open questions:
```
