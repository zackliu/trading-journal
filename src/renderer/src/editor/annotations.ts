// Shared annotation object model for the review canvas AND the stamp palette.
//
// Both Fabric surfaces (an Entry's review page and the global stamp library) use
// the same drawable objects, the same custom subclasses, and the same serialized
// `tj*` payload. Keeping this in one module means the ArrowPoly / TextBoxAnnotation
// classes are registered with Fabric's classRegistry exactly once (module singleton),
// and both canvases hydrate each other's JSON identically.

import {
  Control,
  FabricObject,
  InteractiveFabricObject,
  Point,
  Polyline,
  Textbox,
  classRegistry,
  config,
  controlsUtils,
  util,
} from 'fabric';
import type { Result, Tag } from '../../../shared/domain';

// Office-style selection handles on every interactive object: small, crisp white dots with a thin
// accent ring and a thin accent border — clear but light enough to grab on very small drawings
// (default Fabric corners are bulky 13px hollow squares). Free (non-uniform) corner resize is turned
// on per-canvas via `uniformScaling = false`, so corners stretch width/height independently.
InteractiveFabricObject.ownDefaults = {
  ...InteractiveFabricObject.ownDefaults,
  cornerSize: 8,
  touchCornerSize: 20,
  cornerStyle: 'circle' as const,
  transparentCorners: false,
  cornerColor: '#ffffff',
  cornerStrokeColor: '#4165cc',
  borderColor: '#4165cc',
  borderOpacityWhenMoving: 0.35,
  padding: 0,
};

// Our text boxes are uniformly styled — one colour / size per box, set from the ribbon. Fabric's text
// copy-paste otherwise carries the SOURCE's per-character styles into the destination box, so pasted
// text keeps its old colour and the box's own text-colour control can no longer change it. Turning
// this off makes every paste (between boxes or from outside) adopt the destination box's own style.
config.disableStyleCopyPaste = true;

/** Extra object properties persisted in canvas JSON (Fabric drops unknown keys otherwise). */
export const TJ_PROPS = [
  'tjLocked',
  'boxStroke',
  'boxStrokeWidth',
  'boxFill',
  'boxDash',
  'tjId',
  'tjTags',
  'tjResult',
  'tjLinks',
  'tjRole',
  'mmFlipX',
  'mmFlipY',
] as const;

/** Placeholder shown in an empty title text box — a hint, never stored as the title's content. */
export const TITLE_PLACEHOLDER = '点击添加标题';

/**
 * Every custom field we stash on a Fabric object goes here, read through one typed door.
 * `tjId` / `tjTags` / `tjResult` / `tjLinks` are the persisted annotation payload (a screenshot
 * carries none); `tjLocked` pins a stamp in the palette; `tjChrome` / `tjGhost` mark transient
 * helper objects (the page/strip divider and the drag-out ghost) that are never serialized.
 */
export interface TjMeta {
  tjId?: string;
  tjTags?: Tag[];
  tjResult?: Result;
  tjLinks?: string[];
  tjLocked?: boolean;
  tjChrome?: boolean;
  tjGhost?: boolean;
  /** Structural role marker; `'title'` = the review's title text box (not a queryable annotation). */
  tjRole?: string;
}

export function tjMeta(o: FabricObject): TjMeta {
  return o as unknown as TjMeta;
}

export function isAnnotation(o: FabricObject): boolean {
  return typeof tjMeta(o).tjId === 'string';
}

/** A stamp pinned in the palette: a drag pulls out a copy instead of moving the original. */
export function isLocked(o: FabricObject): boolean {
  return tjMeta(o).tjLocked === true;
}

/** Non-interactive page furniture (the divider between review page and stamp strip). */
export function isChrome(o: FabricObject): boolean {
  return tjMeta(o).tjChrome === true;
}

/** The translucent clone that tracks the cursor during a locked drag-out. */
export function isGhost(o: FabricObject): boolean {
  return tjMeta(o).tjGhost === true;
}

/** The review's structural title text box: kept even when empty, never a queryable annotation. */
export function isTitle(o: FabricObject): boolean {
  return tjMeta(o).tjRole === 'title';
}

/** Stamp a fresh annotation identity on a newly drawn object (id + empty tag list). */
export function ensureAnnotation(o: FabricObject): void {
  const a = tjMeta(o);
  if (!a.tjId) {
    a.tjId = crypto.randomUUID();
    a.tjTags = [];
  }
}

/** Arrow = a two-point polyline that also renders an arrowhead at its end point. */
export class ArrowPoly extends Polyline {
  static override type = 'ArrowPoly';

