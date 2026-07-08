import { useEffect, useState, type ReactNode } from 'react';
import type { AnnotationSelection, DashStyle, DrawStyle, Tool } from '../editor/canvasController';
import type { ResultDimensionView, SavedView, Tag, TagGroupView } from '../../../shared/domain';
import { Icon, type IconName } from './icons';
import { QuickTag } from './QuickTag';
import { ResultQuickPick } from './ResultQuickPick';

interface RibbonProps {
  entryOpen: boolean;
  entryId: string | null;
  hasSelection: boolean;
  tool: Tool;
  style: DrawStyle;
  canUndo: boolean;
  canRedo: boolean;
  onNew: () => void;
  onDeleteReview: () => void;
  onTool: (tool: Tool) => void;
  onStyle: (patch: Partial<DrawStyle>) => void;
  onBeforeTextStyle: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onDeleteSelected: () => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  onFitToCanvas: () => void;
  onSave: () => void;
  stampLocked: boolean;
  onToggleStampLock: () => void;
  groups: TagGroupView[];
  entryTags: Tag[];
  entryDate: string;
  onChangeEntryDate: (date: string) => void;
  selectedAnnotation: AnnotationSelection | null;
  onToggleEntryTag: (tag: Tag, on: boolean) => void;
  onToggleAnnotationTag: (tag: Tag, on: boolean) => void;
  onOpenSettings: () => void;
  onOpenResultSettings: () => void;
  onOpenGeneral: () => void;
  resultDimensions: ResultDimensionView[];
  onSetAnnotationResult: (dimensionId: string, value: string | number | null) => void;
  savedViews: SavedView[];
  hasFilter: boolean;
  filterSummary: string;
  onEditFilter: () => void;
  onClearFilter: () => void;
  onLoadView: (id: string) => void;
}

const BASE_TABS = ['Home', 'Draw', 'Review', 'View', 'Stats'];

const TOOLS: Array<{ id: Tool; icon: IconName; label: string }> = [
  { id: 'select', icon: 'select', label: 'Select' },
  { id: 'rect', icon: 'rect', label: 'Rectangle' },
  { id: 'line', icon: 'line', label: 'Line' },
  { id: 'arrow', icon: 'arrow', label: 'Arrow' },
  { id: 'hline', icon: 'hline', label: 'Horizontal line' },
  { id: 'mm', icon: 'mm', label: 'MM' },
  { id: 'text', icon: 'text', label: 'Text' },
  { id: 'draw', icon: 'draw', label: 'Freehand' },
];

const WIDTHS = [1, 2, 3, 5, 8];
const DASHES: DashStyle[] = ['solid', 'dashed', 'dotted'];
const FONT_SIZES = [10, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64];

function Group({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="rgroup">
      <div className="rgroup__body">{children}</div>
      <div className="rgroup__label">{label}</div>
    </div>
  );
}

function IconButton(props: {
  icon: IconName;
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className={`ricon${props.active ? ' is-active' : ''}`}
      title={props.title}
      aria-label={props.title}
      disabled={props.disabled}
      data-testid={`tool-${props.icon}`}
      onClick={props.onClick}
    >
      <Icon name={props.icon} />
    </button>
  );
}

function Placeholder({ text }: { text: string }): JSX.Element {
  return <div className="rplaceholder">{text} · coming soon</div>;
}

