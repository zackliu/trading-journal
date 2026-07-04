import { test, expect } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Annotation, Tag, ViewQuery } from '../../src/shared/domain';
import { launchApp, store } from './electronApp';

function tempDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'tj-view-'));
}

const CANVAS = JSON.stringify({ version: '6', tjPage: { width: 2900, height: 1600 }, objects: [] });

function ann(id: string, tags: Tag[], result?: Record<string, string | number>): Annotation {
  return { id, bounds: { x: 0, y: 0, width: 100, height: 100 }, tags, result };
}

const emptyQuery: ViewQuery = { entry: [], annotation: [], results: [] };

test('a view matches entry-existence AND single-annotation co-occurrence', async () => {
  const { app, page } = await launchApp(tempDataDir());
  await store.defineDimension(page, { id: 'outcome', label: 'Outcome', type: 'string' });

  // E1: bull day; A1 is the co-occurring H2 long win; A2 is an H2 that lost.
  const e1 = await store.createEntry(page, {
    canvasJson: CANVAS,
    entryTags: [{ group: 'day-structure', value: 'bull' }],
    annotations: [
      ann('a1', [{ group: 'setup', value: 'h2' }, { group: 'side', value: 'long' }], { outcome: 'win' }),
      ann('a2', [{ group: 'setup', value: 'h2' }], { outcome: 'loss' }),
    ],
  });
  // E2: bull day, but H2 / long / win are spread across different annotations (must NOT match).
  const e2 = await store.createEntry(page, {
    canvasJson: CANVAS,
    entryTags: [{ group: 'day-structure', value: 'bull' }],
    annotations: [ann('b1', [{ group: 'setup', value: 'h2' }]), ann('b2', [{ group: 'side', value: 'long' }], { outcome: 'win' })],
  });

  const query: ViewQuery = {
    entry: [{ group: 'day-structure', values: ['bull'] }],
    annotation: [{ group: 'setup', values: ['h2'] }, { group: 'side', values: ['long'] }],
    results: [{ dimension: 'outcome', in: ['win'] }],
  };
  const matches = await store.runView(page, query);

  expect(matches.map((m) => m.entryId)).toEqual([e1.id]);
  expect(matches[0]?.annotationIds).toEqual(['a1']); // only the co-occurring annotation
  expect(matches.map((m) => m.entryId)).not.toContain(e2.id);

  await app.close();
});

test('the same group filters at either dimension depending on the view', async () => {
  const { app, page } = await launchApp(tempDataDir());
  // E1 carries setup:h2 at the ENTRY level; E2 only on an annotation.
  const e1 = await store.createEntry(page, {
    canvasJson: CANVAS,
    entryTags: [{ group: 'setup', value: 'h2' }],
    annotations: [],
  });
  const e2 = await store.createEntry(page, {
    canvasJson: CANVAS,
    entryTags: [],
    annotations: [ann('x', [{ group: 'setup', value: 'h2' }])],
  });

  const asEntry = await store.runView(page, { entry: [{ group: 'setup', values: ['h2'] }], annotation: [], results: [] });
  const asAnnotation = await store.runView(page, { entry: [], annotation: [{ group: 'setup', values: ['h2'] }], results: [] });

  expect(asEntry.map((m) => m.entryId)).toEqual([e1.id]);
  expect(asAnnotation.map((m) => m.entryId)).toEqual([e2.id]);

  await app.close();
});

test('a number result predicate narrows within the co-occurring annotation', async () => {
  const { app, page } = await launchApp(tempDataDir());
  await store.defineDimension(page, { id: 'r-multiple', label: 'R', type: 'number' });

  const winner = await store.createEntry(page, {
    canvasJson: CANVAS,
    entryTags: [],
    annotations: [ann('w', [{ group: 'setup', value: 'h2' }], { 'r-multiple': 2 })],
  });
  const loser = await store.createEntry(page, {
    canvasJson: CANVAS,
    entryTags: [],
    annotations: [ann('l', [{ group: 'setup', value: 'h2' }], { 'r-multiple': -1 })],
  });

  const matches = await store.runView(page, {
    entry: [],
    annotation: [{ group: 'setup', values: ['h2'] }],
    results: [{ dimension: 'r-multiple', gte: 1 }],
  });

  expect(matches.map((m) => m.entryId)).toEqual([winner.id]);
  expect(matches.map((m) => m.entryId)).not.toContain(loser.id);

  await app.close();
});

