import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, store } from './electronApp';

function tempDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'tj-nav-'));
}

/** Index of the currently selected review in the left rail (-1 if none). */
async function activeIndex(page: Page): Promise<number> {
  const items = page.getByTestId('entry-item');
  const count = await items.count();
  for (let i = 0; i < count; i += 1) {
    const cls = await items.nth(i).getAttribute('class');
    if (cls?.includes('is-active')) return i;
  }
  return -1;
}

/** Point the mouse at the middle of the canvas stage so wheel events land on it. */
async function hoverStage(page: Page): Promise<void> {
  const box = await page.getByTestId('editor').boundingBox();
  if (!box) throw new Error('editor stage has no bounding box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
}

/** Live scroll geometry of the canvas stage. */
async function stageMetrics(page: Page): Promise<{ top: number; client: number; scroll: number }> {
  return page.evaluate(() => {
    const el = document.querySelector('.editor__stage') as HTMLElement | null;
    if (!el) throw new Error('no stage element');
    return { top: el.scrollTop, client: el.clientHeight, scroll: el.scrollHeight };
  });
}

/** Force the stage scroll position and return the clamped value the browser accepted. */
async function setStageScrollTop(page: Page, value: number): Promise<number> {
  return page.evaluate((v) => {
    const el = document.querySelector('.editor__stage') as HTMLElement;
    el.scrollTop = v;
    return el.scrollTop;
  }, value);
}

async function drawRectangle(page: Page): Promise<void> {
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('editor')).toHaveAttribute('aria-busy', 'false');
  await page.getByTestId('tool-rect').click();
  const box = await page.locator('.canvas-container').boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  await page.mouse.move(box.x + 80, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 170, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByTestId('tool-select')).toHaveClass(/is-active/);
}

test('Ctrl+N starts a new blank review', async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);

  await expect(page.getByTestId('empty-state')).toBeVisible();

  await page.keyboard.press('Control+n');
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('tool-rect')).toBeEnabled();
  expect(await store.listEntries(page)).toHaveLength(1);

  // A second Ctrl+N adds another review — the artifact is created once, never duplicated.
  await page.keyboard.press('Control+n');
  await expect(page.getByTestId('entry-item')).toHaveCount(2);
  const list = await store.listEntries(page);
  expect(list).toHaveLength(2);
  expect(list[0]?.imageHash).toBeUndefined();

  await app.close();
});

test('Ctrl+S on the empty state does not lock autosave for the next review', async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);

  await page.keyboard.press('Control+s');
  await page.keyboard.press('Control+n');
  await drawRectangle(page);
  const id = (await store.listEntries(page))[0]?.id as string;

  await expect.poll(async () => (await store.getEntry(page, id))?.annotations.length ?? 0).toBe(1);
  await app.close();
});

test('a failed dirty save keeps the current review open instead of switching away', async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);

  const a = await store.newEntry(page);
  const b = await store.newEntry(page);
  await store.setEntryDate(page, a.id, '2026-05-20');
  await store.setEntryDate(page, b.id, '2026-05-10');
  await page.reload();
  const items = page.getByTestId('entry-item');
  await items.first().click();
  await expect(items.first()).toHaveAttribute('data-entry-id', a.id);
  await expect(page.getByTestId('editor')).toHaveAttribute('aria-busy', 'false');

  // Remove A from durable storage, then edit its still-open in-memory page. Auto-save fails for real.
  await store.deleteEntry(page, a.id);
  await drawRectangle(page);
  await expect(page.getByTestId('save-error')).toBeVisible();

  await items.nth(1).click();
  await expect(items.first()).toHaveClass(/is-active/);
  await expect(page.locator('.thumb.is-active')).toHaveAttribute('data-entry-id', a.id);
  await expect(page.getByTestId('editor')).toBeVisible();

  await app.close();
});

