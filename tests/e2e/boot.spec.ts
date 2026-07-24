import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let app: ElectronApplication;
let page: Page;
let dataDir: string;

test.beforeEach(async () => {
  // Isolated, empty portable data folder for each run.
  dataDir = mkdtempSync(join(tmpdir(), 'tj-slice0-'));
  app = await electron.launch({
    args: ['.'],
    env: { ...process.env, TJ_DATA_DIR: dataDir },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
});

test.afterEach(async () => {
  await app?.close();
});

test('the app boots to an empty shell with an open data folder', async () => {
  // 1. The empty shell renders.
  await expect(page.getByTestId('app-title')).toHaveText('Trading Journal');

  // 2. The typed IPC ping round-trips main <-> renderer.
  const ping = await page.evaluate(() =>
    (
      globalThis as unknown as {
        api: { ping(): Promise<{ ok: boolean; sqliteReady: boolean; userVersion: number }> };
      }
    ).api.ping(),
  );
  expect(ping.ok).toBe(true);
  expect(ping.sqliteReady).toBe(true);
  // Schema migrated forward through appended migrations: v1 initial, v2 stamp library, v3 thumbnail,
  // v4 tag registry, v5 vocabulary sort, v6 result preset values, v7 soft-delete, v8 schema_meta,
  // v9 text links/journal identity, v10 journal-global canvas layers.
  expect(ping.userVersion).toBe(10);

  // 3. The status shell reflects the healthy boot.
  await expect(page.getByTestId('status-ipc')).toContainText('connected');
  await expect(page.getByTestId('status-store')).toContainText('SQLite v10');

  // 4. The portable data folder was created with an empty SQLite file and images/.
  expect(existsSync(join(dataDir, 'app.sqlite'))).toBe(true);
  expect(existsSync(join(dataDir, 'images'))).toBe(true);

  await page.screenshot({ path: 'test-results/boot.png' });
});
