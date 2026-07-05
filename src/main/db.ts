import Database from 'better-sqlite3';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type Db = Database.Database;

export interface OpenedDb {
  db: Db;
  userVersion: number;
}

/** How many timestamped pre-migration snapshots of a journal to keep in `backups/`. */
const MAX_BACKUPS = 10;

/**
 * Thrown when the journal on disk was written by a NEWER schema than this app understands. Opening it
 * anyway could silently corrupt real review data, so we refuse and surface a clear message instead.
 */
export class JournalTooNewError extends Error {
  constructor(
    readonly journalVersion: number,
    readonly appSchemaVersion: number,
  ) {
    super(
      `This journal was created by a newer version of Trading Journal (data schema v${journalVersion}, ` +
        `this app supports up to v${appSchemaVersion}). Please update the app to open it. Your data has ` +
        `not been changed.`,
    );
    this.name = 'JournalTooNewError';
  }
}

// Ordered migrations. Index i migrates schema version i -> i+1, wrapped in a transaction together with
// the user_version bump. APPEND-ONLY (v0.1.0+ data contract): never edit, reorder, or remove an
// existing migration, and a migration must preserve/transform existing rows — never drop user data.
const MIGRATIONS: Array<(db: Db) => void> = [
  migration001Initial,
  migration002StampLibrary,
  migration003EntryThumbnail,
  migration004TagRegistry,
  migration005TagSort,
  migration006ResultValues,
  migration007SoftDelete,
  migration008SchemaMeta,
];

/**
 * Open (creating if missing) the SQLite database and run pending migrations. Before applying any
 * migration to an EXISTING journal it snapshots the file into `backups/` (so a bad migration can never
 * destroy review data), and it refuses to open a journal newer than this app's schema (downgrade guard).
 */
export function openDatabase(sqlitePath: string): OpenedDb {
  const preexisting = existsSync(sqlitePath);
  const db: Db = new Database(sqlitePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const current = db.pragma('user_version', { simple: true }) as number;
  if (current > MIGRATIONS.length) {
    db.close();
    throw new JournalTooNewError(current, MIGRATIONS.length);
  }
  if (preexisting && current < MIGRATIONS.length) {
    backupBeforeMigration(db, sqlitePath, current);
  }

  runMigrations(db);
  const userVersion = db.pragma('user_version', { simple: true }) as number;
  return { db, userVersion };
}

/** Snapshot the journal file before a migration runs, keeping the most recent MAX_BACKUPS copies. */
function backupBeforeMigration(db: Db, sqlitePath: string, fromVersion: number): void {
  // Flush any WAL frames into the main file so a plain copy is a complete, consistent snapshot.
  db.pragma('wal_checkpoint(TRUNCATE)');
  const dir = join(dirname(sqlitePath), 'backups');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  copyFileSync(sqlitePath, join(dir, `app-v${fromVersion}-${stamp}.sqlite`));

  const snapshots = readdirSync(dir)
    .filter((name) => name.startsWith('app-v') && name.endsWith('.sqlite'))
    .sort();
  for (const old of snapshots.slice(0, Math.max(0, snapshots.length - MAX_BACKUPS))) {
    rmSync(join(dir, old), { force: true });
  }
}

/** Record which app version last opened this journal (provenance for support / diagnostics). */
export function stampAppVersion(db: Db, appVersion: string): void {
  const upsert = db.prepare(
    'INSERT INTO schema_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );
  const write = db.transaction(() => {
    upsert.run('app_version', appVersion);
    upsert.run('updated_at', String(Date.now()));
  });
  write();
}

function runMigrations(db: Db): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let version = current; version < MIGRATIONS.length; version += 1) {
    const migrate = MIGRATIONS[version];
    const apply = db.transaction(() => {
      migrate(db);
      db.pragma(`user_version = ${version + 1}`);
    });
    apply();
  }
}

