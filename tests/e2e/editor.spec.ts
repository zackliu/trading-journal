import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
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

/** Generate an opaque PNG of the given size in the page and return its base64 (no data: prefix). */
async function makePngB64(page: Page, w: number, h: number): Promise<string> {
  return page.evaluate(
    ({ w, h }) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#4477aa';
      ctx.fillRect(0, 0, w, h);
      return c.toDataURL('image/png').split(',')[1];
    },
    { w, h },
  );
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

test('a failed canvas save surfaces an error instead of silently dropping the edit', async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);
  await page.getByTestId('ribbon-new').click();
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.locator('.canvas-container')).toBeVisible();
  const id = (await store.listEntries(page))[0]?.id;
  if (!id) throw new Error('expected an open review');

  // Force the next save to fail for real: delete the row out from under the open review. The in-memory
  // editor still points at it, so its save now hits "entry not found" — the auto-save's error path.
  await page.evaluate(
    (eid) => (globalThis as unknown as { api: { deleteEntry(x: string): Promise<void> } }).api.deleteEntry(eid),
    id,
  );

  // A habitual Ctrl+S drives the auto-save path; the write rejection must be caught + surfaced to the
  // user (not swallowed as an unhandled rejection, which would silently lose the edit).
  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('save-error')).toBeVisible();

  await app.close();
});

test('a review whose image bytes are missing shows a load error, not a silent blank canvas', async () => {
  const dataDir = tempDataDir();
  const hash = sha256(PNG_A);

  // Phase 1: build a review whose canvas references a screenshot object (paste auto-saves it).
  const first = await launchApp(dataDir);
  await first.page.getByTestId('ribbon-new').click();
  await expect(first.page.getByTestId('editor')).toBeVisible();
  await expect(first.page.locator('.canvas-container')).toBeVisible();
  await first.page.waitForTimeout(300); // let the blank page finish loading before pasting
  await pasteImage(first.page, PNG_A);
  const id = (await store.listEntries(first.page))[0]?.id;
  if (!id) throw new Error('expected an open review');
  await expect
    .poll(async () => (await store.getEntry(first.page, id))?.canvasJson ?? '')
    .toContain(`tj-image://${hash}`);
  await first.app.close();

  // The image file goes missing before the next launch (deleted, or not yet synced from OneDrive). A
  // fresh process has no net cache, so reopening the review genuinely fails to read the image bytes.
  rmSync(join(dataDir, 'images', hash));
  const { app, page } = await launchApp(dataDir);
  await page.getByTestId('entry-item').first().click();

  // The failure is surfaced clearly instead of a silent empty editor...
  await expect(page.getByTestId('load-error')).toBeVisible();
  await expect(page.getByTestId('editor')).toHaveCount(0);
  // ...and the durable review data was left completely untouched (no blank canvas overwrote it).
  expect((await store.getEntry(page, id))?.canvasJson).toContain(`tj-image://${hash}`);

  await app.close();
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

  // Deleting a review is destructive and unrecoverable, so it confirms first.
  await expect(page.getByTestId('confirm-dialog')).toBeVisible();
  await page.getByTestId('confirm-ok').click();

  await expect(page.getByTestId('entry-item')).toHaveCount(0);
  await expect(page.getByTestId('empty-state')).toBeVisible();
  expect(await store.listEntries(page)).toHaveLength(0);

  await app.close();
});

test('cancelling the delete confirmation keeps the review', async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);
  await store.ingestImage(page, PNG_A);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  await page.getByTestId('entry-item').first().click({ button: 'right' });
  await page.getByTestId('context-delete').click();
  await expect(page.getByTestId('confirm-dialog')).toBeVisible();
  await page.getByTestId('confirm-cancel').click();

  // The review is untouched.
  await expect(page.getByTestId('entry-item')).toHaveCount(1);
  expect(await store.listEntries(page)).toHaveLength(1);

  await app.close();
});

