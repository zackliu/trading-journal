import { test, expect } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, store } from './electronApp';

function tempDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'tj-entry-date-'));
}

test('setting a review date replaces the single structural date and drives rail order', async () => {
  const { app, page } = await launchApp(tempDataDir());

  await page.getByTestId('tab-home').click();
  await page.getByTestId('ribbon-new').click();
  await expect(page.getByTestId('editor')).toBeVisible();
  const a = (await store.listEntries(page))[0]?.id as string;
  await page.getByTestId('tab-home').click();
  await page.getByTestId('ribbon-new').click();
  await expect(page.getByTestId('editor')).toBeVisible();
  const b = (await store.listEntries(page))[0]?.id as string;

  // Give them explicit, different dates (the structural "time" of each review).
  await store.setEntryDate(page, a, '2026-03-10');
  await store.setEntryDate(page, b, '2025-11-01');

  // Still exactly one date tag per entry, updated to the new value (never clobbered / duplicated).
  const ea = await store.getEntry(page, a);
  expect(ea?.entryTags.filter((t) => t.group === 'date')).toEqual([{ group: 'date', value: '2026-03-10' }]);

  // Queryable by the new date.
  expect((await store.queryEntriesByTag(page, { group: 'date', value: '2026-03-10' })).map((e) => e.id)).toContain(a);

  // The rail is ordered by date (newest day first): a (2026-03) before b (2025-11).
  const order = (await store.listEntries(page)).map((e) => e.id);
  expect(order.indexOf(a)).toBeLessThan(order.indexOf(b));
  expect((await store.listEntries(page)).find((e) => e.id === a)?.date).toBe('2026-03-10');

  await app.close();
});

test('the Review tab date input edits the review date', async () => {
  const { app, page } = await launchApp(tempDataDir());
  await page.getByTestId('ribbon-new').click();
  const id = (await store.listEntries(page))[0]?.id as string;

  await page.getByTestId('tab-review').click();
  await expect(page.getByTestId('review-date')).toBeVisible();

  await page.getByTestId('review-date').fill('2024-12-25');
  await expect
    .poll(async () => (await store.getEntry(page, id))?.entryTags.find((t) => t.group === 'date')?.value)
    .toBe('2024-12-25');

  // And it remains a single structural date row.
  expect((await store.getEntry(page, id))?.entryTags.filter((t) => t.group === 'date')).toHaveLength(1);

  await app.close();
});
