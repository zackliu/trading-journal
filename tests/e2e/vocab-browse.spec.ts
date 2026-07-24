import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, store } from './electronApp';
import { BASE_CANVAS_LAYER_ID } from '../../src/shared/domain';

function tempDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'tj-slice6-'));
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function canvasBox(page: Page): Promise<Box> {
  const c = page.locator('.canvas-container');
  await expect(c).toBeVisible();
  await page.waitForTimeout(300);
  const b = await c.boundingBox();
  if (!b) throw new Error('canvas has no bounding box');
  return b;
}

async function drag(page: Page, box: Box, x1: number, y1: number, x2: number, y2: number): Promise<void> {
  await page.mouse.move(box.x + x1, box.y + y1);
  await page.mouse.down();
  await page.mouse.move(box.x + x2, box.y + y2, { steps: 6 });
  await page.mouse.up();
}

async function reload(page: Page): Promise<void> {
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
}

// ---- Vocabulary registry (contract) ----

test('a declared group and value are usable before any review uses them, and unused values can be removed', async () => {
  const { app, page } = await launchApp(tempDataDir());

  await store.defineGroup(page, { id: 'symbol', label: 'Symbol', pinned: true });
  await store.defineValue(page, { groupId: 'symbol', value: 'nq' });
  await store.defineValue(page, { groupId: 'symbol', value: 'es' });

  let groups = await store.listGroups(page);
  const sym = groups.find((g) => g.id === 'symbol');
  expect(sym?.pinned).toBe(true);
  expect(sym?.values.map((v) => v.value)).toEqual(['nq', 'es']);
  expect(sym?.values.every((v) => v.count === 0)).toBe(true); // declared, usable, unused

  await store.deleteValue(page, 'symbol', 'es');
  groups = await store.listGroups(page);
  expect(groups.find((g) => g.id === 'symbol')?.values.map((v) => v.value)).toEqual(['nq']);

  await store.setGroupPinned(page, 'symbol', false);
  expect((await store.listGroups(page)).find((g) => g.id === 'symbol')?.pinned).toBe(false);

  await store.deleteGroup(page, 'symbol');
  expect((await store.listGroups(page)).find((g) => g.id === 'symbol')).toBeUndefined();

  await app.close();
});

// ---- Entry tags (contract) ----

test('entry tags are stored, queryable, and never clobber the structural date', async () => {
  const { app, page } = await launchApp(tempDataDir());

  await page.getByTestId('ribbon-new').click();
  const id = (await store.listEntries(page))[0]?.id as string;
  const dateTag = (await store.getEntry(page, id))?.entryTags.find((t) => t.group === 'date');
  expect(dateTag).toBeTruthy();

  await store.setEntryTags(page, id, [{ group: 'symbol', value: 'nq' }]);
  const after = await store.getEntry(page, id);
  expect(after?.entryTags).toContainEqual({ group: 'symbol', value: 'nq' });
  expect(after?.entryTags).toContainEqual(dateTag); // date preserved alongside the user tag
  expect((await store.queryEntriesByTag(page, { group: 'symbol', value: 'nq' })).map((e) => e.id)).toContain(id);

  // A `date` tag handed to setEntryTags is ignored — date stays structural, single, not clobbered.
  await store.setEntryTags(page, id, [
    { group: 'date', value: '1999-01-01' },
    { group: 'symbol', value: 'es' },
  ]);
  const relabeled = await store.getEntry(page, id);
  expect(relabeled?.entryTags.filter((t) => t.group === 'date')).toEqual([dateTag]);
  expect(relabeled?.entryTags.some((t) => t.group === 'symbol' && t.value === 'es')).toBe(true);
  expect(relabeled?.entryTags.some((t) => t.group === 'symbol' && t.value === 'nq')).toBe(false);

  await app.close();
});

// ---- Browse: union of entry-level ∪ annotation-level, deduped, zero copies (contract) ----

