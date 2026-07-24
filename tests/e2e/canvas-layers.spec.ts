import { expect, test, type Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BASE_CANVAS_LAYER_ID } from '../../src/shared/domain';
import { launchApp, store } from './electronApp';

const CANVAS = '.canvas-container';
const SCENE_W = 3482;
const SCENE_H = 1600;

interface Box {
  width: number;
  height: number;
}

function pos(box: Box, x: number, y: number): { x: number; y: number } {
  return { x: (x / SCENE_W) * box.width, y: (y / SCENE_H) * box.height };
}

async function pastePng(page: Page, color: string): Promise<void> {
  const png = await page.evaluate((fill) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 700;
    const context = canvas.getContext('2d')!;
    context.fillStyle = fill;
    context.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png').split(',')[1];
  }, color);
  await page.evaluate((base64) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const data = new DataTransfer();
    data.items.add(new File([bytes], 'chart.png', { type: 'image/png' }));
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, png);
}

function drawables(canvasJson: string): Array<{ type?: string; tjId?: string; tjRole?: string; tjLayerId?: string; left?: number }> {
  const parsed = JSON.parse(canvasJson) as {
    objects?: Array<{ type?: string; tjId?: string; tjRole?: string; tjLayerId?: string; left?: number }>;
  };
  return (parsed.objects ?? []).filter((object) => object.tjRole !== 'title');
}

test('drawings use the highest layer, screenshots use the base top, and arrange commands keep exact boundaries', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'tj-canvas-layers-'));
  const { app, page } = await launchApp(dataDir);

  await test.step('create the top layer', async () => {
    await page.getByTestId('ribbon-layers').click();
    await page.getByTestId('layers-name').fill('Analysis');
    await page.getByTestId('layers-add').click();
  });
  const layers = await store.listCanvasLayers(page);
  const top = layers[1];
  expect(top?.name).toBe('Analysis');
  await page.getByLabel('关闭').click();

  await page.getByTestId('ribbon-new').click();
  const canvas = page.locator(CANVAS);
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(300);
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');

  await test.step('draw in the highest layer', async () => {
    await page.getByTestId('tool-rect').click();
    await canvas.hover({ position: pos(box, 500, 450), force: true });
    await page.mouse.down();
    await canvas.hover({ position: pos(box, 850, 700), force: true });
    await page.mouse.up();
  });

  const entryId = (await store.listEntries(page))[0]?.id;
  if (!entryId) throw new Error('expected an entry');
  await expect
    .poll(async () => drawables((await store.getEntry(page, entryId))?.canvasJson ?? '{}')[0]?.tjLayerId)
    .toBe(top.id);

  await test.step('paste both screenshots into the base layer', async () => {
    await pastePng(page, '#336699');
    await pastePng(page, '#993333');
  });
  await expect.poll(async () => drawables((await store.getEntry(page, entryId))?.canvasJson ?? '{}').length).toBe(3);
  let objects = drawables((await store.getEntry(page, entryId))?.canvasJson ?? '{}');
  expect(objects.map((object) => object.tjLayerId)).toEqual([
    BASE_CANVAS_LAYER_ID,
    BASE_CANVAS_LAYER_ID,
    top.id,
  ]);
  expect(objects.slice(0, 2).every((object) => object.type === 'Image')).toBe(true);

  await test.step('move the drawing down one layer', async () => {
    await canvas.click({ position: pos(box, 650, 560), force: true });
    await page.getByTestId('tab-draw').click();
    await page.getByTitle('移到下一图层').click({ timeout: 3000 });
  });
  await expect
    .poll(async () => drawables((await store.getEntry(page, entryId))?.canvasJson ?? '{}').map((object) => object.tjLayerId))
    .toEqual([BASE_CANVAS_LAYER_ID, BASE_CANVAS_LAYER_ID, BASE_CANVAS_LAYER_ID]);

  await page.getByTitle('移至所有内容最后').click({ timeout: 3000 });
  objects = drawables((await store.getEntry(page, entryId))?.canvasJson ?? '{}');
  expect(objects[0]?.type).toBe('Rect');
  expect(objects[0]?.tjLayerId).toBe(BASE_CANVAS_LAYER_ID);

  await app.close();
});

