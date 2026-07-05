import { test, expect } from '@playwright/test';
import { copyFileSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, store } from './electronApp';

const FIXTURE = join(process.cwd(), 'tests', 'fixtures', 'journal-v7.sqlite');

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
  expect(ping.userVersion).toBe(8);

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

  // A pre-migration snapshot was written before the schema changed.
  const backups = readdirSync(join(dataDir, 'backups'));
  expect(backups.some((f) => /^app-v7-.*\.sqlite$/.test(f))).toBe(true);

  await app.close();
});