test('browsing a tag unions entry-level and annotation-level carriers, deduped, with live counts', async () => {
  const { app, page } = await launchApp(tempDataDir());

  await store.defineGroup(page, { id: 'symbol', label: 'Symbol', pinned: true });
  await store.defineValue(page, { groupId: 'symbol', value: 'nq' });
  await store.defineValue(page, { groupId: 'symbol', value: 'es' });

  const a = await store.createEntry(page, {
    canvasJson: '{}',
    entryTags: [
      { group: 'symbol', value: 'nq' },
      { group: 'date', value: '2026-07-01' },
    ],
    annotations: [],
  });
  const b = await store.createEntry(page, {
    canvasJson: '{}',
    entryTags: [{ group: 'date', value: '2026-07-02' }],
    annotations: [{ id: 'b1', bounds: { x: 0, y: 0, width: 10, height: 10 }, tags: [{ group: 'symbol', value: 'nq' }] }],
  });
  const c = await store.createEntry(page, {
    canvasJson: '{}',
    entryTags: [
      { group: 'symbol', value: 'es' },
      { group: 'date', value: '2026-07-03' },
    ],
    annotations: [],
  });
  const d = await store.createEntry(page, {
    canvasJson: '{}',
    entryTags: [
      { group: 'symbol', value: 'nq' },
      { group: 'date', value: '2026-07-04' },
    ],
    annotations: [{ id: 'd1', bounds: { x: 0, y: 0, width: 5, height: 5 }, tags: [{ group: 'symbol', value: 'nq' }] }],
  });

  // nq = a (entry) ∪ b (annotation) ∪ d (both) — d appears once (deduped).
  const nq = await store.queryEntriesByTag(page, { group: 'symbol', value: 'nq' });
  expect(nq.map((e) => e.id).sort()).toEqual([a.id, b.id, d.id].sort());
  expect(nq.filter((e) => e.id === d.id)).toHaveLength(1);
  expect((await store.queryEntriesByTag(page, { group: 'symbol', value: 'es' })).map((e) => e.id)).toEqual([c.id]);

  // Counts = distinct entries; the entries table holds one row each (no copies for a second view).
  const sym = (await store.listGroups(page)).find((g) => g.id === 'symbol');
  expect(sym?.values.find((v) => v.value === 'nq')?.count).toBe(3);
  expect(sym?.values.find((v) => v.value === 'es')?.count).toBe(1);
  expect((await store.listEntries(page)).length).toBe(4);

  await app.close();
});

// ---- Review tab quick-pick (UI) ----

test('the Review tab quick-pick tags the whole review, which then appears under that group in browse', async () => {
  const { app, page } = await launchApp(tempDataDir());
  await store.defineGroup(page, { id: 'symbol', label: 'Symbol', pinned: true });
  await store.defineValue(page, { groupId: 'symbol', value: 'nq' });
  await reload(page);

  await page.getByTestId('ribbon-new').click();
  const id = (await store.listEntries(page))[0]?.id as string;

  await page.getByTestId('tab-review').click();
  await page.getByTestId('qtag-symbol-nq').click();
  await expect
    .poll(async () => (await store.getEntry(page, id))?.entryTags.some((t) => t.group === 'symbol' && t.value === 'nq'))
    .toBe(true);

  // Browse: pivot to symbol → the nq bucket lists exactly this review.
  await page.getByTestId('pivot-selector').click();
  await page.getByTestId('pivot-group-symbol').click();
  await expect(page.getByTestId('bucket-head-nq')).toContainText('1');
  await expect(page.getByTestId('bucket-nq').getByTestId('entry-item')).toHaveCount(1);

  // Toggling it off removes the review from that tag (no second row was ever created).
  await page.getByTestId('tab-review').click();
  await page.getByTestId('qtag-symbol-nq').click();
  await expect
    .poll(async () => (await store.queryEntriesByTag(page, { group: 'symbol', value: 'nq' })).length)
    .toBe(0);

  await app.close();
});

