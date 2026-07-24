import { randomUUID } from 'node:crypto';
import type { CanvasLayer, CanvasLayerDeletionImpact } from '../../shared/domain';
import type { CanvasLayerUsage } from '../../shared/domain';
import { BASE_CANVAS_LAYER_ID } from '../../shared/domain';
import type { Db } from '../db';
import { parseCanvasObjects, rewriteCanvasLayerJson } from '../canvasLayersMigration';

interface LayerRow {
  id: string;
  name: string;
  is_base: number;
}

interface CanvasRow {
  rowid: number;
  id: string;
  canvas_json: string;
}

function toLayer(row: LayerRow): CanvasLayer {
  return { id: row.id, name: row.name, isBase: row.is_base === 1 };
}

export function listCanvasLayers(db: Db): CanvasLayer[] {
  return (db.prepare('SELECT id, name, is_base FROM canvas_layers ORDER BY sort').all() as LayerRow[]).map(toLayer);
}

export function listCanvasLayerUsage(db: Db): CanvasLayerUsage[] {
  const usage = new Map(
    listCanvasLayers(db).map((layer) => [layer.id, { ...layer, entryCount: 0, objectCount: 0, stampCount: 0 }]),
  );
  for (const entry of entryCanvasRows(db)) {
    const usedInEntry = new Set<string>();
    for (const layerId of drawableLayerIds(entry.canvas_json, `Entry ${entry.id}`)) {
      const layer = usage.get(layerId);
      if (!layer) throw new Error(`canvas object references an unknown layer: ${layerId}`);
      layer.objectCount += 1;
      usedInEntry.add(layerId);
    }
    for (const layerId of usedInEntry) usage.get(layerId)!.entryCount += 1;
  }
  const stamp = db.prepare('SELECT canvas_json FROM stamp_library WHERE id = 1').get() as
    | { canvas_json: string }
    | undefined;
  if (stamp) {
    for (const layerId of drawableLayerIds(stamp.canvas_json, 'stamp library')) {
      const layer = usage.get(layerId);
      if (!layer) throw new Error(`stamp object references an unknown layer: ${layerId}`);
      layer.stampCount += 1;
    }
  }
  return [...usage.values()];
}

export function assertCanvasLayerReferences(db: Db, canvasJson: string): void {
  const { objects } = parseCanvasObjects(canvasJson, 'canvas document');
  if (!objects) return;
  const validIds = new Set(listCanvasLayers(db).map((layer) => layer.id));
  for (const value of objects) {
    const object = value as Record<string, unknown>;
    if (object.tjRole === 'title') continue;
    const layerId = object.tjLayerId;
    if (typeof layerId !== 'string' || !validIds.has(layerId)) {
      throw new Error(`canvas object references an unknown layer: ${String(layerId)}`);
    }
  }
}

export function createCanvasLayer(db: Db, name: string): CanvasLayer {
  const id = randomUUID();
  const sort = (db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 AS next_sort FROM canvas_layers').get() as {
    next_sort: number;
  }).next_sort;
  db.prepare('INSERT INTO canvas_layers (id, name, sort, is_base) VALUES (?, ?, ?, 0)').run(id, name, sort);
  return requireCanvasLayer(db, id);
}

export function renameCanvasLayer(db: Db, id: string, name: string): CanvasLayer {
  const result = db.prepare('UPDATE canvas_layers SET name = ? WHERE id = ?').run(name, id);
  if (result.changes === 0) throw new Error(`canvas layer not found: ${id}`);
  return requireCanvasLayer(db, id);
}

/** Reorder empty layers while preserving the base and every used layer's relative order. */
export function reorderCanvasLayers(db: Db, ids: string[]): CanvasLayer[] {
  const layers = listCanvasLayerUsage(db);
  const currentIds = layers.map((layer) => layer.id);
  if (ids.length !== currentIds.length || new Set(ids).size !== ids.length || currentIds.some((id) => !ids.includes(id))) {
    throw new Error('canvas layer order must contain every layer exactly once');
  }
  if (ids[0] !== BASE_CANVAS_LAYER_ID) throw new Error('the base canvas layer must remain at the bottom');

  const used = new Set(
    layers
      .filter((layer) => layer.isBase || layer.objectCount > 0 || layer.stampCount > 0)
      .map((layer) => layer.id),
  );
  const currentUsedOrder = currentIds.filter((id) => used.has(id));
  const nextUsedOrder = ids.filter((id) => used.has(id));
  if (nextUsedOrder.some((id, index) => id !== currentUsedOrder[index])) {
    throw new Error('a canvas layer in use cannot be moved');
  }

  const write = db.transaction(() => {
    db.prepare('UPDATE canvas_layers SET sort = -sort - 1').run();
    const update = db.prepare('UPDATE canvas_layers SET sort = ? WHERE id = ?');
    ids.forEach((id, index) => update.run(index, id));
  });
  write();
  return listCanvasLayers(db);
}