test('creating a review after selecting the rail moves the sole active thumbnail to the new review', async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);

  await store.newEntry(page);
  await store.newEntry(page);
  await page.reload();
  const items = page.getByTestId('entry-item');
  await expect(items).toHaveCount(2);
  await items.last().click();
  await expect(items.last()).toHaveClass(/is-active/);

  await page.keyboard.press('Control+n');
  const newestId = (await store.listEntries(page))[0]?.id as string;
  await expect(page.getByTestId('entry-item')).toHaveCount(3);
  await expect(page.locator('.thumb.is-active')).toHaveCount(1);
  await expect(page.locator('.thumb.is-active')).toHaveAttribute('data-entry-id', newestId);

  await app.close();
});

test('the wheel steps through the rail when the page fits with no scrollbar', async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);

  // Two blank reviews (Ctrl+N works regardless of ribbon tab); open the top rail item so the
  // active index is deterministic even if the two reviews share a creation millisecond.
  await page.keyboard.press('Control+n');
  await expect(page.getByTestId('editor')).toBeVisible();
  await page.keyboard.press('Control+n');
  await expect(page.getByTestId('entry-item')).toHaveCount(2);

  await page.getByTestId('entry-item').nth(0).click();
  await expect(page.getByTestId('entry-item').nth(0)).toHaveClass(/is-active/);
  expect(await activeIndex(page)).toBe(0);

  // A blank page fits the stage (no scrollbar), so a wheel down jumps straight to the next review.
  await hoverStage(page);
  await page.mouse.wheel(0, 240);
  await expect(page.getByTestId('entry-item').nth(1)).toHaveClass(/is-active/);
  expect(await activeIndex(page)).toBe(1);

  // Wait out the one-step-per-gesture throttle, then wheel back up to the previous review.
  await page.waitForTimeout(500);
  await hoverStage(page);
  await page.mouse.wheel(0, -240);
  await expect(page.getByTestId('entry-item').nth(0)).toHaveClass(/is-active/);
  expect(await activeIndex(page)).toBe(0);

  await app.close();
});

test('one continuous wheel gesture advances exactly one review', async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);

  for (let i = 0; i < 4; i += 1) await store.newEntry(page);
  await page.reload();
  await expect(page.getByTestId('entry-item')).toHaveCount(4);
  await page.getByTestId('entry-item').first().click();
  await hoverStage(page);

  // One long wheel/trackpad stream may outlast any fixed throttle. Events never go idle here, so its
  // inertial tail must not advance a second thumbnail.
  for (let i = 0; i < 4; i += 1) {
    await page.mouse.wheel(0, 120);
    if (i < 3) await page.waitForTimeout(180);
  }

  await expect.poll(() => activeIndex(page)).toBe(1);
  await app.close();
});

test('the wheel advances one visible thumbnail at a time when a review appears in multiple group buckets', async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);

  await store.defineGroup(page, { id: 'setup', label: 'Setup', pinned: true });
  await store.defineValue(page, { groupId: 'setup', value: 'alpha', label: 'Alpha' });
  await store.defineValue(page, { groupId: 'setup', value: 'beta', label: 'Beta' });
  const a = await store.newEntry(page);
  const b = await store.newEntry(page);
  const c = await store.newEntry(page);
  await store.setEntryTags(page, a.id, [{ group: 'setup', value: 'alpha' }]);
  await store.setEntryTags(page, b.id, [
    { group: 'setup', value: 'alpha' },
    { group: 'setup', value: 'beta' },
  ]);
  await store.setEntryTags(page, c.id, [{ group: 'setup', value: 'beta' }]);
  await store.setEntryDate(page, a.id, '2026-05-30');
  await store.setEntryDate(page, b.id, '2026-05-20');
  await store.setEntryDate(page, c.id, '2026-05-10');
  await page.reload();
  await page.getByTestId('pivot-selector').click();
  await page.getByTestId('pivot-group-setup').click();
  await expect(page.getByTestId('entry-item')).toHaveCount(4); // a, b | b, c (bucket order)

  const items = page.getByTestId('entry-item');
  await expect(items.nth(0)).toHaveAttribute('data-entry-id', a.id);
  await expect(items.nth(1)).toHaveAttribute('data-entry-id', b.id);
  await expect(items.nth(2)).toHaveAttribute('data-entry-id', b.id);
  await expect(items.nth(3)).toHaveAttribute('data-entry-id', c.id);
  await items.first().click();
  await expect(items.first()).toHaveClass(/is-active/);
  await hoverStage(page);

  for (let expectedIndex = 1; expectedIndex < 4; expectedIndex += 1) {
    await page.mouse.wheel(0, 240);
    await expect(items.nth(expectedIndex)).toHaveClass(/is-active/);
    await expect(page.locator('.thumb.is-active')).toHaveCount(1);
    await page.waitForTimeout(500);
    await hoverStage(page);
  }

  // Clicking the second B occurrence anchors navigation there; wheel-up moves exactly one visible
  // position to the first B occurrence without reloading or duplicating the underlying Entry.
  await items.nth(2).click();
  await expect(items.nth(2)).toHaveClass(/is-active/);
  await hoverStage(page);
  await page.mouse.wheel(0, -240);
  await expect(items.nth(1)).toHaveClass(/is-active/);
  await expect(page.locator('.thumb.is-active')).toHaveCount(1);
  await expect(items.nth(1)).toHaveAttribute('data-entry-id', b.id);
  expect(await store.listEntries(page)).toHaveLength(3);

  await app.close();
});