test('a human-typed value in Settings auto-derives a stable id while showing the typed text as its label', async () => {
  const { app, page } = await launchApp(tempDataDir());
  await store.defineGroup(page, { id: 'day-structure', label: 'Day Structure', pinned: true });
  await reload(page);

  // Create a value the way a person thinks of it — "TRD", not "trd" — in Settings (creation lives here).
  await page.getByTestId('ribbon-settings').click();
  await expect(page.getByTestId('settings-dialog')).toBeVisible();
  await expect(page.getByTestId('settings-grip-group-day-structure')).toBeVisible(); // drag handle to reorder
  await page.getByTestId('settings-add-value-day-structure').fill('TRD');
  await page.getByTestId('settings-add-value-day-structure').press('Enter');

  // Stored with slug id `trd` + display label "TRD".
  await expect
    .poll(async () =>
      (await store.listGroups(page)).find((g) => g.id === 'day-structure')?.values.some((v) => v.value === 'trd'),
    )
    .toBe(true);
  const group = (await store.listGroups(page)).find((g) => g.id === 'day-structure');
  expect(group?.values.find((v) => v.value === 'trd')?.label).toBe('TRD');
  await expect(page.getByTestId('settings-value-day-structure-trd')).toContainText('TRD');

  // The ribbon chip shows the human label, keyed by the derived id.
  await page.keyboard.press('Escape');
  await page.getByTestId('ribbon-new').click();
  await page.getByTestId('tab-review').click();
  await expect(page.getByTestId('qtag-day-structure-trd')).toHaveText('TRD');

  await app.close();
});

test('Settings order drives the vocabulary order, and reordering persists', async () => {
  const { app, page } = await launchApp(tempDataDir());
  await store.defineGroup(page, { id: 'symbol', label: 'Symbol', pinned: true });
  await store.defineValue(page, { groupId: 'symbol', value: 'nq' });
  await store.defineValue(page, { groupId: 'symbol', value: 'es' });
  await store.defineValue(page, { groupId: 'symbol', value: 'ym' });

  // New values append in insertion order.
  const valuesOf = async (): Promise<string[] | undefined> =>
    (await store.listGroups(page)).find((g) => g.id === 'symbol')?.values.map((v) => v.value);
  expect(await valuesOf()).toEqual(['nq', 'es', 'ym']);

  // Reorder values, then reorder groups.
  await store.reorderValues(page, 'symbol', ['ym', 'nq', 'es']);
  expect(await valuesOf()).toEqual(['ym', 'nq', 'es']);

  await store.defineGroup(page, { id: 'setup', label: 'Setup', pinned: true });
  expect((await store.listGroups(page)).map((g) => g.id)).toEqual(['symbol', 'setup']);
  await store.reorderGroups(page, ['setup', 'symbol']);
  expect((await store.listGroups(page)).map((g) => g.id)).toEqual(['setup', 'symbol']);

  // Both orders survive a restart.
  await reload(page);
  expect((await store.listGroups(page)).map((g) => g.id)).toEqual(['setup', 'symbol']);
  expect(await valuesOf()).toEqual(['ym', 'nq', 'es']);

  await app.close();
});

test('an overflowing group collapses into a searchable drawer that tags from the full list', async () => {
  const { app, page } = await launchApp(tempDataDir());
  await store.defineGroup(page, { id: 'setup', label: 'Setup', pinned: true });
  for (let i = 0; i < 20; i += 1) await store.defineValue(page, { groupId: 'setup', value: `case-${i}` });
  await reload(page);

  await page.getByTestId('ribbon-new').click();
  const id = (await store.listEntries(page))[0]?.id as string;
  await page.getByTestId('tab-review').click();

  // Too many values to fit the fixed-width group → a "+N" expander appears.
  await expect(page.getByTestId('qtag-expand-setup')).toBeVisible();

  // Open the drawer, search, and tag from the full list.
  await page.getByTestId('qtag-expand-setup').click();
  await expect(page.getByTestId('qtag-drawer-setup')).toBeVisible();
  await page.getByTestId('qtag-search-setup').fill('case-17');
  await page.getByTestId('qdrawer-setup-case-17').click();
  await expect
    .poll(async () => (await store.getEntry(page, id))?.entryTags.some((t) => t.group === 'setup' && t.value === 'case-17'))
    .toBe(true);

  await app.close();
});

// ---- Annotation contextual tab (UI) ----

