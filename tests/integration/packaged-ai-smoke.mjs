import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { _electron as electron } from '@playwright/test';
import sharp from 'sharp';

const executablePath = join(process.cwd(), 'dist', 'win-unpacked', 'TradingJournal.exe');
if (!existsSync(executablePath)) throw new Error('Packaged app not found; run npm run package first');

const root = mkdtempSync(join(tmpdir(), 'tj-packaged-ai-'));
const app = await electron.launch({
  executablePath,
  args: [`--user-data-dir=${join(root, 'user-data')}`],
  env: { ...process.env, TJ_DATA_DIR: join(root, 'journal'), TJ_TEST: '1' },
});

try {
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  const image = await sharp({ create: { width: 160, height: 100, channels: 3, background: '#f8fafc' } })
    .png()
    .toBuffer();
  const seeded = await page.evaluate(async (base64) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const { hash } = await globalThis.api.storeImage(bytes);
    const entry = await globalThis.api.createEntry({
      image: { hash },
      canvasJson: JSON.stringify({
        version: '6.9.1',
        tjPage: { width: 160, height: 100 },
        objects: [
          {
            type: 'Image',
            src: `tj-image://${hash}`,
            originX: 'left',
            originY: 'top',
            left: 0,
            top: 0,
            width: 160,
            height: 100,
            scaleX: 1,
            scaleY: 1,
            strokeWidth: 0,
          },
          {
            type: 'Rect',
            originX: 'left',
            originY: 'top',
            left: 40,
            top: 20,
            width: 60,
            height: 50,
            fill: 'transparent',
            stroke: '#c026a3',
            strokeWidth: 2,
            tjId: 'packaged-annotation',
          },
        ],
      }),
      entryTags: [{ group: 'date', value: '2026-07-11' }],
      annotations: [
        {
          id: 'packaged-annotation',
          bounds: { x: 40, y: 20, width: 60, height: 50 },
          tags: [],
          links: [],
        },
      ],
    });
    await globalThis.api.startAiAccess(true);
    return { entryId: entry.id, config: JSON.parse(await globalThis.api.copyAiHttpConfig()) };
  }, image.toString('base64'));

  const connection = seeded.config.servers['trading-journal'];
  const transport = new StreamableHTTPClientTransport(new URL(connection.url), {
    requestInit: { headers: { Authorization: connection.headers.Authorization } },
  });
  const client = new Client({ name: 'packaged-ai-smoke', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  const visual = await client.callTool({
    name: 'get_visual_evidence',
    arguments: { entryId: seeded.entryId, annotationIds: ['packaged-annotation'] },
  });
  const imageCount = (visual.content ?? []).filter((item) => item.type === 'image').length;
  if (imageCount !== 5) throw new Error(`Expected 5 packaged visual images, received ${imageCount}`);
  await client.close();
  await page.evaluate(() => globalThis.api.stopAiAccess());
  console.log('Packaged AI Access smoke passed: companion + Sharp + MCP visual evidence');
} finally {
  await app.close();
}