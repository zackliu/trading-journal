import { useState } from 'react';
import type { StatsPopulation, StatsScope, TagGroupView, TagPredicate } from '../../../shared/domain';

interface Props {
  groups: TagGroupView[];
  initial: StatsScope;
  onApply: (entry: TagPredicate[], annotation: TagPredicate[]) => void;
  onClose: () => void;
}

type Level = 'entry' | 'annotation';

function annotationPredicates(population: StatsPopulation): TagPredicate[] {
  return population.kind === 'matching-annotations' ? population.predicates : [];
}

export function StatsSampleDialog(props: Props): JSX.Element {
  const [entry, setEntry] = useState<TagPredicate[]>(props.initial.entry);
  const [annotation, setAnnotation] = useState<TagPredicate[]>(annotationPredicates(props.initial.population));
  const predicates = (level: Level): TagPredicate[] => (level === 'entry' ? entry : annotation);
  const update = (level: Level, next: TagPredicate[]): void => {
    if (level === 'entry') setEntry(next);
    else setAnnotation(next);
  };
  const addGroup = (level: Level, group: string): void =>
    update(level, [...predicates(level), { group, values: [] }]);
  const removeGroup = (level: Level, group: string): void =>
    update(level, predicates(level).filter((predicate) => predicate.group !== group));
  const toggleValue = (level: Level, group: string, value: string): void =>
    update(
      level,
      predicates(level).map((predicate) =>
        predicate.group !== group
          ? predicate
          : {
              ...predicate,
              values: predicate.values.includes(value)
                ? predicate.values.filter((item) => item !== value)
                : [...predicate.values, value],
            },
      ),
    );

  const renderPredicates = (level: Level): JSX.Element[] =>
    predicates(level).map((predicate) => {
      const group = props.groups.find((item) => item.id === predicate.group);
      const activeValues = group?.values ?? [];
      const activeValueIds = new Set(activeValues.map((value) => value.value));
      const unavailableValues = predicate.values
        .filter((value) => !activeValueIds.has(value))
        .map((value) => ({ value, label: value, unavailable: true }));
      const values = [
        ...activeValues.map((value) => ({ ...value, unavailable: false })),
        ...unavailableValues,
      ];
      return (
        <div className="viewb__pred" key={predicate.group} data-testid={`stats-pred-${level}-${predicate.group}`}>
          <span className="viewb__predname">
            {group?.label ?? predicate.group}
            {!group ? <small className="viewb__unavailable">unavailable group</small> : null}
          </span>
          <div className="viewb__chips">
            {values.map((value) => (
              <button
                type="button"
                key={value.value}
                className={`vchip${predicate.values.includes(value.value) ? ' is-on' : ''}${
                  value.unavailable ? ' is-unavailable' : ''
                }`}
                data-testid={`stats-chip-${level}-${predicate.group}-${value.value}`}
                onClick={() => toggleValue(level, predicate.group, value.value)}
              >
                {value.label ?? value.value}
                {value.unavailable ? <span className="vchip__state">unavailable</span> : null}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="viewb__predx"
            aria-label="Remove condition"
            onClick={() => removeGroup(level, predicate.group)}
          >
            ×
          </button>
        </div>
      );
    });

  const renderAdd = (level: Level): JSX.Element | null => {
    const used = new Set(predicates(level).map((predicate) => predicate.group));
    const available = props.groups.filter((group) => !used.has(group.id));
    if (available.length === 0) return null;
    return (
      <select
        className="viewb__add"
        data-testid={`stats-add-group-${level}`}
        value=""
        onChange={(event) => {
          if (event.target.value) addGroup(level, event.target.value);
        }}
      >
        <option value="">＋ Add group…</option>
        {available.map((group) => (
          <option key={group.id} value={group.id}>
            {group.label}
          </option>
        ))}
      </select>
    );
  };

  return (
    <div className="modal" data-testid="stats-sample-dialog" onMouseDown={props.onClose}>
      <div className="modal__panel viewb" onMouseDown={(event) => event.stopPropagation()}>
        <header className="viewb__head">
          <h2 className="viewb__title">Statistics sample</h2>
          <button type="button" className="settings__close" aria-label="Close" onClick={props.onClose}>
            ×
          </button>
        </header>
        <p className="viewb__hint">
          Entry conditions narrow reviews. Annotation conditions define which annotations are eligible result samples.
        </p>
        <section className="viewb__dim">
          <h3 className="viewb__dimh">
            Entry conditions <span className="viewb__sub">whole review</span>
          </h3>
          {renderPredicates('entry')}
          {renderAdd('entry')}
        </section>
        <section className="viewb__dim">
          <h3 className="viewb__dimh">
            Annotation conditions <span className="viewb__sub">result samples</span>
          </h3>
          {renderPredicates('annotation')}
          {annotation.length === 0 ? (
            <p className="viewb__empty" data-testid="stats-default-population-note">
              No annotation condition: include annotations that have any active result recorded.
            </p>
          ) : null}
          {renderAdd('annotation')}
        </section>
        <footer className="viewb__foot">
          <button type="button" className="viewb__btn" onClick={props.onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="viewb__btn viewb__btn--primary"
            data-testid="stats-sample-apply"
            onClick={() => {
              props.onApply(
                entry.filter((predicate) => predicate.values.length > 0),
                annotation.filter((predicate) => predicate.values.length > 0),
              );
            }}
          >
            Apply sample
          </button>
        </footer>
      </div>
    </div>
  );
}