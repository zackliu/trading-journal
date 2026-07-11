import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import type { AiAccessStatus, AiSampleStudy, AiVisualEvidenceManifest } from '../../src/shared/aiAccess';
import type { IpcApi } from '../../src/shared/ipc';
import { launchApp, store } from './electronApp';

type WindowWithApi = { api: IpcApi };

test.describe.configure({ timeout: 120_000 });

test('AI Access exposes the current journal through a secured read-only MCP session', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tj-ai-access-'));
  const dataDir = join(root, 'journal');
  const userDataDir = join(root, 'user-data');
  const { app, page } = await launchApp(dataDir, userDataDir);

  await store.defineGroup(page, { id: 'setup', label: 'Setup', pinned: true });
  await store.defineValue(page, { groupId: 'setup', value: 'breakout', label: 'Breakout' });
  await store.defineDimension(page, { id: 'outcome', label: 'Outcome', type: 'string' });
  const chart = await countedChartPng();
  const { hash } = await store.storeImage(page, chart.toString('base64'));
  const entry = await store.createEntry(page, {
    image: { hash },
    canvasJson: JSON.stringify({
      version: '6.9.1',
      objects: [
        {
          type: 'Image',
          src: `tj-image://${hash}`,
          originX: 'left',
          originY: 'top',
          left: 0,
          top: 0,
          width: 900,
          height: 500,
          scaleX: 1,
          scaleY: 1,
          strokeWidth: 0,
        },
        {
          type: 'Rect',
          originX: 'left',
          originY: 'top',
          left: 280,
          top: 110,
          width: 220,
          height: 220,
          scaleX: 1,
          scaleY: 1,
          fill: 'transparent',
          stroke: '#c026a3',
          strokeWidth: 4,
          tjId: 'ann-1',
          tjTags: [{ group: 'setup', value: 'breakout' }],
        },
        { type: 'Textbox', tjId: 'ann-note', text: 'Bull spike, then deep pullback' },
      ],
      tjPage: { width: 2900, height: 1600 },
    }),
    entryTags: [{ group: 'date', value: '2026-07-11' }],
    annotations: [
      {
        id: 'ann-1',
        bounds: { x: 280, y: 110, width: 220, height: 220 },
        tags: [{ group: 'setup', value: 'breakout' }],
          result: { outcome: 'Success' },
        links: [],
      },
      {
        id: 'ann-note',
        bounds: { x: 540, y: 120, width: 260, height: 100 },
        tags: [],
        links: [],
      },
    ],
  });
  const before = await store.getEntry(page, entry.id);

  const initial = await page.evaluate(() => (globalThis as unknown as WindowWithApi).api.getAiAccessStatus());
  expect(initial.state).toBe('off');
  expect(initial.disclosureAccepted).toBe(false);

  const started = await page.evaluate(() => (globalThis as unknown as WindowWithApi).api.startAiAccess(true));
  expect(started.state).toBe('on');
  expect(started.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  const configText = await page.evaluate(() => (globalThis as unknown as WindowWithApi).api.copyAiHttpConfig());
  const copied = JSON.parse(configText) as {
    servers: { 'trading-journal': { url: string; headers: { Authorization: string } } };
  };
  const connection = copied.servers['trading-journal'];

  const missingAuth = await fetch(connection.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  expect(missingAuth.status).toBe(401);
  const browserRequest = await fetch(connection.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: connection.headers.Authorization, origin: 'http://localhost' },
    body: '{}',
  });
  expect(browserRequest.status).toBe(403);
  const authenticatedNonMcpRequest = await fetch(connection.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: connection.headers.Authorization },
    body: '{}',
  });
  expect(authenticatedNonMcpRequest.status).toBe(400);

  const transport = new StreamableHTTPClientTransport(new URL(connection.url), {
    requestInit: { headers: { Authorization: connection.headers.Authorization } },
  });
  const client = new Client({ name: 'trading-journal-e2e', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);

  const tools = await client.listTools();
  expect(tools.tools.map((tool) => tool.name)).toEqual([
    'get_journal_overview',
    'list_vocabulary',
    'search_entries',
    'search_samples',
    'prepare_sample_study',
    'get_entry_context',
    'get_linked_context',
    'get_visual_evidence',
    'get_visual_evidence_batch',
  ]);
  expect(tools.tools.map((tool) => tool.name).join(' ')).not.toMatch(/create|update|delete|save|sql|statistics/i);

  const overview = await client.callTool({ name: 'get_journal_overview', arguments: {} });
  expect(overview.structuredContent).toMatchObject({ entryCount: 1, annotationCount: 2 });

  const vocabulary = await client.callTool({
    name: 'list_vocabulary',
    arguments: { kind: 'groups', limit: 50 },
  });
  expect(vocabulary.structuredContent).toMatchObject({
    items: expect.arrayContaining([
      expect.objectContaining({
        id: 'setup:breakout',
        usageCount: 1,
        entryUsageCount: 0,
        annotationUsageCount: 1,
        annotationEntryUsageCount: 1,
      }),
    ]),
  });

  const samples = await client.callTool({
    name: 'search_samples',
    arguments: {
      query: { entry: [], annotation: [{ group: 'setup', values: ['breakout'] }], results: [] },
      limit: 10,
    },
  });
  expect(samples.structuredContent).toMatchObject({
    items: [
      {
        annotationId: 'ann-1',
        entryId: entry.id,
        tags: [{ group: 'setup', value: 'breakout' }],
        result: { outcome: 'Success' },
      },
    ],
  });

  const studyResult = await client.callTool({
    name: 'prepare_sample_study',
    arguments: {
      query: { entry: [], annotation: [{ group: 'setup', values: ['breakout'] }], results: [] },
      resultDimensions: ['outcome'],
      maxSamples: 50,
      nearbyTextLimitPerEntry: 4,
    },
  });
  const study = studyResult.structuredContent as unknown as AiSampleStudy;
  expect(study).toMatchObject({
    populationSampleCount: 1,
    distinctEntryCount: 1,
    returnedSampleCount: 1,
    truncated: false,
    resultDimensions: [
      {
        id: 'outcome',
        type: 'string',
        populationCount: 1,
        recordedCount: 1,
        missingCount: 0,
        stringValues: [{ value: 'Success', count: 1, rate: 1 }],
      },
    ],
    entries: [
      {
        entryId: entry.id,
        samples: [expect.objectContaining({ annotationId: 'ann-1', result: { outcome: 'Success' } })],
        nearbyTexts: [expect.objectContaining({ annotationId: 'ann-note', text: 'Bull spike, then deep pullback' })],
      },
    ],
    visualBatches: [{ requests: [{ entryId: entry.id, annotationIds: ['ann-1'] }], sampleCount: 1 }],
  });

  const invalidStudy = await client.callTool({
    name: 'prepare_sample_study',
    arguments: {
      query: { entry: [{ group: 'setup', values: ['breakout'] }], annotation: [], results: [] },
    },
  });
  expect(invalidStudy).toMatchObject({
    isError: true,
    structuredContent: {
      error: {
        code: 'INVALID_SAMPLE_POPULATION',
        hint: expect.stringContaining('query.annotation'),
        retryable: false,
      },
    },
  });

  const unknownDimension = await client.callTool({
    name: 'prepare_sample_study',
    arguments: {
      query: { entry: [], annotation: [{ group: 'setup', values: ['breakout'] }], results: [] },
      resultDimensions: ['not-a-dimension'],
    },
  });
  expect(unknownDimension).toMatchObject({
    isError: true,
    structuredContent: {
      error: {
        code: 'NOT_FOUND',
        hint: expect.stringContaining('list_vocabulary'),
        retryable: false,
      },
    },
  });

  const context = await client.callTool({ name: 'get_entry_context', arguments: { entryId: entry.id } });
  expect(context.structuredContent).toMatchObject({
    entryId: entry.id,
    evidenceTrust: 'untrusted-journal-evidence',
    annotations: expect.arrayContaining([
      expect.objectContaining({ annotationId: 'ann-1' }),
      expect.objectContaining({
        annotationId: 'ann-note',
        text: 'Bull spike, then deep pullback',
        textTrust: 'untrusted-journal-evidence',
      }),
    ]),
  });

  const visual = await client.callTool({
    name: 'get_visual_evidence',
    arguments: { entryId: entry.id, annotationIds: ['ann-1'] },
  });
  const manifest = visual.structuredContent as unknown as AiVisualEvidenceManifest;
  expect(manifest.annotations[0]).toMatchObject({
    markId: 'A1',
    annotationId: 'ann-1',
    geometry: { kind: 'quad' },
    association: { kind: 'unique', screenshotIds: ['S1'] },
  });
  expect(manifest.evidenceTrust).toBe('untrusted-journal-evidence');
  expect(manifest.inlineAssetIds).toEqual([
    'overview',
    'locator',
    'A1-focus',
    'A1-source-locator',
    'A1-source-clean',
  ]);
  expect(manifest.assets.map((asset) => asset.kind)).toEqual([
    'overview',
    'locator',
    'focus',
    'source-locator',
    'source-clean',
  ]);
  const visualContent = (visual as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  expect(visualContent.filter((item) => item.type === 'image')).toHaveLength(5);
  expect(visualContent.filter((item) => item.type === 'resource_link')).toHaveLength(5);
  expect(visualContent.filter((item) => item.type === 'text').map((item) => item.text)).toEqual([
    expect.stringContaining('"bundleId"'),
    'Visual evidence asset overview (overview)',
    'Visual evidence asset locator (locator)',
    'Visual evidence asset A1-focus (focus)',
    'Visual evidence asset A1-source-locator (source-locator); paired with A1-source-clean',
    'Visual evidence asset A1-source-clean (source-clean); paired with A1-source-locator',
  ]);

  const sourceLocator = manifest.assets.find((asset) => asset.kind === 'source-locator')!;
  const sourceClean = manifest.assets.find((asset) => asset.kind === 'source-clean')!;
  expect(sourceLocator.pairedAssetId).toBe(sourceClean.id);
  expect(sourceClean.pairedAssetId).toBe(sourceLocator.id);
  expect([sourceLocator.width, sourceLocator.height]).toEqual([sourceClean.width, sourceClean.height]);
  const [locatorResource, cleanResource] = await Promise.all([
    client.readResource({ uri: sourceLocator.uri }),
    client.readResource({ uri: sourceClean.uri }),
  ]);
  const locatorBytes = Buffer.from('blob' in locatorResource.contents[0] ? locatorResource.contents[0].blob : '', 'base64');
  const cleanBytes = Buffer.from('blob' in cleanResource.contents[0] ? cleanResource.contents[0].blob : '', 'base64');
  expect(locatorBytes.equals(cleanBytes)).toBe(false);
  expect(await sharp(locatorBytes).metadata()).toMatchObject({ width: sourceLocator.width, height: sourceLocator.height });
  expect(await sharp(cleanBytes).metadata()).toMatchObject({ width: sourceClean.width, height: sourceClean.height });

  const batchVisual = await client.callTool({
    name: 'get_visual_evidence_batch',
    arguments: { requests: study.visualBatches[0].requests },
  });
  expect(batchVisual.structuredContent).toMatchObject({
    manifests: [
      expect.objectContaining({
        entryId: entry.id,
        inlineAssetIds: ['overview', 'locator', 'A1-focus', 'A1-source-locator', 'A1-source-clean'],
      }),
    ],
  });
  const batchContent = (batchVisual as { content?: Array<{ type: string }> }).content ?? [];
  expect(batchContent.filter((item) => item.type === 'image')).toHaveLength(5);
  expect(batchContent.filter((item) => item.type === 'resource_link')).toHaveLength(5);

  const secondTransport = new StreamableHTTPClientTransport(new URL(connection.url), {
    requestInit: { headers: { Authorization: connection.headers.Authorization } },
  });
  const secondClient = new Client({ name: 'other-session', version: '1.0.0' }, { capabilities: {} });
  await secondClient.connect(secondTransport);
  await expect(secondClient.readResource({ uri: sourceClean.uri })).rejects.toThrow(/SESSION_MISMATCH/);
  await secondClient.close();

  const guide = await client.readResource({ uri: 'trading-journal://agent-guide/current' });
  expect(guide.contents[0]).toMatchObject({ mimeType: 'text/markdown' });
  expect('text' in guide.contents[0] ? guide.contents[0].text : '').toContain('每 3 根显示一次编号');
  const prompts = await client.listPrompts();
  expect(prompts.prompts.map((prompt) => prompt.name)).toContain('inspect_entry_visual');

  expect(await store.getEntry(page, entry.id)).toEqual(before);
  await client.close();
  const stopped = await page.evaluate(() => (globalThis as unknown as WindowWithApi).api.stopAiAccess());
  expect(stopped.state).toBe('off');
  await expect.poll(async () => {
    try {
      await fetch(connection.url, { headers: { Authorization: connection.headers.Authorization } });
      return 'reachable';
    } catch {
      return 'closed';
    }
  }).toBe('closed');

  const finalStatus = await page.evaluate(() =>
    (globalThis as unknown as WindowWithApi).api.getAiAccessStatus() as Promise<AiAccessStatus>,
  );
  expect(finalStatus.recentActivity).toEqual([]);
  await app.close();
});