test('typing then switching reviews commits the text (no silent loss)', async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);

  await page.getByTestId('ribbon-new').click(); // review A opens
  await expect(page.getByTestId('editor')).toBeVisible();
  const container = page.locator('.canvas-container');
  await expect(container).toBeVisible();
  await page.waitForTimeout(300);
  const box = await container.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  const aId = (await store.listEntries(page))[0]?.id as string;

  // Type into a text box but do NOT click away / exit editing.
  await page.getByTestId('tool-text').click();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(150);
  await page.keyboard.type('dont-lose-me');

  // Switch straight to another review (the classic loss path) without exiting editing first. Ctrl+N
  // creates + opens review B through the same switchTo path used by a rail click / wheel navigation.
  await page.keyboard.press('Control+n');
  await expect.poll(async () => (await store.listEntries(page)).length).toBe(2);

  // Review A must have kept the freshly typed text.
  await expect.poll(async () => (await store.getEntry(page, aId))?.canvasJson ?? '').toContain('dont-lose-me');

  await app.close();
});

test('typing then reloading persists the text (close / reload safety net)', async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);

  await page.getByTestId('ribbon-new').click();
  await expect(page.getByTestId('editor')).toBeVisible();
  const container = page.locator('.canvas-container');
  await expect(container).toBeVisible();
  await page.waitForTimeout(300);
  const box = await container.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  const id = (await store.listEntries(page))[0]?.id as string;

  await page.getByTestId('tool-text').click();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(150);
  await page.keyboard.type('survive-reload');

  // Reload while still editing: beforeunload must commit + flush before the renderer goes away.
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  await expect.poll(async () => (await store.getEntry(page, id))?.canvasJson ?? '').toContain('survive-reload');

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
  // The page is a fixed 2900×1600 slide, independent of the pasted image's size.
  const parsedPage = JSON.parse(entry?.canvasJson ?? '{}') as { tjPage?: { width?: number; height?: number } };
  expect(parsedPage.tjPage).toEqual({ width: 2900, height: 1600 });
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

  // Paste a page-sized screenshot so a real image object covers the canvas centre (pastes come in at
  // native resolution, so the fixture must actually be large — like a real chart capture).
  const png = await makePngB64(page, 2000, 1200);
  await pasteImage(page, png);
  const hash = sha256(png);
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

test('Ctrl constrains a line endpoint while EDITING it, exactly as while drawing it (no create-only special case)', async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);

  await page.getByTestId('ribbon-new').click();
  await expect(page.getByTestId('editor')).toBeVisible();
  const container = page.locator('.canvas-container');
  await expect(container).toBeVisible();
  await page.waitForTimeout(300);
  const box = await container.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  const at = (x: number, y: number): { x: number; y: number } => ({ x: box.x + x, y: box.y + y });
  const dragTo = async (fx: number, fy: number, tx: number, ty: number): Promise<void> => {
    await page.mouse.move(at(fx, fy).x, at(fx, fy).y);
    await page.mouse.down();
    await page.mouse.move(at(tx, ty).x, at(tx, ty).y, { steps: 8 });
    await page.mouse.up();
  };

  // Draw a clearly diagonal line; finishing auto-selects it, so its endpoint handles are live.
  await page.getByTestId('tab-draw').click();
  await page.getByTestId('tool-line').click();
  const ANCHOR = { x: 120, y: 200 }; // the endpoint we never touch
  await dragTo(ANCHOR.x, ANCHOR.y, 320, 340); // free end starts at (320,340)
  await expect(page.getByTestId('tab-annotation')).toBeVisible();

  const id = (await store.listEntries(page))[0]?.id;
  if (!id) throw new Error('expected one entry');
  // Vertical gap between the two endpoints, in the segment's own (unscaled, unrotated) point space —
  // 0 means the line is horizontal. Returns NaN until the segment is persisted so expect.poll retries.
  const endpointDy = async (): Promise<number> => {
    const parsed = JSON.parse((await store.getEntry(page, id))?.canvasJson ?? '{}') as {
      objects?: { points?: { x: number; y: number }[] }[];
    };
    const seg = (parsed.objects ?? []).find((o) => Array.isArray(o.points) && o.points.length === 2);
    return seg?.points ? Math.abs(seg.points[0].y - seg.points[1].y) : Number.NaN;
  };

  // Phase 1 — dragging the endpoint WITHOUT Ctrl is free (it lands where the cursor is): still diagonal.
  await dragTo(320, 340, 300, 120);
  await page.keyboard.press('Control+s');
  await expect.poll(endpointDy).toBeGreaterThan(40);

  // Phase 2 — the SAME handle dragged WITH Ctrl snaps the segment about the fixed opposite endpoint.
  // The target is within ±22.5° of horizontal from the anchor, so it snaps flat → both endpoints share Y.
  await page.keyboard.down('Control');
  await dragTo(300, 120, 340, 216);
  await page.keyboard.up('Control');
  await page.keyboard.press('Control+s');
  await expect.poll(endpointDy).toBeLessThan(3);

  await app.close();
});

