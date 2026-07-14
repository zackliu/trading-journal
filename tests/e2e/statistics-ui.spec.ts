import { expect, test, type Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Annotation, Result } from '../../src/shared/domain';
import { launchApp, store } from './electronApp';

function tempDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'tj-stats-ui-'));
}

function localDay(offset: number): string {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const BOUNDS = { x: 200, y: 180, width: 220, height: 130 };

function annotation(id: string, tags: Annotation['tags'], result?: Result, left = 200): Annotation {
  return { id, bounds: { ...BOUNDS, x: left }, tags, result, links: [] };
}

function canvasJson(annotations: Annotation[]): string {
  return JSON.stringify({
    version: '6.9.1',
    tjPage: { width: 2900, height: 1600 },
    objects: annotations.map((item, index) => ({
      type: 'Rect',
      originX: 'left',
      originY: 'top',
      left: item.bounds.x,
      top: item.bounds.y + index * 190,
      width: item.bounds.width,
      height: item.bounds.height,
      scaleX: 1,
      scaleY: 1,
      fill: 'transparent',
      stroke: index % 2 === 0 ? '#b13f3a' : '#4165cc',
      strokeWidth: 4,
      tjId: item.id,
      tjTags: item.tags,
      tjResult: item.result,
      tjLinks: item.links,
    })),
  });
}

async function reload(page: Page): Promise<void> {
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
}

async function drawRectangle(page: Page): Promise<void> {
  await expect(page.getByTestId('editor')).toHaveAttribute('aria-busy', 'false');
  await page.getByTestId('tool-rect').click();
  const box = await page.locator('.canvas-container').boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  await page.mouse.move(box.x + 70, box.y + 70);
  await page.mouse.down();
  await page.mouse.move(box.x + 220, box.y + 160, { steps: 6 });
  await page.mouse.up();
}

async function seedFullStudy(page: Page): Promise<void> {
  await store.defineGroup(page, { id: 'day', label: 'Day', pinned: false });
  await store.defineValue(page, { groupId: 'day', value: 'bull', label: 'Bull' });
  await store.defineValue(page, { groupId: 'day', value: 'bear', label: 'Bear' });
  await store.defineGroup(page, { id: 'setup', label: 'Setup', pinned: false });
  await store.defineValue(page, { groupId: 'setup', value: 'h2', label: 'H2' });
  await store.defineGroup(page, { id: 'context', label: 'Context', pinned: false });
  await store.defineValue(page, { groupId: 'context', value: 'trend', label: 'Trend' });
  await store.defineValue(page, { groupId: 'context', value: 'range', label: 'Range' });
  await store.defineDimension(page, { id: 'r', label: 'R multiple', type: 'number' });
  await store.defineDimension(page, { id: 'outcome', label: 'Outcome', type: 'string' });
  await store.defineResultValue(page, 'outcome', 'win', 'Win');
  await store.defineResultValue(page, 'outcome', 'loss', 'Loss');

  const a1 = annotation(
    'a1',
    [
      { group: 'setup', value: 'h2' },
      { group: 'context', value: 'trend' },
    ],
    { r: 2, outcome: 'win' },
    200,
  );
  const a2 = annotation(
    'a2',
    [
      { group: 'setup', value: 'h2' },
      { group: 'context', value: 'trend' },
    ],
    { r: -1, outcome: 'loss' },
    560,
  );
  await store.createEntry(page, {
    canvasJson: canvasJson([a1, a2]),
    entryTags: [
      { group: 'date', value: localDay(0) },
      { group: 'day', value: 'bull' },
    ],
    annotations: [a1, a2],
  });

  const b1 = annotation(
    'b1',
    [
      { group: 'setup', value: 'h2' },
      { group: 'context', value: 'range' },
    ],
    { r: 0, outcome: 'loss' },
  );
  const b2 = annotation(
    'b2',
    [
      { group: 'setup', value: 'h2' },
      { group: 'context', value: 'range' },
    ],
    { r: -1 },
    560,
  );
  await store.createEntry(page, {
    canvasJson: canvasJson([b1, b2]),
    entryTags: [
      { group: 'date', value: localDay(-40) },
      { group: 'day', value: 'bear' },
    ],
    annotations: [b1, b2],
  });
  await reload(page);
}

async function buildBiasedView(page: Page): Promise<void> {
  await page.getByTestId('tab-view').click();
  await page.getByTestId('view-edit').click();
  await page.getByTestId('add-group-entry').selectOption('day');
  await page.getByTestId('vchip-entry-day-bull').click();
  await page.getByTestId('add-group-annotation').selectOption('setup');
  await page.getByTestId('vchip-annotation-setup-h2').click();
  await page.getByTestId('add-result').selectOption('outcome');
  await page.getByTestId('rchip-outcome-win').click();
  await page.getByTestId('view-apply').click();
}

test('Stats shows a direct empty state when no result dimension exists', async () => {
  const { app, page } = await launchApp(tempDataDir());
  await page.getByTestId('tab-stats').click();
  await expect(page.getByTestId('stats-workspace')).toBeVisible();
  await expect(page.getByTestId('stats-empty-dimensions')).toBeVisible();
  await app.close();
});

test('period presets use the structural review date with inclusive calendar windows', async () => {
  const { app, page } = await launchApp(tempDataDir());
  await seedFullStudy(page);
  await page.getByTestId('tab-stats').click();
  await page.getByTestId('stats-measure').selectOption('r');
  await expect(page.getByTestId('stats-population-count')).toContainText('4');

  await page.getByTestId('stats-period-30d').click();
  await expect(page.getByTestId('stats-population-count')).toContainText('2');
  await page.getByTestId('stats-scope-count').click();
  await expect(page.getByTestId('stats-examples-bar')).toContainText('matching scope Entries');
  await expect(page.getByTestId('stats-examples-rail').getByTestId('entry-item')).toHaveCount(1);
  await expect(page.getByTestId('stats-example-position')).toHaveCount(0);
  await page.getByTestId('stats-back').click();
  await page.getByTestId('stats-period-90d').click();
  await expect(page.getByTestId('stats-population-count')).toContainText('4');

  await page.getByTestId('stats-period-custom').click();
  await page.getByTestId('stats-date-from').fill(localDay(-40));
  await page.getByTestId('stats-date-to').fill(localDay(-40));
  await expect(page.getByTestId('stats-population-count')).toContainText('2');
  await page.getByTestId('stats-date-from').fill(localDay(1));
  await page.getByTestId('stats-date-to').fill(localDay(1));
  await expect(page.getByTestId('stats-scope-count')).toBeDisabled();
  await expect(page.getByTestId('stats-population-count')).toContainText('0');
  await app.close();
});

test('Stats strips View result selection, compares one group, and returns to exact canvas evidence', async () => {
  const { app, page } = await launchApp(tempDataDir());
  await seedFullStudy(page);
  await buildBiasedView(page);

  await page.getByTestId('tab-stats').click();
  await expect(page.getByTestId('stats-report')).toBeVisible();
  await expect(page.getByTestId('stats-result-filter-warning')).toContainText('Ignored 1 result filter');
  await expect(page.getByTestId('stats-population-count')).toContainText('2');
  await page.getByTestId('stats-measure').selectOption('r');
  await expect(page.getByTestId('stats-number-mean')).toHaveText('0.5');

  await page.getByTestId('stats-threshold-op').selectOption('gte');
  await page.getByTestId('stats-threshold-value').fill('1');
  await expect(page.getByTestId('stats-number-threshold')).toContainText('50%');
  await expect(page.getByTestId('stats-number-threshold')).toContainText('1 / 2');

  await page.getByTestId('stats-compare-picker').selectOption('annotation:context');
  await expect(page.getByTestId('stats-compare')).toBeVisible();
  await expect(page.locator('[data-testid="stats-cohort"][data-value="trend"]')).toContainText('2');
  await expect(page.locator('[data-testid="stats-cohort"][data-value="__none__"]')).toContainText('0');

  const trendRow = page.locator('[data-testid="stats-cohort"][data-value="trend"]');
  await trendRow.getByTestId('stats-cohort-threshold-match').click();
  await expect(page.getByTestId('stats-example-position')).toHaveText('1 / 1');
  await page.getByTestId('stats-back').click();

  const scrollBefore = await page.evaluate(() => {
    const workspace = document.querySelector('[data-testid="stats-workspace"]') as HTMLElement;
    workspace.scrollTop = 180;
    const button = document.querySelector('[data-testid="stats-review-all"]') as HTMLButtonElement;
    button.click();
    return workspace.scrollTop;
  });

  await expect(page.getByTestId('stats-examples-bar')).toBeVisible();
  await expect(page.getByTestId('stats-examples-rail').getByTestId('entry-item')).toHaveCount(1);
  await expect(page.getByTestId('stats-example-position')).toHaveText('1 / 2');
  await expect(page.getByTestId('tab-annotation')).toBeVisible();
  await expect(page.getByTestId('tab-stats')).toHaveClass(/is-active/);
  await page.getByTestId('stats-example-next').click();
  await expect(page.getByTestId('stats-example-position')).toHaveText('2 / 2');
  expect(await store.listSavedViews(page)).toHaveLength(0);

  await page.getByTestId('stats-back').click();
  await expect(page.getByTestId('stats-report')).toBeVisible();
  await expect(page.getByTestId('stats-threshold-value')).toHaveValue('1');
  await expect(page.getByTestId('stats-compare-picker')).toHaveValue('annotation:context');
  await expect.poll(() => page.evaluate(() => (document.querySelector('[data-testid="stats-workspace"]') as HTMLElement).scrollTop)).toBe(scrollBefore);

  await page.getByTestId('stats-review-all').click();
  await expect(page.getByTestId('stats-example-position')).toHaveText('1 / 2');
  await expect(page.getByTestId('stats-measure')).toBeDisabled();
  await expect(page.getByTestId('stats-period-all')).toBeDisabled();
  await expect(page.getByTestId('stats-compare-picker')).toBeDisabled();
  await page.getByTestId('tab-annotation').click();
  await expect(page.getByTestId('stats-examples-bar')).toBeVisible();
  await page.getByTestId('rquick-num-r').fill('4');
  await expect.poll(async () => {
    const entries = await store.listEntries(page);
    const entry = entries.find((item) => item.date === localDay(0));
    return entry ? (await store.getEntry(page, entry.id))?.annotations.find((item) => item.id === 'a1')?.result?.r : null;
  }).toBe(4);
  await expect(page.getByTestId('stats-examples-bar')).toBeVisible();
  await page.getByTestId('stats-back').click();
  await expect(page.getByTestId('stats-number-mean')).toHaveText('1.5');

  await page.getByTestId('tab-draw').click();
  await expect(page.getByTestId('stats-workspace')).toHaveCount(0);
  await expect(page.getByTestId('editor')).toBeVisible();
  await app.close();
});

test('string compare keeps category colors stable and every segment returns to evidence', async () => {
  const { app, page } = await launchApp(tempDataDir());
  await seedFullStudy(page);
  await page.getByTestId('tab-stats').click();
  await page.getByTestId('stats-measure').selectOption('outcome');
  await page.getByTestId('stats-compare-picker').selectOption('annotation:context');

  await expect(page.getByTestId('stats-overall').getByRole('heading')).toHaveText('All result-bearing samples');
  await expect(page.getByTestId('stats-coverage')).toContainText('Recorded Outcome / result-bearing samples');
  await expect(page.getByTestId('stats-compare').locator('thead')).toContainText('Recorded / result-bearing');
  await expect(page.getByTestId('stats-missing')).toContainText('Not recorded for Outcome / result-bearing samples');
  await page.getByTestId('stats-missing').click();
  await expect(page.getByTestId('stats-examples-bar')).toContainText(
    'not recorded for Outcome / result-bearing samples',
  );
  await page.getByTestId('stats-back').click();
  const overallLossKey = page
    .getByTestId('stats-overall')
    .locator('[data-testid="stats-string-segment"][data-value="loss"] .stats-dist__key');
  const rangeLossSegment = page
    .locator('[data-testid="stats-cohort"][data-value="range"]')
    .locator('[data-testid="stats-string-segment"][data-value="loss"]');
  await expect(overallLossKey).toBeVisible();
  await expect(rangeLossSegment.locator('.stats-dist__key')).toHaveAttribute(
    'class',
    await overallLossKey.getAttribute('class') as string,
  );

  await rangeLossSegment.click();
  await expect(page.getByTestId('stats-example-position')).toHaveText('1 / 1');
  await expect(page.getByTestId('tab-annotation')).toBeVisible();
  await page.getByTestId('stats-back').click();
  await app.close();
});

test('deleting an evidence review closes the session and recalculates statistics', async () => {
  const { app, page } = await launchApp(tempDataDir());
  await seedFullStudy(page);
  await page.getByTestId('tab-stats').click();
  await page.getByTestId('stats-measure').selectOption('r');
  await expect(page.getByTestId('stats-population-count')).toContainText('4');
  await page.getByTestId('stats-review-all').click();
  const evidenceItems = page.getByTestId('stats-examples-rail').getByTestId('entry-item');
  await expect(evidenceItems).toHaveCount(2);

  await evidenceItems.first().click({ button: 'right' });
  await page.getByTestId('context-delete').click();
  await page.getByTestId('confirm-ok').click();

  await expect(page.getByTestId('stats-examples-bar')).toHaveCount(0);
  await expect(page.getByTestId('stats-report')).toBeVisible();
  await expect(page.getByTestId('stats-population-count')).toContainText('2');
  await expect(page.getByTestId('stats-drill-error')).toContainText('review was deleted');
  expect(await store.listEntries(page)).toHaveLength(1);
  await app.close();
});

test('archived predicates remain visible and removable in the statistics sample editor', async () => {
  const { app, page } = await launchApp(tempDataDir());
  await store.defineGroup(page, { id: 'setup', label: 'Setup', pinned: false });
  await store.defineValue(page, { groupId: 'setup', value: 'h2', label: 'H2' });
  await store.defineDimension(page, { id: 'r', label: 'R multiple', type: 'number' });
  const sample = annotation('archived-filter-sample', [{ group: 'setup', value: 'h2' }], { r: 1 });
  await store.createEntry(page, {
    canvasJson: canvasJson([sample]),
    entryTags: [{ group: 'date', value: localDay(0) }],
    annotations: [sample],
  });
  const saved = await store.createSavedView(page, 'Archived setup', {
    entry: [],
    annotation: [{ group: 'setup', values: ['h2'] }],
    results: [],
  });
  await store.deleteGroup(page, 'setup');
  await reload(page);
  await page.getByTestId('tab-view').click();
  await page.getByTestId('view-picker').selectOption(saved.id);
  await page.getByTestId('tab-stats').click();
  await page.getByTestId('stats-edit-sample').click();

  const predicate = page.getByTestId('stats-pred-annotation-setup');
  await expect(predicate).toContainText('unavailable group');
  const chip = page.getByTestId('stats-chip-annotation-setup-h2');
  await expect(chip).toContainText('unavailable');
  await chip.click();
  await page.getByTestId('stats-sample-apply').click();
  await expect(page.getByTestId('stats-sample-summary')).toContainText('result-bearing samples');
  await app.close();
});

test('a failed dirty save blocks entry into the statistics workspace', async () => {
  const { app, page } = await launchApp(tempDataDir());
  await store.defineDimension(page, { id: 'r', label: 'R multiple', type: 'number' });
  const entry = await store.newEntry(page);
  await reload(page);
  await page.getByTestId('entry-item').click();
  await store.deleteEntry(page, entry.id);
  await drawRectangle(page);
  await expect(page.getByTestId('save-error')).toBeVisible();

  await page.getByTestId('tab-stats').click();
  await expect(page.getByTestId('stats-workspace')).toHaveCount(0);
  await expect(page.getByTestId('save-error')).toBeVisible();
  await expect(page.getByTestId('tab-draw')).toHaveClass(/is-active/);
  await app.close();
});

test('classification sample editing distinguishes no population from unrecorded results', async () => {
  const { app, page } = await launchApp(tempDataDir());
  await store.defineGroup(page, { id: 'setup', label: 'Setup', pinned: false });
  await store.defineValue(page, { groupId: 'setup', value: 'h2', label: 'H2' });
  await store.defineDimension(page, { id: 'r', label: 'R multiple', type: 'number' });
  const sample = annotation('missing-r', [{ group: 'setup', value: 'h2' }]);
  await store.createEntry(page, {
    canvasJson: canvasJson([sample]),
    entryTags: [{ group: 'date', value: localDay(0) }],
    annotations: [sample],
  });
  await reload(page);

  await page.getByTestId('tab-stats').click();
  await expect(page.getByTestId('stats-no-population')).toBeVisible();
  await page.getByTestId('stats-edit-sample').click();
  await page.getByTestId('stats-add-group-annotation').selectOption('setup');
  await page.getByTestId('stats-chip-annotation-setup-h2').click();
  await page.getByTestId('stats-sample-apply').click();

  await expect(page.getByTestId('stats-no-recorded')).toBeVisible();
  await expect(page.getByTestId('stats-population-count')).toContainText('1');
  await expect(page.getByTestId('stats-recorded')).toContainText('0');
  await expect(page.getByTestId('stats-missing')).toContainText('1');
  await page.getByRole('button', { name: 'Review missing examples' }).click();
  await expect(page.getByTestId('stats-examples-bar')).toBeVisible();
  await expect(page.getByTestId('tab-annotation')).toBeVisible();

  await app.close();
});