test('AI search order and revision-bound resources stay deterministic', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tj-ai-revision-'));
  const { app, page } = await launchApp(join(root, 'journal'), join(root, 'user-data'));
  const older = await store.createEntry(page, {
    canvasJson: JSON.stringify({ version: '6.9.1', tjPage: { width: 200, height: 100 }, objects: [] }),
    entryTags: [{ group: 'date', value: '2026-01-01' }],
    annotations: [],
  });
  const newer = await store.createEntry(page, {
    canvasJson: JSON.stringify({ version: '6.9.1', tjPage: { width: 200, height: 100 }, objects: [] }),
    entryTags: [{ group: 'date', value: '2026-07-11' }],
    annotations: [],
  });
  const connection = await startAndReadConnection(page);
  const { client } = await connectMcp(connection, 'revision-e2e');

  const newest = await client.callTool({ name: 'search_entries', arguments: { sort: 'newest', limit: 10 } });
  const oldest = await client.callTool({ name: 'search_entries', arguments: { sort: 'oldest', limit: 10 } });
  expect((newest.structuredContent as { items: Array<{ entryId: string }> }).items.map((item) => item.entryId)).toEqual([
    newer.id,
    older.id,
  ]);
  expect((oldest.structuredContent as { items: Array<{ entryId: string }> }).items.map((item) => item.entryId)).toEqual([
    older.id,
    newer.id,
  ]);

  const contextUri = (newest.structuredContent as { items: Array<{ contextResource: string }> }).items[0].contextResource;
  await expect(client.readResource({ uri: contextUri })).resolves.toBeTruthy();
  await store.updateEntryCanvas(
    page,
    newer.id,
    JSON.stringify({ version: '6.9.1', tjPage: { width: 200, height: 100 }, objects: [], revisionProbe: true }),
  );
  await expect(client.readResource({ uri: contextUri })).rejects.toThrow(/REVISION_EXPIRED/);

  await client.close();
  await page.evaluate(() => (globalThis as unknown as WindowWithApi).api.stopAiAccess());
  await app.close();
});

