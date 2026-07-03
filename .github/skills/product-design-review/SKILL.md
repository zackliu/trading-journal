---
name: product-design-review
description: "Use when reviewing or creating product architecture, MVP scope, data-model decisions, tag/group design, view/render tradeoffs, or roadmap for the Trading Journal app. Tests whether the design holds together as a product, not just wording."
argument-hint: "proposal, decision, or area to review"
---
# Product Design Review

Use this skill when a design needs more than wording polish. The goal is to test whether the design holds together as a product and a data model.

## Procedure

1. Restate the decision or proposal in one paragraph.
2. Identify the user scenario: capturing a review, tagging an annotation, classifying by groups, or retrieving by a tag combination.
3. Separate mechanism from net effect. If a desired result (e.g., "the chart shows up in two categories") appears as a special case or a copy, find the underlying primitive (one artifact + tags + query).
4. For any bug, gap, or confusing behavior, review the domain model first, the implementation second, and missing explicit validation third.
5. Compare at least two options when the decision is meaningful.
6. Review consequences across the boundaries: Ingest, Entry Store, Annotation-Tag Index, Tag & Query Engine, Canvas, Render.
7. If the decision changes a spec, describe the target-state edit. Do not suggest revision notes or "latest discussion" paragraphs in the spec body.
8. Decide whether the proposal should change docs, contracts, implementation, tests, or all of them.

## Review Rubric

- **Problem clarity**: Is the pain specific and real (duplication, one-dimensional sections, manual counts)?
- **Three-way separation**: Does the design keep artifact, tags, and source distinct?
- **No duplication**: Is "one Entry, many views, zero copies" preserved? Is any artifact copied to satisfy a category or view?
- **No special annotation type**: Is any annotation taggable, rather than a special "setup marker" type?
- **Grouped tags**: Are groups orthogonal and user-defined (not a hardcoded set), and is a trade's outcome kept out of tags entirely (an annotation-level typed `result`, not an `outcome` group)?
- **Derived highlight**: Is browse-a-tag highlight a brief render-time transform (no viewport fit, no dim), not stored state?
- **Tag placement**: Are annotation-level tags on annotations and entry-level tags on the entry, without duplication?
- **Query integrity**: Do tag queries and statistics read the Annotation-Tag Index, not raw canvas JSON?
- **MVP focus**: Does it validate ingest → annotate → tag → query → browse → basic stats on static screenshots?
- **Root-cause integrity**: Does it fix the model instead of adding a hidden special case?
- **No compatibility drift**: Does it avoid fallback shims and dual paths unless a migration is explicitly requested?
- **Spec as finished artifact**: Would the resulting spec read as the current intended design, not a change log?
- **Scope restraint**: Does it avoid charting-platform, broker, live-data, backtesting, or general-drawing scope creep?

## Output Format

```markdown
## Design Review
- Verdict:
- Strongest part:
- Highest-risk assumption:
- Duplication / net-effect check:
- Group & boundary corrections:
- Suggested edit or implementation slice:
- Open questions:
```
