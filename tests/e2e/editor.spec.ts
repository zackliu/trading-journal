import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, store } from './electronApp';

const PNG_A =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function tempDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'tj-slice3-'));
}

function sha256(base64: string): string {
  return createHash('sha256').update(Buffer.from(base64, 'base64')).digest('hex');
}

/** Dispatch a real `paste` ClipboardEvent carrying an image file (the Ctrl+V path). */
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

test('the editor save path persists canvas JSON round-trip', async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);
  const entry = await store.ingestImage(page, PNG_A);

  const canvasJson = JSON.stringify({
    version: '6.0.0',
    objects: [{ type: 'Rect', left: 10, top: 20, width: 40, height: 30, stroke: '#f85149' }],
    tjPage: { width: 640, height: 480 },
  });
  const saved = await store.updateEntryCanvas(page, entry.id, canvasJson);
  expect(saved.canvasJson).toBe(canvasJson);

  // Reopening the data folder keeps the saved canvas verbatim (image stays a hash ref).
  const reloaded = await store.getEntry(page, entry.id);
  await app.close();
  expect(reloaded?.canvasJson).toBe(canvasJson);
  expect(reloaded?.image?.hash).toBe(entry.image?.hash);
});

test('New creates a blank review and opens a white page', async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);

  // An empty workspace shows the empty state; New starts a blank review.
  await expect(page.getByTestId('empty-state')).toBeVisible();
  await page.getByTestId('ribbon-new').click();

  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.locator('.canvas-container')).toBeVisible();
  // The unified ribbon's Draw tools are enabled once a review is open.
  await expect(page.getByTestId('tool-rect')).toBeEnabled();
  await page.screenshot({ path: 'test-results/editor.png' });

  // The blank review has no image yet.
  const list = await store.listEntries(page);
  expect(list).toHaveLength(1);
  expect(list[0]?.imageHash).toBeUndefined();

  await app.close();
});

test('opening an existing review shows the canvas editor', async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);
  await store.ingestImage(page, PNG_A);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  // A review thumbnail lives in the left rail; opening it shows the editor.
  await page.getByTestId('entry-item').first().click();
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('tool-rect')).toBeEnabled();

  await app.close();
});

test('right-clicking a review offers a delete action', async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);
  await store.ingestImage(page, PNG_A);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  await page.getByTestId('entry-item').first().click({ button: 'right' });
  await expect(page.getByTestId('context-menu')).toBeVisible();
  await page.getByTestId('context-delete').click();

  await expect(page.getByTestId('entry-item')).toHaveCount(0);
  await expect(page.getByTestId('empty-state')).toBeVisible();
  expect(await store.listEntries(page)).toHaveLength(0);

  await app.close();
});

test('pasting into an open review adds an image object referenced by hash', async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);

  await page.getByTestId('ribbon-new').click();
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.locator('.canvas-container')).toBeVisible();
  await page.waitForTimeout(300); // let the blank page finish loading before pasting

  await pasteImage(page, PNG_A);
  const hash = sha256(PNG_A);

  // Paste auto-saves: the canvas JSON references the image by hash (no base64 bytes).
  await expect
    .poll(async () => {
      const list = await store.listEntries(page);
      const id = list[0]?.id;
      if (!id) return '';
      const entry = await store.getEntry(page, id);
      return entry?.canvasJson ?? '';
    })
    .toContain(`tj-image://${hash}`);

  const list = await store.listEntries(page);
  const id = list[0]?.id;
  if (!id) throw new Error('expected one entry');
  const entry = await store.getEntry(page, id);
  expect(entry?.canvasJson).not.toContain('data:image');
  // The page is a fixed 2500×1600 slide, independent of the pasted image's size.
  const parsedPage = JSON.parse(entry?.canvasJson ?? '{}') as { tjPage?: { width?: number; height?: number } };
  expect(parsedPage.tjPage).toEqual({ width: 2500, height: 1600 });
  // The first image becomes the entry cover for the thumbnail.
  expect(list[0]?.imageHash).toBe(hash);

  await app.close();
});

test('finishing a shape returns to the select tool', async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);

  await page.getByTestId('ribbon-new').click();
  await expect(page.getByTestId('editor')).toBeVisible();
  const container = page.locator('.canvas-container');
  await expect(container).toBeVisible();
  await page.waitForTimeout(300); // let the blank page finish loading before drawing

  await page.getByTestId('tool-rect').click();
  await expect(page.getByTestId('tool-rect')).toHaveClass(/is-active/);

  const box = await container.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  await page.mouse.move(box.x + 60, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 190, box.y + 150, { steps: 6 });
  await page.mouse.up();

  // PPT-style: the tool auto-returns to select so any object is movable on hover.
  await expect(page.getByTestId('tool-select')).toHaveClass(/is-active/);

  await app.close();
});