test('layer-local movement swaps adjacent objects while multi-selection cannot change layers', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'tj-layer-local-'));
  const { app, page } = await launchApp(dataDir);
  await store.createCanvasLayer(page, 'Top');
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.getByTestId('ribbon-new').click();
  const canvas = page.locator(CANVAS);
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(300);
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');

  const drawRect = async (fromX: number, toX: number): Promise<void> => {
    await page.getByTestId('tab-draw').click();
    await page.getByTestId('tool-rect').click();
    await canvas.hover({ position: pos(box, fromX, 450), force: true });
    await page.mouse.down();
    await canvas.hover({ position: pos(box, toX, 650), force: true });
    await page.mouse.up();
  };
  await drawRect(400, 650);
  await drawRect(800, 1050);
  const entryId = (await store.listEntries(page))[0]?.id;
  if (!entryId) throw new Error('expected an entry');
  await expect.poll(async () => drawables((await store.getEntry(page, entryId))?.canvasJson ?? '{}').length).toBe(2);
  const originalOrder = drawables((await store.getEntry(page, entryId))?.canvasJson ?? '{}').map((object) => object.left);

  await canvas.click({ position: pos(box, 520, 550), force: true });
  await page.getByTestId('tab-draw').click();
  const arrangeTitles = [
    '同层上移一层',
    '同层下移一层',
    '移至本图层最前',
    '移至本图层最后',
    '移到上一图层',
    '移到下一图层',
    '移至所有内容最前',
    '移至所有内容最后',
  ];
  const iconPaths = await Promise.all(
    arrangeTitles.map((title) => page.getByTitle(title).locator('path').getAttribute('d')),
  );
  expect(new Set(iconPaths).size).toBe(arrangeTitles.length);

  await canvas.click({ position: pos(box, 520, 550), button: 'right', force: true });
  await expect(page.getByTestId('menu-layer-info')).toContainText('隶属图层');
  await expect(page.getByTestId('menu-layer-info')).toContainText('Top');
  await expect(page.getByTestId('menu-layer-forward')).toHaveText('挪上');
  await expect(page.getByTestId('menu-layer-front')).not.toBeVisible();
  await page.getByTestId('menu-other-arrange').click();
  await expect(page.getByTestId('menu-layer-front')).toBeVisible();
  await expect(page.getByTestId('menu-layer-front').locator('..')).toHaveCSS('opacity', '1');
  await page.keyboard.press('Escape');
  await page.getByTitle('同层上移一层').click();
  await expect
    .poll(async () => drawables((await store.getEntry(page, entryId))?.canvasJson ?? '{}').map((object) => object.left))
    .toEqual([...originalOrder].reverse());

  await page.keyboard.down('Shift');
  await canvas.click({ position: pos(box, 920, 550), force: true });
  await page.keyboard.up('Shift');
  await page.getByTestId('tab-draw').click();
  await expect(page.getByTitle('移到下一图层')).toBeDisabled();
  await expect(page.getByTitle('移至所有内容最前')).toBeDisabled();
  await expect(page.getByTitle('移至所有内容最后')).toBeDisabled();

  await app.close();
});

test('the layer manager makes stack direction explicit and only unused layers are draggable', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'tj-layer-manager-order-'));
  const { app, page } = await launchApp(dataDir);
  const usedLower = await store.createCanvasLayer(page, '标注');
  const empty = await store.createCanvasLayer(page, '待调整');
  const usedUpper = await store.createCanvasLayer(page, '文字');
  await store.createEntry(page, {
    canvasJson: JSON.stringify({
      version: '6',
      objects: [
        { type: 'Rect', tjId: 'lower', tjLayerId: usedLower.id },
        { type: 'Rect', tjId: 'upper', tjLayerId: usedUpper.id },
      ],
    }),
    entryTags: [],
    annotations: [],
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.getByTestId('ribbon-layers').click();

  await expect(page.getByTestId('layers-list')).toContainText('最上层');
  await expect(page.getByTestId('layers-list')).toContainText('覆盖下方');
  await expect(page.getByTestId(`layer-${empty.id}`)).toContainText('空图层 · 可拖动调整');
  await expect(page.getByTestId(`layer-${empty.id}`)).toHaveAttribute('draggable', 'true');
  await expect(page.getByTestId(`layer-${usedLower.id}`)).toHaveAttribute('draggable', 'false');

  await page.getByTestId(`layer-${empty.id}`).dragTo(page.getByTestId(`layer-${usedUpper.id}`), {
    targetPosition: { x: 30, y: 1 },
  });
  await expect
    .poll(async () => (await store.listCanvasLayers(page)).map((layer) => layer.id))
    .toEqual([BASE_CANVAS_LAYER_ID, usedLower.id, usedUpper.id, empty.id]);
  const rows = page.locator('.layers__row');
  await expect(rows.nth(0)).toHaveAttribute('data-testid', `layer-${empty.id}`);
  await expect(rows.nth(1)).toHaveAttribute('data-testid', `layer-${usedUpper.id}`);

  await app.close();
});