test('switching between groups with the same bucket key starts from the first occurrence in the new pivot', async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);

  await store.defineGroup(page, { id: 'setup', label: 'Setup', pinned: true });
  await store.defineValue(page, { groupId: 'setup', value: 'shared', label: 'Shared' });
  await store.defineGroup(page, { id: 'context', label: 'Context', pinned: true });
  await store.defineValue(page, { groupId: 'context', value: 'first', label: 'First' });
  await store.defineValue(page, { groupId: 'context', value: 'shared', label: 'Shared' });
  const entry = await store.newEntry(page);
  await store.setEntryTags(page, entry.id, [
    { group: 'setup', value: 'shared' },
    { group: 'context', value: 'first' },
    { group: 'context', value: 'shared' },
  ]);
  await page.reload();

  await page.getByTestId('pivot-selector').click();
  await page.getByTestId('pivot-group-setup').click();
  await page.getByTestId('bucket-shared').getByTestId('entry-item').click();
  await expect(page.getByTestId('bucket-shared').getByTestId('entry-item')).toHaveClass(/is-active/);

  await page.getByTestId('pivot-selector').click();
  await page.getByTestId('pivot-group-context').click();
  // `setup:shared` and `context:shared` are different occurrences despite sharing a raw bucket key.
  // The current review therefore resolves naturally to its first position in the new Context rail.
  await expect(page.getByTestId('bucket-first').getByTestId('entry-item')).toHaveClass(/is-active/);
  await expect(page.getByTestId('bucket-shared').getByTestId('entry-item')).not.toHaveClass(/is-active/);
  await expect(page.locator('.thumb.is-active')).toHaveCount(1);

  await app.close();
});

test('removing an entry tag invalidates the old group rail before navigation can reuse it', async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);

  await store.defineGroup(page, { id: 'setup', label: 'Setup', pinned: true });
  await store.defineValue(page, { groupId: 'setup', value: 'alpha', label: 'Alpha' });
  const a = await store.newEntry(page);
  const b = await store.newEntry(page);
  await store.setEntryTags(page, a.id, [{ group: 'setup', value: 'alpha' }]);
  await store.setEntryTags(page, b.id, [{ group: 'setup', value: 'alpha' }]);
  await store.setEntryDate(page, a.id, '2026-05-20');
  await store.setEntryDate(page, b.id, '2026-05-10');
  await page.reload();
  await page.getByTestId('pivot-selector').click();
  await page.getByTestId('pivot-group-setup').click();

  const alpha = page.getByTestId('bucket-alpha').getByTestId('entry-item');
  await expect(alpha).toHaveCount(2);
  await alpha.first().click();
  await expect(alpha.first()).toHaveAttribute('data-entry-id', a.id);
  await page.getByTestId('tab-review').click();
  await page.getByTestId('qtag-setup-alpha').click();

  await expect(alpha).toHaveCount(1);
  await expect(alpha.first()).toHaveAttribute('data-entry-id', b.id);
  await expect(page.locator('.thumb.is-active')).toHaveCount(0);
  await hoverStage(page);
  await page.mouse.wheel(0, 240);
  await expect(alpha.first()).not.toHaveClass(/is-active/);

  await app.close();
});

