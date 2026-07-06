import { test, expect } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, store } from './electronApp';

function tempDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'tj-result-'));
}

const CANVAS = JSON.stringify({ version: '6', tjPage: { width: 2900, height: 1600 }, objects: [] });

test('a result dimension declares preset values, listed in registry order', async () => {
  const { app, page } = await launchApp(tempDataDir());
  await store.defineDimension(page, { id: 'outcome', label: 'Outcome', type: 'string' });
  await store.defineResultValue(page, 'outcome', 'win', 'Win');
  await store.defineResultValue(page, 'outcome', 'loss', 'Loss');
  await store.defineDimension(page, { id: 'r-multiple', label: 'R Multiple', type: 'number' });

  const vocab = await store.listResultVocabulary(page);
  expect(vocab.find((d) => d.id === 'outcome')?.values.map((v) => v.value)).toEqual(['win', 'loss']);
  expect(vocab.find((d) => d.id === 'r-multiple')?.values).toEqual([]); // a number dimension has no presets

  await store.deleteResultValue(page, 'outcome', 'loss');
  const after = await store.listResultVocabulary(page);
  expect(after.find((d) => d.id === 'outcome')?.values.map((v) => v.value)).toEqual(['win']);

  await app.close();
});

test('a result dimension type is fixed at creation: re-declaring the id never flips it', async () => {
  const { app, page } = await launchApp(tempDataDir());
  await store.defineDimension(page, { id: 'outcome', label: 'Outcome', type: 'string' });
  await store.defineResultValue(page, 'outcome', 'win', 'Win');

  // A trade records a string result — it now lives in string_value under a `string` dimension.
  const entry = await store.createEntry(page, {
    canvasJson: CANVAS,
    entryTags: [],
    annotations: [{ id: 'a', bounds: { x: 0, y: 0, width: 10, height: 10 }, tags: [], result: { outcome: 'win' } }],
  });

  // Re-declaring the SAME id with a DIFFERENT type (the Settings "Add" form re-using an existing name)
  // must not flip the stored type — otherwise the recorded result is stranded in the wrong column and the
  // annotation's next save throws. Re-declaring only relabels; the original `string` type is preserved.
  await store.defineDimension(page, { id: 'outcome', label: 'Result', type: 'number' });

  const outcome = (await store.listResultVocabulary(page)).find((d) => d.id === 'outcome');
  expect(outcome?.type).toBe('string');
  expect(outcome?.label).toBe('Result'); // the label DID update
  expect(outcome?.count).toBe(1); // the recorded result survived, still readable/typed

  // And the annotation still saves cleanly (a flipped type would make this throw).
  const resaved = await store.getEntry(page, entry.id);
  expect(resaved?.annotations[0]?.result).toEqual({ outcome: 'win' });
  const roundtrip = await store.updateEntry(page, entry.id, {
    canvasJson: CANVAS,
    entryTags: [],
    annotations: [{ id: 'a', bounds: { x: 0, y: 0, width: 10, height: 10 }, tags: [], result: { outcome: 'win' } }],
  });
  expect(roundtrip.annotations[0]?.result).toEqual({ outcome: 'win' });

  await app.close();
});

test('deleting an in-use result dimension archives it; it restores with values and usage intact', async () => {
  const { app, page } = await launchApp(tempDataDir());
  await store.defineDimension(page, { id: 'outcome', label: 'Outcome', type: 'string' });
  await store.defineResultValue(page, 'outcome', 'win', 'Win');

  // An unused dimension deletes cleanly (archived, gone from the active registry).
  await store.defineDimension(page, { id: 'grade', label: 'Grade', type: 'string' });
  await store.deleteResultDimension(page, 'grade');
  expect((await store.listResultVocabulary(page)).map((d) => d.id)).not.toContain('grade');

  // A trade records the dimension — it is now in use.
  await store.createEntry(page, {
    canvasJson: CANVAS,
    entryTags: [],
    annotations: [{ id: 'a', bounds: { x: 0, y: 0, width: 10, height: 10 }, tags: [], result: { outcome: 'win' } }],
  });
  expect((await store.listResultVocabulary(page)).find((d) => d.id === 'outcome')?.count).toBe(1);

  // Deleting an in-use dimension is a soft archive: hidden from the active list, kept under Archived.
  await store.deleteResultDimension(page, 'outcome');
  expect((await store.listResultVocabulary(page)).map((d) => d.id)).not.toContain('outcome');
  expect((await store.listArchivedResults(page)).dimensions.map((d) => d.id)).toContain('outcome');

  // Restoring brings it back with its preset value and its recorded usage untouched (the id never changed).
  await store.restoreResultDimension(page, 'outcome');
  const restored = (await store.listResultVocabulary(page)).find((d) => d.id === 'outcome');
  expect(restored?.values.map((v) => v.value)).toEqual(['win']);
  expect(restored?.count).toBe(1);
  expect((await store.listArchivedResults(page)).dimensions.map((d) => d.id)).not.toContain('outcome');

  await app.close();
});