test('visual evidence preserves duplicate cropped screenshot instances and refuses Path source grounding', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tj-ai-instances-'));
  const { app, page } = await launchApp(join(root, 'journal'), join(root, 'user-data'));
  const source = await sharp(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect width="50" height="50" fill="#ef4444"/><rect x="50" width="50" height="50" fill="#2563eb"/></svg>',
    ),
  ).png().toBuffer();
  const { hash } = await store.storeImage(page, source.toString('base64'));
  const entry = await store.createEntry(page, {
    image: { hash },
    canvasJson: JSON.stringify({
      version: '6.9.1',
      tjPage: { width: 150, height: 50 },
      objects: [
        imageObject(hash, 0, 0),
        imageObject(hash, 100, 50),
        annotationRect('left-rect', 10),
        annotationRect('right-rect', 110),
        {
          type: 'ArrowPoly',
          originX: 'left',
          originY: 'top',
          left: 5,
          top: 35,
          width: 35,
          height: 0,
          points: [{ x: 0, y: 0 }, { x: 35, y: 0 }],
          stroke: '#111827',
          strokeWidth: 2,
          fill: 'transparent',
          tjId: 'arrow',
        },
        { type: 'Path', left: 10, top: 10, width: 20, height: 20, path: [['M', 0, 0], ['L', 20, 20]], tjId: 'freehand' },
      ],
    }),
    entryTags: [{ group: 'date', value: '2026-07-11' }],
    annotations: [
      annotationIndex('left-rect', 10),
      annotationIndex('right-rect', 110),
      { id: 'arrow', bounds: { x: 5, y: 34, width: 35, height: 2 }, tags: [], links: [] },
      annotationIndex('freehand', 10),
    ],
  });
  const connection = await startAndReadConnection(page);
  const { client } = await connectMcp(connection, 'instance-e2e');

  const visual = await client.callTool({
    name: 'get_visual_evidence',
    arguments: { entryId: entry.id, annotationIds: ['left-rect', 'right-rect'] },
  });
  const manifest = visual.structuredContent as unknown as AiVisualEvidenceManifest;
  expect(manifest.screenshots).toHaveLength(2);
  expect(manifest.screenshots[0].hash).toBe(manifest.screenshots[1].hash);
  expect(manifest.screenshots[0].pageQuad).not.toEqual(manifest.screenshots[1].pageQuad);
  expect(manifest.annotations.map((annotation) => annotation.association)).toEqual([
    { kind: 'unique', screenshotIds: ['S1'] },
    { kind: 'unique', screenshotIds: ['S2'] },
  ]);
  const overview = manifest.assets.find((asset) => asset.kind === 'overview')!;
  const overviewResource = await client.readResource({ uri: overview.uri });
  const overviewBytes = Buffer.from('blob' in overviewResource.contents[0] ? overviewResource.contents[0].blob : '', 'base64');
  const { data, info } = await sharp(overviewBytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixel = (x: number, y: number): number[] => {
    const offset = (y * info.width + x) * info.channels;
    return [...data.subarray(offset, offset + 3)];
  };
  expect(pixel(25, 42 + 25)).toEqual([239, 68, 68]);
  expect(pixel(75, 42 + 25)).toEqual([255, 255, 255]);
  expect(pixel(125, 42 + 25)).toEqual([37, 99, 235]);

  const arrow = await client.callTool({
    name: 'get_visual_evidence',
    arguments: { entryId: entry.id, annotationIds: ['arrow'] },
  });
  const arrowManifest = arrow.structuredContent as unknown as AiVisualEvidenceManifest;
  expect(arrowManifest.annotations[0]).toMatchObject({
    geometry: {
      kind: 'arrow',
      start: expect.any(Object),
      end: expect.any(Object),
      arrowTip: expect.any(Object),
      arrowHead: [expect.any(Object), expect.any(Object), expect.any(Object)],
    },
    association: { kind: 'unique', screenshotIds: ['S1'] },
  });
  expect(arrowManifest.assets.map((asset) => asset.kind)).toEqual([
    'overview',
    'locator',
    'focus',
    'source-locator',
    'source-clean',
  ]);

  const unsupported = await client.callTool({
    name: 'get_visual_evidence',
    arguments: { entryId: entry.id, annotationIds: ['freehand'] },
  });
  const unsupportedManifest = unsupported.structuredContent as unknown as AiVisualEvidenceManifest;
  expect(unsupportedManifest.annotations[0]).toMatchObject({
    geometry: { kind: 'unsupported' },
    association: { kind: 'unsupported', screenshotIds: [] },
  });
  expect(unsupportedManifest.assets.map((asset) => asset.kind)).toEqual(['overview', 'locator', 'focus']);

  await client.close();
  await page.evaluate(() => (globalThis as unknown as WindowWithApi).api.stopAiAccess());
  await app.close();
});

