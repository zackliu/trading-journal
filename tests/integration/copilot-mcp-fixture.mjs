import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron } from '@playwright/test';
import sharp from 'sharp';

const root = mkdtempSync(join(tmpdir(), 'tj-copilot-mcp-'));
const app = await electron.launch({
  args: ['.', `--user-data-dir=${join(root, 'user-data')}`],
  env: { ...process.env, TJ_DATA_DIR: join(root, 'journal'), TJ_TEST: '1' },
});
const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');

const candles = Array.from({ length: 30 }, (_, index) => {
  const x = 30 + index * 27;
  const up = index % 4 !== 1;
  const bodyTop = 100 + ((index * 19) % 170);
  const bodyHeight = 38 + ((index * 7) % 44);
  const color = up ? '#2f9e44' : '#ef476f';
  const count =
    (index + 1) % 3 === 0
      ? `<text x="${x + 6}" y="455" text-anchor="middle" font-size="13" fill="#e8590c">${index + 1}</text>`
      : '';
  return `<line x1="${x + 6}" y1="${bodyTop - 18}" x2="${x + 6}" y2="${bodyTop + bodyHeight + 20}" stroke="${color}"/><rect x="${x}" y="${bodyTop}" width="12" height="${bodyHeight}" fill="${color}"/>${count}`;
}).join('');
const chartSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="500"><rect width="900" height="500" fill="#fbfbfb"/><g stroke="#e9ecef">${Array.from({ length: 10 }, (_, index) => `<line x1="0" y1="${index * 50}" x2="900" y2="${index * 50}"/>`).join('')}</g>${candles}<text x="28" y="28" font-size="16" fill="#495057">Labels below bars appear every 3 candles</text></svg>`;
const chart = await sharp(Buffer.from(chartSvg)).png().toBuffer();

const seeded = await page.evaluate(
  async ({ base64 }) => {
    await globalThis.api.defineGroup({ id: 'setup', label: 'Setup', pinned: true });
    await globalThis.api.defineValue({ groupId: 'setup', value: 'counted-move', label: 'Counted Move' });
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const { hash } = await globalThis.api.storeImage(bytes);
    const entry = await globalThis.api.createEntry({
      image: { hash },
      canvasJson: JSON.stringify({
        version: '6.9.1',
        tjPage: { width: 900, height: 500 },
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
            tjId: 'count-zone',
            tjTags: [{ group: 'setup', value: 'counted-move' }],
          },
          {
            type: 'TextBoxAnnotation',
            originX: 'left',
            originY: 'top',
            left: 530,
            top: 110,
            width: 300,
            height: 100,
            text: 'Every third bar has a cumulative count label.',
            fontSize: 24,
            fill: '#111827',
            boxFill: '#ffbf00',
            boxStroke: '#ffbf00',
            boxStrokeWidth: 1,
            tjId: 'count-note',
          },
        ],
      }),
      entryTags: [{ group: 'date', value: '2026-07-11' }],
      annotations: [
        {
          id: 'count-zone',
          bounds: { x: 280, y: 110, width: 220, height: 220 },
          tags: [{ group: 'setup', value: 'counted-move' }],
        },
        {
          id: 'count-note',
          bounds: { x: 530, y: 110, width: 300, height: 100 },
          tags: [],
        },
      ],
    });
    const status = await globalThis.api.startAiAccess(true);
    const config = JSON.parse(await globalThis.api.copyAiHttpConfig());
    return { entryId: entry.id, status, config };
  },
  { base64: chart.toString('base64') },
);

console.log(`TJ_COPILOT_FIXTURE=${JSON.stringify(seeded)}`);
console.log('Fixture is running. Stop this terminal after the Copilot MCP integration check.');

const shutdown = async () => {
  try {
    await page.evaluate(() => globalThis.api.stopAiAccess());
  } finally {
    await app.close();
  }
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
await new Promise(() => undefined);
