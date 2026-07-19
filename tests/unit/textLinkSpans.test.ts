import { describe, expect, it } from 'vitest';
import type { InternalLinkTarget, TextLinkSpan } from '../../src/shared/domain';
import {
  normalizeTextLinkSpans,
  removeTextLinkTarget,
  setTextLinkTarget,
  transformTextLinkSpans,
} from '../../src/shared/textLinkSpans';

const target: InternalLinkTarget = { kind: 'annotation', id: 'target' };
const span = (start: number, end: number): TextLinkSpan => ({ start, end, target });

describe('text-link character marks', () => {
  it('inherits a link only when inserting inside its range', () => {
    expect(transformTextLinkSpans([span(1, 4)], 5, { from: 2, to: 2, insertedGraphemes: ['新'] })).toEqual([
      span(1, 5),
    ]);
    expect(transformTextLinkSpans([span(1, 4)], 5, { from: 1, to: 1, insertedGraphemes: ['新'] })).toEqual([
      span(2, 5),
    ]);
  });

  it('shrinks on partial deletion and disappears after deleting the last linked character', () => {
    expect(transformTextLinkSpans([span(1, 4)], 5, { from: 2, to: 3, insertedGraphemes: [] })).toEqual([
      span(1, 3),
    ]);
    expect(transformTextLinkSpans([span(1, 4)], 5, { from: 1, to: 4, insertedGraphemes: [] })).toEqual([]);
  });

  it('keeps replacement text linked only when replacement stays in one span', () => {
    expect(transformTextLinkSpans([span(1, 5)], 6, { from: 2, to: 4, insertedGraphemes: ['🙂'] })).toEqual([
      span(1, 4),
    ]);
    expect(transformTextLinkSpans([span(1, 3)], 6, { from: 2, to: 5, insertedGraphemes: ['x'] })).toEqual([
      span(1, 2),
    ]);
  });

  it('assigns and removes only the selected range', () => {
    expect(setTextLinkTarget([], 5, 1, 4, target)).toEqual([span(1, 4)]);
    expect(removeTextLinkTarget([span(0, 5)], 5, 1, 4)).toEqual([span(0, 1), span(4, 5)]);
  });

  it('merges adjacent equal targets and rejects overlap', () => {
    expect(normalizeTextLinkSpans([span(2, 4), span(0, 2)], 4)).toEqual([span(0, 4)]);
    expect(() => normalizeTextLinkSpans([span(0, 3), span(2, 4)], 4)).toThrow('overlapping');
  });
});