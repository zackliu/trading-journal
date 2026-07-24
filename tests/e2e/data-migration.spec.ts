import { test, expect } from '@playwright/test';
import { copyFileSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, store } from './electronApp';

const FIXTURE = join(process.cwd(), 'tests', 'fixtures', 'journal-v7.sqlite');
const FIXTURE_V9 = join(process.cwd(), 'tests', 'fixtures', 'journal-v9.sqlite');

/**
 * The data-safety guarantee (v0.1.0+): opening a journal created by an older schema must migrate it
 * forward WITHOUT losing any review data, and must snapshot it first. This golden fixture is a real
 * v7 journal with a tagged entry, an annotation carrying a tag + a recorded result, a vocabulary
 * group/value, a result dimension/value, and a saved view. When you add a migration, this test is the
 * proof it is non-destructive — keep it green.
 */
test('an older journal migrates forward with every review preserved, and is backed up first', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'tj-migrate-'));
  copyFileSync(FIXTURE, join(dataDir, 'app.sqlite'));

  const { app, page } = await launchApp(dataDir);

  // Migrated to the current schema (the fixture was v7; migrations ran forward).
  const ping = await page.evaluate(() =>
    (globalThis as unknown as { api: { ping(): Promise<{ userVersion: number }> } }).api.ping(),
  );
  expect(ping.userVersion).toBe(10);

  // The entry and its tags survived.
  const entries = await store.listEntries(page);
  expect(entries.length).toBe(1);
  const entry = await store.getEntry(page, entries[0].id);
  expect(entry?.entryTags).toEqual(
    expect.arrayContaining([
      { group: 'date', value: '2026-01-02' },
      { group: 'setup', value: 'h2' },
    ]),
  );
  expect(entry?.canvasJson).toContain('tjPage');
  const migratedCanvas = JSON.parse(entry?.canvasJson ?? '{}') as {
    objects?: Array<{ tjRole?: string; tjLayerId?: string }>;
  };
  for (const object of migratedCanvas.objects ?? []) {
    if (object.tjRole === 'title') expect(object.tjLayerId).toBeUndefined();
    else expect(object.tjLayerId).toBe('base');
  }
  const originalCanvasJson = entry?.canvasJson;

  // Loading a preserved review for browsing is read-only. Merely opening it must not normalize,
  // reserialize, or otherwise rewrite its durable canvas document.
  await page.getByTestId('entry-item').click();
  await expect(page.getByTestId('editor')).toHaveAttribute('aria-busy', 'false');
  expect((await store.getEntry(page, entries[0].id))?.canvasJson).toBe(originalCanvasJson);

  // The annotation, its tag, and its recorded result survived.
  expect(entry?.annotations.length).toBe(1);
  const annotation = entry?.annotations[0];
  expect(annotation?.tags).toEqual(expect.arrayContaining([{ group: 'setup', value: 'h2' }]));
  expect(annotation?.result).toEqual({ outcome: 'win' });
  expect((await store.queryEntriesByTag(page, { group: 'setup', value: 'h2' })).length).toBe(1);

  // The vocabulary registry and result registry survived (labels + counts intact).
  const setup = (await store.listGroups(page)).find((g) => g.id === 'setup');
  expect(setup?.values.find((v) => v.value === 'h2')?.label).toBe('High 2');
  const outcome = (await store.listResultVocabulary(page)).find((d) => d.id === 'outcome');
  expect(outcome?.values.map((v) => v.value)).toContain('win');
  expect(outcome?.count).toBe(1);

  // The saved view survived.
  expect((await store.listSavedViews(page)).map((v) => v.name)).toContain('Winning H2');

  // The real legacy stamp document survived and was assigned to the permanent base layer without
  // changing its identity, tags, result or array position.
  const stampJson = (await store.getStampLibrary(page)).canvasJson;
  const stampDoc = JSON.parse(stampJson) as {
    objects?: Array<{
      tjId?: string;
      tjLayerId?: string;
      tjTags?: Array<{ group: string; value: string }>;
      tjResult?: Record<string, string | number>;
    }>;
  };
  expect(stampDoc.objects).toHaveLength(1);
  expect(stampDoc.objects?.[0]).toMatchObject({
    tjId: 'golden-stamp',
    tjLayerId: 'base',
    tjTags: [{ group: 'setup', value: 'h2' }],
    tjResult: { outcome: 'win' },
  });

  // A pre-migration snapshot was written before the schema changed.
  const backups = readdirSync(join(dataDir, 'backups'));
  const backupName = backups.find((f) => /^app-v7-.*\.sqlite$/.test(f));
  expect(backupName).toBeTruthy();
  expect(backups.filter((name) => name.endsWith('.tmp') || name.includes('.tmp-') || name.endsWith('-wal') || name.endsWith('-shm'))).toEqual([]);

  await app.close();

  // The snapshot is not merely present: it is a standalone, openable v7 journal whose data can run
  // through the full migration chain again.
  const restoreDir = mkdtempSync(join(tmpdir(), 'tj-restore-backup-'));
  copyFileSync(join(dataDir, 'backups', backupName!), join(restoreDir, 'app.sqlite'));
  const restored = await launchApp(restoreDir);
  expect(await store.listEntries(restored.page)).toHaveLength(1);
  const restoredStamp = JSON.parse((await store.getStampLibrary(restored.page)).canvasJson) as { objects?: unknown[] };
  expect(restoredStamp.objects).toHaveLength(1);
  await restored.app.close();
});

