import { randomUUID } from 'node:crypto';
import type { Db } from '../db';
import type {
  AiPage,
  AiReadContext,
  JournalReadRequest,
  JournalReadResponse,
} from '../../shared/aiAccess';
import { openReadOnlyDatabase } from './readOnlyDb';
import { AiReadRepository } from './readRepository';
import { journalReadRequestSchema } from './validation';
import { VisualEvidenceService } from './visualEvidenceService';

interface CursorSnapshot {
  accessEpoch: string;
  journalInstanceId: string;
  sessionId: string;
  snapshotAt: string;
  expiresAt: number;
  items: unknown[];
  offset: number;
  limit: number;
}

const CURSOR_TTL_MS = 10 * 60 * 1000;
const MAX_CURSOR_SNAPSHOTS = 32;
const MAX_PAGE_WINDOW = 1_000;

export class JournalReadService {
  private readonly database: Db;
  private readonly repository: AiReadRepository;
  private readonly visualEvidence: VisualEvidenceService;
  private readonly cursors = new Map<string, CursorSnapshot>();

  constructor(
    sqlitePath: string,
    imagesDir: string,
    appVersion: string,
    private readonly journalInstanceId: string,
    private readonly accessEpoch: string,
  ) {
    this.database = openReadOnlyDatabase(sqlitePath);
    this.repository = new AiReadRepository(this.database, journalInstanceId, appVersion);
    this.visualEvidence = new VisualEvidenceService(this.database, this.repository, imagesDir, journalInstanceId);
  }

  async execute(context: AiReadContext, rawRequest: unknown): Promise<JournalReadResponse> {
    this.validateContext(context);
    const request = journalReadRequestSchema.parse(rawRequest) as JournalReadRequest;
    switch (request.op) {
      case 'overview':
        return { op: request.op, value: this.repository.overview() };
      case 'list-vocabulary':
        return {
          op: request.op,
          value: this.page(context, request.input, () => this.repository.listVocabulary(request.input)),
        };
      case 'search-entries':
        return {
          op: request.op,
          value: this.page(context, request.input, () => this.repository.searchEntries(request.input)),
        };
      case 'search-samples':
        return {
          op: request.op,
          value: this.page(context, request.input, () => this.repository.searchSamples(request.input)),
        };
      case 'prepare-sample-study':
        return { op: request.op, value: this.repository.prepareSampleStudy(request.input) };
      case 'entry-context':
        return {
          op: request.op,
          value: this.repository.entryContext(request.input.entryId, request.input.expectedUpdatedAt),
        };
      case 'linked-context':
        return { op: request.op, value: this.repository.linkedContext(request.input) };
      case 'visual-evidence':
        return { op: request.op, value: await this.visualEvidence.create(request.input, context.sessionId) };
      case 'visual-evidence-batch':
        return {
          op: request.op,
          value: {
            manifests: await Promise.all(
              request.input.requests.map((item) => this.visualEvidence.create(item, context.sessionId)),
            ),
          },
        };
      case 'create-visual-artifacts':
        return { op: request.op, value: await this.visualEvidence.createArtifacts(request.input, context.sessionId) };
      case 'advance-progressive-reveal':
        return { op: request.op, value: await this.visualEvidence.advanceReveal(request.input, context.sessionId) };
      case 'read-visual-artifact-chunk':
        return { op: request.op, value: this.visualEvidence.readArtifactChunk(request.input, context.sessionId) };
      case 'read-resource':
        return { op: request.op, value: this.visualEvidence.read(request.input.uri, context.sessionId) };
      case 'read-resources':
        return {
          op: request.op,
          value: {
            items: request.input.uris.map((uri) => this.visualEvidence.read(uri, context.sessionId)),
          },
        };
    }
  }

  assertQueryOnly(): void {
    try {
      this.database.exec('CREATE TABLE __ai_write_probe (id INTEGER)');
    } catch {
      return;
    }
    throw new Error('AI read database accepted a write');
  }

  close(): void {
    this.cursors.clear();
    this.visualEvidence.clear();
    this.database.close();
  }

  closeSession(sessionId: string): void {
    for (const [cursor, snapshot] of this.cursors) {
      if (snapshot.sessionId === sessionId) this.cursors.delete(cursor);
    }
    this.visualEvidence.clearSession(sessionId);
  }

  private page<T>(
    context: AiReadContext,
    input: { cursor?: string; limit?: number },
    load: () => T[],
  ): AiPage<T> {
    this.pruneCursors();
    if (input.cursor) return this.continuePage<T>(context, input.cursor);
    const loaded = load();
    const truncated = loaded.length > MAX_PAGE_WINDOW;
    const items = loaded.slice(0, MAX_PAGE_WINDOW);
    const limit = input.limit ?? 20;
    const snapshotAt = new Date().toISOString();
    const pageItems = items.slice(0, limit);
    const truncation = truncated
      ? {
          truncated: true as const,
          narrowQueryHint: 'More than 1000 rows matched. Narrow the query by date, tag, result, or SavedView.',
        }
      : {};
    if (items.length <= limit) return { items: pageItems, snapshotAt, ...truncation };
    const cursor = this.storeCursor(context, snapshotAt, items, limit, limit);
    return { items: pageItems, nextCursor: cursor, snapshotAt, ...truncation };
  }

  private continuePage<T>(context: AiReadContext, cursor: string): AiPage<T> {
    const snapshot = this.cursors.get(cursor);
    this.cursors.delete(cursor);
    if (!snapshot || snapshot.expiresAt <= Date.now()) throw new Error('cursor expired');
    if (
      snapshot.accessEpoch !== context.accessEpoch ||
      snapshot.journalInstanceId !== context.journalInstanceId ||
      snapshot.sessionId !== context.sessionId
    ) {
      throw new Error('cursor does not belong to this session');
    }
    const items = snapshot.items.slice(snapshot.offset, snapshot.offset + snapshot.limit) as T[];
    const nextOffset = snapshot.offset + snapshot.limit;
    if (nextOffset >= snapshot.items.length) return { items, snapshotAt: snapshot.snapshotAt };
    const nextCursor = this.storeCursor(
      context,
      snapshot.snapshotAt,
      snapshot.items,
      nextOffset,
      snapshot.limit,
    );
    return { items, nextCursor, snapshotAt: snapshot.snapshotAt };
  }

  private storeCursor(
    context: AiReadContext,
    snapshotAt: string,
    items: unknown[],
    offset: number,
    limit: number,
  ): string {
    while (this.cursors.size >= MAX_CURSOR_SNAPSHOTS) {
      const oldest = this.cursors.keys().next().value as string | undefined;
      if (!oldest) break;
      this.cursors.delete(oldest);
    }
    const cursor = randomUUID();
    this.cursors.set(cursor, {
      accessEpoch: context.accessEpoch,
      journalInstanceId: context.journalInstanceId,
      sessionId: context.sessionId,
      snapshotAt,
      expiresAt: Date.now() + CURSOR_TTL_MS,
      items,
      offset,
      limit,
    });
    return cursor;
  }

  private validateContext(context: AiReadContext): void {
    if (context.accessEpoch !== this.accessEpoch) throw new Error('AI access epoch expired');
    if (context.journalInstanceId !== this.journalInstanceId) throw new Error('journal instance changed');
    if (!context.sessionId) throw new Error('missing AI session id');
  }

  private pruneCursors(): void {
    const now = Date.now();
    for (const [cursor, snapshot] of this.cursors) if (snapshot.expiresAt <= now) this.cursors.delete(cursor);
  }
}