test('one entry appears under multiple views with no second stored row', async () => {
  const { app, page } = await launchApp(tempDataDir());
  const e = await store.createEntry(page, {
    canvasJson: CANVAS,
    entryTags: [],
    annotations: [ann('h', [{ group: 'setup', value: 'h2' }]), ann('w', [{ group: 'setup', value: 'wedge' }])],
  });

  const asH2 = await store.runView(page, { entry: [], annotation: [{ group: 'setup', values: ['h2'] }], results: [] });
  const asWedge = await store.runView(page, { entry: [], annotation: [{ group: 'setup', values: ['wedge'] }], results: [] });

  expect(asH2.map((m) => m.entryId)).toEqual([e.id]);
  expect(asWedge.map((m) => m.entryId)).toEqual([e.id]);
  // One durable row, reachable from both views — never duplicated for a second view.
  expect(await store.listEntries(page)).toHaveLength(1);

  await app.close();
});

test('context-sensitive counts recompute under the active filter', async () => {
  const { app, page } = await launchApp(tempDataDir());
  await store.defineGroup(page, { id: 'setup', label: 'Setup', pinned: true });
  await store.defineValue(page, { groupId: 'setup', value: 'h2' });
  await store.defineValue(page, { groupId: 'setup', value: 'wedge' });

  const bull = [{ group: 'day-structure', value: 'bull' }];
  await store.createEntry(page, { canvasJson: CANVAS, entryTags: bull, annotations: [ann('1', [{ group: 'setup', value: 'h2' }])] });
  await store.createEntry(page, { canvasJson: CANVAS, entryTags: bull, annotations: [ann('2', [{ group: 'setup', value: 'h2' }])] });
  await store.createEntry(page, { canvasJson: CANVAS, entryTags: bull, annotations: [ann('3', [{ group: 'setup', value: 'wedge' }])] });
  await store.createEntry(page, { canvasJson: CANVAS, entryTags: [], annotations: [ann('4', [{ group: 'setup', value: 'h2' }])] });
  await store.createEntry(page, { canvasJson: CANVAS, entryTags: [], annotations: [ann('5', [{ group: 'setup', value: 'wedge' }])] });

  const global = await store.countGroupValuesUnderView(page, emptyQuery, 'setup');
  expect(global).toEqual([
    { value: 'h2', count: 3 },
    { value: 'wedge', count: 2 },
  ]);

  const underBull = await store.countGroupValuesUnderView(
    page,
    { entry: [{ group: 'day-structure', values: ['bull'] }], annotation: [], results: [] },
    'setup',
  );
  expect(underBull).toEqual([
    { value: 'h2', count: 2 },
    { value: 'wedge', count: 1 },
  ]);

  await app.close();
});

test('a saved view re-runs its query, it is not a folder', async () => {
  const { app, page } = await launchApp(tempDataDir());
  const query: ViewQuery = { entry: [], annotation: [{ group: 'setup', values: ['h2'] }], results: [] };

  const first = await store.createEntry(page, {
    canvasJson: CANVAS,
    entryTags: [],
    annotations: [ann('h', [{ group: 'setup', value: 'h2' }])],
  });
  const view = await store.createSavedView(page, 'H2 setups', query);

  // Only the query is stored — not artifacts.
  expect(view.queryJson).toBe(JSON.stringify(query));
  expect(JSON.parse(view.queryJson)).toEqual(query);

  const before = await store.runView(page, JSON.parse((await store.getSavedView(page, view.id))!.queryJson) as ViewQuery);
  expect(before.map((m) => m.entryId)).toEqual([first.id]);

  // A newly added matching review shows up on re-run — the view is a live query, not a container.
  const second = await store.createEntry(page, {
    canvasJson: CANVAS,
    entryTags: [],
    annotations: [ann('h2', [{ group: 'setup', value: 'h2' }])],
  });
  const after = await store.runView(page, JSON.parse((await store.getSavedView(page, view.id))!.queryJson) as ViewQuery);
  expect(after.map((m) => m.entryId).sort()).toEqual([first.id, second.id].sort());

  // Deleting the view removes only the query, never the reviews it matched.
  await store.deleteSavedView(page, view.id);
  expect(await store.listSavedViews(page)).toHaveLength(0);
  expect(await store.listEntries(page)).toHaveLength(2);

  await app.close();
});
