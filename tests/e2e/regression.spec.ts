import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, store } from './electronApp';

function tempDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'tj-regress-'));
}

const CANVAS = '.canvas-container';
const SCENE_W = 3482;
const SCENE_H = 1600;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function canvasBox(page: Page): Promise<Box> {
  const c = page.locator(CANVAS);
  await expect(c).toBeVisible();
  await page.waitForTimeout(300);
  const b = await c.boundingBox();
  if (!b) throw new Error('canvas has no bounding box');
  return b;
}

function pos(box: Box, sx: number, sy: number): { x: number; y: number } {
  return { x: (sx / SCENE_W) * box.width, y: (sy / SCENE_H) * box.height };
}

/** A stamp saved by the pre-unified-canvas version sat at page-region coordinates (~0–240). */
async function seedLegacyStamp(page: Page): Promise<void> {
  await store.saveStampLibrary(
    page,
    JSON.stringify({
      version: '6',
      objects: [
        {
          type: 'Rect',
          left: 60,
          top: 60,
          width: 120,
          height: 80,
          fill: 'transparent',
          stroke: '#f85149',
          strokeWidth: 3,
          tjId: 'legacy-stamp',
          tjTags: [],
        },
      ],
    }),
  );
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(300);
}

async function newReview(page: Page): Promise<string> {
  await page.getByTestId('tab-home').click();
  await page.getByTestId('ribbon-new').click();
  await expect(page.getByTestId('editor')).toBeVisible();
  const id = (await store.listEntries(page))[0]?.id;
  if (!id) throw new Error('expected an open review');
  return id;
}

/** Draw one page rectangle and persist the review via the Save button. */
async function drawAndSave(page: Page, entryId: string): Promise<void> {
  const box = await canvasBox(page);
  await page.getByTestId('tool-rect').click();
  await page.locator(CANVAS).hover({ position: pos(box, 400, 320), force: true });
  await page.mouse.down();
  await page.locator(CANVAS).hover({ position: pos(box, 720, 540), force: true });
  await page.mouse.up();
  await page.keyboard.press('Control+s');
  await expect.poll(async () => (await store.getEntry(page, entryId))?.annotations.length ?? 0).toBeGreaterThan(0);
}

test('a legacy page-coordinate library stamp is healed into the strip, never onto the page', async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);
  await seedLegacyStamp(page);

  const entryId = await newReview(page);
  await drawAndSave(page, entryId);

  // The legacy stamp was healed into the strip: it is NOT an Entry annotation, and only the drawn
  // rectangle is projected (Bug: it used to render on the page and be projected as an annotation).
  const anns = (await store.getEntry(page, entryId))?.annotations ?? [];
  expect(anns.map((a) => a.id)).not.toContain('legacy-stamp');
  expect(anns).toHaveLength(1);

  // The library stamp now lives in the strip region (its left is past the page + divider).
  const lib = JSON.parse((await store.getStampLibrary(page)).canvasJson) as { objects?: { left?: number }[] };
  expect(lib.objects?.[0]?.left ?? 0).toBeGreaterThanOrEqual(2900);

  await app.close();
});

test('saving several reviews in a row with a palette stamp never collides on annotation id', async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);
  await seedLegacyStamp(page);

  // Each review draws + saves. Before the fix, the legacy page-coord stamp was projected for every
  // entry, so the SECOND save hit `UNIQUE constraint failed: annotations.id` and rolled back.
  const ids: string[] = [];
  for (let i = 0; i < 3; i += 1) {
    const id = await newReview(page);
    await drawAndSave(page, id);
    ids.push(id);
  }

  expect(new Set(ids).size).toBe(3);
  const collated: string[] = [];
  for (const id of ids) {
    const anns = (await store.getEntry(page, id))?.annotations ?? [];
    expect(anns).toHaveLength(1); // each entry kept exactly its own drawing
    expect(anns.map((a) => a.id)).not.toContain('legacy-stamp');
    collated.push(...anns.map((a) => a.id));
  }
  // Every projected annotation id is globally unique (no cross-entry collision).
  expect(new Set(collated).size).toBe(collated.length);

  await app.close();
});

test('a blank new review opens with an empty page', async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);
  await seedLegacyStamp(page);

  // Build a first review so the palette (and its healed stamp) round-trips.
  const first = await newReview(page);
  await drawAndSave(page, first);

  // A freshly created review must carry no page annotations of its own.
  const second = await newReview(page);
  const anns = (await store.getEntry(page, second))?.annotations ?? [];
  expect(anns).toHaveLength(0);

  await app.close();
});

test('pressing a locked drawing does not pull out a marquee that grabs other objects', async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);
  const entryId = await newReview(page);
  const box = await canvasBox(page);

  const drawRect = async (a: [number, number], b: [number, number]): Promise<void> => {
    await page.getByTestId('tool-rect').click();
    await page.locator(CANVAS).hover({ position: pos(box, a[0], a[1]), force: true });
    await page.mouse.down();
    await page.locator(CANVAS).hover({ position: pos(box, b[0], b[1]), force: true });
    await page.mouse.up();
  };

  // A = the drawing we lock; B = a bystander the marquee must never grab.
  await drawRect([300, 300], [520, 460]);
  await drawRect([700, 560], [980, 760]);
  await page.keyboard.press('Control+s');
  await expect.poll(async () => (await store.getEntry(page, entryId))?.annotations.length ?? 0).toBe(2);

  // Lock A (right-click its centre → Lock).
  await page.locator(CANVAS).click({ button: 'right', position: pos(box, 410, 380), force: true });
  await page.getByTestId('menu-lock').click();
  await expect.poll(async () => (await store.getEntry(page, entryId))?.canvasJson ?? '').toContain('"tjLocked":true');

  // Press-drag STARTING on locked A, sweeping a rubber-band across B. A locked (non-selectable) object
  // must NOT start a group-selection marquee — Fabric otherwise would, grabbing B.
  await page.locator(CANVAS).hover({ position: pos(box, 410, 380), force: true });
  await page.mouse.down();
  await page.locator(CANVAS).hover({ position: pos(box, 720, 600), force: true });
  await page.locator(CANVAS).hover({ position: pos(box, 1050, 820), force: true });
  await page.mouse.up();

  // If a marquee had grabbed B, Delete would remove it. With the press inert, B survives.
  await page.keyboard.press('Delete');
  await page.waitForTimeout(400);
  const anns = (await store.getEntry(page, entryId))?.annotations ?? [];
  expect(anns).toHaveLength(2);

  await app.close();
});

test('Ctrl+Z undoes the last drawing and persists the undone page', async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);
  const entryId = await newReview(page);
  const box = await canvasBox(page);

  await page.getByTestId('tool-rect').click();
  await page.locator(CANVAS).hover({ position: pos(box, 400, 320), force: true });
  await page.mouse.down();
  await page.locator(CANVAS).hover({ position: pos(box, 760, 560), force: true });
  await page.mouse.up();
  await expect.poll(async () => (await store.getEntry(page, entryId))?.annotations.length ?? 0).toBe(1);

  // Ctrl+Z removes the rectangle, and the undone (empty) page is persisted.
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await store.getEntry(page, entryId))?.annotations.length ?? 0).toBe(0);

  await app.close();
});
