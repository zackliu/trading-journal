---
name: experience-first-design
description: "Use when designing or reworking any Trading Journal interaction, panel, gesture, or flow (canvas edits, popovers, drag-and-drop, palettes/stamp library, copy-paste, browse). Design from the user's real intended hands-on experience and intuition: simulate the concrete action sequence and its micro-psychology, unify mechanisms instead of special-casing, make the whole loop feel seamless, and converge before building."
argument-hint: "the interaction or flow to design"
---
# Experience-First Design

Design from the user's actual desired hands-on experience, not from the data model or a feature checklist. The question is never "what fields must we expose"; it is "what does the user want to *do* here, and how should each moment *feel*." A design is right when the user never has to think about the mechanism.

This is how the product owner reasons. Match it: start from the felt experience, walk the exact gesture, protect the micro-psychology, and refuse special cases.

## Procedure

1. **Start from the felt experience.** State, in the user's own words, the concrete thing they want to do and how it should feel ("I drag a block out of the palette and it becomes a reusable copy; the palette stays intact"). Not the UI inventory, not the schema.
2. **Simulate the exact action sequence.** Walk the gesture step by step — hover, click, drag, cross a boundary, drop, type, dismiss — and narrate what the user sees and *believes* at each micro-step. Failures of feel hide between the steps.
3. **Design the micro-psychology.** Every transient state must telegraph its own meaning. A copy in flight is a translucent ghost that solidifies on drop; the source never visibly leaves, so it never feels like a cut. If a step could be misread as "did I move, copy, or delete that?", redesign until the affordance answers the question by itself.
4. **Unify mechanisms; refuse special cases.** If two things feel like the same action to the user, they must *be* one mechanism. A difference that lives only in origin (an image from the OS clipboard vs a drawing copied inside the app) is not a difference in mechanism — both are "paste the clipboard onto the page." Hunt the underlying primitive; never fork the code to reproduce a net effect. (See the net-effect trap in user memory and `product-design-review`.)
5. **Make the whole loop seamless (浑然天成).** Design commit and cancel, not just the happy path: what Saves, what dismisses (e.g. click-away = cancel unsaved), what is locked by default, what is reversible, where a transient surface anchors and how it closes. Every surface that opens must have an obvious, natural way to close or undo.
6. **Name and justify any asymmetry.** If drag-out copies but drag-in moves, say so and tie it to the workflow (the palette is a reused source, so out must leave it intact; in deposits a duplicate the user already made). Unstated asymmetry feels like a bug.
7. **Converge before building.** Restate the felt experience, list the genuinely forking decisions each with a recommended default, get confirmation, then write the spec, then implement. Never start code from an unresolved feel — design discussion is not implementation permission.
8. **Write the feel into the spec.** Each slice carries a **用户动作流程与直觉逻辑** section: the concrete action flow and the intuition that makes it right, so implementers build the *feeling*, not just the function.

## Smells (stop and rethink)

- Designing outward from the schema ("there is a tags table, so add a tags panel").
- A separate code path that only exists to reproduce a net effect the user perceives as ordinary (special-cased screenshot paste, a category branch, an exemption).
- A persistent panel where a transient, context-anchored surface (a right-click popover that dismisses on click-away) fits the action better.
- Any moment where the user cannot tell whether they moved, copied, or deleted something.
- A gesture that visually consumes a reusable source (dragging from a palette that empties the palette).
- Writing code before the felt experience is agreed.

## Output Format

```markdown
## Experience-First Design
- Felt experience (user's words):
- Action sequence (step by step, with what the user sees / believes):
- Micro-psychology (what each transient state telegraphs):
- Unified mechanism (the primitive; special cases refused):
- Whole loop (commit / cancel / dismiss / lock / undo):
- Named asymmetries (and their workflow justification):
- Forking decisions (each with a recommended default):
- Spec impact (which slice; the 用户动作流程与直觉逻辑 text to add):
```
