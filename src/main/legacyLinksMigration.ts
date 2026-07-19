export class LegacyLinksMigrationError extends Error {
  constructor(readonly source: string) {
    super(
      `Trading Journal could not safely remove retired link data because ${source} contains malformed JSON. ` +
        'The journal has not been changed.',
    );
    this.name = 'LegacyLinksMigrationError';
  }
}

function parseLegacyJson(raw: string, source: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new LegacyLinksMigrationError(source);
  }
}

export interface LegacyLinksStripResult {
  json: string;
  removedFieldCount: number;
}

export function stripLegacyCanvasLinksJson(raw: string, source: string): LegacyLinksStripResult {
  const root = parseLegacyJson(raw, source);
  const pending: unknown[] = [root];
  let removedFieldCount = 0;
  while (pending.length > 0) {
    const value = pending.pop();
    if (Array.isArray(value)) {
      for (const child of value) pending.push(child);
      continue;
    }
    if (!value || typeof value !== 'object') continue;
    const record = value as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(record, 'tjLinks')) {
      delete record.tjLinks;
      removedFieldCount += 1;
    }
    for (const child of Object.values(record)) {
      pending.push(child);
    }
  }
  return {
    json: removedFieldCount === 0 ? raw : JSON.stringify(root),
    removedFieldCount,
  };
}