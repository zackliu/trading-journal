import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, store } from './electronApp';

function tempDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'tj-stamp-'));
}

const CANVAS = '.canvas-container';
// The one surface: page[0..2900] + gap(12) + strip[2912..3482]; height 1600. Must match the controller.
const SCENE_W = 3482;
const SCENE_H = 1600;

// A 1x1 PNG standing in for a system-clipboard screenshot (Win+Shift+S auto-copies to the OS clipboard).
const PNG_1x1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
type Scene = [number, number];

async function canvasBox(page: Page): Promise<Box> {
  const c = page.locator(CANVAS);
  await expect(c).toBeVisible();
  await page.waitForTimeout(300);
  const b = await c.boundingBox();
  if (!b) throw new Error('canvas has no bounding box');
  return b;
}

/** Scene-pixel point → a canvas-element-relative position (robust to device-pixel scaling). */
function pos(box: Box, sx: number, sy: number): { x: number; y: number } {
  return { x: (sx / SCENE_W) * box.width, y: (sy / SCENE_H) * box.height };
}

/** Press-drag between two scene points on the one canvas (page ↔ strip is continuous). */
async function dragScene(page: Page, box: Box, from: Scene, to: Scene): Promise<void> {
  await page.locator(CANVAS).hover({ position: pos(box, from[0], from[1]), force: true });
  await page.mouse.down();
  await page.locator(CANVAS).hover({ position: pos(box, (from[0] + to[0]) / 2, (from[1] + to[1]) / 2), force: true });
  await page.locator(CANVAS).hover({ position: pos(box, to[0], to[1]), force: true });
  await page.mouse.up();
}

async function drawRect(page: Page, box: Box, from: Scene, to: Scene): Promise<void> {
  await page.getByTestId('tab-draw').click();
  await page.getByTestId('tool-rect').click();
  await page.locator(CANVAS).hover({ position: pos(box, from[0], from[1]), force: true });
  await page.mouse.down();
  await page.locator(CANVAS).hover({ position: pos(box, to[0], to[1]), force: true });
  await page.mouse.up();
}

/** Tag the drawing at scene point `at` via the contextual Annotation tab's quick-pick (vocab pre-declared). */
async function tagAt(page: Page, box: Box, at: Scene, group: string, value: string): Promise<void> {
  await page.locator(CANVAS).click({ position: pos(box, at[0], at[1]), force: true }); // select the drawing
  await expect(page.getByTestId('tab-annotation')).toHaveClass(/is-active/);
  await page.getByTestId(`qtag-${group}-${value}`).click();
  await page.getByTestId('tab-draw').click(); // restore Draw for subsequent tools / palette lock
}

function stampCount(canvasJson: string): number {
  try {
    const parsed = JSON.parse(canvasJson) as { objects?: unknown[] };
    return Array.isArray(parsed.objects) ? parsed.objects.length : 0;
  } catch {
    return 0;
  }
}

/** Seed the global stamp library with one tagged rectangle in the strip region, then reload. */
async function seedStamp(
  page: Page,
  tag: { group: string; value: string },
  extra: Record<string, unknown> = {},
): Promise<void> {
  const json = JSON.stringify({
    version: '6',
    objects: [
      {
        type: 'Rect',
        left: 3120,
        top: 120,
        width: 100,
        height: 70,
        fill: 'transparent',
        stroke: '#f85149',
        strokeWidth: 3,
        tjId: 'seed-stamp',
        tjTags: [tag],
        ...extra,
      },
    ],
  });
  await store.saveStampLibrary(page, json);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(400);
}

async function openReview(page: Page): Promise<string> {
  await page.getByTestId('ribbon-new').click();
  await expect(page.getByTestId('editor')).toBeVisible();
  const id = (await store.listEntries(page))[0]?.id;
  if (!id) throw new Error('expected an open review');
  return id;
}

// The seeded stamp's centre in scene coords (left 3120 + w/2, top 120 + h/2).
const STAMP_CENTER: Scene = [3170, 155];

test('dragging a stamp onto the page drops a tagged copy while the palette keeps the stamp', async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);
  await seedStamp(page, { group: 'setup', value: 'wedge-top' });
  const entryId = await openReview(page);
  const box = await canvasBox(page);

  // Locked palette (default): drag the stamp from the strip onto the review page.
  await dragScene(page, box, STAMP_CENTER, [900, 700]);

  // The page gained a fresh annotation carrying the stamp's tag (answered by the index).
  await expect
    .poll(async () => (await store.queryByTag(page, { group: 'setup', value: 'wedge-top' })).length)
    .toBe(1);
  const hits = await store.queryByTag(page, { group: 'setup', value: 'wedge-top' });
  expect(hits[0]?.entryId).toBe(entryId);
  expect(hits[0]?.annotationId).not.toBe('seed-stamp'); // a new id, not the stamp itself

  // Dragging out is a copy: the palette still holds the one original stamp, unchanged.
  expect(stampCount((await store.getStampLibrary(page)).canvasJson)).toBe(1);

  await app.close();
});

