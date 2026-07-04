import { randomUUID } from 'node:crypto';
import type { Db } from '../db';
import type { Annotation, CreateEntryInput, Entry, EntrySummary, Tag } from '../../shared/domain';
import { projectEntryAnnotations, readAnnotationResult, readAnnotationTags } from './annotationIndex';

interface EntryRow {
  id: string;
  image_hash: string;
  canvas_json: string;
  created_at: number;
  updated_at: number;
}

interface TagRow {
  group: string;
  value: string;
}

interface AnnotationRow {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  links: string;
}

/** Create a new durable Entry and project its annotations into the index. */
export function createEntry(db: Db, input: CreateEntryInput): Entry {
  const id = randomUUID();
  const now = Date.now();
  const write = db.transaction(() => {
    db.prepare(
      'INSERT INTO entries (id, image_hash, canvas_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run(id, input.image?.hash ?? '', input.canvasJson, now, now);
    insertEntryTags(db, id, input.entryTags);
    projectEntryAnnotations(db, id, input.annotations);
  });
  write();
  return requireEntry(db, id);
}

/** Replace an existing Entry's content and re-project its annotation index. */
export function updateEntry(db: Db, id: string, input: CreateEntryInput): Entry {
  const exists = db.prepare('SELECT id FROM entries WHERE id = ?').get(id);
  if (!exists) {
    throw new Error(`entry not found: ${id}`);
  }
  const now = Date.now();
  const write = db.transaction(() => {
    db.prepare('UPDATE entries SET image_hash = ?, canvas_json = ?, updated_at = ? WHERE id = ?').run(
      input.image?.hash ?? '',
      input.canvasJson,
      now,
      id,
    );
    db.prepare('DELETE FROM entry_tags WHERE entry_id = ?').run(id);
    insertEntryTags(db, id, input.entryTags);
    projectEntryAnnotations(db, id, input.annotations);
  });
  write();
  return requireEntry(db, id);
}

export function getEntry(db: Db, id: string): Entry | null {
  const row = db
    .prepare('SELECT id, image_hash, canvas_json, created_at, updated_at FROM entries WHERE id = ?')
    .get(id) as EntryRow | undefined;
  if (!row) return null;

  const entryTags = (
    db.prepare('SELECT "group", value FROM entry_tags WHERE entry_id = ? ORDER BY "group", value').all(id) as TagRow[]
  ).map((tag) => ({ group: tag.group, value: tag.value }));

  const annotationRows = db
    .prepare('SELECT id, x, y, width, height, links FROM annotations WHERE entry_id = ? ORDER BY id')
    .all(id) as AnnotationRow[];

  const annotations = annotationRows.map((annotation) => ({
    id: annotation.id,
    bounds: { x: annotation.x, y: annotation.y, width: annotation.width, height: annotation.height },
    tags: readAnnotationTags(db, annotation.id),
    result: readAnnotationResult(db, annotation.id),
    links: JSON.parse(annotation.links) as string[],
  }));

  return {
    id: row.id,
    image: row.image_hash ? { hash: row.image_hash } : undefined,
    canvasJson: row.canvas_json,
    entryTags,
    annotations,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Update the canvas JSON + rendered thumbnail of an entry and re-project its annotation index (the editor's save path). */
export function updateEntryCanvas(
  db: Db,
  id: string,
  canvasJson: string,
  annotations: Annotation[],
  thumbnail: string,
): Entry {
  const exists = db.prepare('SELECT id FROM entries WHERE id = ?').get(id);
  if (!exists) {
    throw new Error(`entry not found: ${id}`);
  }
  const write = db.transaction(() => {
    db.prepare('UPDATE entries SET canvas_json = ?, thumbnail = ?, updated_at = ? WHERE id = ?').run(
      canvasJson,
      thumbnail,
      Date.now(),
      id,
    );
    projectEntryAnnotations(db, id, annotations);
  });
  write();
  return requireEntry(db, id);
}

/** Resolve which entry an annotation belongs to — used to follow a cross-entry link. */
export function locateAnnotation(db: Db, annotationId: string): { entryId: string } | null {
  const row = db.prepare('SELECT entry_id FROM annotations WHERE id = ?').get(annotationId) as
    | { entry_id: string }
    | undefined;
  return row ? { entryId: row.entry_id } : null;
}

/** Set (or replace) an entry's background image reference — the editor's paste-in path. */
export function setEntryImage(db: Db, id: string, hash: string): Entry {
  const exists = db.prepare('SELECT id FROM entries WHERE id = ?').get(id);
  if (!exists) {
    throw new Error(`entry not found: ${id}`);
  }
  db.prepare('UPDATE entries SET image_hash = ?, updated_at = ? WHERE id = ?').run(hash, Date.now(), id);
  return requireEntry(db, id);
}

/** Delete an entry and (via FK cascade) its annotation / tag / result projections. */
export function deleteEntry(db: Db, id: string): void {
  db.prepare('DELETE FROM entries WHERE id = ?').run(id);
}

function requireEntry(db: Db, id: string): Entry {
  const entry = getEntry(db, id);
  if (!entry) {
    throw new Error(`entry disappeared immediately after write: ${id}`);
  }
  return entry;
}

function insertEntryTags(db: Db, entryId: string, tags: Tag[]): void {
  const insert = db.prepare('INSERT OR IGNORE INTO entry_tags (entry_id, "group", value) VALUES (?, ?, ?)');
  for (const tag of tags) {
    insert.run(entryId, tag.group, tag.value);
  }
}

interface EntrySummaryRow {
  id: string;
  image_hash: string;
  thumbnail: string;
  created_at: number;
}

/** Newest-first entry summaries for the Daily list (id, rendered thumbnail, cover fallback, date). */
export function listEntries(db: Db): EntrySummary[] {
  const rows = db
    .prepare('SELECT id, image_hash, thumbnail, created_at FROM entries ORDER BY created_at DESC, id DESC')
    .all() as EntrySummaryRow[];
  const dateStmt = db.prepare(
    'SELECT value FROM entry_tags WHERE entry_id = ? AND "group" = \'date\' ORDER BY value DESC LIMIT 1',
  );
  return rows.map((row) => {
    const dateRow = dateStmt.get(row.id) as { value: string } | undefined;
    return {
      id: row.id,
      thumbnail: row.thumbnail || undefined,
      imageHash: row.image_hash || undefined,
      createdAt: row.created_at,
      date: dateRow?.value,
    };
  });
}