test('the page has a fixed default size with a fit-to-window zoom control', async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);

  await page.getByTestId('ribbon-new').click();
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('zoom-control')).toBeVisible();

  const readPct = async (): Promise<number> =>
    Number(((await page.getByTestId('zoom-fit').textContent()) ?? '').replace('%', ''));

  // Default = fit: the whole 2500×1600 page fits the window, so well under 100%.
  const fitPct = await readPct();
  expect(fitPct).toBeGreaterThan(0);
  expect(fitPct).toBeLessThan(100);

  // Zooming in raises the percentage (no longer fit).
  await page.getByTestId('zoom-in').click();
  expect(await readPct()).toBeGreaterThan(fitPct);

  await app.close();
});

test('right-clicking an image can lock it, then unlock it, persisting the flag', async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);

  await page.getByTestId('ribbon-new').click();
  await expect(page.getByTestId('editor')).toBeVisible();
  const container = page.locator('.canvas-container');
  await expect(container).toBeVisible();
  await page.waitForTimeout(300);

  // Paste an image so there is an object to lock (it fills the page centre).
  await pasteImage(page, PNG_A);
  const hash = sha256(PNG_A);
  await expect
    .poll(async () => {
      const list = await store.listEntries(page);
      const id = list[0]?.id;
      if (!id) return '';
      return (await store.getEntry(page, id))?.canvasJson ?? '';
    })
    .toContain(`tj-image://${hash}`);

  const list = await store.listEntries(page);
  const id = list[0]?.id;
  if (!id) throw new Error('expected one entry');

  const box = await container.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // Right-click the image → Lock is offered.
  await page.mouse.click(cx, cy, { button: 'right' });
  await expect(page.getByTestId('menu-lock')).toBeVisible();
  await page.getByTestId('menu-lock').click();

  // The locked flag persists in the saved canvas JSON.
  await expect.poll(async () => (await store.getEntry(page, id))?.canvasJson ?? '').toContain('"tjLocked":true');

  // Right-clicking the locked image now offers Unlock instead of Lock.
  await page.mouse.click(cx, cy, { button: 'right' });
  await expect(page.getByTestId('menu-unlock')).toBeVisible();
  await expect(page.getByTestId('menu-lock')).toHaveCount(0);
  await page.getByTestId('menu-unlock').click();

  await expect.poll(async () => (await store.getEntry(page, id))?.canvasJson ?? '').toContain('"tjLocked":false');

  await app.close();
});

test('lines and arrows are saved as two-point segments, and arrows revive on reload', async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);

  await page.getByTestId('ribbon-new').click();
  await expect(page.getByTestId('editor')).toBeVisible();
  const container = page.locator('.canvas-container');
  await expect(container).toBeVisible();
  await page.waitForTimeout(300);
  const box = await container.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');

  const drag = async (x1: number, y1: number, x2: number, y2: number): Promise<void> => {
    await page.mouse.move(box.x + x1, box.y + y1);
    await page.mouse.down();
    await page.mouse.move(box.x + x2, box.y + y2, { steps: 6 });
    await page.mouse.up();
  };

  await page.getByTestId('tool-line').click();
  await drag(40, 40, 200, 120);
  await page.getByTestId('tool-arrow').click();
  await drag(60, 170, 240, 210);
  // The arrow stays selected → its two endpoint handles are visible.
  await page.screenshot({ path: 'test-results/segments.png' });

  await page.keyboard.press('Control+s');
  const list = await store.listEntries(page);
  const id = list[0]?.id;
  if (!id) throw new Error('expected one entry');
  await expect.poll(async () => (await store.getEntry(page, id))?.canvasJson ?? '').toContain('"type":"ArrowPoly"');

  const entry = await store.getEntry(page, id);
  const parsed = JSON.parse(entry?.canvasJson ?? '{}') as {
    objects?: { type?: string; points?: unknown[] }[];
  };
  const objs = parsed.objects ?? [];
  // Both the line and the arrow are two-point segments (endpoint-editable), not scalable boxes.
  const segments = objs.filter((o) => Array.isArray(o.points) && o.points.length === 2);
  expect(segments).toHaveLength(2);
  expect(objs.some((o) => o.type === 'ArrowPoly')).toBe(true);

  // Reopening the entry revives the arrow subclass without error.
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.getByTestId('entry-item').first().click();
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('tool-arrow')).toBeEnabled();

  await app.close();
});