test('a dropped stamp copy carries tags but not result', async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);
  await seedStamp(
    page,
    { group: 'pattern', value: 'double-top' },
    { tjResult: { 'r-multiple': 2 } },
  );
  await openReview(page);
  const box = await canvasBox(page);

  await dragScene(page, box, STAMP_CENTER, [900, 700]);

  await expect
    .poll(async () => (await store.queryByTag(page, { group: 'pattern', value: 'double-top' })).length)
    .toBe(1);
  const hits = await store.queryByTag(page, { group: 'pattern', value: 'double-top' });
  expect(hits[0]?.tags).toEqual([{ group: 'pattern', value: 'double-top' }]);
  expect(hits[0]?.result).toBeUndefined();

  await app.close();
});

test('unlocking the palette lets a page drawing be moved in as a global stamp', async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);
  // Pre-declare the vocabulary (registry) so the Annotation quick-pick offers it; reload to load it.
  await store.defineGroup(page, { id: 'setup', label: 'setup', pinned: true });
  await store.defineValue(page, { groupId: 'setup', value: 'alpha' });
  await store.defineValue(page, { groupId: 'setup', value: 'beta' });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  const entry1 = await openReview(page);
  const box = await canvasBox(page);

  // Draw + tag a page drawing, then try to drag it into the LOCKED strip — it must be refused.
  await drawRect(page, box, [300, 260], [640, 460]);
  await tagAt(page, box, [470, 360], 'setup', 'alpha');
  await dragScene(page, box, [470, 360], [3170, 900]);
  await expect(page.getByTestId('tab-draw')).toHaveClass(/is-active/);

  // Refused: the strip is still empty and the drawing still belongs to the review.
  expect(stampCount((await store.getStampLibrary(page)).canvasJson)).toBe(0);
  expect((await store.queryByTag(page, { group: 'setup', value: 'alpha' }))[0]?.entryId).toBe(entry1);

  // Unlock, then draw + tag a second drawing and drag THAT one into the strip — now it transfers.
  await page.getByTestId('stamp-lock').click();
  await expect(page.getByTestId('stamp-lock')).toContainText('Unlocked');
  await drawRect(page, box, [300, 900], [640, 1100]);
  await tagAt(page, box, [470, 1000], 'setup', 'beta');
  await expect.poll(async () => (await store.queryByTag(page, { group: 'setup', value: 'beta' })).length).toBe(1);
  await dragScene(page, box, [470, 1000], [3170, 1000]);

  // The drawing left the review and became a global stamp carrying its tag.
  await expect.poll(async () => stampCount((await store.getStampLibrary(page)).canvasJson)).toBe(1);
  expect((await store.getStampLibrary(page)).canvasJson).toContain('"value":"beta"');
  expect(await store.queryByTag(page, { group: 'setup', value: 'beta' })).toHaveLength(0);
  // The first (locked-refused) drawing is untouched and still in the review.
  expect(await store.queryByTag(page, { group: 'setup', value: 'alpha' })).toHaveLength(1);

  // The library is global: open a different review and the stamp is still there.
  await page.getByTestId('tab-home').click();
  const entry2 = await openReview(page);
  expect(entry2).not.toBe(entry1);
  expect(stampCount((await store.getStampLibrary(page)).canvasJson)).toBe(1);

  await app.close();
});

test('unlocking the palette lets a stamp be dragged out onto the page as a move (same id), not a copy', async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);
  await seedStamp(page, { group: 'setup', value: 'flag' });
  const entryId = await openReview(page);
  const box = await canvasBox(page);

  // Unlock: the surface behaves as one canvas, so dragging a stamp onto the page MOVES it out.
  await page.getByTestId('stamp-lock').click();
  await dragScene(page, box, STAMP_CENTER, [900, 700]);

  // The stamp is now an Entry annotation with the SAME id — a move, not a fresh-id copy.
  await expect.poll(async () => (await store.queryByTag(page, { group: 'setup', value: 'flag' })).length).toBe(1);
  const hits = await store.queryByTag(page, { group: 'setup', value: 'flag' });
  expect(hits[0]?.entryId).toBe(entryId);
  expect(hits[0]?.annotationId).toBe('seed-stamp');

  // And it left the palette: the library is now empty (contrast with the locked drag-out, which keeps it).
  expect(stampCount((await store.getStampLibrary(page)).canvasJson)).toBe(0);

  await app.close();
});