  override _render(ctx: CanvasRenderingContext2D): void {
    super._render(ctx);
    const pts = this.points;
    const n = pts.length;
    if (n < 2) return;
    const a = pts[n - 2];
    const b = pts[n - 1];
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const size = 9 + (this.strokeWidth || 1) * 2.4;
    ctx.save();
    ctx.translate(b.x - this.pathOffset.x, b.y - this.pathOffset.y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-size, -size * 0.5);
    ctx.lineTo(-size, size * 0.5);
    ctx.closePath();
    ctx.fillStyle = typeof this.stroke === 'string' ? this.stroke : '#000000';
    ctx.fill();
    ctx.restore();
  }
}
classRegistry.setClass(ArrowPoly, 'ArrowPoly');

/** Snap the vector (x1,y1)→(x2,y2) to the nearest of eight directions (horizontal / vertical / 45°),
 * keeping its length. One shared constraint for BOTH first drawing a line (Ctrl during the draw drag)
 * and later dragging an existing endpoint (Ctrl on the handle) — so editing a line is never a special
 * case of creating one. */
export function snapTo45(x1: number, y1: number, x2: number, y2: number): [number, number] {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return [x1 + len * Math.cos(angle), y1 + len * Math.sin(angle)];
}

/** Give a line / arrow polyline draggable endpoint handles instead of image-style controls. Holding
 * Ctrl while dragging a handle constrains the segment to H / V / 45° about the opposite (fixed)
 * endpoint — the same constraint used while the line was first drawn, so an edit is not special. */
export function attachSegmentControls(obj: FabricObject): void {
  if (!(obj instanceof Polyline)) return;
  const controls = controlsUtils.createPolyControls(obj, { render: controlsUtils.renderCircleControl });
  for (const key of Object.keys(controls)) {
    const control = controls[key];
    const base = control.actionHandler;
    control.actionHandler = (eventData, transform, x, y) => {
      // Two-point segments only: snap the dragged end about the fixed opposite end when Ctrl is held.
      if ((eventData as MouseEvent).ctrlKey && obj.points.length === 2) {
        const anchor = obj.points[Number(key.slice(1)) === 0 ? 1 : 0];
        const off = obj.pathOffset;
        const a = new Point(anchor.x - off.x, anchor.y - off.y).transform(obj.calcTransformMatrix());
        const [sx, sy] = snapTo45(a.x, a.y, x, y);
        return base(eventData, transform, sx, sy);
      }
      return base(eventData, transform, x, y);
    };
  }
  obj.controls = controls;
  obj.hasBorders = false;
  obj.objectCaching = false;
  // Hit testing along the stroke (not the bounding box) is applied canvas-wide via
  // `segmentContainsPoint` — see CanvasController's `_pointIsInObjectSelectionArea` override.
}

/** Half-width, in *screen* pixels, of a line's clickable band — the perpendicular reach on each side
 * of the stroke that still counts as a hit (PowerPoint uses a similar small, zoom-independent band). */
const SEGMENT_HIT_SCREEN_PADDING = 6;

function pointToSegmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Office-style hit testing for a line / arrow. A point selects the segment when its PERPENDICULAR
 * distance to the real stroke is within a small, zoom-independent screen band — never merely because
 * it landed inside the diagonal bounding box. This fixes both failure modes at once: a thin horizontal
 * line (a near-zero-height box) becomes easy to grab, and a diagonal line stops selecting the large
 * empty triangle around it. The band is constant on screen, so it feels the same at any zoom.
 */
export function segmentContainsPoint(obj: Polyline, scenePoint: Point): boolean {
  const pts = obj.points;
  if (!pts || pts.length < 2) return false;
  const m = obj.calcTransformMatrix();
  const off = obj.pathOffset;
  const zoom = obj.canvas?.getZoom() ?? 1;
  const tolerance = SEGMENT_HIT_SCREEN_PADDING / zoom + (obj.strokeWidth ?? 0) / 2;
  let prev = util.transformPoint(new Point(pts[0].x - off.x, pts[0].y - off.y), m);
  for (let i = 1; i < pts.length; i += 1) {
    const cur = util.transformPoint(new Point(pts[i].x - off.x, pts[i].y - off.y), m);
    if (pointToSegmentDistance(scenePoint, prev, cur) <= tolerance) return true;
    prev = cur;
  }
  return false;
}

/** Minimum horizontal extent (scene px) a measured move always keeps, so a click with no horizontal
 * drag still leaves a grabbable object you can widen later — a measured move is NEVER discarded for
 * being too small (that would silently lose the mark the user just placed). */
export const MM_MIN_WIDTH = 40;

