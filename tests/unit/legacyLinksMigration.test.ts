import { describe, expect, it } from 'vitest';
import {
  LegacyLinksMigrationError,
  stripLegacyCanvasLinksJson,
} from '../../src/main/legacyLinksMigration';

describe('legacy link retirement', () => {
  it('leaves canvas JSON byte-for-byte unchanged when no legacy field exists', () => {
    const raw = '{ "objects": [{"text":"precious review"}] }';
    expect(stripLegacyCanvasLinksJson(raw, 'Entry')).toEqual({ json: raw, removedFieldCount: 0 });
  });

  it('removes every nested tjLinks field while preserving all other review content', () => {
    const raw = JSON.stringify({
      tjPage: { width: 2900, height: 1600 },
      objects: [
        {
          type: 'TextBoxAnnotation',
          tjId: 'note',
          text: 'keep me',
          tjTags: [{ group: 'setup', value: 'h2' }],
          tjResult: { outcome: 'win' },
          tjLinks: ['irrelevant-target'],
          nested: { stroke: '#f00', tjLinks: null },
        },
      ],
    });

    const stripped = stripLegacyCanvasLinksJson(raw, 'Entry');
    expect(stripped.removedFieldCount).toBe(2);
    expect(JSON.parse(stripped.json)).toEqual({
      tjPage: { width: 2900, height: 1600 },
      objects: [
        {
          type: 'TextBoxAnnotation',
          tjId: 'note',
          text: 'keep me',
          tjTags: [{ group: 'setup', value: 'h2' }],
          tjResult: { outcome: 'win' },
          nested: { stroke: '#f00' },
        },
      ],
    });
  });

  it.each(['not-json', '{"objects":'])('rolls back rather than rewriting malformed canvas JSON: %s', (raw) => {
    expect(() => stripLegacyCanvasLinksJson(raw, 'Entry')).toThrow(LegacyLinksMigrationError);
  });
});