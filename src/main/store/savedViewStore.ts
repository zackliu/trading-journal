import { randomUUID } from 'node:crypto';
import type { Db } from '../db';
import type { SavedView } from '../../shared/domain';

// A SavedView is a named, re-runnable ViewQuery — a "section" is a live query, never a folder that
// holds copies. Only the query string is persisted (in the pre-existing saved_views table); the
// matching entries are recomputed on every run, so a new matching review appears automatically.

interface SavedViewRow {
  id: string;
  name: string;
  query_json: string;
  created_at: number;
}

/** Persist a ViewQuery (already serialized to JSON) under a name; returns the created SavedView. */
export function createSavedView(db: Db, name: string, queryJson: string): SavedView {
  const id = randomUUID();
  const createdAt = Date.now();
  db.prepare('INSERT INTO saved_views (id, name, query_json, created_at) VALUES (?, ?, ?, ?)').run(
    id,
    name,
    queryJson,
    createdAt,
  );
  return { id, name, queryJson, createdAt };
}

/** All saved views, newest-first. */
export function listSavedViews(db: Db): SavedView[] {
  const rows = db
    .prepare('SELECT id, name, query_json, created_at FROM saved_views ORDER BY created_at DESC, id DESC')
    .all() as SavedViewRow[];
  return rows.map(toSavedView);
}

export function getSavedView(db: Db, id: string): SavedView | null {
  const row = db.prepare('SELECT id, name, query_json, created_at FROM saved_views WHERE id = ?').get(id) as
    | SavedViewRow
    | undefined;
  return row ? toSavedView(row) : null;
}

/** Delete a saved view. Removing the query never touches any review (it held no artifacts). */
export function deleteSavedView(db: Db, id: string): void {
  db.prepare('DELETE FROM saved_views WHERE id = ?').run(id);
}

function toSavedView(row: SavedViewRow): SavedView {
  return { id: row.id, name: row.name, queryJson: row.query_json, createdAt: row.created_at };
}