test('deleting a used layer warns and merges into the layer below without changing object order', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'tj-delete-layer-ui-'));
  const { app, page } = await launchApp(dataDir);
  const layer = await store.createCanvasLayer(page, 'Temporary');
  const entry = await store.createEntry(page, {
    canvasJson: JSON.stringify({
      version: '6',
      objects: [
        { type: 'Rect', left: 100, top: 100, width: 80, height: 80, tjId: 'base', tjLayerId: BASE_CANVAS_LAYER_ID },
        { type: 'Rect', left: 200, top: 100, width: 80, height: 80, tjId: 'temporary', tjLayerId: layer.id },
      ],
    }),
    entryTags: [],
    annotations: [],
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  const before = drawables((await store.getEntry(page, entry.id))?.canvasJson ?? '{}').map((object) => object.tjId);
  await page.getByTestId('ribbon-layers').click();
  await page.getByTestId(`layer-delete-${layer.id}`).click();
  await expect(page.getByTestId('confirm-dialog')).toContainText('原图层结构无法恢复');
  await expect(page.getByTestId('confirm-dialog')).toContainText('1 条复盘、1 个页面对象');
  await page.getByTestId('confirm-ok').click();
  await expect(page.getByTestId(`layer-${layer.id}`)).toHaveCount(0);

  const afterJson = (await store.getEntry(page, entry.id))?.canvasJson ?? '{}';
  expect(drawables(afterJson).map((object) => object.tjId)).toEqual(before);
  expect(drawables(afterJson).every((object) => object.tjLayerId === BASE_CANVAS_LAYER_ID)).toBe(true);

  await app.close();
});

test('a stamp keeps its strip position while its selected target layer controls the dropped copy', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'tj-stamp-target-layer-'));
  const { app, page } = await launchApp(dataDir);
  const top = await store.createCanvasLayer(page, 'Stamp overlay');
  await store.saveStampLibrary(
    page,
    JSON.stringify({
      version: '6',
      objects: [
        {
          type: 'Rect',
          left: 3120,
          top: 120,
          width: 100,
          height: 70,
          fill: '#ff0000',
          tjId: 'layered-stamp',
          tjTags: [],
          tjLayerId: BASE_CANVAS_LAYER_ID,
        },
      ],
    }),
  );
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.getByTestId('ribbon-new').click();
  const canvas = page.locator(CANVAS);
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(300);
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');

  await canvas.click({ position: pos(box, 3170, 155), button: 'right', force: true });
  await expect(page.getByTestId('context-menu')).toHaveCount(0);

  await page.getByTestId('stamp-lock').click();
  await canvas.click({ position: pos(box, 3170, 155), button: 'right', force: true });
  await expect(page.getByTestId('menu-layer-info')).toContainText('基层');
  await expect(page.getByTestId('menu-stamp-layer')).toContainText('选择图层');
  await expect(page.getByTestId('menu-stamp-layer')).toContainText('基层');
  await page.getByTestId('menu-stamp-layer').click();
  await expect(page.getByTestId(`menu-stamp-layer-${BASE_CANVAS_LAYER_ID}`)).toHaveClass(/is-active/);
  await expect(page.getByTestId(`menu-stamp-layer-${BASE_CANVAS_LAYER_ID}`).locator('..')).toHaveCSS('opacity', '1');
  await page.getByTestId(`menu-stamp-layer-${top.id}`).click();
  await page.getByTestId('tab-annotation').click();
  await expect(page.getByTestId('stamp-target-layer')).toHaveValue(top.id);
  await expect.poll(async () => (await store.getStampLibrary(page)).canvasJson).toContain(top.id);

  await page.getByTestId('tab-draw').click();
  await page.getByTestId('stamp-lock').click();
  await canvas.hover({ position: pos(box, 3170, 155), force: true });
  await page.mouse.down();
  await canvas.hover({ position: pos(box, 1800, 700), force: true });
  await canvas.hover({ position: pos(box, 900, 700), force: true });
  await page.mouse.up();

  const entryId = (await store.listEntries(page))[0]?.id;
  if (!entryId) throw new Error('expected an entry');
  await expect
    .poll(async () => drawables((await store.getEntry(page, entryId))?.canvasJson ?? '{}').find((object) => object.tjId !== 'layered-stamp')?.tjLayerId)
    .toBe(top.id);

  await app.close();
});
