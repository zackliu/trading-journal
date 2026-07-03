---
name: tagging-conventions
description: "Use when defining, naming, or validating classification tags for the Trading Journal: how groups and tag values are structured, named, kept orthogonal, and placed on the right object (Entry or annotation). Covers the general grouped-tag convention only — which groups exist and what values each holds is user-defined domain vocabulary, not enumerated in this skill."
argument-hint: "tag or group naming/structure question"
---
# Tagging Conventions

Use this skill to keep classification **grouped, stable, and consistent**. It defines the *shape and rules* of tags. It does **not** enumerate concrete tag values: which groups exist and what values each holds is user-owned domain vocabulary the user maintains in the app's own data/config — never hardcoded here, in specs, or in `src/`.

## Core Model

- A tag is always `group:value`.
- A **group** is one orthogonal classification dimension (an axis). A **value** is a single point on that axis. In the UI, groups are the first nav level and values (tags) the second (OneNote-style).
- Groups are independent; an Entry or an annotation carries any combination of tags drawn from different groups.
- The groups themselves, and the value set within each group, are defined by the user. A group is not assumed to be any particular dimension — it is whatever independent axis the user chooses to classify by.

## Naming Rules

- `group:value`, both lowercase, kebab-case, ASCII.
- One fact, one group. Never fuse two independent facts into a single value. If a value encodes a dimension plus its context, split it into separate groups. A measured outcome is not a tag at all — model it as an annotation-level typed `result` (see the trading-journal-domain skill), never as a tag value or an `outcome` group.
- Stable id vs display string. Storage holds the kebab-case id; the UI may render any label. Do not let display text become the stored key.
- Add a value only when it is a genuinely new point on that axis, not a combination already expressible through another group.

## Placement

- A tag attaches to the whole Entry (entry-level) or to a specific annotation (annotation-level). Decide each group's usual level once.
- Annotation-level tags decide which element is briefly highlighted when that tag is browsed; entry-level tags just include the whole chart.
- Do not store the same fact on both the Entry and its annotations.

## Anti-Patterns

- Free-form tag strings that drift (mixed casing, spaces, or fused suffixes for the same idea) instead of one stable `group:value`.
- Fusing groups: putting a direction or context inside another group's value instead of giving each its own group. (A measured outcome is not a group at all — it is an annotation-level typed `result`; never encode it as a tag value or an `outcome` group.)
- Hardcoding the concrete value list into `src/`, specs, or this skill instead of treating it as user-defined vocabulary/config.
- Encoding a category as an `if` branch instead of a `group:value` matched generically by the query engine.
- Inventing a meaning for an abbreviation the user has not confirmed.

## Output Format

```markdown
## Tagging Decision
- Group(s) involved:
- Value shape (group:value, kebab-case):
- One-fact-one-group check (nothing fused):
- Level (entry vs annotation):
- User-owned vocabulary respected (no invented/enumerated values):
```