function migration001Initial(db: Db): void {
  db.exec(`
    CREATE TABLE entries (
      id          TEXT PRIMARY KEY,
      image_hash  TEXT NOT NULL,
      canvas_json TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );

    CREATE TABLE entry_tags (
      entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
      "group"  TEXT NOT NULL,
      value    TEXT NOT NULL,
      PRIMARY KEY (entry_id, "group", value)
    );

    CREATE TABLE annotations (
      id       TEXT PRIMARY KEY,
      entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
      x        REAL NOT NULL,
      y        REAL NOT NULL,
      width    REAL NOT NULL,
      height   REAL NOT NULL,
      links    TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE annotation_tags (
      annotation_id TEXT NOT NULL REFERENCES annotations(id) ON DELETE CASCADE,
      entry_id      TEXT NOT NULL,
      "group"       TEXT NOT NULL,
      value         TEXT NOT NULL,
      PRIMARY KEY (annotation_id, "group", value)
    );

    CREATE TABLE result_dimensions (
      id    TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      type  TEXT NOT NULL CHECK (type IN ('string', 'number'))
    );

    CREATE TABLE annotation_results (
      annotation_id TEXT NOT NULL REFERENCES annotations(id) ON DELETE CASCADE,
      entry_id      TEXT NOT NULL,
      dimension_id  TEXT NOT NULL REFERENCES result_dimensions(id),
      string_value  TEXT,
      number_value  REAL,
      PRIMARY KEY (annotation_id, dimension_id),
      CHECK ((string_value IS NULL) <> (number_value IS NULL))
    );

    CREATE TABLE saved_views (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      query_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX idx_annotations_entry ON annotations(entry_id);
    CREATE INDEX idx_entry_tags_gv ON entry_tags("group", value);
    CREATE INDEX idx_annotation_tags_gv ON annotation_tags("group", value);
    CREATE INDEX idx_annotation_results_dim ON annotation_results(dimension_id);
  `);
}

// The global stamp library: one free-layout canvas document, shared across all reviews and
// stored exactly once (a singleton row). Stamps are drawing objects only — no screenshots.
function migration002StampLibrary(db: Db): void {
  db.exec(`
    CREATE TABLE stamp_library (
      id          INTEGER PRIMARY KEY CHECK (id = 1),
      canvas_json TEXT NOT NULL,
      updated_at  INTEGER NOT NULL
    );
  `);
}

// The list thumbnail is a rendered, scaled-down snapshot of the review page (screenshots +
// annotations), stored as a JPEG data URL and refreshed on every canvas save. It reflects the real
// page, not a frozen cover screenshot.
function migration003EntryThumbnail(db: Db): void {
  db.exec(`ALTER TABLE entries ADD COLUMN thumbnail TEXT NOT NULL DEFAULT '';`);
}

// The vocabulary registry: user-declared classification groups and their values, existing
// independently of whether any review uses them. Feeds the pivot browse dropdown, the
// Review/Annotation quick-pick, and Settings. `date` is NOT stored here — it stays a structural,
// system-maintained entry tag and is never a tagging option. Insertion order (rowid) is the display
// order. Deleting a group cascades its values; deleting a registry row never touches entry_tags /
// annotation_tags (those are the actual usage, reconciled by the vocabulary-evolution slice).
function migration004TagRegistry(db: Db): void {
  db.exec(`
    CREATE TABLE tag_groups (
      id     TEXT PRIMARY KEY,
      label  TEXT NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE tag_values (
      group_id TEXT NOT NULL REFERENCES tag_groups(id) ON DELETE CASCADE,
      value    TEXT NOT NULL,
      label    TEXT,
      PRIMARY KEY (group_id, value)
    );
  `);
}

// User-controllable display order for groups and for the values within a group. The Settings window
// drags to reorder; the ribbon quick-pick renders in this order. New rows append (max+1); reordering
// rewrites the whole scope's sort to 0..n-1.
function migration005TagSort(db: Db): void {
  db.exec(`
    ALTER TABLE tag_groups ADD COLUMN sort INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE tag_values ADD COLUMN sort INTEGER NOT NULL DEFAULT 0;
  `);
}

// Preset values for a result dimension — mirrors tag_values. A string dimension can declare its
// allowed outcomes (e.g. win / loss / breakeven), which the Annotation tab then offers as one-tap
// chips; number dimensions declare none (their value is typed). Deleting a dimension cascades these.
function migration006ResultValues(db: Db): void {
  db.exec(`
    CREATE TABLE result_dimension_values (
      dimension_id TEXT NOT NULL REFERENCES result_dimensions(id) ON DELETE CASCADE,
      value        TEXT NOT NULL,
      label        TEXT,
      sort         INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (dimension_id, value)
    );
  `);
}

// Soft delete: deleting a group / value / result dimension / result value archives it (hidden from the
// quick-pick, pivot, and active Settings) instead of destroying it, so an accidental delete of a
// heavily-used vocabulary entry is recoverable (Restore) and never orphans its recorded usage.
function migration007SoftDelete(db: Db): void {
  db.exec(`
    ALTER TABLE tag_groups ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE tag_values ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE result_dimensions ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE result_dimension_values ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
  `);
}

// Provenance for the v0.1.0+ data-safety posture: a tiny key/value table recording which app version
// last opened this journal (written on every open via stampAppVersion). Purely additive — no user data.
function migration008SchemaMeta(db: Db): void {
  db.exec(`
    CREATE TABLE schema_meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}
