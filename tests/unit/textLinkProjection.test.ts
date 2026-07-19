import { describe, expect, it } from 'vitest';
import { extractTextLinkProjection } from '../../src/main/store/textLinks';

describe('text-link canvas projection', () => {
  it('extracts title and annotation links without copying display text into each span', () => {
    const canvas = JSON.stringify({
      objects: [
        {
          type: 'TextBoxAnnotation',
          tjRole: 'title',
          text: '复盘标题',
          tjTextLinks: [{ start: 0, end: 2, target: { kind: 'entry', id: 'entry-2' } }],
        },
        {
          type: 'TextBoxAnnotation',
          tjId: 'annotation-1',
          text: 'A🙂B',
          tjTextLinks: [{ start: 1, end: 2, target: { kind: 'annotation', id: 'annotation-2' } }],
        },
      ],
    });

    expect(extractTextLinkProjection(canvas, 'entry-1', new Set(['annotation-1']))).toEqual([
      {
        source: { kind: 'annotation', annotationId: 'annotation-1' },
        text: 'A🙂B',
        textLinks: [{ start: 1, end: 2, target: { kind: 'annotation', id: 'annotation-2' } }],
      },
      {
        source: { kind: 'entry-title' },
        text: '复盘标题',
        textLinks: [{ start: 0, end: 2, target: { kind: 'entry', id: 'entry-2' } }],
      },
    ]);
  });

  it('rejects an unknown source and invalid ranges', () => {
    const unknownSource = JSON.stringify({
      type: 'TextBoxAnnotation',
      tjId: 'other',
      text: 'text',
      tjTextLinks: [{ start: 0, end: 1, target: { kind: 'entry', id: 'entry-2' } }],
    });
    expect(() => extractTextLinkProjection(unknownSource, 'entry-1', new Set())).toThrow('not in this Entry');

    const invalidRange = JSON.stringify({
      type: 'TextBoxAnnotation',
      tjRole: 'title',
      text: 'x',
      tjTextLinks: [{ start: 0, end: 2, target: { kind: 'entry', id: 'entry-2' } }],
    });
    expect(() => extractTextLinkProjection(invalidRange, 'entry-1', new Set())).toThrow('invalid text-link span');
  });
});