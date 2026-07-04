import { useEffect, useRef, useState } from 'react';
import type { ArchivedVocab, TagGroup, TagGroupView, TagValue } from '../../../shared/domain';
import { ConfirmDialog } from './ConfirmDialog';
import { EditableName } from './EditableName';
import { Icon } from './icons';
import { slugify } from './slug';
import { SortableList, type DragHandle } from './SortableList';

interface Props {
  groups: TagGroupView[];
  archived: ArchivedVocab;
  onDefineGroup: (group: TagGroup) => void;
  onDeleteGroup: (id: string) => void;
  onDefineValue: (value: TagValue) => void;
  onDeleteValue: (groupId: string, value: string) => void;
  onSetPinned: (id: string, pinned: boolean) => void;
  onReorderGroups: (ids: string[]) => void;
  onReorderValues: (groupId: string, values: string[]) => void;
  onRestoreGroup: (id: string) => void;
  onRestoreValue: (groupId: string, value: string) => void;
  onClose: () => void;
}

type PendingDelete =
  | { kind: 'group'; groupId: string; label: string; count: number }
  | { kind: 'value'; groupId: string; value: string; label: string; count: number };

/**
 * The independent Settings window (Home → Settings): declare classification groups and their values,
 * rename their display labels in place (the stable id never changes), pin groups to the ribbon
 * quick-pick, and archive entries. This is the vocabulary registry's editor — groups and values exist
 * here independently of any review using them. Deleting an entry that reviews still use is a
 * recoverable archive (confirmed first, then listed under Archived); `date` is structural and never
 * appears here.
 */
