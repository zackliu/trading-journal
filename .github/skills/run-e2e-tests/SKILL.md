---
name: run-e2e-tests
description: "Use whenever running, re-running, or verifying the Trading Journal test suite (Playwright + Electron): the build-first requirement, the exact commands, how per-test progress shows in the terminal, and the no-focus-steal launch so test windows never interrupt the user's work."
argument-hint: "spec file or test title to run, or 'full' for the whole suite"
---
# Running the e2e Test Suite

The tests drive the **built** Electron app (`playwright.config.ts` → `_electron` with `args: ['.']`, which runs `out/main/index.js`), serially (`workers: 1`), with the **list** reporter. Always run them this way so per-test progress is visible in the terminal and app windows never steal focus.

## Procedure (keep this order)

1. **Build after any `src/**` change.** Playwright runs the compiled app in `out/`, not the TypeScript source — a stale build silently tests old code.
   ```pwsh
   npm run build
   ```
2. **Cheap gates first** (fast feedback before the slow suite):
   ```pwsh
   npm run typecheck; npm run lint
   ```
3. **Iterate on one spec** while working a change:
   ```pwsh
   npx playwright test navigation.spec.ts
   # or a single test by title substring:
   npx playwright test -g "walks the rail order"
   ```
4. **Run the full suite before declaring done:**
   ```pwsh
   npx playwright test
   ```
   `npm test` also works — it is `npm run build && playwright test` (build + full suite in one step). Use bare `npx playwright test` when the build is already current to skip the rebuild.

Run every command in the **integrated terminal in sync mode** and watch the output — do not background it. The list reporter prints one numbered line per test as it finishes (`✓ 12 …title… (2.5s)`), and because `workers: 1` runs them serially you can see exactly which test (N of total) is in flight. Poll the terminal output to follow along; the final line is `N passed (M.Ss)`.

## Windows must not steal focus

A full run launches dozens of Electron app instances back-to-back. Two things keep them from popping over the user's work — never regress either:

- The launch helpers in `tests/e2e/electronApp.ts` set **`TJ_TEST=1`** in the app's env.
- The main process (`src/main/index.ts`, `ready-to-show` handler) shows the window with **`win.showInactive()`** when `TJ_TEST` is set, instead of `win.show()`. `showInactive()` renders the window normally (so the Fabric canvas and timers are **not** background-throttled, which would make timing-sensitive tests flaky) but never grabs foreground focus, so the windows stay behind the editor. Real (non-test) launches still `win.show()` and focus normally.

Why the *last few* windows used to pop up: with plain `win.show()`, Windows' foreground-lock blocks a background app from stealing focus **only while you are actively typing**; the moment you pause, the next `show()` grabs the foreground. `showInactive()` removes that entirely — no run should interrupt you now.

## Rules

- **Never** pass `--headed` — it forces visible, focused windows and defeats the no-focus-steal behavior.
- Keep `reporter: [['list']]` and `workers: 1` in `playwright.config.ts`; that pairing is what makes the progress readable and serial.
- Rebuild (`npm run build`) after editing `src/**` before `npx playwright test`, or just use `npm test`.
- Do not delete or relax a failing test to go green — fix the root cause (see `AGENTS.md`).
