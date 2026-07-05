// Shared annotation object model for the review canvas AND the stamp palette.
//
// Both Fabric surfaces (an Entry's review page and the global stamp library) use
// the same drawable objects, the same custom subclasses, and the same serialized
// `tj*` payload. Keeping this in one module means the ArrowPoly / TextBoxAnnotation
// classes are registered with Fabric's classRegistry exactly once (module singleton),
// and both canvases hydrate each other's JSON identically.

import {
  InteractiveFabricObject,
  Point,
  Polyline,
  Textbox,
  classRegistry,
  controlsUtils,
  util,
  type Control,
  type FabricObject,
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

/** Give a line / arrow polyline draggable endpoint handles instead of image-style controls. */
export function attachSegmentControls(obj: FabricObject): void {
  if (!(obj instanceof Polyline)) return;
  obj.controls = controlsUtils.createPolyControls(obj, { render: controlsUtils.renderCircleControl });
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
}