test('clicking an annotation activates the contextual Annotation tab and tags the annotation', async () => {
  const { app, page } = await launchApp(tempDataDir());
  await store.defineGroup(page, { id: 'setup', label: 'Setup', pinned: true });
  await store.defineValue(page, { groupId: 'setup', value: 'h2' });
  await reload(page);

  await page.getByTestId('ribbon-new').click();
  const box = await canvasBox(page);
  const id = (await store.listEntries(page))[0]?.id as string;

  await expect(page.getByTestId('tab-annotation')).toHaveCount(0); // nothing selected → no contextual tab

  await page.getByTestId('tool-rect').click();
  await drag(page, box, 40, 40, 240, 160); // finishing the shape selects it
  await expect(page.getByTestId('tab-annotation')).toBeVisible();
  await expect(page.getByTestId('tab-draw')).toHaveClass(/is-active/);

  await page.mouse.click(box.x + 140, box.y + 100);
  await expect(page.getByTestId('tab-annotation')).toHaveClass(/is-active/);
  await page.getByTestId('qtag-setup-h2').click();
  await expect.poll(async () => (await store.queryByTag(page, { group: 'setup', value: 'h2' })).length).toBe(1);
  expect((await store.queryByTag(page, { group: 'setup', value: 'h2' }))[0]?.entryId).toBe(id);

  // Deselect (click empty page) → the contextual tab disappears.
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.82);
  await expect(page.getByTestId('tab-annotation')).toHaveCount(0);

  await app.close();
});

// ---- All reviews (year-month) + date is structural, not a group (UI) ----

test('All reviews buckets by year-month, and date is neither a settings group nor a tagging option', async () => {
  const { app, page } = await launchApp(tempDataDir());

  await page.getByTestId('ribbon-new').click();
  await page.getByTestId('tab-home').click();
  await page.getByTestId('ribbon-new').click();

  // Default pivot is "All reviews": one year-month bucket holds both of today's reviews.
  await expect(page.locator('.pbucket')).toHaveCount(1);
  await expect(page.getByTestId('buckets').getByTestId('entry-item')).toHaveCount(2);

  // date is not offered as a pivot dimension…
  await page.getByTestId('pivot-selector').click();
  await expect(page.getByTestId('pivot-group-date')).toHaveCount(0);
  await page.getByTestId('pivot-all').click();

  // …and not a settings group, so it is never a tagging option.
  await page.getByTestId('tab-home').click();
  await page.getByTestId('ribbon-settings').click();
  await expect(page.getByTestId('settings-dialog')).toBeVisible();
  await expect(page.getByTestId('settings-group-date')).toHaveCount(0);

  await app.close();
});

