import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, store } from './electronApp';

// A 1x1 PNG so the pasted image deterministically fills the work area.
const PNG_A =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const TITLE_H = 100; // must match the controller's title-band height
const CANVAS = '.canvas-container';
const SCENE_W = 3280;
const SCENE_H = 1600;

function tempDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'tj-title-'));
}

function pos(box: { width: number; height: number }, sx: number, sy: number): { x: number; y: number } {
  return { x: (sx / SCENE_W) * box.width, y: (sy / SCENE_H) * box.height };
}

async function newReview(page: Page): Promise<string> {
  await page.getByTestId('ribbon-new').click();
  await expect(page.getByTestId('editor')).toBeVisible();
  const id = (await store.listEntries(page))[0]?.id;
  if (!id) throw new Error('expected an open review');
  return id;
}

async function pasteImage(page: Page, base64Png: string): Promise<void> {
  await page.evaluate((b64) => {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const file = new File([bytes], 'screenshot.png', { type: 'image/png' });
    const data = new DataTransfer();
    data.items.add(file);
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, base64Png);
}

test('a new review has a structural title box that is not a queryable annotation', async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);
  const entryId = await newReview(page);
  await page.keyboard.press('Control+s');

  // The (empty) title box is saved in the canvas JSON...
  await expect.poll(async () => (await store.getEntry(page, entryId))?.canvasJson ?? '').toContain('"tjRole":"title"');
  // ...but it carries no tjId, so it never projects into the annotation index.
  const anns = (await store.getEntry(page, entryId))?.annotations ?? [];
  expect(anns).toHaveLength(0);

  await app.close();
});

test('a pasted image lands in the work area below the title band', async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);
  const entryId = await newReview(page);
  await pasteImage(page, PNG_A);

  await expect.poll(async () => (await store.getEntry(page, entryId))?.canvasJson ?? '').toContain('tj-image://');
  const parsed = JSON.parse((await store.getEntry(page, entryId))?.canvasJson ?? '{}') as {
    objects?: { src?: string; top?: number }[];
  };
  const image = (parsed.objects ?? []).find((o) => typeof o.src === 'string' && o.src.startsWith('tj-image://'));
  expect(image).toBeTruthy();
  expect(image?.top ?? 0).toBeGreaterThanOrEqual(TITLE_H - 0.5);

  await app.close();
});

test('an empty title box is kept after entering and leaving edit (not discarded)', async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);
  const entryId = await newReview(page);
  await page.keyboard.press('Control+s');
  await expect.poll(async () => (await store.getEntry(page, entryId))?.canvasJson ?? '').toContain('"tjRole":"title"');

  const box = (await page.locator(CANVAS).boundingBox())!;
  // Double-click into the title band to edit, then click into the work area to leave without typing.
  await page.locator(CANVAS).dblclick({ position: pos(box, 220, 75), force: true });
  await page.waitForTimeout(150);
  await page.locator(CANVAS).click({ position: pos(box, 1200, 900), force: true });
  await page.waitForTimeout(300);

  // The empty title is exempt from the "discard empty text box" rule — it is still there.
  const json = (await store.getEntry(page, entryId))?.canvasJson ?? '';
  expect(json).toContain('"tjRole":"title"');

  await app.close();
});
