import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, store } from './electronApp';

// A tiny valid PNG (1x1). Ingest hashes the exact bytes, so we can predict the hash.
const PNG_A =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function tempDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'tj-slice2-'));
}

function sha256(base64: string): string {
  return createHash('sha256').update(Buffer.from(base64, 'base64')).digest('hex');
}

/** Dispatch a real `paste` ClipboardEvent carrying an image file (the Ctrl+V path). */
async function pasteImage(page: Page, base64Png: string): Promise<void> {
  await page.evaluate((b64) => {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const file = new File([bytes], 'screenshot.png', { type: 'image/png' });
    const data = new DataTransfer();
    data.items.add(file);
    const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
    window.dispatchEvent(event);
  }, base64Png);
}

test('pasting a screenshot creates an entry with a hash-referenced image, shown in the daily list', async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);
  const hash = sha256(PNG_A);

  await pasteImage(page, PNG_A);

  // The entry appears in the rendered Daily list with a tj-image thumbnail.
  const items = page.getByTestId('entry-item');
  await expect(items).toHaveCount(1);
  await expect(items.first().locator('img')).toHaveAttribute('src', `tj-image://${hash}`);

  // Store reflects it: image is a hash reference (not base64).
  const list = await store.listEntries(page);
  expect(list).toHaveLength(1);
  expect(list[0]?.imageHash).toBe(hash);

  // The image bytes were written once to images/<hash>.
  expect(existsSync(join(dataDir, 'images', hash))).toBe(true);

  await app.close();
});

test('importing the same image twice stores the bytes once', async () => {
  const dataDir = tempDataDir();
  const { app, page } = await launchApp(dataDir);

  const first = await store.ingestImage(page, PNG_A);
  const second = await store.ingestImage(page, PNG_A);
  await app.close();

  // Two distinct entries, both referencing the same content hash.
  expect(first.id).not.toBe(second.id);
  expect(first.image?.hash).toBe(second.image?.hash);

  // Only one file exists under images/.
  const files = readdirSync(join(dataDir, 'images'));
  expect(files).toEqual([first.image?.hash]);
});
