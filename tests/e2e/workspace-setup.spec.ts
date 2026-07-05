import { test, expect } from '@playwright/test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, launchAppNoWorkspace, store } from './electronApp';

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

test('first launch with no configured folder shows the setup gate; choosing a folder opens the app', async () => {
  const userData = tmp('tj-ud-');
  const dataDir = tmp('tj-data-');
  const { app, page } = await launchAppNoWorkspace(userData);

  // No data folder yet → the blocking gate, not the app.
  await expect(page.getByTestId('setup-gate')).toBeVisible();
  await expect(page.getByTestId('setup-gate')).toHaveAttribute('data-status', 'unset');
  await expect(page.getByTestId('ribbon-new')).toHaveCount(0);

  // Selecting a folder (native picker is bypassed by driving the same contract the picker feeds).
  const state = await store.setWorkspaceFolder(page, dataDir);
  expect(state.status).toBe('ready');
  expect(state.dataDir).toBe(dataDir);

  // Reloading boots into the workspace — the gate is gone and the app is usable against the new folder.
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByTestId('setup-gate')).toHaveCount(0);
  await page.getByTestId('ribbon-new').click();
  expect((await store.listEntries(page)).length).toBe(1);

  await app.close();
});

test('a configured folder that no longer exists lands on the missing state, and preparing it lets retry through', async () => {
  const userData = tmp('tj-ud-');
  const gone = join(tmpdir(), `tj-gone-${Date.now()}`); // configured but never created

  writeFileSync(join(userData, 'config.json'), JSON.stringify({ dataDir: gone }), 'utf8');
  const { app, page } = await launchAppNoWorkspace(userData);

  await expect(page.getByTestId('setup-gate')).toBeVisible();
  await expect(page.getByTestId('setup-gate')).toHaveAttribute('data-status', 'missing');
  let state = await store.getWorkspaceState(page);
  expect(state.status).toBe('missing');
  expect(state.dataDir).toBe(gone);

  // Prepare the folder, then a fresh resolve (what "retry" triggers) opens it.
  mkdirSync(gone, { recursive: true });
  state = await store.getWorkspaceState(page);
  expect(state.status).toBe('ready');
  expect(state.dataDir).toBe(gone);

  await app.close();
});

test('the chosen folder persists across restarts (the config pointer, not a default)', async () => {
  const userData = tmp('tj-ud-');
  const dataDir = tmp('tj-data-');

  let launched = await launchAppNoWorkspace(userData);
  await expect(launched.page.getByTestId('setup-gate')).toBeVisible();
  expect((await store.setWorkspaceFolder(launched.page, dataDir)).status).toBe('ready');
  await launched.app.close();

  // Relaunch with the same app-config location → resolves straight to the remembered folder, no gate.
  launched = await launchAppNoWorkspace(userData);
  await expect(launched.page.getByTestId('setup-gate')).toHaveCount(0);
  await expect(launched.page.getByTestId('ribbon-new')).toBeVisible();
  const state = await store.getWorkspaceState(launched.page);
  expect(state.status).toBe('ready');
  expect(state.dataDir).toBe(dataDir);

  await launched.app.close();
});

test('General settings shows the active data folder', async () => {
  const dataDir = tmp('tj-data-');
  const { app, page } = await launchApp(dataDir);

  await page.getByTestId('ribbon-general').click();
  await expect(page.getByTestId('general-settings')).toBeVisible();
  const state = await store.getWorkspaceState(page);
  await expect(page.getByTestId('general-path')).toHaveText(state.dataDir ?? '');

  await app.close();
});
