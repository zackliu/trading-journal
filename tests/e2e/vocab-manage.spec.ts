import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, store } from './electronApp';

function tempDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'tj-vocab-manage-'));
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

// ---- Rename (display label only; the stable id never changes) ----

test('renaming a group or value in Settings changes only the display label, keeping the id', async () => {
  const { app, page } = await launchApp(tempDataDir());

  await page.getByTestId('ribbon-settings').click();
  await expect(page.getByTestId('settings-dialog')).toBeVisible();
  await page.getByTestId('settings-group-name').fill('Setup');
  await page.getByTestId('settings-add-group').click();
  await page.getByTestId('settings-add-value-setup').fill('Trend');
  await page.getByTestId('settings-add-value-setup').press('Enter');
  await expect(page.getByTestId('settings-value-setup-trend')).toBeVisible();

  // Rename the group: pencil → input → Enter.
  await page.getByTestId('settings-group-name-setup-edit').click();
  await page.getByTestId('settings-group-name-setup-input').fill('Entry Setup');
  await page.getByTestId('settings-group-name-setup-input').press('Enter');
  await expect(page.getByTestId('settings-group-setup')).toContainText('Entry Setup');

  // Rename the value the same way.
  await page.getByTestId('settings-value-name-setup-trend-edit').click();
  await page.getByTestId('settings-value-name-setup-trend-input').fill('Pullback Trend');
  await page.getByTestId('settings-value-name-setup-trend-input').press('Enter');
  await expect(page.getByTestId('settings-value-setup-trend')).toContainText('Pullback Trend');

  // The ids are untouched — only the labels moved.
  const group = (await store.listGroups(page)).find((g) => g.id === 'setup');
  expect(group?.label).toBe('Entry Setup');
  expect(group?.values.find((v) => v.value === 'trend')?.label).toBe('Pullback Trend');

  await app.close();
});

// ---- Soft-delete: an unused entry archives without a prompt and can be restored ----

test('deleting an unused value archives it silently, and Archived can restore it', async () => {
  const { app, page } = await launchApp(tempDataDir());

  await page.getByTestId('ribbon-settings').click();
  await page.getByTestId('settings-group-name').fill('Setup');
  await page.getByTestId('settings-add-group').click();
  await page.getByTestId('settings-add-value-setup').fill('Trend');
  await page.getByTestId('settings-add-value-setup').press('Enter');
  await expect(page.getByTestId('settings-value-setup-trend')).toBeVisible();

  // Unused (count 0) → deletes straight away, no confirmation.
  await page.getByTestId('settings-del-value-setup-trend').click();
  await expect(page.getByTestId('confirm-dialog')).toHaveCount(0);
  await expect(page.getByTestId('settings-value-setup-trend')).toHaveCount(0);

  // It is archived, not destroyed — Archived lists it and restores it.
  await page.getByTestId('settings-archived-toggle').click();
  await expect(page.getByTestId('settings-archived-value-setup-trend')).toBeVisible();
  await page.getByTestId('settings-restore-value-setup-trend').click();
  await expect(page.getByTestId('settings-value-setup-trend')).toBeVisible();
  expect((await store.listGroups(page)).find((g) => g.id === 'setup')?.values.map((v) => v.value)).toEqual(['trend']);

  await app.close();
});

// ---- Soft-delete: an in-use entry asks first, then archives (restorable) ----

test('deleting an in-use value confirms first, then archives it (recoverable)', async () => {
  const { app, page } = await launchApp(tempDataDir());
  await store.defineGroup(page, { id: 'setup', label: 'Setup', pinned: true });
  await store.defineValue(page, { groupId: 'setup', value: 'h2' });
  await reload(page);

  // Put the value in use: tag an annotation with setup:h2.
  await page.getByTestId('ribbon-new').click();
  const box = await canvasBox(page);
  await page.getByTestId('tool-rect').click();
  await drag(page, box, 40, 40, 240, 160);
  await expect(page.getByTestId('tab-annotation')).toBeVisible();
  await page.getByTestId('tab-annotation').click();
  await page.getByTestId('qtag-setup-h2').click();
  await expect.poll(async () => (await store.queryByTag(page, { group: 'setup', value: 'h2' })).length).toBe(1);

  await page.getByTestId('tab-home').click();
  await page.getByTestId('ribbon-settings').click();
  await expect(page.getByTestId('settings-value-setup-h2').locator('.svalue__count')).toHaveText('1');

  // In use (count 1) → a confirmation appears; cancelling keeps the value.
  await page.getByTestId('settings-del-value-setup-h2').click();
  await expect(page.getByTestId('confirm-dialog')).toBeVisible();
  await expect(page.getByTestId('confirm-dialog')).toContainText('1 review');
  await page.getByTestId('confirm-cancel').click();
  await expect(page.getByTestId('settings-value-setup-h2')).toBeVisible();

  // Confirming archives it — hidden from the active list but kept and restorable.
  await page.getByTestId('settings-del-value-setup-h2').click();
  await page.getByTestId('confirm-ok').click();
  await expect(page.getByTestId('settings-value-setup-h2')).toHaveCount(0);
  await page.getByTestId('settings-archived-toggle').click();
  await expect(page.getByTestId('settings-archived-value-setup-h2')).toBeVisible();
  await page.getByTestId('settings-restore-value-setup-h2').click();
  await expect(page.getByTestId('settings-value-setup-h2')).toBeVisible();

  // The tag usage was never touched by archiving/restoring the registry entry.
  expect((await store.queryByTag(page, { group: 'setup', value: 'h2' })).length).toBe(1);

  await app.close();
});
