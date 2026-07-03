import Database from 'better-sqlite3';

export type Db = Database.Database;

export interface OpenedDb {
  db: Db;
  userVersion: number;
}

// Ordered migrations. Index i migrates schema version i -> i+1, wrapped in a
// transaction together with the user_version bump. Slice 1 introduces the schema.
const MIGRATIONS: Array<(db: Db) => void> = [migration001Initial];

/** Open (creating if missing) the SQLite database and run pending migrations. */
export function openDatabase(sqlitePath: string): OpenedDb {
  const db: Db = new Database(sqlitePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  const userVersion = db.pragma('user_version', { simple: true }) as number;
  return { db, userVersion };
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
