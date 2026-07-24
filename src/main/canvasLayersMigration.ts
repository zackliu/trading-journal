import { BASE_CANVAS_LAYER_ID } from '../shared/domain';

export class CanvasLayersMigrationError extends Error {
  constructor(readonly source: string) {
    super(`Trading Journal could not safely add canvas layers because ${source} contains malformed canvas JSON.`);
    this.name = 'CanvasLayersMigrationError';
  }
}

export interface AssignBaseCanvasLayerResult {
  json: string;
  changed: boolean;
  assignedCount: number;
}

export interface RewriteCanvasLayerResult {
  json: string;
  changed: boolean;
  objectCount: number;
}

/** Assign every top-level drawable to the base layer without changing object order. */
export function assignBaseCanvasLayerJson(raw: string, source: string): AssignBaseCanvasLayerResult {
  const { root, objects } = parseCanvasObjects(raw, source);
  if (objects === undefined) return { json: raw, changed: false, assignedCount: 0 };

  let assignedCount = 0;
  for (const value of objects) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new CanvasLayersMigrationError(source);
    }
    const object = value as Record<string, unknown>;
    assertDrawableOrStructuralTitle(object, source);
    if (object.tjRole === 'title') continue;
    object.tjLayerId = BASE_CANVAS_LAYER_ID;
    assignedCount += 1;
  }

  return {
    json: assignedCount > 0 ? JSON.stringify(root) : raw,
    changed: assignedCount > 0,
    assignedCount,
  };
}

/** Reassign matching drawable objects without changing array position or any other property. */
export function rewriteCanvasLayerJson(
  raw: string,
  fromLayerId: string,
  toLayerId: string,
  source: string,
): RewriteCanvasLayerResult {
  const { root, objects } = parseCanvasObjects(raw, source);
  if (objects === undefined) return { json: raw, changed: false, objectCount: 0 };

  let objectCount = 0;
  for (const value of objects) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CanvasLayersMigrationError(source);
    const object = value as Record<string, unknown>;
    assertDrawableOrStructuralTitle(object, source);
    if (object.tjRole === 'title') continue;
    if (object.tjLayerId === fromLayerId) {
      object.tjLayerId = toLayerId;
      objectCount += 1;
    }
  }
  return {
    json: objectCount > 0 ? JSON.stringify(root) : raw,
    changed: objectCount > 0,
    objectCount,
  };
}

export function parseCanvasObjects(
  raw: string,
  source: string,
): { root: Record<string, unknown>; objects: unknown[] | undefined } {
  let root: unknown;
  try {
    root = JSON.parse(raw) as unknown;
  } catch {
    throw new CanvasLayersMigrationError(source);
  }
  if (!root || typeof root !== 'object' || Array.isArray(root)) throw new CanvasLayersMigrationError(source);
  const record = root as Record<string, unknown>;
  const objects = record.objects;
  if (objects !== undefined && !Array.isArray(objects)) throw new CanvasLayersMigrationError(source);
  return { root: record, objects };
}

function assertDrawableOrStructuralTitle(object: Record<string, unknown>, source: string): void {
  if (object.tjChrome === true) throw new CanvasLayersMigrationError(source);
  if (object.tjRole === 'title' && object.tjLayerId !== undefined) throw new CanvasLayersMigrationError(source);
}