import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, store } from './electronApp';

function tempDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'tj-viewui-'));
}

const CANVAS = JSON.stringify({ version: '6', tjPage: { width: 2900, height: 1600 }, objects: [] });
const B = { x: 0, y: 0, width: 100, height: 100 };

/** Two reviews: one is a bull-day H2 win (the target), one is a bear-day wedge loss (a foil). */
async function seed(page: Page): Promise<void> {
  await store.defineGroup(page, { id: 'day-structure', label: 'Day Structure', pinned: true });
  await store.defineValue(page, { groupId: 'day-structure', value: 'bull', label: 'Bull' });
  await store.defineValue(page, { groupId: 'day-structure', value: 'bear', label: 'Bear' });
  await store.defineGroup(page, { id: 'setup', label: 'Setup', pinned: true });
  await store.defineValue(page, { groupId: 'setup', value: 'h2', label: 'H2' });
  await store.defineValue(page, { groupId: 'setup', value: 'wedge', label: 'Wedge' });
  await store.defineDimension(page, { id: 'outcome', label: 'Outcome', type: 'string' });
  await store.createEntry(page, {
    canvasJson: CANVAS,
    entryTags: [{ group: 'day-structure', value: 'bull' }],
    annotations: [{ id: 'm', bounds: B, tags: [{ group: 'setup', value: 'h2' }], result: { outcome: 'win' } }],
  });
  await store.createEntry(page, {
    canvasJson: CANVAS,
    entryTags: [{ group: 'day-structure', value: 'bear' }],
    annotations: [{ id: 'n', bounds: B, tags: [{ group: 'setup', value: 'wedge' }], result: { outcome: 'loss' } }],
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
}

/** Build "bull day · H2 · win" in the open View builder (entry + annotation + result). */
async function buildFilter(page: Page): Promise<void> {
  await page.getByTestId('view-edit').click();
  await page.getByTestId('view-builder').waitFor();
  await page.getByTestId('add-group-entry').selectOption('day-structure');
  await page.getByTestId('vchip-entry-day-structure-bull').click();
  await page.getByTestId('add-group-annotation').selectOption('setup');
  await page.getByTestId('vchip-annotation-setup-h2').click();
  await page.getByTestId('add-result').selectOption('outcome');
  await page.getByTestId('rchip-outcome-win').click();
}

function railItems(page: Page) {
  return page.getByTestId('group-browser').getByTestId('entry-item');
}

test('the View builder narrows the rail to matching reviews with entry/annotation chips', async () => {
  const { app, page } = await launchApp(tempDataDir());
  await seed(page);
  await expect(railItems(page)).toHaveCount(2);

  await page.getByTestId('tab-view').click();
  await buildFilter(page);
  await page.getByTestId('view-apply').click();

  // Only the bull-day H2 win survives; the filter is shown as scoped chips (entry vs annotation).
  await expect(page.getByTestId('filter-bar')).toBeVisible();
  await expect(railItems(page)).toHaveCount(1);
  await expect(page.locator('.fchip--entry')).toHaveText(/Bull/);
  await expect(page.locator('.fchip--annotation')).toHaveCount(2); // Setup + Outcome co-occur on one trade

  // Clearing restores the whole library.
  await page.getByTestId('filter-clear').click();
  await expect(page.getByTestId('filter-bar')).toHaveCount(0);
  await expect(railItems(page)).toHaveCount(2);

  await app.close();
});

test('a saved view is listed in the picker and reloading it re-runs the filter (not a folder)', async () => {
  const { app, page } = await launchApp(tempDataDir());
  await seed(page);

  await page.getByTestId('tab-view').click();
  await buildFilter(page);
  await page.getByTestId('view-name').fill('h2 wins');
  await page.getByTestId('view-save').click();
  await page.getByTestId('view-apply').click(); // apply + close
  await expect(railItems(page)).toHaveCount(1);

  // Clear, then reload the saved view from the ribbon picker — it re-runs the query.
  await page.getByTestId('filter-clear').click();
  await expect(railItems(page)).toHaveCount(2);
  await page.getByTestId('view-picker').selectOption({ label: 'h2 wins' });
  await expect(page.getByTestId('filter-bar')).toBeVisible();
  await expect(railItems(page)).toHaveCount(1);

  await app.close();
});