export function inspectCanvasLayerDeletion(db: Db, id: string): CanvasLayerDeletionImpact {
  const layers = listCanvasLayers(db);
  const index = layers.findIndex((layer) => layer.id === id);
  if (index < 0) throw new Error(`canvas layer not found: ${id}`);
  const layer = layers[index];
  if (layer.isBase || id === BASE_CANVAS_LAYER_ID || index === 0) throw new Error('the base canvas layer cannot be deleted');
  const mergeInto = layers[index - 1];

  let entryCount = 0;
  let objectCount = 0;
  for (const entry of entryCanvasRows(db)) {
    const rewritten = rewriteCanvasLayerJson(entry.canvas_json, id, mergeInto.id, `Entry ${entry.id}`);
    if (rewritten.objectCount > 0) entryCount += 1;
    objectCount += rewritten.objectCount;
  }
  const stamp = db.prepare('SELECT canvas_json FROM stamp_library WHERE id = 1').get() as
    | { canvas_json: string }
    | undefined;
  const stampCount = stamp
    ? rewriteCanvasLayerJson(stamp.canvas_json, id, mergeInto.id, 'stamp library').objectCount
    : 0;
  return { layer, mergeInto, entryCount, objectCount, stampCount };
}

export function deleteCanvasLayerAndMerge(db: Db, id: string): CanvasLayerDeletionImpact {
  const merge = db.transaction(() => {
    const impact = inspectCanvasLayerDeletion(db, id);
    const updateEntry = db.prepare('UPDATE entries SET canvas_json = ?, updated_at = ? WHERE id = ?');
    const now = Date.now();
    for (const entry of entryCanvasRows(db)) {
      const rewritten = rewriteCanvasLayerJson(entry.canvas_json, id, impact.mergeInto.id, `Entry ${entry.id}`);
      if (rewritten.changed) updateEntry.run(rewritten.json, now, entry.id);
    }
    const stamp = db.prepare('SELECT canvas_json FROM stamp_library WHERE id = 1').get() as
      | { canvas_json: string }
      | undefined;
    if (stamp) {
      const rewritten = rewriteCanvasLayerJson(stamp.canvas_json, id, impact.mergeInto.id, 'stamp library');
      if (rewritten.changed) {
        db.prepare('UPDATE stamp_library SET canvas_json = ?, updated_at = ? WHERE id = 1').run(rewritten.json, now);
      }
    }
    db.prepare('DELETE FROM canvas_layers WHERE id = ?').run(id);
    return impact;
  });
  return merge();
}

function requireCanvasLayer(db: Db, id: string): CanvasLayer {
  const row = db.prepare('SELECT id, name, is_base FROM canvas_layers WHERE id = ?').get(id) as LayerRow | undefined;
  if (!row) throw new Error(`canvas layer not found: ${id}`);
  return toLayer(row);
}

function* entryCanvasRows(db: Db): Generator<CanvasRow> {
  const read = db.prepare('SELECT rowid, id, canvas_json FROM entries WHERE rowid > ? ORDER BY rowid LIMIT 100');
  let cursor = 0;
  while (true) {
    const rows = read.all(cursor) as CanvasRow[];
    if (rows.length === 0) return;
    yield* rows;
    cursor = rows[rows.length - 1].rowid;
  }
}

function drawableLayerIds(raw: string, source: string): string[] {
  const { objects } = parseCanvasObjects(raw, source);
  if (!objects) return [];
  const ids: string[] = [];
  for (const value of objects) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${source} contains malformed canvas JSON`);
    const object = value as Record<string, unknown>;
    if (object.tjRole === 'title') continue;
    if (typeof object.tjLayerId !== 'string') throw new Error(`${source} contains a drawable without a canvas layer`);
    ids.push(object.tjLayerId);
  }
  return ids;
}
