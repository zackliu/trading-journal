import type { InternalLinkAddress, InternalLinkTarget } from './domain';

const INTERNAL_LINK_PREFIX = 'trading-journal://journal/';

function assertNonEmptyId(value: string, field: string): void {
  if (value.length === 0) throw new Error(`${field} must not be empty.`);
}

export function formatInternalLink(address: InternalLinkAddress): string {
  assertNonEmptyId(address.journalId, 'journalId');
  assertNonEmptyId(address.target.id, 'target id');
  return (
    INTERNAL_LINK_PREFIX +
    `${encodeURIComponent(address.journalId)}/${address.target.kind}/${encodeURIComponent(address.target.id)}`
  );
}

export function parseInternalLink(value: string): InternalLinkAddress | null {
  if (!value.startsWith(INTERNAL_LINK_PREFIX)) return null;

  const segments = value.slice(INTERNAL_LINK_PREFIX.length).split('/');
  if (segments.length !== 3) return null;

  const [encodedJournalId, kind, encodedTargetId] = segments;
  if (kind !== 'entry' && kind !== 'annotation') return null;

  let journalId: string;
  let targetId: string;
  try {
    journalId = decodeURIComponent(encodedJournalId);
    targetId = decodeURIComponent(encodedTargetId);
  } catch {
    return null;
  }
  if (journalId.length === 0 || targetId.length === 0) return null;

  const target: InternalLinkTarget = { kind, id: targetId };
  const address: InternalLinkAddress = { journalId, target };
  return formatInternalLink(address) === value ? address : null;
}