test('copy-paste duplicates a drawing as an independent annotation', async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);
  const entryId = await openReview(page);
  const box = await canvasBox(page);

  await drawRect(page, box, [300, 260], [640, 460]);
  await page.keyboard.press('Control+c');
  await page.evaluate(() =>
    window.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: new DataTransfer(), bubbles: true, cancelable: true }),
    ),
  );

  await expect.poll(async () => (await store.getEntry(page, entryId))?.annotations.length ?? 0).toBe(2);
  const ids = (await store.getEntry(page, entryId))?.annotations.map((a) => a.id) ?? [];
  expect(new Set(ids).size).toBe(2);

  await app.close();
});

test('a system-clipboard screenshot out-ranks an earlier copied drawing (recency)', async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);
  const entryId = await openReview(page);
  const box = await canvasBox(page);

  // Copy a drawing: Ctrl+C now also takes over the system clipboard.
  await drawRect(page, box, [300, 260], [640, 460]);
  await page.keyboard.press('Control+c');

  // Then a screenshot arrives on the system clipboard. Ctrl+V must paste the screenshot (the newest
  // copy), not a second drawing — the old bug let the shadowed drawing win forever.
  await page.evaluate((b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    const file = new File([bytes], 'screenshot.png', { type: 'image/png' });
    const data = new DataTransfer();
    data.items.add(file);
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, PNG_1x1);

  // The page gains an image object referenced by hash; the drawing is NOT duplicated.
  await expect
    .poll(async () => ((await store.getEntry(page, entryId))?.canvasJson ?? '').includes('tj-image://'))
    .toBe(true);
  expect((await store.getEntry(page, entryId))?.annotations.length ?? 0).toBe(1);

  await app.close();
});

/** Seed the strip with arbitrary annotation objects (e.g. line stamps), then reload. */
async function seedLibraryObjects(page: Page, objects: Record<string, unknown>[]): Promise<void> {
  await store.saveStampLibrary(page, JSON.stringify({ version: '6', objects }));
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(400);
}

test('a diagonal line stamp is pulled out by the stroke you press, not the topmost overlapping box', async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);
  // Two parallel diagonal line stamps whose bounding boxes heavily overlap. The UPPER line is drawn
  // LAST (topmost z) — the old box-containment hit pulled it out no matter which stroke you pressed.
  await seedLibraryObjects(page, [
    {
      type: 'Polyline',
      points: [
        { x: 3000, y: 250 },
        { x: 3300, y: 450 },
      ],
      fill: '',
      stroke: '#3fb950',
      strokeWidth: 4,
      tjId: 'lower',
      tjTags: [{ group: 'setup', value: 'lower' }],
    },
    {
      type: 'Polyline',
      points: [
        { x: 3000, y: 200 },
        { x: 3300, y: 400 },
      ],
      fill: '',
      stroke: '#f85149',
      strokeWidth: 4,
      tjId: 'upper',
      tjTags: [{ group: 'setup', value: 'upper' }],
    },
  ]);
  const entryId = await openReview(page);
  const box = await canvasBox(page);

  // Press ON the lower stroke's midpoint — a spot the upper line's bounding box also covers — and drag
  // to the page. The pulled-out copy must be the LOWER line (under the pointer), not the topmost upper.
  await dragScene(page, box, [3150, 350], [900, 700]);

  await expect
    .poll(async () => (await store.queryByTag(page, { group: 'setup', value: 'lower' })).length)
    .toBe(1);
  const lower = await store.queryByTag(page, { group: 'setup', value: 'lower' });
  expect(lower[0]?.entryId).toBe(entryId);
  expect((await store.queryByTag(page, { group: 'setup', value: 'upper' })).length).toBe(0);

  await app.close();
});

test('a thin horizontal line stamp is grabbable within its stroke band, not only its sliver box', async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);
  // A horizontal line: its point bounding box is a near-zero-height sliver, so the old box hit was
  // almost impossible to land; the stroke band (used by the hover cursor) is what makes it grabbable.
  await seedLibraryObjects(page, [
    {
      type: 'Polyline',
      points: [
        { x: 3000, y: 300 },
        { x: 3300, y: 300 },
      ],
      fill: '',
      stroke: '#a371f7',
      strokeWidth: 4,
      tjId: 'hline',
      tjTags: [{ group: 'setup', value: 'hline' }],
    },
  ]);
  const entryId = await openReview(page);
  const box = await canvasBox(page);

  // Press 6 scene-px BELOW the stroke — outside the sliver box but well within the hover band — and drag
  // onto the page. The old box hit returned nothing here (grabbable-but-empty); now it pulls out.
  await dragScene(page, box, [3150, 306], [900, 700]);

  await expect
    .poll(async () => (await store.queryByTag(page, { group: 'setup', value: 'hline' })).length)
    .toBe(1);
  expect((await store.queryByTag(page, { group: 'setup', value: 'hline' }))[0]?.entryId).toBe(entryId);

  await app.close();
});
