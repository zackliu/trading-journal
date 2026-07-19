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

test('selected title text becomes a persisted internal hyperlink with Ctrl+K', async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);
  const targetEntryId = await newReview(page);

  await page.getByTestId('entry-item').first().click({ button: 'right' });
  await page.getByTestId('context-copy-link').click();
  await expect(page.getByTestId('action-notice')).toHaveText('Link copied');
  const copiedAddress = await page.evaluate((id) =>
    (globalThis as unknown as {
      api: { copyInternalLink(target: { kind: 'entry'; id: string }): Promise<string> };
    }).api.copyInternalLink({ kind: 'entry', id }),
    targetEntryId,
  );
  expect(copiedAddress).toContain(`/entry/${encodeURIComponent(targetEntryId)}`);

  await page.getByTestId('tab-home').click();
  const sourceEntryId = await newReview(page);
  expect(sourceEntryId).not.toBe(targetEntryId);
  const box = (await page.locator(CANVAS).boundingBox())!;
  await page.locator(CANVAS).dblclick({ position: pos(box, 260, 55), force: true });
  await page.keyboard.type('Review the first setup');
  await page.keyboard.press('Control+Home');
  await page.keyboard.down('Shift');
  for (let index = 0; index < 6; index += 1) await page.keyboard.press('ArrowRight');
  await page.keyboard.up('Shift');
  await page.keyboard.press('Control+k');

  await expect(page.getByTestId('link-dialog')).toBeVisible();
  await expect(page.getByTestId('link-text')).toHaveValue('Review');
  await page.getByTestId('link-address').fill(copiedAddress);
  await expect(page.getByTestId('link-save')).toBeEnabled();
  await page.getByTestId('link-save').click();

  await expect
    .poll(async () => {
      const json = (await store.getEntry(page, sourceEntryId))?.canvasJson ?? '{}';
      const parsed = JSON.parse(json) as {
        objects?: Array<{
          tjRole?: string;
          tjTextLinks?: Array<{ start: number; end: number; target: { kind: string; id: string } }>;
        }>;
      };
      return parsed.objects?.find((object) => object.tjRole === 'title')?.tjTextLinks ?? [];
    })
    .toEqual([
      {
        start: 0,
        end: 6,
        target: { kind: 'entry', id: targetEntryId },
      },
    ]);

  await page.locator(CANVAS).dblclick({ position: pos(box, 330, 55), force: true });
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Backspace');
  await page.locator(CANVAS).click({ position: pos(box, 1200, 900), force: true });
  await expect
    .poll(async () => {
      const json = (await store.getEntry(page, sourceEntryId))?.canvasJson ?? '{}';
      const parsed = JSON.parse(json) as {
        objects?: Array<{ tjRole?: string; text?: string; tjTextLinks?: Array<{ start: number; end: number }> }>;
      };
      const title = parsed.objects?.find((object) => object.tjRole === 'title');
      return { text: title?.text, links: title?.tjTextLinks };
    })
    .toEqual({ text: 'Reiew the first setup', links: [{ start: 0, end: 5, target: { kind: 'entry', id: targetEntryId } }] });

  await page.keyboard.press('Control+z');
  await expect
    .poll(async () => (await store.getEntry(page, sourceEntryId))?.canvasJson ?? '')
    .toContain('Review the first setup');

  await page.locator(CANVAS).click({ button: 'right', position: pos(box, 105, 55), force: true });
  await page.getByTestId('menu-remove-link').click();
  await expect
    .poll(async () => (await store.getEntry(page, sourceEntryId))?.canvasJson ?? '')
    .not.toContain('tjTextLinks');
  expect((await store.getEntry(page, sourceEntryId))?.canvasJson).toContain('Review the first setup');

  await page.keyboard.press('Control+z');
  await expect
    .poll(async () => (await store.getEntry(page, sourceEntryId))?.canvasJson ?? '')
    .toContain('tjTextLinks');

  await page.locator(CANVAS).click({ button: 'right', position: pos(box, 105, 55), force: true });
  await page.getByTestId('menu-open-link').click();
  await expect(page.locator(`[data-entry-id="${targetEntryId}"]`)).toHaveClass(/is-active/);

  await app.close();
});
