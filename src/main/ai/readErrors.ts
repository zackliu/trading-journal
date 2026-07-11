import { ZodError } from 'zod';
import type { AiReadError } from '../../shared/aiAccess';

export function toAiReadError(error: unknown): AiReadError {
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    const field = issue?.path.join('.') || undefined;
    const invalidPopulation = issue?.message.includes('explicit annotation or result population');
    const limitExceeded = issue?.message.includes('at most') || issue?.message.includes('Too big');
    return {
      code: invalidPopulation ? 'INVALID_SAMPLE_POPULATION' : limitExceeded ? 'LIMIT_EXCEEDED' : 'INVALID_REQUEST',
      message: invalidPopulation ? 'Sample study population is not explicit.' : 'Request validation failed.',
      hint: invalidPopulation
        ? 'Put at least one classification predicate in query.annotation or one predicate in query.results. Use list_vocabulary to resolve stable IDs.'
        : limitExceeded
          ? 'Split the request into smaller sample or visual batches. prepare_sample_study already returns valid visualBatches.'
        : `${field ? `Fix field ${field}. ` : ''}${issue?.message ?? 'Check the tool input schema and stable IDs from list_vocabulary.'}`,
      field,
      retryable: false,
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  const match = (pattern: RegExp): RegExpMatchArray | null => message.match(pattern);
  let found: RegExpMatchArray | null;
  if ((found = match(/^(entry|annotation|saved view|result dimension) not found: (.+)$/i))) {
    return {
      code: 'NOT_FOUND',
      message,
      hint:
        found[1].toLowerCase() === 'result dimension'
          ? 'Call list_vocabulary with kind="results" and use the returned stable dimension id.'
          : 'Call search_entries, search_samples, or list_vocabulary again and use an id from the current journal snapshot.',
      retryable: false,
    };
  }
  if (message === 'cursor expired') {
    return {
      code: 'CURSOR_EXPIRED',
      message: 'The pagination cursor expired.',
      hint: 'Restart the original list/search call without a cursor; narrow the query if the result set is large.',
      retryable: true,
    };
  }
  if (message.includes('does not belong to this session') || message.includes('journal instance changed')) {
    return {
      code: 'SESSION_MISMATCH',
      message: 'The cursor or evidence belongs to another MCP session or journal instance.',
      hint: 'Repeat the creating search or visual-evidence call in this active session.',
      retryable: true,
    };
  }
  if (message.includes('revision expired') || message.includes('Entry changed')) {
    return {
      code: 'REVISION_EXPIRED',
      message: 'The Entry changed after this context or evidence link was created.',
      hint: 'Call get_entry_context or get_visual_evidence again to obtain the current revision.',
      retryable: true,
    };
  }
  if (message.includes('visual evidence bundle expired') || message.includes('visual evidence resource not found')) {
    return {
      code: 'EVIDENCE_EXPIRED',
      message: 'The visual evidence bundle expired or was evicted.',
      hint: 'Call get_visual_evidence or get_visual_evidence_batch again for the same Entry and annotation ids.',
      retryable: true,
    };
  }
  if (
    message.includes('visual artifact plan expired') ||
    message.includes('bar alignment probe expired') ||
    message.includes('visual artifact resource not found')
  ) {
    return {
      code: 'EVIDENCE_EXPIRED',
      message: 'The visual artifact plan or calibration probe expired or was evicted.',
      hint: 'Call get_visual_evidence again, then recreate the artifact plan and probe in this session.',
      retryable: true,
    };
  }
  if (
    message.includes('screenshot instance does not belong') ||
    message.includes('annotation was not selected') ||
    message.includes('visual artifact item not found or not yet revealed') ||
    message.includes('progressive reveal not found')
  ) {
    return {
      code: 'NOT_FOUND',
      message: 'The requested screenshot, annotation, artifact item, or reveal frame is not available in this plan.',
      hint: 'Use an S-id/item id returned by the current bundle or plan. Advance the reveal before requesting a future frame.',
      retryable: false,
    };
  }
  if (
    message.includes('plan hash does not match') ||
    message.includes('proposal hash does not match') ||
    message.includes('ROI') ||
    message.includes('alignment') ||
    message.includes('bar reveal') ||
    message.includes('progressive reveal') ||
    message.includes('chunk offset') ||
    message.includes('source context') ||
    message.includes('source transform') ||
    message.includes('source window')
  ) {
    return {
      code: 'INVALID_REQUEST',
      message,
      hint: 'Use the current bundle/plan manifest and its source-pixel bounds, then retry with matching ids, hashes, and integer ROI values.',
      retryable: false,
    };
  }
  if (message.includes('too large') || message.includes('exceeds') || message.includes('at most')) {
    return {
      code: 'LIMIT_EXCEEDED',
      message,
      hint: 'Split the request into smaller date ranges, sample sets, Entry batches, or annotation batches.',
      retryable: false,
    };
  }
  return {
    code: 'READ_FAILED',
    message: 'The journal read could not be completed.',
    hint: 'Check the request IDs with list_vocabulary/search tools, then retry. If it persists, inspect Recent activity in AI Settings.',
    retryable: true,
  };
}