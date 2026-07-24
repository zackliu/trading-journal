import { describe, expect, it } from 'vitest';
import {
  CanvasLayersMigrationError,
  assignBaseCanvasLayerJson,
  rewriteCanvasLayerJson,
} from '../../src/main/canvasLayersMigration';

describe('canvas layer JSON transforms', () => {
  it('assigns the base layer without reordering and leaves the structural title outside layers', () => {
    const raw = JSON.stringify({
      version: '6',
      objects: [
        { type: 'Rect', tjId: 'bottom', left: 10 },
        { type: 'TextBoxAnnotation', tjRole: 'title', text: 'Review' },
        { type: 'Image', src: 'tj-image://hash', left: 20 },
        { type: 'Rect', tjId: 'top', left: 30 },
      ],
    });

    const result = assignBaseCanvasLayerJson(raw, 'unit canvas');
    const parsed = JSON.parse(result.json) as {
      objects: Array<{ tjId?: string; tjRole?: string; tjLayerId?: string }>;
    };
    expect(result.assignedCount).toBe(3);
    expect(parsed.objects.map((object) => object.tjId ?? object.tjRole)).toEqual([
      'bottom',
      'title',
      undefined,
      'top',
    ]);
    expect(parsed.objects[0].tjLayerId).toBe('base');
    expect(parsed.objects[1].tjLayerId).toBeUndefined();
    expect(parsed.objects[2].tjLayerId).toBe('base');
    expect(parsed.objects[3].tjLayerId).toBe('base');

    for (const object of parsed.objects) delete object.tjLayerId;
    expect(parsed).toEqual(JSON.parse(raw));
  });

  it('merges a layer by changing only matching ids and preserving array order', () => {
    const raw = JSON.stringify({
      objects: [
        { tjId: 'base', tjLayerId: 'base' },
        { tjId: 'a', tjLayerId: 'middle' },
        { tjId: 'b', tjLayerId: 'middle' },
        { tjId: 'top', tjLayerId: 'top' },
      ],
    });
    const result = rewriteCanvasLayerJson(raw, 'middle', 'base', 'unit canvas');
    const objects = (JSON.parse(result.json) as { objects: Array<{ tjId: string; tjLayerId: string }> }).objects;
    expect(result.objectCount).toBe(2);
    expect(objects.map((object) => object.tjId)).toEqual(['base', 'a', 'b', 'top']);
    expect(objects.map((object) => object.tjLayerId)).toEqual(['base', 'base', 'base', 'top']);
  });

  it('rejects malformed canvas JSON instead of partially transforming it', () => {
    expect(() => assignBaseCanvasLayerJson('{broken', 'broken entry')).toThrow(CanvasLayersMigrationError);
    expect(() => rewriteCanvasLayerJson('{"objects":{}}', 'a', 'b', 'broken entry')).toThrow(
      CanvasLayersMigrationError,
    );
    expect(() => assignBaseCanvasLayerJson('{"objects":[{"tjChrome":true}]}', 'broken entry')).toThrow(
      CanvasLayersMigrationError,
    );
    expect(() =>
      assignBaseCanvasLayerJson('{"objects":[{"tjRole":"title","tjLayerId":"base"}]}', 'broken entry'),
    ).toThrow(CanvasLayersMigrationError);
  });
});
