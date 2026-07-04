/**
 * Turn free-typed vocabulary text into a stable tag id: lowercased, whitespace/punctuation collapsed
 * to hyphens, unicode letters/digits kept. The user types what they think ("TRD", "Trading Range Day",
 * "上升日"); this derives the stable `group:value` id while the typed text is kept as the display label.
 * Returns '' when the text has no letters/digits (the caller rejects that).
 */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/gu, '-')
    .replace(/[^\p{L}\p{N}-]+/gu, '')
    .replace(/-+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}
