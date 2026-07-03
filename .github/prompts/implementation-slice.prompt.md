---
description: "Plan the first safe implementation slice for a Trading Journal feature or data-model contract."
name: "Implementation Slice"
argument-hint: "feature or contract"
agent: "agent"
---
# Implementation Slice

Plan the first reviewable implementation slice for:

`${input:feature:Describe the feature, contract, or change}`

Use `implementation-planning` and `trading-journal-domain` when relevant. The canvas library and storage form are decided (Fabric.js + Electron + SQLite); follow them for any slice touching the canvas or persistence.

Respect the repo rules: define contracts before UI, never duplicate an artifact to satisfy a view, keep highlight derived, run queries against the Annotation-Tag Index, and do not add fallback code or source-shape tests unless explicitly requested.

Return:

```markdown
## First Slice Plan
- Goal:
- Source design section:
- Root-cause stance:
- Files or modules likely affected:
- Contract shape (Entry / Annotation / Tag / SavedView):
- Implementation steps:
- Domain-behavior tests:
- Validation commands:
- Risks:
- Follow-up slices:
```