test('the text tool makes an Office-style text box (types text; empty is discarded; box props separate)', async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);

  await page.getByTestId('ribbon-new').click();
  await expect(page.getByTestId('editor')).toBeVisible();
  const container = page.locator('.canvas-container');
  await expect(container).toBeVisible();
  await page.waitForTimeout(300);
  const box = await container.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');

  // Pick a font size up front (Office-style), place a text box, and type into it.
  await page.getByTestId('font-size').selectOption('40');
  await page.getByTestId('tool-text').click();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(150);
  await page.keyboard.type('Hi');
  await page.mouse.click(box.x + 6, box.y + 6); // exit editing + deselect
  await page.screenshot({ path: 'test-results/textbox.png' });

  await page.keyboard.press('Control+s');
  const list = await store.listEntries(page);
  const id = list[0]?.id;
  if (!id) throw new Error('expected one entry');
  await expect
    .poll(async () => (await store.getEntry(page, id))?.canvasJson ?? '')
    .toContain('"type":"TextBoxAnnotation"');

  const parsed = JSON.parse((await store.getEntry(page, id))?.canvasJson ?? '{}') as {
    objects?: {
      type?: string;
      tjRole?: string;
      text?: string;
      fontSize?: number;
      boxStroke?: string;
      fill?: string;
      splitByGrapheme?: boolean;
    }[];
  };
  const tb = (parsed.objects ?? []).find((o) => o.type === 'TextBoxAnnotation' && o.tjRole !== 'title');
  expect(tb?.text).toBe('Hi');
  // Font size comes from the Office-style control; the box border is its own property.
  expect(tb?.fontSize).toBe(40);
  expect(typeof tb?.boxStroke).toBe('string');
  // Text colour is the object fill, distinct from the box border/fill.
  expect(tb?.fill).toBe('#111827');
  // Wraps per grapheme so narrowing the width always adds lines (spaceless/CJK too).
  expect(tb?.splitByGrapheme).toBe(true);

  // An empty text box is discarded on exit (Office-style: no text means it was never created).
  await page.getByTestId('tool-text').click();
  await page.mouse.click(box.x + box.width * 0.75, box.y + box.height * 0.6);
  await page.mouse.click(box.x + 6, box.y + 6); // exit without typing → discarded, nothing changed
  const after = JSON.parse((await store.getEntry(page, id))?.canvasJson ?? '{}') as {
    objects?: { type?: string; tjRole?: string }[];
  };
  expect(
    (after.objects ?? []).filter((o) => o.type === 'TextBoxAnnotation' && o.tjRole !== 'title'),
  ).toHaveLength(1);

  // Reopen — the text-box subclass revives without error.
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.getByTestId('entry-item').first().click();
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('tool-text')).toBeEnabled();

  await app.close();
});

test('No border removes a rectangle outline but lines keep their stroke', async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);

  await page.getByTestId('ribbon-new').click();
  await expect(page.getByTestId('editor')).toBeVisible();
  const container = page.locator('.canvas-container');
  await expect(container).toBeVisible();
  await page.waitForTimeout(300);
  const box = await container.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');

  const drag = async (x1: number, y1: number, x2: number, y2: number): Promise<void> => {
    await page.mouse.move(box.x + x1, box.y + y1);
    await page.mouse.down();
    await page.mouse.move(box.x + x2, box.y + y2, { steps: 6 });
    await page.mouse.up();
  };

  // Turn on "No border", then draw a rectangle and a line.
  await page.getByTestId('no-border').click();
  await page.getByTestId('tool-rect').click();
  await drag(40, 40, 220, 150);
  await page.getByTestId('tool-line').click();
  await drag(40, 190, 240, 230);

  await page.keyboard.press('Control+s');
  const list = await store.listEntries(page);
  const id = list[0]?.id;
  if (!id) throw new Error('expected one entry');
  await expect.poll(async () => (await store.getEntry(page, id))?.canvasJson ?? '').toContain('"strokeWidth":0');

  const parsed = JSON.parse((await store.getEntry(page, id))?.canvasJson ?? '{}') as {
    objects?: { strokeWidth?: number; points?: unknown[] }[];
  };
  const objs = parsed.objects ?? [];
  // The rectangle has no outline.
  expect(objs.some((o) => o.strokeWidth === 0)).toBe(true);
  // The line keeps a visible stroke even with "No border" active.
  const seg = objs.find((o) => Array.isArray(o.points) && o.points.length === 2);
  expect(seg?.strokeWidth ?? 0).toBeGreaterThan(0);

  await app.close();
});