test('line endpoints have a forgiving grab area — a press NEAR the endpoint (off the stroke) still grabs it', async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);

  await page.getByTestId('ribbon-new').click();
  await expect(page.getByTestId('editor')).toBeVisible();
  const container = page.locator('.canvas-container');
  await expect(container).toBeVisible();
  await page.waitForTimeout(300);
  const box = await container.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  const at = (x: number, y: number): { x: number; y: number } => ({ x: box.x + x, y: box.y + y });

  await page.getByTestId('tab-draw').click();
  await page.getByTestId('tool-line').click();
  // A horizontal line; finishing auto-selects it so its endpoint handles are live.
  await page.mouse.move(at(120, 200).x, at(120, 200).y);
  await page.mouse.down();
  await page.mouse.move(at(320, 200).x, at(320, 200).y, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByTestId('tab-annotation')).toBeVisible();

  const id = (await store.listEntries(page))[0]?.id;
  if (!id) throw new Error('expected one entry');
  const endpointDy = async (): Promise<number> => {
    const parsed = JSON.parse((await store.getEntry(page, id))?.canvasJson ?? '{}') as {
      objects?: { points?: { x: number; y: number }[] }[];
    };
    const seg = (parsed.objects ?? []).find((o) => Array.isArray(o.points) && o.points.length === 2);
    return seg?.points ? Math.abs(seg.points[0].y - seg.points[1].y) : Number.NaN;
  };

  // Press 8px BELOW the right endpoint: off the stroke (outside the line's hit band) and outside the old
  // tiny ±4px handle box, but inside the enlarged grab area. Drag down — grabbing the endpoint bends the
  // line diagonal; a body drag or a miss would keep it flat. (Arrows share this exact control path.)
  await page.mouse.move(at(320, 208).x, at(320, 208).y);
  await page.mouse.down();
  await page.mouse.move(at(360, 300).x, at(360, 300).y, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press('Control+s');
  await expect.poll(endpointDy).toBeGreaterThan(40);

  await app.close();
});

type MM = { type?: string; left?: number; top?: number; width?: number; height?: number; mmFlipX?: boolean; mmFlipY?: boolean; tjId?: string };

/** The base anchor A of a measured move, in scene coordinates, from its stored box + flip flags. */
function mmAnchorA(mm: MM): { x: number; y: number } {
  const left = mm.left ?? 0;
  const top = mm.top ?? 0;
  const w = mm.width ?? 0;
  const h = mm.height ?? 0;
  return { x: mm.mmFlipX ? left + w : left, y: mm.mmFlipY ? top + h : top };
}