test('a v9 journal gains only layer ownership while its complete canvas structure stays intact', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'tj-migrate-v9-'));
  copyFileSync(FIXTURE_V9, join(dataDir, 'app.sqlite'));

  const { app, page } = await launchApp(dataDir);
  const ping = await page.evaluate(() =>
    (globalThis as unknown as { api: { ping(): Promise<{ userVersion: number }> } }).api.ping(),
  );
  expect(ping.userVersion).toBe(10);

  const entries = await store.listEntries(page);
  expect(entries).toHaveLength(1);
  const entry = await store.getEntry(page, entries[0].id);
  expect(entry?.image?.hash).toBe('a'.repeat(64));
  expect(entry?.annotations.map((annotation) => annotation.id)).toEqual(['seed-annotation', 'seed-note']);
  expect(entry?.annotations.find((annotation) => annotation.id === 'seed-annotation')).toMatchObject({
    tags: [{ group: 'setup', value: 'h2' }],
    result: { outcome: 'win' },
  });

  const canvas = JSON.parse(entry?.canvasJson ?? '{}') as {
    version: string;
    tjPage: { width: number; height: number };
    objects: Array<Record<string, unknown>>;
  };
  expect(canvas.objects.map((object) => object.tjId ?? object.tjRole ?? object.type)).toEqual([
    'title',
    'Image',
    'seed-annotation',
    'seed-note',
  ]);
  expect(canvas.objects[0].tjLayerId).toBeUndefined();
  expect(canvas.objects.slice(1).every((object) => object.tjLayerId === 'base')).toBe(true);
  for (const object of canvas.objects) delete object.tjLayerId;
  expect(canvas).toEqual({
    version: '6',
    tjPage: { width: 2900, height: 1600 },
    objects: [
      {
        type: 'TextBoxAnnotation',
        tjRole: 'title',
        text: 'Review seed',
        tjTextLinks: [{ start: 0, end: 6, target: { kind: 'annotation', id: 'seed-annotation' } }],
        left: 30,
        top: 50,
        width: 500,
        height: 50,
      },
      {
        type: 'Image',
        src: `tj-image://${'a'.repeat(64)}`,
        left: 0,
        top: 100,
        width: 900,
        height: 500,
      },
      {
        type: 'Rect',
        tjId: 'seed-annotation',
        tjTags: [{ group: 'setup', value: 'h2' }],
        tjResult: { outcome: 'win' },
        left: 100,
        top: 100,
        width: 200,
        height: 120,
        stroke: '#f85149',
      },
      {
        type: 'TextBoxAnnotation',
        tjId: 'seed-note',
        tjTags: [],
        text: 'Note text',
        tjTextLinks: [{ start: 0, end: 4, target: { kind: 'annotation', id: 'seed-annotation' } }],
        left: 400,
        top: 300,
        width: 180,
        height: 60,
      },
    ],
  });

  const stamp = JSON.parse((await store.getStampLibrary(page)).canvasJson) as {
    objects?: Array<{ tjId?: string; tjLayerId?: string }>;
  };
  expect(stamp.objects).toEqual([expect.objectContaining({ tjId: 'golden-stamp', tjLayerId: 'base' })]);
  expect(readdirSync(join(dataDir, 'backups')).some((name) => /^app-v9-.*\.sqlite$/.test(name))).toBe(true);

  await app.close();
});