test('AI access key persists encrypted and reset invalidates every copied config', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tj-ai-key-'));
  const dataDir = join(root, 'journal');
  const userDataDir = join(root, 'user-data');
  const first = await launchApp(dataDir, userDataDir);
  const firstConnection = await startAndReadConnection(first.page);
  await first.page.evaluate(() => (globalThis as unknown as WindowWithApi).api.stopAiAccess());
  await first.app.close();

  const machineConfig = readFileSync(join(userDataDir, 'config.json'), 'utf8');
  expect(machineConfig).toContain('encryptedAccessKey');
  expect(machineConfig).not.toContain(firstConnection.headers.Authorization.slice('Bearer '.length));

  const second = await launchApp(dataDir, userDataDir);
  const status = await second.page.evaluate(() => (globalThis as unknown as WindowWithApi).api.getAiAccessStatus());
  expect(status).toMatchObject({ state: 'off', disclosureAccepted: true });
  await second.page.evaluate(() => (globalThis as unknown as WindowWithApi).api.startAiAccess(false));
  const persistedText = await second.page.evaluate(() =>
    (globalThis as unknown as WindowWithApi).api.copyAiHttpConfig(),
  );
  const persisted = (JSON.parse(persistedText) as { servers: { 'trading-journal': McpConnection } }).servers[
    'trading-journal'
  ];
  expect(persisted.headers.Authorization).toBe(firstConnection.headers.Authorization);

  await second.page.evaluate(() => (globalThis as unknown as WindowWithApi).api.resetAiAccessKey());
  await second.page.evaluate(() => (globalThis as unknown as WindowWithApi).api.startAiAccess(false));
  const replacedText = await second.page.evaluate(() =>
    (globalThis as unknown as WindowWithApi).api.copyAiHttpConfig(),
  );
  const replaced = (JSON.parse(replacedText) as { servers: { 'trading-journal': McpConnection } }).servers[
    'trading-journal'
  ];
  expect(replaced.headers.Authorization).not.toBe(firstConnection.headers.Authorization);
  const oldRequest = await fetch(replaced.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: firstConnection.headers.Authorization },
    body: '{}',
  });
  expect(oldRequest.status).toBe(401);

  await second.page.evaluate(() => (globalThis as unknown as WindowWithApi).api.stopAiAccess());
  await second.app.close();
});