export function Ribbon(props: RibbonProps): JSX.Element {
  const { entryOpen, entryId, hasSelection, style, selectedAnnotation } = props;
  const [active, setActive] = useState<string>('Home');
  const annId = selectedAnnotation?.id ?? null;
  const tabs = annId ? [...BASE_TABS, 'Annotation'] : BASE_TABS;

  // Opening (or switching to) a review reveals the drawing tools; closing it returns to Home.
  useEffect(() => setActive(entryOpen ? 'Draw' : 'Home'), [entryOpen, entryId]);
  // Selecting an annotation reveals its contextual tab (like Office's Shape Format) but does NOT
  // steal focus from Draw — so drawing stays fluid; click the tab to tag. Deselecting hides it.
  useEffect(() => {
    if (!annId) setActive((a) => (a === 'Annotation' ? 'Draw' : a));
  }, [annId]);

  return (
    <div className="ribbon" data-testid="ribbon">
      <div className="ribbon__tabs">
        <span className="ribbon__brand" data-testid="app-title">
          Trading Journal
        </span>
        {tabs.map((tab) => (
          <button
            type="button"
            key={tab}
            className={`ribbon__tab${tab === active ? ' is-active' : ''}${tab === 'Annotation' ? ' ribbon__tab--ctx' : ''}`}
            data-testid={`tab-${tab.toLowerCase()}`}
            onClick={() => setActive(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="ribbon__band">
        {active === 'Home' ? (
          <>
            <Group label="Review">
              <button type="button" className="rbig" data-testid="ribbon-new" onClick={props.onNew}>
                <Icon name="plus" /> New
              </button>
              <button
                type="button"
                className="rsave"
                data-testid="editor-save"
                disabled={!entryOpen}
                title="Save now (Ctrl+S) — edits also save automatically"
                onClick={props.onSave}
              >
                <Icon name="save" /> Save
              </button>
              <button
                type="button"
                className="rtext"
                data-testid="ribbon-delete-review"
                disabled={!entryOpen}
                onClick={props.onDeleteReview}
              >
                <Icon name="trash" /> Delete
              </button>
              <span className="rhint">paste a screenshot · Ctrl+V · or drop an image</span>
            </Group>
            <Group label="Settings">
              <button type="button" className="rtext" data-testid="ribbon-settings" onClick={props.onOpenSettings}>
                <Icon name="tag" /> Group &amp; tags
              </button>
              <button
                type="button"
                className="rtext"
                data-testid="ribbon-result-settings"
                onClick={props.onOpenResultSettings}
              >
                <Icon name="gauge" /> Result
              </button>
              <button type="button" className="rtext" data-testid="ribbon-general" onClick={props.onOpenGeneral}>
                <Icon name="folder" /> General
              </button>
            </Group>
          </>
        ) : null}

        {active === 'Draw' ? (
          <>
            <Group label="Tools">
              <div className="rgrid rgrid--4">
                {TOOLS.map((t) => (
                  <IconButton
                    key={t.id}
                    icon={t.icon}
                    title={t.label}
                    active={props.tool === t.id}
                    disabled={!entryOpen}
                    onClick={() => props.onTool(t.id)}
                  />
                ))}
              </div>
            </Group>
            <Group label="Stroke">
              <div className="r2">
                <div className="rrow">
                  <label className="rfield" title="Stroke color">
                    <input
                      type="color"
                      data-testid="stroke-color"
                      value={style.stroke}
                      disabled={!entryOpen}
                      onChange={(e) => props.onStyle({ stroke: e.target.value })}
                    />
                  </label>
                  <div className="rwidths">
                    {WIDTHS.map((w) => (
                      <button
                        type="button"
                        key={w}
                        className={`rwidth${style.strokeWidth === w && !style.borderless ? ' is-active' : ''}`}
                        title={`${w}px`}
                        disabled={!entryOpen}
                        onClick={() => props.onStyle({ strokeWidth: w, borderless: false })}
                      >
                        <span className="rwidth__bar" style={{ height: `${w}px` }} />
                      </button>
                    ))}
                  </div>
                </div>
                <div className="rrow">
                  <div className="rdashes">
                    {DASHES.map((d) => (
                      <button
                        type="button"
                        key={d}
                        className={`rdash${style.dash === d ? ' is-active' : ''}`}
                        title={d}
                        disabled={!entryOpen}
                        data-testid={`dash-${d}`}
                        onClick={() => props.onStyle({ dash: d })}
                      >
                        <span className={`rdash__line rdash__line--${d}`} />
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className={`rtext rtext--sm${style.borderless ? ' is-active' : ''}`}
                    title="No border (rectangles & text boxes only)"
                    disabled={!entryOpen}
                    data-testid="no-border"
                    onClick={() => props.onStyle({ borderless: true })}
                  >
                    No border
                  </button>
                </div>
              </div>
            </Group>
            <Group label="Fill & opacity">
              <div className="r2">
                <div className="rrow">
                  <label className="rfield" title="Fill color">
                    <input
                      type="color"
                      data-testid="fill-color"
                      value={style.fill === 'transparent' ? '#3fb950' : style.fill}
                      disabled={!entryOpen}
                      onChange={(e) => props.onStyle({ fill: e.target.value })}
                    />
                  </label>
                  <button
                    type="button"
                    className="rtext rtext--sm"
                    disabled={!entryOpen}
                    onClick={() => props.onStyle({ fill: 'transparent' })}
                  >
                    No fill
                  </button>
                </div>
                <div className="rrow">
                  <input
                    className="ropacity"
                    type="range"
                    min={0.1}
                    max={1}
                    step={0.1}
                    value={style.opacity}
                    title="Opacity"
                    disabled={!entryOpen}
                    onChange={(e) => props.onStyle({ opacity: Number(e.target.value) })}
                  />
                </div>
              </div>
            </Group>
            <Group label="Text">
              <div className="r2">
                <div className="rrow">
                  <label className="rfield" title="Text color (selected text, or the whole box)">
                    <input
                      type="color"
                      data-testid="text-color"
                      value={style.textColor}
                      disabled={!entryOpen}
                      onMouseDown={() => props.onBeforeTextStyle()}
                      onChange={(e) => props.onStyle({ textColor: e.target.value })}
                    />
                  </label>
                  <button
                    type="button"
                    className={`rtext rtext--sm${style.bold ? ' is-active' : ''}`}
                    title="Bold (selected text, or the whole box)"
                    data-testid="bold"
                    disabled={!entryOpen}
                    style={{ fontWeight: 700 }}
                    onMouseDown={(e) => {
                      e.preventDefault(); // keep the text box in edit mode so the character selection survives
                      props.onBeforeTextStyle();
                    }}
                    onClick={() => props.onStyle({ bold: !style.bold })}
                  >
                    B
                  </button>
                </div>
                <div className="rrow">
                  <select
                    className="rselect"
                    title="Font size"
                    data-testid="font-size"
                    value={style.fontSize}
                    disabled={!entryOpen}
                    onMouseDown={() => props.onBeforeTextStyle()}
                    onChange={(e) => props.onStyle({ fontSize: Number(e.target.value) })}
                  >
                    {FONT_SIZES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </Group>
            <Group label="Edit">
              <div className="rgrid rgrid--2">
                <IconButton icon="undo" title="Undo" disabled={!entryOpen || !props.canUndo} onClick={props.onUndo} />
                <IconButton icon="redo" title="Redo" disabled={!entryOpen || !props.canRedo} onClick={props.onRedo} />
                <IconButton
                  icon="trash"
                  title="Delete selected"
                  disabled={!entryOpen || !hasSelection}
                  onClick={props.onDeleteSelected}
                />
              </div>
            </Group>
            <Group label="Arrange">
              <div className="rgrid rgrid--2">
                <IconButton
                  icon="front"
                  title="Bring to front"
                  disabled={!entryOpen || !hasSelection}
                  onClick={props.onBringToFront}
                />
                <IconButton
                  icon="sendtoback"
                  title="Send to back"
                  disabled={!entryOpen || !hasSelection}
                  onClick={props.onSendToBack}
                />
                <IconButton
                  icon="fit"
                  title="Fit image to canvas"
                  disabled={!entryOpen || !hasSelection}
                  onClick={props.onFitToCanvas}
                />
              </div>
            </Group>
            <Group label="Palette">
              <button
                type="button"
                className={`rtext${props.stampLocked ? '' : ' is-active'}`}
                data-testid="stamp-lock"
                disabled={!entryOpen}
                title={
                  props.stampLocked
                    ? 'Palette locked — drag a stamp onto the page to use it. Unlock to add / rearrange stamps.'
                    : 'Palette unlocked — drag a drawing into the strip to store it, or rearrange. Click to lock.'
                }
                onClick={props.onToggleStampLock}
              >
                <Icon name={props.stampLocked ? 'lock' : 'unlock'} /> {props.stampLocked ? 'Locked' : 'Unlocked'}
              </button>
            </Group>
          </>
        ) : null}

        {active === 'Review' ? (
          <>
            <Group label="Date">
              <input
                type="date"
                className="ribbon__date"
                data-testid="review-date"
                value={props.entryDate}
                onChange={(e) => props.onChangeEntryDate(e.target.value)}
              />
            </Group>
            <div className="ribbon__vdiv" aria-hidden="true" />
            <QuickTag
              groups={props.groups}
              selected={props.entryTags}
              onToggle={props.onToggleEntryTag}
              onOpenSettings={props.onOpenSettings}
            />
          </>
        ) : null}
        {active === 'Annotation' && selectedAnnotation ? (
          <>
            <QuickTag
              groups={props.groups}
              selected={selectedAnnotation.tags}
              onToggle={props.onToggleAnnotationTag}
              onOpenSettings={props.onOpenSettings}
            />
            <div className="ribbon__vdiv" aria-hidden="true" />
            <ResultQuickPick
              dimensions={props.resultDimensions}
              result={selectedAnnotation.result}
              onSet={props.onSetAnnotationResult}
              onOpenSettings={props.onOpenResultSettings}
            />
          </>
        ) : null}
        {active === 'View' ? (
          <>
            <Group label="Filter">
              <button type="button" className="rtext" data-testid="view-edit" onClick={props.onEditFilter}>
                <Icon name="tag" /> Edit filter…
              </button>
              <button
                type="button"
                className="rtext"
                data-testid="view-clear"
                disabled={!props.hasFilter}
                onClick={props.onClearFilter}
              >
                <Icon name="trash" /> Clear
              </button>
              <span className="rhint" data-testid="view-summary">
                {props.filterSummary}
              </span>
            </Group>
            <Group label="Saved views">
              <select
                className="rselect"
                data-testid="view-picker"
                value=""
                onChange={(e) => {
                  if (e.target.value) props.onLoadView(e.target.value);
                }}
              >
                <option value="">Open a view…</option>
                {props.savedViews.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </Group>
          </>
        ) : null}
        {active === 'Stats' ? <Placeholder text="Group × result statistics (Slice 8)" /> : null}
      </div>
    </div>
  );
}