test('the wheel scrolls a zoomed page and only steps to the next review at the bottom edge', async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);

  await page.keyboard.press('Control+n');
  await expect(page.getByTestId('editor')).toBeVisible();
  await page.keyboard.press('Control+n');
  await expect(page.getByTestId('entry-item')).toHaveCount(2);

  await page.getByTestId('entry-item').nth(0).click();
  await expect(page.getByTestId('entry-item').nth(0)).toHaveClass(/is-active/);

  // Zoom in past the fit until the stage genuinely has a vertical scrollbar.
  for (let i = 0; i < 15; i += 1) {
    const m = await stageMetrics(page);
    if (m.scroll > m.client + 40) break;
    await page.getByTestId('zoom-in').click();
  }
  const zoomed = await stageMetrics(page);
  expect(zoomed.scroll).toBeGreaterThan(zoomed.client + 40);

  // Mid-scroll: a wheel down scrolls the page — it must NOT jump to the next review.
  const mid = Math.floor((zoomed.scroll - zoomed.client) / 2);
  expect(await setStageScrollTop(page, mid)).toBeGreaterThan(0);
  await hoverStage(page);
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(300);
  expect(await activeIndex(page)).toBe(0);

  // At the bottom edge: a further wheel down steps to the next review.
  await setStageScrollTop(page, zoomed.scroll);
  await hoverStage(page);
  await page.mouse.wheel(0, 240);
  await expect(page.getByTestId('entry-item').nth(1)).toHaveClass(/is-active/);
  expect(await activeIndex(page)).toBe(1);

  await app.close();
});

test('the wheel walks the rail order and expands a collapsed bucket it lands in', async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);

  // Three blank reviews, dated into two month buckets (two in May, one in March).
  await page.keyboard.press('Control+n');
  await expect(page.getByTestId('editor')).toBeVisible();
  await page.keyboard.press('Control+n');
  await page.keyboard.press('Control+n');
  await expect(page.getByTestId('entry-item')).toHaveCount(3);

  const [x, y, z] = (await store.listEntries(page)).map((e) => e.id);
  await store.setEntryDate(page, x, '2026-05-20'); // May
  await store.setEntryDate(page, y, '2026-05-10'); // May
  await store.setEntryDate(page, z, '2026-03-10'); // March
  await page.reload(); // a direct store write does not refresh App state — reload to rebuild the rail
  await expect(page.getByTestId('entry-item')).toHaveCount(3);

  // Default "All reviews" pivot, newest first → rail order [x (05-20), y (05-10), z (03-10)], grouped
  // into a May bucket (x, y) then a March bucket (z).
  await expect(page.getByTestId('bucket-2026-05')).toBeVisible();
  await expect(page.getByTestId('bucket-2026-03')).toBeVisible();

  // Collapse the May bucket: its two reviews leave the DOM but stay part of the rail order.
  await page.getByTestId('bucket-head-2026-05').click();
  await expect(page.getByTestId('bucket-head-2026-05')).toHaveClass(/is-collapsed/);
  await expect(page.getByTestId('entry-item')).toHaveCount(1); // only z (March) is shown

  // Open z (the sole visible review), then wheel UP to its rail neighbour y — which is hidden in the
  // collapsed May bucket. The wheel must reach it via the rail order (not the full library) and the
  // collapsed bucket must auto-expand so the landed review becomes visible.
  await page.getByTestId('entry-item').first().click();
  await expect(page.getByTestId('editor')).toBeVisible();
  await hoverStage(page);
  await page.mouse.wheel(0, -240);

  await expect(page.getByTestId('bucket-head-2026-05')).not.toHaveClass(/is-collapsed/);
  await expect(page.getByTestId('entry-item')).toHaveCount(3);
  // y is the middle rail row (index 1) of [x, y, z] and is now the active review.
  await expect.poll(() => activeIndex(page)).toBe(1);

  await app.close();
});