test('App settings has a dedicated AI page with MCP setup and editable prompts', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tj-ai-settings-'));
  const { app, page } = await launchApp(join(root, 'journal'), join(root, 'user-data'));
  await page.getByTestId('ribbon-general').click();
  await expect(page.getByTestId('settings-page-general')).toBeVisible();
  await expect(page.getByTestId('settings-tab-general')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('ai-access')).toHaveCount(0);

  await page.getByTestId('settings-tab-ai').click();
  await expect(page.getByTestId('ai-access')).toBeVisible();
  await expect(page.getByTestId('settings-tab-ai')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('ai-access-steps')).toContainText('MCP: Open User Configuration');
  await expect(page.getByTestId('ai-access-steps')).toContainText('MCP: List Servers');
  await expect(page.getByTestId('ai-agent-guide')).toHaveValue(/左上是 1 小时图（1h）/);
  await expect(page.getByTestId('ai-agent-guide')).toHaveValue(/蓝色平滑曲线是 5m EMA20/);
  await expect(page.getByTestId('ai-agent-guide')).toHaveValue(/红色小块表示 sell 入场点/);
  await expect(page.getByTestId('ai-agent-guide')).toHaveValue(/每 3 根显示一次编号/);
  await expect(page.getByTestId('ai-agent-guide')).toHaveValue(/纯白背景通常表示 RTH 时段/);
  await expect(page.getByTestId('ai-prompt-inspect_entry_visual')).toBeVisible();
  await page.getByTestId('ai-agent-guide').fill('Unsaved guide draft');
  await page.getByTestId('settings-tab-general').click();
  await expect(page.getByTestId('general-path')).toBeVisible();
  await page.getByTestId('settings-tab-ai').click();
  await expect(page.getByTestId('ai-agent-guide')).toHaveValue('Unsaved guide draft');
  await app.close();
});