test('the MM tool draws a measured move as three equidistant levels, persisted and editable', async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);

  await page.getByTestId('ribbon-new').click();
  await expect(page.getByTestId('editor')).toBeVisible();
  const container = page.locator('.canvas-container');
  await expect(container).toBeVisible();
  await page.waitForTimeout(300);
  const box = await container.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  const dragTo = async (fx: number, fy: number, tx: number, ty: number): Promise<void> => {
    await page.mouse.move(box.x + fx, box.y + fy);
    await page.mouse.down();
    await page.mouse.move(box.x + tx, box.y + ty, { steps: 8 });
    await page.mouse.up();
  };

  await page.getByTestId('tab-draw').click();
  await page.getByTestId('tool-mm').click();
  // Upper-right: A (base) at (120,300), B (measured) at (320,200) → lines extend right, stack doubles up.
  await dragTo(120, 300, 320, 200);
  await expect(page.getByTestId('tab-annotation')).toBeVisible(); // an annotation is selected

  const id = (await store.listEntries(page))[0]?.id;
  if (!id) throw new Error('expected one entry');
  await expect
    .poll(async () => (await store.getEntry(page, id))?.canvasJson ?? '')
    .toContain('"type":"MeasuredMove"');

  const objects = async (): Promise<MM[]> => {
    const parsed = JSON.parse((await store.getEntry(page, id))?.canvasJson ?? '{}') as { objects?: MM[] };
    return parsed.objects ?? [];
  };
  const readMM = async (): Promise<MM> => {
    const mm = (await objects()).find((o) => o.type === 'MeasuredMove');
    if (!mm) throw new Error('no MeasuredMove persisted');
    return mm;
  };

  const before = await readMM();
  // height = 2 × the leg spacing (2×|dy|=200) and width = |dx| = 200 → equal, a ratio that is the same
  // at any zoom because both scale by 1/zoom. This encodes three equidistant lines.
  expect(before.width ?? 0).toBeGreaterThan(0);
  expect(Math.abs((before.height ?? 0) - (before.width ?? 0))).toBeLessThan((before.width ?? 1) * 0.15);
  // Direction from the drag quadrant: extends right (mmFlipX false), doubles upward (mmFlipY true).
  expect(before.mmFlipX).toBe(false);
  expect(before.mmFlipY).toBe(true);
  // It is a taggable annotation like any other (carries a tjId), not a special type.
  expect(typeof before.tjId).toBe('string');
  const aBefore = mmAnchorA(before);

  // Editing is the same as creating: drag the measured handle (at B = 320,200) further up to widen the
  // leg; the stored spacing grows and the object is neither dropped nor duplicated.
  await dragTo(320, 200, 320, 120);
  await page.keyboard.press('Control+s');
  await expect.poll(async () => (await readMM()).height ?? 0).toBeGreaterThan((before.height ?? 0) * 1.4);
  expect((await objects()).filter((o) => o.type === 'MeasuredMove')).toHaveLength(1);
  // Dragging one endpoint keeps the OTHER endpoint pinned — the whole move must not drift.
  const aAfter = mmAnchorA(await readMM());
  expect(Math.hypot(aAfter.x - aBefore.x, aAfter.y - aBefore.y)).toBeLessThan(3);

  await app.close();
});

test('a measured move is never discarded — a bare click keeps a grabbable min-width line', async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);

  await page.getByTestId('ribbon-new').click();
  await expect(page.getByTestId('editor')).toBeVisible();
  const container = page.locator('.canvas-container');
  await expect(container).toBeVisible();
  await page.waitForTimeout(300);
  const box = await container.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');

  await page.getByTestId('tab-draw').click();
  await page.getByTestId('tool-mm').click();
  // A bare click with no drag: a plain shape is discarded as "too small", but a measured move must
  // survive with a small width so it can be pulled open later — discarding would lose the mark.
  await page.mouse.move(box.x + 200, box.y + 220);
  await page.mouse.down();
  await page.mouse.up();

  await page.keyboard.press('Control+s');
  const id = (await store.listEntries(page))[0]?.id;
  if (!id) throw new Error('expected one entry');
  await expect
    .poll(async () => (await store.getEntry(page, id))?.canvasJson ?? '')
    .toContain('"type":"MeasuredMove"');

  const parsed = JSON.parse((await store.getEntry(page, id))?.canvasJson ?? '{}') as { objects?: MM[] };
  const mm = (parsed.objects ?? []).find((o) => o.type === 'MeasuredMove');
  expect(mm?.width ?? 0).toBeGreaterThan(10); // kept a grabbable minimum width
  expect(mm?.height ?? -1).toBeLessThan(1); // flat (no leg yet), but still editable — pull a handle to open it

  await app.close();
});

