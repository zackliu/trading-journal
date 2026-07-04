import { test, expect } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, store } from './electronApp';

function tempDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'tj-ribbon-'));
}

// The ribbon's natural height must be identical on every tab, regardless of each tab's content
// (Draw's dense tools, the Review/Annotation quick-pick, the placeholder tabs). It is pinned to a
// fixed height; this guards that invariant so a future change can't let one tab grow taller.
test('the ribbon band is the same height on every tab', async () => {
  const { app, page } = await launchApp(tempDataDir());
  // A pinned group gives the Review tab real content (the worst case for growth).
  await store.defineGroup(page, { id: 'day-structure', label: 'Day Structure', pinned: true });
  await store.defineValue(page, { groupId: 'day-structure', value: 'trd', label: 'TRD' });
  await store.defineValue(page, { groupId: 'day-structure', value: 'bull', label: 'Bull Trend' });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.getByTestId('ribbon-new').click(); // open a review so Review has content

  const band = page.getByTestId('ribbon').locator('.ribbon__band');
  const heights: number[] = [];
  for (const tab of ['home', 'draw', 'review', 'view', 'stats']) {
    await page.getByTestId(`tab-${tab}`).click();
    const box = await band.boundingBox();
    heights.push(box?.height ?? -1);
  }

  expect(new Set(heights).size).toBe(1); // strictly one height across all tabs

  await app.close();
});
