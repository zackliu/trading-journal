import type { Db } from '../db';
import type { TagGroup, TagGroupView, TagValue } from '../../shared/domain';
import { countEntriesForTag } from './tagQuery';

// The vocabulary registry (Tag & query-engine boundary). Groups and values are declared here
// independently of usage, so the pivot browse dropdown, the Review/Annotation quick-pick, and
// Settings all read one source of truth. `date` is never stored here — it stays structural.
// Registry writes never touch entry_tags / annotation_tags (the actual usage); reconciling a
// rename/merge with existing usage is the vocabulary-evolution slice, not this one.

interface GroupRow {
  id: string;
  label: string;
  pinned: number;
}

interface ValueRow {
  value: string;
  label: string | null;
}

/** Declare (or relabel / re-pin) a group. `id` is the stable kebab key; new groups append to the end. */
export function defineGroup(db: Db, group: TagGroup): void {
  db.prepare(
    'INSERT INTO tag_groups (id, label, pinned, sort) ' +
      'VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort), -1) + 1 FROM tag_groups)) ' +
      'ON CONFLICT(id) DO UPDATE SET label = excluded.label, pinned = excluded.pinned',
  ).run(group.id, group.label, group.pinned ? 1 : 0);
}

/** Remove a group and (via cascade) its declared values. Does not touch existing tag usage. */
export function deleteGroup(db: Db, id: string): void {
  db.prepare('DELETE FROM tag_groups WHERE id = ?').run(id);
}

/** Declare (or relabel) a value within a group; new values append to the end of that group. */
export function defineValue(db: Db, value: TagValue): void {
  db.prepare(
    'INSERT INTO tag_values (group_id, value, label, sort) ' +
      'VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort), -1) + 1 FROM tag_values WHERE group_id = ?)) ' +
      'ON CONFLICT(group_id, value) DO UPDATE SET label = excluded.label',
  ).run(value.groupId, value.value, value.label ?? null, value.groupId);
}

/** Remove a declared value from a group. Does not touch existing tag usage. */
export function deleteValue(db: Db, groupId: string, value: string): void {
  db.prepare('DELETE FROM tag_values WHERE group_id = ? AND value = ?').run(groupId, value);
}

/** Pin / unpin a group for the ribbon quick-pick. */
export function setGroupPinned(db: Db, id: string, pinned: boolean): void {
  db.prepare('UPDATE tag_groups SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, id);
}

/** Persist a new group order (the full id list, top-to-bottom) from a Settings drag. */
export function reorderGroups(db: Db, ids: string[]): void {
  const update = db.prepare('UPDATE tag_groups SET sort = ? WHERE id = ?');
  const write = db.transaction(() => {
    ids.forEach((id, index) => update.run(index, id));
  });
  write();
}

/** Persist a new value order within a group (the full value list, top-to-bottom) from a Settings drag. */
export function reorderValues(db: Db, groupId: string, values: string[]): void {
  const update = db.prepare('UPDATE tag_values SET sort = ? WHERE group_id = ? AND value = ?');
  const write = db.transaction(() => {
    values.forEach((value, index) => update.run(index, groupId, value));
  });
  write();
}

/** All declared groups with their values and per-value distinct-entry counts, in user-set order. */
export function listGroups(db: Db): TagGroupView[] {
  const groups = db.prepare('SELECT id, label, pinned FROM tag_groups ORDER BY sort, rowid').all() as GroupRow[];
  const valuesStmt = db.prepare('SELECT value, label FROM tag_values WHERE group_id = ? ORDER BY sort, rowid');
  return groups.map((group) => ({
    id: group.id,
    label: group.label,
    pinned: group.pinned !== 0,
    values: (valuesStmt.all(group.id) as ValueRow[]).map((row) => ({
      value: row.value,
      label: row.label ?? undefined,
      count: countEntriesForTag(db, group.id, row.value),
    })),
  }));
}
