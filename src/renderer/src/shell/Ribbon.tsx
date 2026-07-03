import { useEffect, useState, type ReactNode } from 'react';
import type { DashStyle, DrawStyle, Tool } from '../editor/canvasController';
import { Icon, type IconName } from './icons';

interface RibbonProps {
  entryOpen: boolean;
  hasSelection: boolean;
  tool: Tool;
  style: DrawStyle;
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean;
  onNew: () => void;
  onDeleteReview: () => void;
  onTool: (tool: Tool) => void;
  onStyle: (patch: Partial<DrawStyle>) => void;
  onUndo: () => void;
  onRedo: () => void;
  onDeleteSelected: () => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  onFitToCanvas: () => void;
  onSave: () => void;
}

const TABS = ['Home', 'Draw', 'Tags', 'Browse', 'Stats'];

const TOOLS: Array<{ id: Tool; icon: IconName; label: string }> = [
  { id: 'select', icon: 'select', label: 'Select' },
  { id: 'rect', icon: 'rect', label: 'Rectangle' },
  { id: 'line', icon: 'line', label: 'Line' },
  { id: 'arrow', icon: 'arrow', label: 'Arrow' },
  { id: 'hline', icon: 'hline', label: 'Horizontal line' },
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
  const { entryOpen, hasSelection, style } = props;
  const [active, setActive] = useState(0);

  // Opening a review reveals the drawing tools; closing it returns to Home.
  useEffect(() => setActive(entryOpen ? 1 : 0), [entryOpen]);

  return (
    <div className="ribbon" data-testid="ribbon">
      <div className="ribbon__tabs">
        <span className="ribbon__brand" data-testid="app-title">
          Trading Journal
        </span>
        {TABS.map((tab, i) => (
          <button
            type="button"
            key={tab}
            className={`ribbon__tab${i === active ? ' is-active' : ''}`}
            onClick={() => setActive(i)}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="ribbon__band">
        {active === 0 ? (
          <Group label="Review">
            <button type="button" className="rbig" data-testid="ribbon-new" onClick={props.onNew}>
              <Icon name="plus" /> New
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
        ) : null}

        {active === 1 ? (
          <>
            <Group label="Tools">
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
            </Group>
            <Group label="Stroke">
              <label className="rfield" title="Stroke color">
                <input
                  type="color"
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
              <button
                type="button"
                className={`rtext${style.borderless ? ' is-active' : ''}`}
                title="No border (rectangles & text boxes only)"
                disabled={!entryOpen}
                data-testid="no-border"
                onClick={() => props.onStyle({ borderless: true })}
              >
                No border
              </button>
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
            </Group>
            <Group label="Fill & opacity">
              <label className="rfield" title="Fill color">
                <input
                  type="color"
                  value={style.fill === 'transparent' ? '#3fb950' : style.fill}
                  disabled={!entryOpen}
                  onChange={(e) => props.onStyle({ fill: e.target.value })}
                />
              </label>
              <button
                type="button"
                className="rtext"
                disabled={!entryOpen}
                onClick={() => props.onStyle({ fill: 'transparent' })}
              >
                No fill
              </button>
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
            </Group>
            <Group label="Text">
              <label className="rfield" title="Text color">
                <input
                  type="color"
                  value={style.textColor}
                  disabled={!entryOpen}
                  onChange={(e) => props.onStyle({ textColor: e.target.value })}
                />
              </label>
              <select
                className="rselect"
                title="Font size"
                data-testid="font-size"
                value={style.fontSize}
                disabled={!entryOpen}
                onChange={(e) => props.onStyle({ fontSize: Number(e.target.value) })}
              >
                {FONT_SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Group>
            <Group label="Edit">
              <IconButton icon="undo" title="Undo" disabled={!entryOpen || !props.canUndo} onClick={props.onUndo} />
              <IconButton icon="redo" title="Redo" disabled={!entryOpen || !props.canRedo} onClick={props.onRedo} />
              <IconButton
                icon="trash"
                title="Delete selected"
                disabled={!entryOpen || !hasSelection}
                onClick={props.onDeleteSelected}
              />
            </Group>
            <Group label="Arrange">
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
            </Group>
            <Group label="Stamp">
              <IconButton icon="stamp" title="Save as stamp" disabled />
            </Group>
            <Group label="Entry">
              <button
                type="button"
                className="rsave"
                disabled={!entryOpen || !props.dirty}
                onClick={props.onSave}
                data-testid="editor-save"
              >
                <Icon name="save" /> Save
              </button>
            </Group>
          </>
        ) : null}

        {active === 2 ? <Placeholder text="Tag & result editing (Slice 4)" /> : null}
        {active === 3 ? <Placeholder text="Browse by group → tag (Slice 7)" /> : null}
        {active === 4 ? <Placeholder text="Group × result statistics (Slice 8)" /> : null}
      </div>
    </div>
  );
}
