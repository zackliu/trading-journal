import { expect, test } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BASE_CANVAS_LAYER_ID } from '../../src/shared/domain';
import { launchApp, store } from './electronApp';

function canvas(objects: Array<Record<string, unknown>>): string {
  return JSON.stringify({ version: '6', objects });
}

function objectIds(canvasJson: string): string[] {
  const parsed = JSON.parse(canvasJson) as { objects: Array<{ tjId?: string }> };
  return parsed.objects.map((object) => object.tjId ?? '');
}

test('canvas layers grow upward, rename by stable id, and merge downward without reordering', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'tj-layers-'));
  const { app, page } = await launchApp(dataDir);

  const initial = await store.listCanvasLayers(page);
  expect(initial).toEqual([{ id: BASE_CANVAS_LAYER_ID, name: '基层', isBase: true }]);

  const lower = await store.createCanvasLayer(page, '标记');
  const upper = await store.createCanvasLayer(page, '文字');
  expect((await store.listCanvasLayers(page)).map((layer) => layer.id)).toEqual([
    BASE_CANVAS_LAYER_ID,
    lower.id,
    upper.id,
  ]);
  expect(await store.renameCanvasLayer(page, lower.id, '入场标记')).toEqual({
    ...lower,
    name: '入场标记',
  });

  const entry = await store.createEntry(page, {
    canvasJson: canvas([
      { type: 'Rect', tjId: 'base', tjLayerId: BASE_CANVAS_LAYER_ID },
      { type: 'Rect', tjId: 'lower-a', tjLayerId: lower.id },
      { type: 'Rect', tjId: 'lower-b', tjLayerId: lower.id },
      { type: 'Rect', tjId: 'upper', tjLayerId: upper.id },
    ]),
    entryTags: [],
    annotations: [],
  });
  await store.saveStampLibrary(
    page,
    canvas([
      { type: 'Rect', tjId: 'stamp-lower', tjLayerId: lower.id },
      { type: 'Rect', tjId: 'stamp-upper', tjLayerId: upper.id },
    ]),
  );

  const impact = await store.inspectCanvasLayerDeletion(page, lower.id);
  expect(impact).toMatchObject({
    layer: { id: lower.id, name: '入场标记', isBase: false },
    mergeInto: { id: BASE_CANVAS_LAYER_ID, isBase: true },
    entryCount: 1,
    objectCount: 2,
    stampCount: 1,
  });

  const beforeEntry = (await store.getEntry(page, entry.id))?.canvasJson ?? '';
  const beforeStamp = (await store.getStampLibrary(page)).canvasJson;
  await store.deleteCanvasLayerAndMerge(page, lower.id);

  const afterEntry = (await store.getEntry(page, entry.id))?.canvasJson ?? '';
  const afterStamp = (await store.getStampLibrary(page)).canvasJson;
  expect(objectIds(afterEntry)).toEqual(objectIds(beforeEntry));
  expect(objectIds(afterStamp)).toEqual(objectIds(beforeStamp));
  expect(afterEntry).not.toContain(lower.id);
  expect(afterStamp).not.toContain(lower.id);
  expect((await store.listCanvasLayers(page)).map((layer) => layer.id)).toEqual([
    BASE_CANVAS_LAYER_ID,
    upper.id,
  ]);

  await expect(store.deleteCanvasLayerAndMerge(page, BASE_CANVAS_LAYER_ID)).rejects.toThrow(
    /base canvas layer cannot be deleted/,
  );
  expect((await store.listCanvasLayers(page))[0]).toMatchObject({ id: BASE_CANVAS_LAYER_ID, isBase: true });

  await app.close();
});

test('an unused layer can be inserted between used layers without changing any painted object order', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'tj-empty-layer-order-'));
  const { app, page } = await launchApp(dataDir);
  const usedLower = await store.createCanvasLayer(page, '标注');
  const empty = await store.createCanvasLayer(page, '待调整');
  const usedUpper = await store.createCanvasLayer(page, '文字');
  const entry = await store.createEntry(page, {
    canvasJson: canvas([
      { type: 'Rect', tjId: 'lower', tjLayerId: usedLower.id },
      { type: 'Rect', tjId: 'upper', tjLayerId: usedUpper.id },
    ]),
    entryTags: [],
    annotations: [],
  });
  await store.saveStampLibrary(page, canvas([{ type: 'Rect', tjId: 'stamp-upper', tjLayerId: usedUpper.id }]));

  expect(await store.listCanvasLayerUsage(page)).toEqual([
    { id: BASE_CANVAS_LAYER_ID, name: '基层', isBase: true, entryCount: 0, objectCount: 0, stampCount: 0 },
    { ...usedLower, entryCount: 1, objectCount: 1, stampCount: 0 },
    { ...empty, entryCount: 0, objectCount: 0, stampCount: 0 },
    { ...usedUpper, entryCount: 1, objectCount: 1, stampCount: 1 },
  ]);

  const entryBefore = (await store.getEntry(page, entry.id))?.canvasJson;
  const stampBefore = (await store.getStampLibrary(page)).canvasJson;
  await store.reorderCanvasLayers(page, [BASE_CANVAS_LAYER_ID, empty.id, usedLower.id, usedUpper.id]);
  expect((await store.listCanvasLayers(page)).map((layer) => layer.id)).toEqual([
    BASE_CANVAS_LAYER_ID,
    empty.id,
    usedLower.id,
    usedUpper.id,
  ]);
  expect((await store.getEntry(page, entry.id))?.canvasJson).toBe(entryBefore);
  expect((await store.getStampLibrary(page)).canvasJson).toBe(stampBefore);

  await expect(
    store.reorderCanvasLayers(page, [BASE_CANVAS_LAYER_ID, empty.id, usedUpper.id, usedLower.id]),
  ).rejects.toThrow(/layer in use cannot be moved/);
  expect((await store.listCanvasLayers(page)).map((layer) => layer.id)).toEqual([
    BASE_CANVAS_LAYER_ID,
    empty.id,
    usedLower.id,
    usedUpper.id,
  ]);

  await app.close();
});