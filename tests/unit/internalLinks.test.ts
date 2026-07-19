import { describe, expect, it } from 'vitest';
import { formatInternalLink, parseInternalLink } from '../../src/shared/internalLinks';

describe('internal link addresses', () => {
  it.each([
    ['entry', 'entry/with?reserved%字符🙂'],
    ['annotation', '.'],
    ['annotation', '..'],
  ] as const)('round-trips an arbitrary non-empty %s id', (kind, id) => {
    const address = { journalId: 'journal/主库🙂', target: { kind, id } };
    const formatted = formatInternalLink(address);

    expect(parseInternalLink(formatted)).toEqual(address);
  });

  it.each([
    'https://journal/a/entry/b',
    'trading-journal://other/a/entry/b',
    'trading-journal://journal/a/unknown/b',
    'trading-journal://journal/a/entry/',
    'trading-journal://journal/a/entry/b/extra',
    'trading-journal://journal/a/entry/%ZZ',
    'trading-journal://journal/a/entry/b?query=1',
    'trading-journal://journal/a/entry/b#fragment',
    'trading-journal://journal/a/entry/%62',
  ])('rejects malformed or non-canonical input: %s', (value) => {
    expect(parseInternalLink(value)).toBeNull();
  });

  it('refuses to format empty stable ids', () => {
    expect(() => formatInternalLink({ journalId: '', target: { kind: 'entry', id: 'entry' } })).toThrow();
    expect(() => formatInternalLink({ journalId: 'journal', target: { kind: 'entry', id: '' } })).toThrow();
  });
});