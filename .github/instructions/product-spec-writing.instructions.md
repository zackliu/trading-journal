---
description: "Use when writing or editing Trading Journal product specs, the brief, data-model docs, ADRs, or any markdown design document."
applyTo: "*.md,docs/**/*.md"
---
# Product Spec Writing

- Preserve design decisions, not just wording. If a sentence carries a product boundary (three-way separation, no duplication, no special annotation type, derived highlight), validate the boundary before editing style.
- Treat `trading-journal-brief-ch.md` as the current thesis and domain model. Keep it the single source of truth.
- Keep the product centered on: annotate a static chart screenshot, tag any annotation (or the whole chart) with values from user-defined groups, retrieve by tag combination, and render one artifact under any browsed group/tag without copies.
- Avoid expanding scope into charting platforms, brokers, live market data, backtesting, or general drawing tools.
- Write specs as polished target-state artifacts, not revision records. If discussion changes the design, fold the decision into the relevant section as if it had always been intended.
- Do not append "修改说明", "补充说明", "根据最新讨论", changelog paragraphs, or stacked caveats inside the spec body unless the user explicitly asks for a revision history.
- Remove or rewrite obsolete statements instead of preserving them with later corrections. A reader should not need to reconstruct the conversation to understand the current design.
- Do not leave implementation branches in a target-state spec. Choose one mechanism; if two genuinely distinct scenarios exist, describe each concretely. Keep undecided project-level choices in an explicit "待定决策" section, not as conditional mechanism in the design body.
- Chinese product prose should read as natural Chinese with stable English technical terms where clearer: Entry, Annotation, tag, group, canvas, view, query, annotation-tag index.
- Keep tags consistent with `tagging-conventions`: `group:value`, kebab-case, one fact per group. Concrete group values are user-defined vocabulary; do not enumerate or invent them in specs.
- For comparison tables (views, groups, options), keep row meaning parallel across columns and avoid one-off exceptions that hide a missing primitive.
