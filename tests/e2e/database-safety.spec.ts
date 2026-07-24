import { _electron as electron, expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function userVersion(path: string): number {
  return readFileSync(path).readUInt32BE(60);
}

async function expectBootFailure(dataDir: string): Promise<void> {
  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, TJ_DATA_DIR: dataDir, TJ_TEST: '1' },
  });
  const child = app.process();
  if (child.exitCode === null) await once(child, 'exit');
}

test('a too-new journal is rejected before any write-capable pragma touches it', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'tj-too-new-'));
  const sqlitePath = join(dataDir, 'app.sqlite');
  copyFileSync(join(process.cwd(), 'tests', 'fixtures', 'journal-v7.sqlite'), sqlitePath);
  const bytes = readFileSync(sqlitePath);
  bytes.writeUInt32BE(999, 60);
  writeFileSync(sqlitePath, bytes);
  const before = sha256(sqlitePath);

  await expectBootFailure(dataDir);

  expect(sha256(sqlitePath)).toBe(before);
  expect(userVersion(sqlitePath)).toBe(999);
  expect(existsSync(`${sqlitePath}-wal`)).toBe(false);
  expect(existsSync(`${sqlitePath}-shm`)).toBe(false);
  expect(existsSync(join(dataDir, 'backups'))).toBe(false);
});

test('a malformed v9 canvas rolls migration 010 back without changing the source database', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'tj-v10-rollback-'));
  const sqlitePath = join(dataDir, 'app.sqlite');
  copyFileSync(join(process.cwd(), 'tests', 'fixtures', 'journal-v9-malformed.sqlite'), sqlitePath);
  const before = sha256(sqlitePath);

  await expectBootFailure(dataDir);

  expect(sha256(sqlitePath)).toBe(before);
  expect(userVersion(sqlitePath)).toBe(9);
  expect(existsSync(`${sqlitePath}-wal`)).toBe(false);
  expect(existsSync(`${sqlitePath}-shm`)).toBe(false);
  const backups = readdirSync(join(dataDir, 'backups')).filter((name) => name.endsWith('.sqlite'));
  expect(backups).toHaveLength(1);
  expect(sha256(join(dataDir, 'backups', backups[0]))).toBe(before);
});

test('a failure late in the v7 migration chain rolls every pending migration back', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'tj-chain-rollback-'));
  const sqlitePath = join(dataDir, 'app.sqlite');
  copyFileSync(join(process.cwd(), 'tests', 'fixtures', 'journal-v7-malformed.sqlite'), sqlitePath);
  const before = sha256(sqlitePath);

  await expectBootFailure(dataDir);

  expect(sha256(sqlitePath)).toBe(before);
  expect(userVersion(sqlitePath)).toBe(7);
  const backups = readdirSync(join(dataDir, 'backups')).filter((name) => name.endsWith('.sqlite'));
  expect(backups).toHaveLength(1);
  expect(sha256(join(dataDir, 'backups', backups[0]))).toBe(before);
});