async function countedChartPng(): Promise<Buffer> {
  const candles = Array.from({ length: 30 }, (_, index) => {
    const x = 30 + index * 27;
    const up = index % 4 !== 1;
    const bodyTop = 100 + ((index * 19) % 170);
    const bodyHeight = 38 + ((index * 7) % 44);
    const color = up ? '#2f9e44' : '#ef476f';
    const count = (index + 1) % 3 === 0
      ? `<text x="${x + 6}" y="455" text-anchor="middle" font-size="13" fill="#e8590c">${index + 1}</text>`
      : '';
    return `<line x1="${x + 6}" y1="${bodyTop - 18}" x2="${x + 6}" y2="${bodyTop + bodyHeight + 20}" stroke="${color}"/><rect x="${x}" y="${bodyTop}" width="12" height="${bodyHeight}" fill="${color}"/>${count}`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="500"><rect width="900" height="500" fill="#fbfbfb"/><g stroke="#e9ecef">${Array.from({ length: 10 }, (_, index) => `<line x1="0" y1="${index * 50}" x2="900" y2="${index * 50}"/>`).join('')}</g>${candles}<text x="28" y="28" font-size="16" fill="#495057">Labels below bars appear every 3 candles</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

type McpConnection = { url: string; headers: { Authorization: string } };

async function startAndReadConnection(page: import('@playwright/test').Page): Promise<McpConnection> {
  await page.evaluate(() => (globalThis as unknown as WindowWithApi).api.startAiAccess(true));
  const configText = await page.evaluate(() => (globalThis as unknown as WindowWithApi).api.copyAiHttpConfig());
  return (JSON.parse(configText) as { servers: { 'trading-journal': McpConnection } }).servers['trading-journal'];
}

async function connectMcp(connection: McpConnection, name: string): Promise<{ client: Client }> {
  const transport = new StreamableHTTPClientTransport(new URL(connection.url), {
    requestInit: { headers: { Authorization: connection.headers.Authorization } },
  });
  const client = new Client({ name, version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  return { client };
}

function imageObject(hash: string, left: number, cropX: number): Record<string, unknown> {
  return {
    type: 'Image',
    src: `tj-image://${hash}`,
    originX: 'left',
    originY: 'top',
    left,
    top: 0,
    width: 50,
    height: 50,
    cropX,
    cropY: 0,
    scaleX: 1,
    scaleY: 1,
    strokeWidth: 0,
  };
}

function annotationRect(id: string, left: number): Record<string, unknown> {
  return {
    type: 'Rect',
    originX: 'left',
    originY: 'top',
    left,
    top: 10,
    width: 20,
    height: 20,
    fill: 'transparent',
    stroke: '#c026a3',
    strokeWidth: 2,
    tjId: id,
  };
}

function annotationIndex(id: string, x: number): import('../../src/shared/domain').Annotation {
  return { id, bounds: { x, y: 10, width: 20, height: 20 }, tags: [], links: [] };
}