test('a result value in use is archived and restorable', async () => {
  const { app, page } = await launchApp(tempDataDir());
  await store.defineDimension(page, { id: 'outcome', label: 'Outcome', type: 'string' });
  await store.defineResultValue(page, 'outcome', 'win', 'Win');
  await store.defineResultValue(page, 'outcome', 'loss', 'Loss');
  await store.createEntry(page, {
    canvasJson: CANVAS,
    entryTags: [],
    annotations: [{ id: 'a', bounds: { x: 0, y: 0, width: 10, height: 10 }, tags: [], result: { outcome: 'win' } }],
  });

  // 'win' is recorded on a trade -> archived on delete and preserved under Archived.
  await store.deleteResultValue(page, 'outcome', 'win');
  expect((await store.listResultVocabulary(page)).find((d) => d.id === 'outcome')?.values.map((v) => v.value)).toEqual([
    'loss',
  ]);
  expect((await store.listArchivedResults(page)).values.map((v) => `${v.dimensionId}:${v.value}`)).toContain('outcome:win');

  await store.restoreResultValue(page, 'outcome', 'win');
  const values = (await store.listResultVocabulary(page)).find((d) => d.id === 'outcome')?.values.map((v) => v.value);
  expect(values).toContain('win');

  await app.close();
});

test('renaming a result dimension keeps its id, values, and recorded usage', async () => {
  const { app, page } = await launchApp(tempDataDir());
  await store.defineDimension(page, { id: 'outcome', label: 'Outcome', type: 'string' });
  await store.defineResultValue(page, 'outcome', 'win', 'Win');
  await store.createEntry(page, {
    canvasJson: CANVAS,
    entryTags: [],
    annotations: [{ id: 'a', bounds: { x: 0, y: 0, width: 10, height: 10 }, tags: [], result: { outcome: 'win' } }],
  });

  // Relabel is an upsert with the same id and a new display label — no reference migration needed.
  await store.defineDimension(page, { id: 'outcome', label: 'Trade Result', type: 'string' });
  const dim = (await store.listResultVocabulary(page)).find((d) => d.id === 'outcome');
  expect(dim?.label).toBe('Trade Result');
  expect(dim?.values.map((v) => v.value)).toEqual(['win']);
  expect(dim?.count).toBe(1);

  await app.close();
});

test('signed result choices stay distinct — "1R" and "-1R" do not collide', async () => {
  const { app, page } = await launchApp(tempDataDir());
  await page.getByTestId('ribbon-new').click();
  await page.getByTestId('tab-home').click();
  await page.getByTestId('ribbon-result-settings').click();
  await page.getByTestId('result-settings').waitFor();

  await page.getByTestId('result-dim-name').fill('Result');
  await page.getByTestId('result-dim-type').selectOption('string');
  await page.getByTestId('result-add-dim').click();

  for (const choice of ['1R', '-1R', 'BE']) {
    await page.getByTestId('result-add-value-result').fill(choice);
    await page.getByTestId('result-add-value-result').press('Enter');
  }

  // Values are stored verbatim, so the sign is preserved and nothing overwrites anything.
  const values = (await store.listResultVocabulary(page)).find((d) => d.id === 'result')?.values.map((v) => v.value);
  expect(values).toEqual(['1R', '-1R', 'BE']);

  await app.close();
});