/**
 * Measured-move projection: three equally-spaced horizontal lines — a base level, the measured level
 * (one leg away) and the 1:1 projection (two legs away, the “double” target). All three share ONE
 * stroke style (colour / width / opacity from the ribbon); there is no dashing, no per-line hierarchy
 * and no fill. Geometry is a plain axis-aligned box: width = horizontal reach, height = 2× the leg
 * spacing, with the three lines at the box's top edge, middle and bottom edge. Two anchors drive it —
 * A on the base line, B on the measured line — and `mmFlipX` / `mmFlipY` record which corner A sits in,
 * so the two drag handles land on the correct ends and the projection is on the far side (it is derived
 * and carries no handle). Pixel geometry only: it measures distance on the screenshot, never price.
 * Creating and later re-dragging use the exact same geometry (`setMmFromAnchors`), so an edit is never
 * a special case of a create.
 */
export class MeasuredMove extends FabricObject {
  static override type = 'MeasuredMove';
  declare mmFlipX?: boolean;
  declare mmFlipY?: boolean;

  constructor(options: Record<string, unknown> = {}) {
    super();
    this.setOptions({
      fill: '',
      objectCaching: false,
      hasBorders: false,
      mmFlipX: false,
      mmFlipY: false,
      ...options,
    });
  }

