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
