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
  // Slice 1 schema migrated to v1; Slice 5 added the stamp library (v2); v3 adds the rendered thumbnail column; v4 adds the tag registry; v5 adds vocabulary sort order.
  expect(ping.userVersion).toBe(5);

  // 3. The status shell reflects the healthy boot.
  await expect(page.getByTestId('status-ipc')).toContainText('connected');
  await expect(page.getByTestId('status-store')).toContainText('SQLite v5');

  // 4. The portable data folder was created with an empty SQLite file and images/.
  expect(existsSync(join(dataDir, 'app.sqlite'))).toBe(true);
  expect(existsSync(join(dataDir, 'images'))).toBe(true);

  await page.screenshot({ path: 'test-results/boot.png' });
});