  override _render(ctx: CanvasRenderingContext2D): void {
    const w = this.width ?? 0;
    const h = this.height ?? 0;
    ctx.save();
    ctx.strokeStyle = typeof this.stroke === 'string' && this.stroke ? this.stroke : '#000000';
    ctx.lineWidth = this.strokeWidth ?? 1;
    ctx.lineCap = 'round';
    for (const y of [-h / 2, 0, h / 2]) {
      ctx.beginPath();
      ctx.moveTo(-w / 2, y);
      ctx.lineTo(w / 2, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Fabric inflates an object's dimensions — and therefore its centre — by strokeWidth. But we draw the
  // three lines ourselves at exactly ±width/2 / ±height/2, and the anchor math treats width/height as the
  // exact span with left/top as the exact box edge. Excluding strokeWidth here keeps the centre at
  // left+width/2, so reading an anchor's scene position and writing it back are idempotent. Otherwise
  // dragging one handle re-reads the *opposite* (fixed) anchor offset by strokeWidth/2 every frame and
  // bakes that offset into left/top, making the whole measured move drift as you drag.
  override _getTransformedDimensions(options: Record<string, unknown> = {}): Point {
    return super._getTransformedDimensions({ ...options, strokeWidth: 0 });
  }
}
classRegistry.setClass(MeasuredMove, 'MeasuredMove');

/** The local (centre-origin) position of a measured-move anchor: A on the base edge at the pivot
 * corner, B on the middle line at the far horizontal end. */
function mmAnchorLocal(obj: MeasuredMove, which: 'a' | 'b'): Point {
  const w = obj.width ?? 0;
  const h = obj.height ?? 0;
  if (which === 'a') return new Point(obj.mmFlipX ? w / 2 : -w / 2, obj.mmFlipY ? h / 2 : -h / 2);
  return new Point(obj.mmFlipX ? -w / 2 : w / 2, 0);
}

/** An anchor's current scene position — used to hold one end fixed while the other end is dragged. */
function mmAnchorScene(obj: MeasuredMove, which: 'a' | 'b'): Point {
  return mmAnchorLocal(obj, which).transform(obj.calcTransformMatrix());
}

/**
 * Rebuild a measured move's box from its two anchors (A = base, B = measured) in scene coordinates.
 * Width is clamped to MM_MIN_WIDTH so it is never lost; height (2× the leg spacing) may be zero (a flat
 * single line you can still pull open). Direction falls out of the signs of dx / dy, so all four
 * quadrants are one formula with no special case. The create drag and the handle-edit drag both call
 * this, so editing behaves exactly like creating.
 */
export function setMmFromAnchors(obj: MeasuredMove, ax: number, ay: number, bx: number, by: number): void {
  const dx = bx - ax;
  const dy = by - ay;
  const flipX = dx < 0;
  const flipY = dy < 0;
  const width = Math.max(Math.abs(dx), MM_MIN_WIDTH);
  const height = Math.abs(dy) * 2;
  const left = flipX ? ax - width : ax; // A is the pivot; the box reaches from A toward B
  const top = flipY ? ay - height : ay; // A is on the base edge; the stack grows toward B and one leg beyond
  obj.set({ mmFlipX: flipX, mmFlipY: flipY, width, height, left, top });
  obj.setCoords();
}

/** Office-style hit band for a measured move: a point selects it when within a small, zoom-independent
 * screen band of ANY of its three horizontal lines — never merely inside the empty box between them. */
export function measuredMoveContainsPoint(obj: MeasuredMove, scenePoint: Point): boolean {
  const w = obj.width ?? 0;
  const h = obj.height ?? 0;
  const zoom = obj.canvas?.getZoom() ?? 1;
  const tolerance = SEGMENT_HIT_SCREEN_PADDING / zoom + (obj.strokeWidth ?? 0) / 2;
  const m = obj.calcTransformMatrix();
  for (const y of [-h / 2, 0, h / 2]) {
    const a = new Point(-w / 2, y).transform(m);
    const b = new Point(w / 2, y).transform(m);
    if (pointToSegmentDistance(scenePoint, a, b) <= tolerance) return true;
  }
  return false;
}

/** Give a measured move its two endpoint handles (A on the base line, B on the measured line). The
 * lines are always horizontal, so there is no Ctrl constraint; dragging a handle rebuilds the box from
 * that anchor and the fixed opposite anchor — the same geometry function as the create drag. */
export function attachMmControls(obj: FabricObject): void {
  if (!(obj instanceof MeasuredMove)) return;
  obj.objectCaching = false;
  obj.hasBorders = false;
  const handle = (which: 'a' | 'b'): Control =>
    new Control({
      actionName: 'modifyMM',
      cursorStyleHandler: () => 'crosshair',
      render: controlsUtils.renderCircleControl,
      positionHandler: (_dim, _finalMatrix, o) => {
        const mm = o as MeasuredMove;
        return mmAnchorLocal(mm, which).transform(mm.calcTransformMatrix()).transform(mm.getViewportTransform());
      },
      actionHandler: (_eventData, transform, x, y) => {
        const mm = transform.target as MeasuredMove;
        const fixed = mmAnchorScene(mm, which === 'a' ? 'b' : 'a');
        if (which === 'a') setMmFromAnchors(mm, x, y, fixed.x, fixed.y);
        else setMmFromAnchors(mm, fixed.x, fixed.y, x, y);
        return true;
      },
    });
  obj.controls = { a: handle('a'), b: handle('b') };
}

/** Text = an editable text box that draws its own bordered / filled rectangle behind the text. */
export class TextBoxAnnotation extends Textbox {
  static override type = 'TextBoxAnnotation';
  declare boxStroke?: string;
  declare boxStrokeWidth?: number;
  declare boxFill?: string;
  declare boxDash?: number[] | null;
  declare tjRole?: string;

  override _render(ctx: CanvasRenderingContext2D): void {
    const pad = 6;
    const w = this.width + pad * 2;
    const h = this.height + pad * 2;
    ctx.save();
    if (this.boxFill && this.boxFill !== 'transparent') {
      ctx.fillStyle = this.boxFill;
      ctx.fillRect(-w / 2, -h / 2, w, h);
    }
    if (this.boxStroke && (this.boxStrokeWidth ?? 0) > 0) {
      ctx.strokeStyle = this.boxStroke;
      ctx.lineWidth = this.boxStrokeWidth ?? 1;
      if (this.boxDash) ctx.setLineDash(this.boxDash);
      ctx.strokeRect(-w / 2, -h / 2, w, h);
    }
    ctx.restore();
    // An empty title shows a faint placeholder hint (never stored as content; gone once you type).
    if (this.tjRole === 'title' && (this.text ?? '') === '' && !this.isEditing) {
      ctx.save();
      ctx.fillStyle = 'rgba(60, 54, 44, 0.34)';
      ctx.font = `${this.fontSize}px ${this.fontFamily}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(TITLE_PLACEHOLDER, -this.width / 2, 0);
      ctx.restore();
    }
    super._render(ctx);
  }
}
classRegistry.setClass(TextBoxAnnotation, 'TextBoxAnnotation');

/**
 * Office “resize-to-fit-text” controls: every handle (sides + corners) changes only the
 * WIDTH (text rewraps, font/border never scale); height auto-fits the content, so there is
 * no height handle. Width has priority — you cannot reduce line count by shrinking height.
 */
export function attachTextControls(obj: FabricObject): void {
  if (!(obj instanceof TextBoxAnnotation)) return;
  const base = controlsUtils.createTextboxDefaultControls();
  const asWidth = (c: Control): Control => {
    c.actionHandler = controlsUtils.changeWidth;
    c.actionName = 'resizing';
    c.cursorStyleHandler = () => 'ew-resize';
    return c;
  };
  obj.controls = {
    ml: base.ml,
    mr: base.mr,
    tl: asWidth(base.tl),
    tr: asWidth(base.tr),
    bl: asWidth(base.bl),
    br: asWidth(base.br),
    mtr: base.mtr,
  };
  obj.objectCaching = false;
}

/** Re-apply the custom controls after an object is hydrated / enlivened from JSON. */
export function reattachControls(obj: FabricObject): void {
  attachSegmentControls(obj);
  attachTextControls(obj);
  attachMmControls(obj);
}