test('measured-move handles have a forgiving grab area — a press near a handle still grabs it', async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);

  await page.getByTestId('ribbon-new').click();
  await expect(page.getByTestId('editor')).toBeVisible();
  const container = page.locator('.canvas-container');
  await expect(container).toBeVisible();
  await page.waitForTimeout(300);
  const box = await container.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  const at = (x: number, y: number): { x: number; y: number } => ({ x: box.x + x, y: box.y + y });

  await page.getByTestId('tab-draw').click();
  await page.getByTestId('tool-mm').click();
  // Upper-right MM: base A at (120,300), measured B at (320,200).
  await page.mouse.move(at(120, 300).x, at(120, 300).y);
  await page.mouse.down();
  await page.mouse.move(at(320, 200).x, at(320, 200).y, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByTestId('tab-annotation')).toBeVisible();

  const id = (await store.listEntries(page))[0]?.id;
  if (!id) throw new Error('expected one entry');
  const readMM = async (): Promise<MM> => {
    const parsed = JSON.parse((await store.getEntry(page, id))?.canvasJson ?? '{}') as { objects?: MM[] };
    return (parsed.objects ?? []).find((o) => o.type === 'MeasuredMove')!;
  };
  const before = await readMM();
  const aBefore = mmAnchorA(before);
  const hBefore = before.height ?? 0;

  // Press 8px ABOVE the measured handle B (off its dot and off the line) and drag up. The enlarged grab
  // area catches it, so the leg widens (height grows) while the base anchor A stays pinned.
  await page.mouse.move(at(320, 192).x, at(320, 192).y);
  await page.mouse.down();
  await page.mouse.move(at(320, 120).x, at(320, 120).y, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press('Control+s');
  await expect.poll(async () => (await readMM()).height ?? 0).toBeGreaterThan(hBefore * 1.3);
  const aAfter = mmAnchorA(await readMM());
  expect(Math.hypot(aAfter.x - aBefore.x, aAfter.y - aBefore.y)).toBeLessThan(3);

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

test('pasting text into a selected text box inserts characters, never an image, and stays box-styled', async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);

  await page.getByTestId('ribbon-new').click();
  await expect(page.getByTestId('editor')).toBeVisible();
  const container = page.locator('.canvas-container');
  await expect(container).toBeVisible();
  await page.waitForTimeout(300);
  const box = await container.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');

  // Make a text box with "Hi", then Escape to leave editing while keeping the box selected.
  await page.getByTestId('tool-text').click();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(150);
  await page.keyboard.type('Hi');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('tab-annotation')).toBeVisible(); // selected, not editing

  // A clipboard holding BOTH text and an image (as some apps provide when copying rich text). Because
  // a text box is the target, the TEXT must win — appended into the box — and no image is pasted.
  await page.evaluate((b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    const data = new DataTransfer();
    data.setData('text/plain', 'World');
    data.items.add(new File([bytes], 'shot.png', { type: 'image/png' }));
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, PNG_A);

  const id = (await store.listEntries(page))[0]?.id as string;
  await expect
    .poll(async () => {
      const parsed = JSON.parse((await store.getEntry(page, id))?.canvasJson ?? '{}') as {
        objects?: { type?: string; tjRole?: string; text?: string }[];
      };
      return (parsed.objects ?? []).find((o) => o.type === 'TextBoxAnnotation' && o.tjRole !== 'title')?.text ?? '';
    })
    .toBe('HiWorld');

  const canvasJson = (await store.getEntry(page, id))?.canvasJson ?? '';
  expect(canvasJson).not.toContain('tj-image://'); // the image was NOT pasted onto the page
  const parsed = JSON.parse(canvasJson) as {
    objects?: { type?: string; tjRole?: string; styles?: unknown }[];
  };
  const tb = (parsed.objects ?? []).find((o) => o.type === 'TextBoxAnnotation' && o.tjRole !== 'title');
  // No per-character styles: the box-level text-colour control stays authoritative (Fabric would
  // otherwise carry the source's per-char colour on paste, which is exactly the reported bug).
  const styles = tb?.styles;
  const emptyStyles =
    styles == null || (Array.isArray(styles) ? styles.length === 0 : Object.keys(styles).length === 0);
  expect(emptyStyles).toBe(true);

  await app.close();
});