export function SettingsDialog(props: Props): JSX.Element {
  const { groups, archived } = props;
  const [groupName, setGroupName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingDelete | null>(null);
  const closeRef = useRef(props.onClose);
  closeRef.current = props.onClose;

  const requestDeleteGroup = (group: TagGroupView): void => {
    const count = group.values.reduce((n, v) => n + v.count, 0);
    if (count > 0) setPending({ kind: 'group', groupId: group.id, label: group.label, count });
    else props.onDeleteGroup(group.id);
  };
  const requestDeleteValue = (groupId: string, value: string, label: string, count: number): void => {
    if (count > 0) setPending({ kind: 'value', groupId, value, label, count });
    else props.onDeleteValue(groupId, value);
  };
  const confirmDelete = (): void => {
    if (!pending) return;
    if (pending.kind === 'group') props.onDeleteGroup(pending.groupId);
    else props.onDeleteValue(pending.groupId, pending.value);
    setPending(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const addGroup = (): void => {
    const label = groupName.trim();
    const id = slugify(label);
    if (!id) {
      setError('enter a group name');
      return;
    }
    props.onDefineGroup({ id, label, pinned: true });
    setGroupName('');
    setError(null);
  };

  return (
    <div className="modal" data-testid="settings-dialog" onMouseDown={() => props.onClose()}>
      <div className="modal__panel settings" onMouseDown={(e) => e.stopPropagation()}>
        <header className="settings__head">
          <h2>Tag groups &amp; values</h2>
          <button type="button" className="settings__close" aria-label="Close" onClick={props.onClose}>
            <Icon name="back" />
          </button>
        </header>

        <div className="settings__new">
          <input
            className="settings__input"
            placeholder="group name, e.g. Day Structure"
            data-testid="settings-group-name"
            value={groupName}
            onChange={(e) => {
              setGroupName(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addGroup();
            }}
          />
          <button type="button" className="settings__btn" data-testid="settings-add-group" onClick={addGroup}>
            Add group
          </button>
        </div>
        {error ? <div className="settings__error">{error}</div> : null}

        <div className="settings__list">
          {groups.length === 0 ? (
            <p className="settings__empty">No groups yet. Add one above — its values then appear in the ribbon.</p>
          ) : (
            <SortableList
              items={groups}
              getKey={(g) => g.id}
              onReorder={props.onReorderGroups}
              renderItem={(group, handle) => (
                <GroupRow
                  group={group}
                  handle={handle}
                  requestDeleteGroup={requestDeleteGroup}
                  requestDeleteValue={requestDeleteValue}
                  {...props}
                />
              )}
            />
          )}
        </div>

        <ArchivedSection archived={archived} onRestoreGroup={props.onRestoreGroup} onRestoreValue={props.onRestoreValue} />

        {pending ? (
          <ConfirmDialog
            title={pending.kind === 'group' ? 'Archive group?' : 'Archive value?'}
            message={`“${pending.label}” is used by ${pending.count} review${
              pending.count === 1 ? '' : 's'
            }. It will be hidden from the ribbon but kept, and you can restore it from Archived below.`}
            confirmLabel="Archive"
            onConfirm={confirmDelete}
            onCancel={() => setPending(null)}
          />
        ) : null}
      </div>
    </div>
  );
}

function ArchivedSection({
  archived,
  onRestoreGroup,
  onRestoreValue,
}: {
  archived: ArchivedVocab;
  onRestoreGroup: (id: string) => void;
  onRestoreValue: (groupId: string, value: string) => void;
}): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const total = archived.groups.length + archived.values.length;
  if (total === 0) return null;

  return (
    <div className={`archived${open ? ' is-open' : ''}`} data-testid="settings-archived">
      <button type="button" className="archived__toggle" data-testid="settings-archived-toggle" onClick={() => setOpen((v) => !v)}>
        <Icon name={open ? 'view' : 'browse'} />
        Archived ({total})
      </button>
      {open ? (
        <div className="archived__list">
          {archived.groups.map((g) => (
            <div className="archived__row" key={`g:${g.id}`} data-testid={`settings-archived-group-${g.id}`}>
              <span className="archived__kind">group</span>
              <span className="archived__name">{g.label}</span>
              <button
                type="button"
                className="archived__restore"
                data-testid={`settings-restore-group-${g.id}`}
                onClick={() => onRestoreGroup(g.id)}
              >
                Restore
              </button>
            </div>
          ))}
          {archived.values.map((v) => (
            <div className="archived__row" key={`v:${v.groupId}:${v.value}`} data-testid={`settings-archived-value-${v.groupId}-${v.value}`}>
              <span className="archived__kind">{v.groupLabel}</span>
              <span className="archived__name">{v.label ?? v.value}</span>
              <button
                type="button"
                className="archived__restore"
                data-testid={`settings-restore-value-${v.groupId}-${v.value}`}
                onClick={() => onRestoreValue(v.groupId, v.value)}
              >
                Restore
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function GroupRow(
  props: Props & {
    group: TagGroupView;
    handle: DragHandle;
    requestDeleteGroup: (group: TagGroupView) => void;
    requestDeleteValue: (groupId: string, value: string, label: string, count: number) => void;
  },
): JSX.Element {
  const { group, handle } = props;
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);

  const addValue = (): void => {
    const label = value.trim();
    const id = slugify(label);
    if (!id) {
      setError(true);
      return;
    }
    props.onDefineValue({ groupId: group.id, value: id, label });
    setValue('');
    setError(false);
  };

  return (
    <section className="sgroup" data-testid={`settings-group-${group.id}`}>
      <div className="sgroup__head">
        <button
          type="button"
          className="grip"
          aria-label="Drag to reorder group"
          data-testid={`settings-grip-group-${group.id}`}
          {...handle}
        >
          <Icon name="grip" />
        </button>
        <EditableName
          value={group.label}
          testId={`settings-group-name-${group.id}`}
          onSave={(label) => props.onDefineGroup({ id: group.id, label, pinned: group.pinned })}
        />
        <span className="sgroup__id">{group.id}</span>
        <label className="sgroup__pin" title="Show as quick-pick on the Review / Annotation tabs">
          <input
            type="checkbox"
            data-testid={`settings-pin-${group.id}`}
            checked={group.pinned}
            onChange={(e) => props.onSetPinned(group.id, e.target.checked)}
          />
          Pinned
        </label>
        <button
          type="button"
          className="sgroup__del"
          data-testid={`settings-del-group-${group.id}`}
          title="Delete group"
          onClick={() => props.requestDeleteGroup(group)}
        >
          <Icon name="trash" />
        </button>
      </div>
      <div className="sgroup__vals">
        {group.values.length > 0 ? (
          <SortableList
            items={group.values}
            getKey={(v) => v.value}
            onReorder={(order) => props.onReorderValues(group.id, order)}
            renderItem={(v, vhandle) => (
              <div className="svalue" data-testid={`settings-value-${group.id}-${v.value}`}>
                <button type="button" className="grip grip--sm" aria-label="Drag to reorder value" {...vhandle}>
                  <Icon name="grip" />
                </button>
                <EditableName
                  value={v.label ?? v.value}
                  testId={`settings-value-name-${group.id}-${v.value}`}
                  onSave={(label) => props.onDefineValue({ groupId: group.id, value: v.value, label })}
                />
                <span className="svalue__count">{v.count}</span>
                <button
                  type="button"
                  className="svalue__x"
                  aria-label={`delete ${v.value}`}
                  data-testid={`settings-del-value-${group.id}-${v.value}`}
                  onClick={() => props.requestDeleteValue(group.id, v.value, v.label ?? v.value, v.count)}
                >
                  ×
                </button>
              </div>
            )}
          />
        ) : null}
        <input
          className={`sgroup__add${error ? ' is-error' : ''}`}
          placeholder="+ value, e.g. TRD"
          data-testid={`settings-add-value-${group.id}`}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addValue();
          }}
        />
      </div>
    </section>
  );
}
