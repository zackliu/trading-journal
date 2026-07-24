import { test, expect } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CreateEntryInput } from '../../src/shared/domain';
import { launchApp, store } from './electronApp';

function tempDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'tj-slice1-'));
}

test('creating an entry writes durable truth readable after restart', async () => {
  const dataDir = tempDataDir();
  const input: CreateEntryInput = {
    image: { hash: 'img-hash-1' },
    canvasJson: JSON.stringify({ fabric: 'placeholder', objects: [] }),
    entryTags: [
      { group: 'date', value: '2026-07-03' },
      { group: 'instrument', value: 'es' },
    ],
    annotations: [],
  };

  // First launch: create the entry, then quit.
  const first = await launchApp(dataDir);
  const created = await store.createEntry(first.page, input);
  await first.app.close();
  expect(created.id).toBeTruthy();

  // Reopen the same data folder (simulated restart) and read it back.
  const second = await launchApp(dataDir);
  const loaded = await store.getEntry(second.page, created.id);
  await second.app.close();

  expect(loaded).not.toBeNull();
  expect(loaded?.image).toEqual({ hash: 'img-hash-1' });
  // Canvas JSON round-trips exactly; the image lives as a hash ref, not base64.
  expect(loaded?.canvasJson).toBe(input.canvasJson);
  expect(loaded?.entryTags).toEqual(expect.arrayContaining(input.entryTags));
  expect(loaded?.entryTags).toHaveLength(2);
  expect(loaded?.id).toBe(created.id);
  expect(loaded?.annotations).toEqual([]);
});

test("an annotation's tags and typed result are projected and stay in sync", async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);

  // User predefines the outcome dimensions (one numeric, one categorical).
  await store.defineDimension(page, { id: 'r-multiple', label: 'R Multiple', type: 'number' });
  await store.defineDimension(page, { id: 'pullback-depth', label: 'Pullback Depth', type: 'string' });

  const boxId = 'ann-box-1';
  const textId = 'ann-text-1';
  const input: CreateEntryInput = {
    image: { hash: 'img-hash-2' },
    canvasJson: '{}',
    entryTags: [],
    annotations: [
      {
        id: boxId,
        bounds: { x: 10, y: 20, width: 100, height: 60 },
        tags: [{ group: 'setup', value: 'wedge-top' }],
        result: { 'r-multiple': 1, 'pullback-depth': 'deep' },
      },
      {
        id: textId,
        bounds: { x: 5, y: 5, width: 200, height: 30 },
        tags: [{ group: 'structure', value: 'lower-high' }],
      },
    ],
  };
  const created = await store.createEntry(page, input);

  // Both annotations land in the projection under the same parent entry.
  const afterCreate = await store.getEntry(page, created.id);
  expect(afterCreate?.annotations.map((a) => a.id)).toEqual([boxId, textId]);

  // Queries read the annotation-tag index (not canvas JSON).
  const setupHits = await store.queryByTag(page, { group: 'setup', value: 'wedge-top' });
  expect(setupHits.map((h) => h.annotationId)).toEqual([boxId]);
  expect(setupHits[0]?.entryId).toBe(created.id);
  expect(setupHits[0]?.bounds).toEqual({ x: 10, y: 20, width: 100, height: 60 });
  expect(setupHits[0]?.result).toEqual({ 'r-multiple': 1, 'pullback-depth': 'deep' });

  const structHits = await store.queryByTag(page, { group: 'structure', value: 'lower-high' });
  expect(structHits.map((h) => h.annotationId)).toEqual([textId]);
  expect(structHits[0]?.entryId).toBe(created.id);
  expect(structHits[0]?.bounds).toEqual({ x: 5, y: 5, width: 200, height: 30 });
  expect(structHits[0]?.result).toBeUndefined();

  // Update: drop the box's tag + result, and retag the text box.
  const updated: CreateEntryInput = {
    image: input.image,
    canvasJson: input.canvasJson,
    entryTags: [],
    annotations: [
      { id: boxId, bounds: input.annotations[0].bounds, tags: [] },
      { id: textId, bounds: input.annotations[1].bounds, tags: [{ group: 'structure', value: 'higher-low' }] },
    ],
  };
  await store.updateEntry(page, created.id, updated);

  // The index stays in sync: old tag + result gone, new tag present.
  expect(await store.queryByTag(page, { group: 'setup', value: 'wedge-top' })).toHaveLength(0);
  expect(await store.queryByTag(page, { group: 'structure', value: 'lower-high' })).toHaveLength(0);
  const higherLow = await store.queryByTag(page, { group: 'structure', value: 'higher-low' });
  expect(higherLow.map((h) => h.annotationId)).toEqual([textId]);

  const reloaded = await store.getEntry(page, created.id);
  const box = reloaded?.annotations.find((a) => a.id === boxId);
  expect(box?.tags).toEqual([]);
  expect(box?.result).toBeUndefined();

  await app.close();
});

test('the store rejects a malformed create-entry payload at the boundary', async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);

  const badInput = {
    image: { hash: 'h' },
    canvasJson: '{}',
    entryTags: [{ group: 'Not Kebab', value: 'x' }],
    annotations: [],
  };
  const errorMessage = await page.evaluate(
    (input) =>
      (globalThis as unknown as { api: { createEntry(i: unknown): Promise<unknown> } }).api
        .createEntry(input)
        .then(
          () => '',
          (err: unknown) => (err instanceof Error ? err.message : String(err)),
        ),
    badInput,
  );
  await app.close();

  // A non-kebab tag group is rejected before any write happens.
  expect(errorMessage).not.toBe('');
});

test('the store rejects a drawable canvas object without a layer id', async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);

  const errorMessage = await page.evaluate(() =>
    (globalThis as unknown as { api: { createEntry(i: unknown): Promise<unknown> } }).api
      .createEntry({
        canvasJson: JSON.stringify({ version: '6', objects: [{ type: 'Rect', width: 20, height: 20 }] }),
        entryTags: [],
        annotations: [],
      })
      .then(
        () => '',
        (err: unknown) => (err instanceof Error ? err.message : String(err)),
      ),
  );
  await app.close();

  expect(errorMessage).toContain('drawable canvas objects must have a layer id');
});

test('the store rejects unknown layer ids and persisted structural canvas objects', async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);

  const invoke = (canvasJson: string): Promise<string> =>
    page.evaluate((json) =>
      (globalThis as unknown as { api: { createEntry(i: unknown): Promise<unknown> } }).api
        .createEntry({ canvasJson: json, entryTags: [], annotations: [] })
        .then(
          () => '',
          (err: unknown) => (err instanceof Error ? err.message : String(err)),
        ),
    canvasJson);

  await expect(invoke(JSON.stringify({ objects: [{ type: 'Rect', tjLayerId: 'missing-layer' }] }))).resolves.toContain(
    'unknown layer',
  );
  await expect(invoke(JSON.stringify({ objects: [{ type: 'Rect', tjChrome: true }] }))).resolves.toContain(
    'canvas chrome cannot be persisted',
  );
  await expect(
    invoke(JSON.stringify({ objects: [{ type: 'TextBoxAnnotation', tjRole: 'title', tjLayerId: 'base' }] })),
  ).resolves.toContain('structural title cannot belong to a layer');

  await app.close();
});
