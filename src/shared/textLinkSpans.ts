import type { InternalLinkTarget, TextEditOperation, TextLinkSpan } from './domain';

export function sameInternalLinkTarget(left: InternalLinkTarget, right: InternalLinkTarget): boolean {
  return left.kind === right.kind && left.id === right.id;
}

export function normalizeTextLinkSpans(spans: TextLinkSpan[], textLength: number): TextLinkSpan[] {
  const sorted = spans
    .map((span) => ({ ...span, target: { ...span.target } }))
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const normalized: TextLinkSpan[] = [];
  for (const span of sorted) {
    if (
      !Number.isInteger(span.start) ||
      !Number.isInteger(span.end) ||
      span.start < 0 ||
      span.end <= span.start ||
      span.end > textLength ||
      span.target.id.length === 0
    ) {
      throw new Error('invalid text-link span');
    }
    const previous = normalized.at(-1);
    if (previous && span.start < previous.end) throw new Error('overlapping text-link spans');
    if (previous && span.start === previous.end && sameInternalLinkTarget(previous.target, span.target)) {
      previous.end = span.end;
    } else {
      normalized.push(span);
    }
  }
  return normalized;
}

function targetAt(spans: TextLinkSpan[], index: number): InternalLinkTarget | null {
  const span = spans.find((candidate) => candidate.start <= index && index < candidate.end);
  return span ? span.target : null;
}

function inheritedTarget(spans: TextLinkSpan[], operation: TextEditOperation): InternalLinkTarget | null {
  if (operation.insertedGraphemes.length === 0) return null;
  if (operation.from === operation.to) {
    const span = spans.find((candidate) => candidate.start < operation.from && operation.from < candidate.end);
    return span?.target ?? null;
  }
  const span = spans.find((candidate) => candidate.start <= operation.from && operation.to <= candidate.end);
  return span?.target ?? null;
}

function marksToSpans(marks: Array<InternalLinkTarget | null>): TextLinkSpan[] {
  const spans: TextLinkSpan[] = [];
  let start = 0;
  while (start < marks.length) {
    const target = marks[start];
    if (!target) {
      start += 1;
      continue;
    }
    let end = start + 1;
    while (end < marks.length && marks[end] && sameInternalLinkTarget(target, marks[end] as InternalLinkTarget)) {
      end += 1;
    }
    spans.push({ start, end, target: { ...target } });
    start = end;
  }
  return spans;
}

export function transformTextLinkSpans(
  spans: TextLinkSpan[],
  textLength: number,
  operation: TextEditOperation,
): TextLinkSpan[] {
  const current = normalizeTextLinkSpans(spans, textLength);
  if (
    !Number.isInteger(operation.from) ||
    !Number.isInteger(operation.to) ||
    operation.from < 0 ||
    operation.to < operation.from ||
    operation.to > textLength
  ) {
    throw new Error('invalid text edit operation');
  }

  const inherited = inheritedTarget(current, operation);
  const marks = Array.from({ length: textLength }, (_, index) => targetAt(current, index));
  marks.splice(
    operation.from,
    operation.to - operation.from,
    ...operation.insertedGraphemes.map(() => (inherited ? { ...inherited } : null)),
  );
  return marksToSpans(marks);
}

export function setTextLinkTarget(
  spans: TextLinkSpan[],
  textLength: number,
  start: number,
  end: number,
  target: InternalLinkTarget,
): TextLinkSpan[] {
  if (start < 0 || end <= start || end > textLength || target.id.length === 0) {
    throw new Error('invalid text-link assignment');
  }
  const marks = Array.from({ length: textLength }, (_, index) => targetAt(spans, index));
  for (let index = start; index < end; index += 1) marks[index] = { ...target };
  return marksToSpans(marks);
}

export function removeTextLinkTarget(
  spans: TextLinkSpan[],
  textLength: number,
  start: number,
  end: number,
): TextLinkSpan[] {
  if (start < 0 || end <= start || end > textLength) throw new Error('invalid text-link removal');
  const marks = Array.from({ length: textLength }, (_, index) => targetAt(spans, index));
  for (let index = start; index < end; index += 1) marks[index] = null;
  return marksToSpans(marks);
}