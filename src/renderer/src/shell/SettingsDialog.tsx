import { useEffect, useRef, useState } from 'react';
import type { TagGroup, TagGroupView, TagValue } from '../../../shared/domain';
import { Icon } from './icons';
import { slugify } from './slug';
import { SortableList, type DragHandle } from './SortableList';

interface Props {
  groups: TagGroupView[];
  onDefineGroup: (group: TagGroup) => void;
  onDeleteGroup: (id: string) => void;
  onDefineValue: (value: TagValue) => void;
  onDeleteValue: (groupId: string, value: string) => void;
  onSetPinned: (id: string, pinned: boolean) => void;
  onReorderGroups: (ids: string[]) => void;
  onReorderValues: (groupId: string, values: string[]) => void;
  onClose: () => void;
}

/**
 * The independent Settings window (Home → Settings): declare / delete classification groups and
 * their values, and pin groups to the ribbon quick-pick. This is the vocabulary registry's editor —
 * groups and values exist here independently of any review using them. `date` is structural and
 * never appears here. Rename / merge (with reference migration) is a later slice.
 */
export function SettingsDialog(props: Props): JSX.Element {
  const { groups } = props;
  const [groupName, setGroupName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef(props.onClose);
  closeRef.current = props.onClose;

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
              renderItem={(group, handle) => <GroupRow group={group} handle={handle} {...props} />}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function GroupRow(props: Props & { group: TagGroupView; handle: DragHandle }): JSX.Element {
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
        <span className="sgroup__name">{group.label}</span>
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
          onClick={() => props.onDeleteGroup(group.id)}
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
                <span className="svalue__name">{v.label ?? v.value}</span>
                <span className="svalue__count">{v.count}</span>
                <button
                  type="button"
                  className="svalue__x"
                  aria-label={`delete ${v.value}`}
                  data-testid={`settings-del-value-${group.id}-${v.value}`}
                  onClick={() => props.onDeleteValue(group.id, v.value)}
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
