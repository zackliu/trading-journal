import { randomBytes } from 'node:crypto';
import { safeStorage } from 'electron';
import { readConfig, writeConfig } from '../appConfig';

export function getOrCreateAccessKey(): string {
  const config = readConfig();
  const encrypted = config.aiAccess?.encryptedAccessKey;
  if (encrypted) {
    try {
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
    } catch {
      throw new Error('The stored AI Access key cannot be decrypted. Reset the access key to continue.');
    }
  }
  return replaceAccessKey();
}

export function replaceAccessKey(): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS-protected credential encryption is unavailable; AI Access cannot start safely.');
  }
  const key = randomBytes(32).toString('base64url');
  const encryptedAccessKey = safeStorage.encryptString(key).toString('base64');
  const config = readConfig();
  writeConfig({
    ...config,
    aiAccess: { ...config.aiAccess, encryptedAccessKey },
  });
  return key;
}