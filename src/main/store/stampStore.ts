import type { Db } from '../db';

// Stamp store — the durable boundary for the global stamp library. It is a single
// free-layout canvas document (Fabric JSON of drawing stamps), stored exactly once as
// a singleton row and shared across every review. It is independent of any Entry: dropping
// a stamp onto a review copies it into that Entry's canvas, it never links back here.

interface StampRow {
  canvas_json: string;
}

/** Read the global stamp library document (an empty canvas doc if none saved yet). */
export function getStampLibrary(db: Db): { canvasJson: string } {
  const row = db.prepare('SELECT canvas_json FROM stamp_library WHERE id = 1').get() as StampRow | undefined;
  return { canvasJson: row?.canvas_json ?? '{}' };
}

/** Persist the global stamp library document (upsert the singleton row). */
export function saveStampLibrary(db: Db, canvasJson: string): void {
  db.prepare(
    'INSERT INTO stamp_library (id, canvas_json, updated_at) VALUES (1, ?, ?) ' +
      'ON CONFLICT(id) DO UPDATE SET canvas_json = excluded.canvas_json, updated_at = excluded.updated_at',
  ).run(canvasJson, Date.now());
}