test('Bold formats the selected characters, persists, and a whole-box Bold overrides the runs', async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);

  await page.getByTestId('ribbon-new').click();
  await expect(page.getByTestId('editor')).toBeVisible();
  const container = page.locator('.canvas-container');
  await expect(container).toBeVisible();
  await page.waitForTimeout(300);
  const box = await container.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');

  const id = (await store.listEntries(page))[0]?.id as string;
  const readBox = async (): Promise<{ text?: string; fontWeight?: string; styles?: unknown } | undefined> => {
    const parsed = JSON.parse((await store.getEntry(page, id))?.canvasJson ?? '{}') as {
      objects?: { type?: string; tjRole?: string; text?: string; fontWeight?: string; styles?: unknown }[];
    };
    return (parsed.objects ?? []).find((o) => o.type === 'TextBoxAnnotation' && o.tjRole !== 'title');
  };

  // Type "Hello", then select the last two characters ("lo") and Bold just them.
  await page.getByTestId('tool-text').click();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(150);
  await page.keyboard.type('Hello');
  await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('Shift+ArrowLeft');
  await page.getByTestId('bold').click();
  await page.keyboard.press('Escape'); // commit; the box stays selected

  // Per-character: a run is bold, but the box object itself is not — proof it hit the range only.
  await expect
    .poll(async () => JSON.stringify((await readBox())?.styles ?? '').includes('"fontWeight":"bold"'))
    .toBe(true);
  expect((await readBox())?.fontWeight ?? 'normal').not.toBe('bold');
  expect((await readBox())?.text).toBe('Hello');

  // Bold the whole box (now selected, not editing): object-level bold, and the per-char runs are dropped.
  await page.getByTestId('bold').click();
  await expect.poll(async () => (await readBox())?.fontWeight ?? 'normal').toBe('bold');
  expect(JSON.stringify((await readBox())?.styles ?? '')).not.toContain('"fontWeight":"bold"');

  await app.close();
});

test('the ribbon reads back the selected object style (format follows selection)', async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);

  await page.getByTestId('ribbon-new').click();
  await expect(page.getByTestId('editor')).toBeVisible();
  const container = page.locator('.canvas-container');
  await expect(container).toBeVisible();
  await page.waitForTimeout(300);
  const box = await container.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');

  const drawRectAt = async (x1: number, y1: number, x2: number, y2: number): Promise<void> => {
    await page.getByTestId('tab-draw').click();
    await page.getByTestId('tool-rect').click();
    await page.mouse.move(box.x + x1, box.y + y1);
    await page.mouse.down();
    await page.mouse.move(box.x + x2, box.y + y2);
    await page.mouse.up(); // finishing a shape returns to the select tool
  };
  const setColor = async (hex: string): Promise<void> => {
    // Drive the controlled color input the way a real edit does: use the native value setter so
    // React's onChange fires (a plain el.value assignment is swallowed by React's value tracker).
    await page.getByTestId('stroke-color').evaluate((el, v) => {
      const input = el as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, v);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, hex);
  };

  // Rect A: default red stroke. Drawing selects it, so the swatch reads its own colour.
  await drawRectAt(60, 60, 160, 140);
  await expect(page.getByTestId('stroke-color')).toHaveValue('#f85149');
  await setColor('#0000ff'); // recolour A (applies to the selection)

  // Rect B elsewhere, then move the persistent default to green while B is selected.
  await drawRectAt(300, 60, 400, 140);
  await setColor('#00ff00');

  // Re-select A: the swatch must read A's own blue, not the current green default.
  await page.mouse.click(box.x + 110, box.y + 100);
  await expect(page.getByTestId('stroke-color')).toHaveValue('#0000ff');

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
