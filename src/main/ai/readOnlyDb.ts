import Database from 'better-sqlite3';
import type { Db } from '../db';

/** Open an existing journal for AI reads without running migrations or any provenance write. */
export function openReadOnlyDatabase(sqlitePath: string): Db {
  const database: Db = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  database.pragma('foreign_keys = ON');
  database.pragma('query_only = ON');
  const queryOnly = database.pragma('query_only', { simple: true }) as number;
  if (queryOnly !== 1) {
    database.close();
    throw new Error('AI read database did not enter query-only mode');
  }
  return database;
}