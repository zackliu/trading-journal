import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, store } from './electronApp';

function tempDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'tj-slice4-'));
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function canvasBox(page: Page): Promise<Box> {
  const container = page.locator('.canvas-container');
  await expect(container).toBeVisible();
  await page.waitForTimeout(300);
  const box = await container.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  return box;
}

async function drag(page: Page, box: Box, x1: number, y1: number, x2: number, y2: number): Promise<void> {
  await page.mouse.move(box.x + x1, box.y + y1);
  await page.mouse.down();
  await page.mouse.move(box.x + x2, box.y + y2, { steps: 6 });
  await page.mouse.up();
}

async function firstEntryId(page: Page): Promise<string> {
  const list = await store.listEntries(page);
  const id = list[0]?.id;
  if (!id) throw new Error('expected an entry');
  return id;
}

test('a trade records a typed result via presets on the Annotation tab', async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);

  await page.getByTestId('ribbon-new').click();
  await expect(page.getByTestId('editor')).toBeVisible();
  const box = await canvasBox(page);
  const entryId = await firstEntryId(page);

  // Draw a trade annotation (auto-selected → the Annotation tab appears).
  await page.getByTestId('tool-rect').click();
  await drag(page, box, 40, 40, 240, 160);

  // Define result types in Settings: a number (R Multiple) and a choices dimension (Outcome: win / loss).
  await page.getByTestId('tab-home').click();
  await page.getByTestId('ribbon-result-settings').click();
  await expect(page.getByTestId('result-settings')).toBeVisible();
  await page.getByTestId('result-dim-name').fill('R Multiple');
  await page.getByTestId('result-dim-type').selectOption('number');
  await page.getByTestId('result-add-dim').click();
  await page.getByTestId('result-dim-name').fill('Outcome');
  await page.getByTestId('result-dim-type').selectOption('string');
  await page.getByTestId('result-add-dim').click();
  await page.getByTestId('result-add-value-outcome').fill('win');
  await page.getByTestId('result-add-value-outcome').press('Enter');
  await page.getByTestId('result-add-value-outcome').fill('loss');
  await page.getByTestId('result-add-value-outcome').press('Enter');
  await page.getByTestId('result-settings-close').click();

  // Record the result on the Annotation tab: type the number, click the Outcome preset chip.
  await page.getByTestId('tab-annotation').click();
  await page.getByTestId('rquick-num-r-multiple').fill('2');
  await page.getByTestId('rquick-outcome-win').click();

  await expect
    .poll(async () => (await store.getEntry(page, entryId))?.annotations[0]?.result ?? null)
    .toEqual({ 'r-multiple': 2, outcome: 'win' });

  // Clicking the active Outcome preset clears just that dimension; the number survives.
  await page.getByTestId('rquick-outcome-win').click();
  await expect
    .poll(async () => (await store.getEntry(page, entryId))?.annotations[0]?.result ?? null)
    .toEqual({ 'r-multiple': 2 });

  await app.close();
});