test('the left rail sorts reviews by date, newest first by default and toggleable to oldest first', async () => {
  const { app, page } = await launchApp(tempDataDir());
  const newReview = async (): Promise<string> => {
    await page.getByTestId('tab-home').click();
    await page.getByTestId('ribbon-new').click();
    await expect(page.getByTestId('editor')).toBeVisible();
    return (await store.listEntries(page))[0]?.id as string;
  };
  const jul = await newReview();
  const apr = await newReview();
  const jan = await newReview();
  await store.setEntryDate(page, jul, '2026-07-07');
  await store.setEntryDate(page, apr, '2026-04-10');
  await store.setEntryDate(page, jan, '2026-01-08');
  await reload(page);

  const bucketOrder = (): Promise<(string | null)[]> =>
    page.locator('[data-testid^="bucket-20"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));

  // Default is newest-first: July, then April, then January.
  await expect(page.getByTestId('sort-toggle')).toHaveAttribute('data-dir', 'desc');
  expect(await bucketOrder()).toEqual(['bucket-2026-07', 'bucket-2026-04', 'bucket-2026-01']);

  // Toggle → oldest-first reverses the whole date order.
  await page.getByTestId('sort-toggle').click();
  await expect(page.getByTestId('sort-toggle')).toHaveAttribute('data-dir', 'asc');
  await expect.poll(bucketOrder).toEqual(['bucket-2026-01', 'bucket-2026-04', 'bucket-2026-07']);

  // Toggle back → newest-first again.
  await page.getByTestId('sort-toggle').click();
  await expect(page.getByTestId('sort-toggle')).toHaveAttribute('data-dir', 'desc');
  await expect.poll(bucketOrder).toEqual(['bucket-2026-07', 'bucket-2026-04', 'bucket-2026-01']);

  await app.close();
});

// ---- Collapse / expand (UI) ----

test('browse buckets collapse, and a right-click collapses or expands all', async () => {
  const { app, page } = await launchApp(tempDataDir());
  await store.defineGroup(page, { id: 'symbol', label: 'Symbol', pinned: true });
  await store.defineValue(page, { groupId: 'symbol', value: 'nq' });
  await store.defineValue(page, { groupId: 'symbol', value: 'es' });
  await store.createEntry(page, {
    canvasJson: '{}',
    entryTags: [
      { group: 'symbol', value: 'nq' },
      { group: 'date', value: '2026-07-01' },
    ],
    annotations: [],
  });
  await store.createEntry(page, {
    canvasJson: '{}',
    entryTags: [
      { group: 'symbol', value: 'es' },
      { group: 'date', value: '2026-07-02' },
    ],
    annotations: [],
  });
  await reload(page);

  await page.getByTestId('pivot-selector').click();
  await page.getByTestId('pivot-group-symbol').click();
  await expect(page.getByTestId('bucket-nq').getByTestId('entry-item')).toHaveCount(1);

  // Collapsing one bucket hides only its thumbnails.
  await page.getByTestId('bucket-head-nq').click();
  await expect(page.getByTestId('bucket-nq').getByTestId('entry-item')).toHaveCount(0);
  await expect(page.getByTestId('bucket-es').getByTestId('entry-item')).toHaveCount(1);

  // Right-click → Collapse all, then Expand all — only display changes, results are intact.
  await page.getByTestId('bucket-head-es').click({ button: 'right' });
  await page.getByTestId('browse-collapse-all').click();
  await expect(page.getByTestId('buckets').getByTestId('entry-item')).toHaveCount(0);

  await page.getByTestId('bucket-head-nq').click({ button: 'right' });
  await page.getByTestId('browse-expand-all').click();
  await expect(page.getByTestId('buckets').getByTestId('entry-item')).toHaveCount(2);

  await app.close();
});

// ---- Highlight is derived, never persisted (UI) ----

test('opening a review from a value bucket keeps the highlight derived, never persisted', async () => {
  const { app, page } = await launchApp(tempDataDir());

  const rect = {
    type: 'Rect',
    left: 200,
    top: 400,
    width: 300,
    height: 160,
    fill: 'transparent',
    stroke: '#f85149',
    strokeWidth: 3,
    tjId: 'r1',
    tjLayerId: BASE_CANVAS_LAYER_ID,
    tjTags: [{ group: 'setup', value: 'h2' }],
  };
  const canvasJson = JSON.stringify({ version: '6', tjPage: { width: 2500, height: 1600 }, objects: [rect] });
  const entry = await store.createEntry(page, {
    canvasJson,
    entryTags: [{ group: 'date', value: '2026-07-04' }],
    annotations: [{ id: 'r1', bounds: { x: 200, y: 400, width: 300, height: 160 }, tags: [{ group: 'setup', value: 'h2' }] }],
  });
  await store.defineGroup(page, { id: 'setup', label: 'Setup', pinned: true });
  await store.defineValue(page, { groupId: 'setup', value: 'h2' });
  await reload(page);

  await page.getByTestId('pivot-selector').click();
  await page.getByTestId('pivot-group-setup').click();
  await page.getByTestId('bucket-h2').getByTestId('entry-item').first().click();
  await expect(page.getByTestId('editor')).toBeVisible();

  // Force a save while the halo is on screen: it is a render-only overlay, so nothing halo-shaped persists.
  await page.keyboard.press('Control+s');
  await expect.poll(async () => (await store.getEntry(page, entry.id))?.annotations.length ?? 0).toBe(1);
  const persisted = await store.getEntry(page, entry.id);
  expect(persisted?.canvasJson).not.toContain('flash');
  expect(persisted?.canvasJson).not.toContain('highlight');

  await app.close();
});
