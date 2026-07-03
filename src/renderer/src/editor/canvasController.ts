import {
  Canvas,
  FabricImage,
  Line,
  PencilBrush,
  Polyline,
  Rect,
  Textbox,
  classRegistry,
  controlsUtils,
  type Control,
  type FabricObject,
  type TPointerEvent,
  type TPointerEventInfo,
} from 'fabric';

export type Tool = 'select' | 'rect' | 'line' | 'arrow' | 'hline' | 'text' | 'draw';
export type DashStyle = 'solid' | 'dashed' | 'dotted';

export interface DrawStyle {
  stroke: string;
  fill: string;
  opacity: number;
  strokeWidth: number;
  dash: DashStyle;
  borderless: boolean;
  textColor: string;
  fontSize: number;
}

export interface EditorState {
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean;
  hasSelection: boolean;
}

/** A right-click on the canvas, asking the shell to open the canvas context menu. */
export interface CanvasContextRequest {
  x: number;
  y: number;
  hasSelection: boolean;
  isImage: boolean;
  isLocked: boolean;
}

const MIN_DRAG = 3;
const DEFAULT_PAGE = { width: 2500, height: 1600 };
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;

function dashArray(dash: DashStyle, width: number): number[] | null {
  if (dash === 'dashed') return [width * 4, width * 3];
  if (dash === 'dotted') return [Math.max(1, width), width * 2];
  return null;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** A locked object is pinned: not selectable/movable, but still right-clickable. */
interface LockFlag {
  tjLocked?: boolean;
}

function isLocked(o: FabricObject): boolean {
  return (o as unknown as LockFlag).tjLocked === true;
}

/** Arrow = a two-point polyline that also renders an arrowhead at its end point. */
class ArrowPoly extends Polyline {
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
function attachSegmentControls(obj: FabricObject): void {
  if (!(obj instanceof Polyline)) return;
  obj.controls = controlsUtils.createPolyControls(obj, { render: controlsUtils.renderCircleControl });
  obj.hasBorders = false;
  obj.objectCaching = false;
}

/** Text = an editable text box that draws its own bordered / filled rectangle behind the text. */
class TextBoxAnnotation extends Textbox {
  static override type = 'TextBoxAnnotation';
  declare boxStroke?: string;
  declare boxStrokeWidth?: number;
  declare boxFill?: string;
  declare boxDash?: number[] | null;

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
    super._render(ctx);
  }
}
classRegistry.setClass(TextBoxAnnotation, 'TextBoxAnnotation');

/**
 * Office “resize-to-fit-text” controls: every handle (sides + corners) changes only the
 * WIDTH (text rewraps, font/border never scale); height auto-fits the content, so there is
 * no height handle. Width has priority — you cannot reduce line count by shrinking height.
 */
function attachTextControls(obj: FabricObject): void {
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

function snapTo45(x1: number, y1: number, x2: number, y2: number): [number, number] {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return [x1 + len * Math.cos(angle), y1 + len * Math.sin(angle)];
}

/**
 * Imperative Fabric wrapper for one Entry's review page. Lives outside React:
 * React owns the surrounding shell/ribbon and calls these methods; the canvas is
 * mounted once and never re-rendered by the framework.
 *
 * The canvas is a white "page" that *is* the review. Screenshots are movable /
 * resizable image objects on the page (referenced by `tj-image://<hash>`, never
 * base64-embedded); annotations are objects too. Geometry is in page-pixel
 * coordinates; a fit zoom scales the view only. Page size travels in the JSON
 * as `tjPage` so it reloads exactly.
 */
export class CanvasController {
  private readonly canvas: Canvas;
  private tool: Tool = 'select';
  private style: DrawStyle = {
    stroke: '#f85149',
    fill: 'transparent',
    opacity: 1,
    strokeWidth: 3,
    dash: 'solid',
    borderless: false,
    textColor: '#111827',
    fontSize: 22,
  };
  private drawing = false;
  private startX = 0;
  private startY = 0;
  private endX = 0;
  private endY = 0;
  private draft: FabricObject | null = null;
  private history: string[] = [];
  private histIndex = -1;
  private savedIndex = 0;
  private restoring = false;
  private availW = 800;
  private availH = 600;
  private pageW = DEFAULT_PAGE.width;
  private pageH = DEFAULT_PAGE.height;
  private zoom = 1;
  private fitMode = true;
  private stateCb: ((s: EditorState) => void) | null = null;
  private toolCb: ((t: Tool) => void) | null = null;
  private contextCb: ((r: CanvasContextRequest) => void) | null = null;
  private zoomCb: ((z: { percent: number; fitMode: boolean }) => void) | null = null;
  private contextTarget: FabricObject | null = null;
  private newTextBox: TextBoxAnnotation | null = null;

  constructor(el: HTMLCanvasElement) {
    this.canvas = new Canvas(el, {
      selection: true,
      preserveObjectStacking: true,
      fireRightClick: true,
      stopContextMenu: true,
    });
    this.canvas.on('mouse:down', (opt) => this.onDown(opt));
    this.canvas.on('mouse:move', (opt) => this.onMove(opt));
    this.canvas.on('mouse:up', () => this.onUp());
    this.canvas.on('path:created', () => this.pushHistory());
    this.canvas.on('object:modified', () => this.pushHistory());
    this.canvas.on('selection:created', () => this.emit());
    this.canvas.on('selection:updated', () => this.emit());
    this.canvas.on('selection:cleared', () => this.emit());
    this.canvas.on('text:editing:exited', (e) => this.onTextEditExit((e.target as FabricObject | undefined) ?? null));
  }

  onState(cb: (s: EditorState) => void): void {
    this.stateCb = cb;
    this.emit();
  }

  onToolChange(cb: (t: Tool) => void): void {
    this.toolCb = cb;
  }

  onContext(cb: (r: CanvasContextRequest) => void): void {
    this.contextCb = cb;
  }

  onZoom(cb: (z: { percent: number; fitMode: boolean }) => void): void {
    this.zoomCb = cb;
    this.emitZoom();
  }

  /** The visible stage area (px). Re-fits the page while in fit mode. */
  setViewport(w: number, h: number): void {
    this.availW = Math.max(1, w);
    this.availH = Math.max(1, h);
    if (this.fitMode && !this.restoring) this.applyFit();
  }

  async loadEntry(canvasJson: string, coverUrl: string | null): Promise<void> {
    this.restoring = true;
    const parsed = safeParse(canvasJson);
    if (parsed && Array.isArray(parsed.objects) && parsed.objects.length > 0) {
      await this.hydrate(parsed);
    } else {
      this.canvas.remove(...this.canvas.getObjects());
      this.canvas.backgroundImage = undefined;
      this.canvas.backgroundColor = '#ffffff';
      this.pageW = DEFAULT_PAGE.width;
      this.pageH = DEFAULT_PAGE.height;
      if (coverUrl) {
        // No stored objects but a cover exists: materialise it as the base image.
        const img = await FabricImage.fromURL(coverUrl);
        this.placeContained(img, true);
        this.canvas.add(img);
        this.canvas.sendObjectToBack(img);
      }
    }
    this.fitMode = true;
    this.refreshZoom();
    this.applyTool('select');
    this.canvas.requestRenderAll();
    this.restoring = false;

    this.history = [this.serialize()];
    this.histIndex = 0;
    this.savedIndex = 0;
    this.emit();
  }

  private async hydrate(data: Record<string, unknown>): Promise<void> {
    const page = (data.tjPage as { width?: number; height?: number } | undefined) ?? DEFAULT_PAGE;
    await this.canvas.loadFromJSON(data);
    for (const obj of this.canvas.getObjects()) {
      attachSegmentControls(obj);
      attachTextControls(obj);
    }
    this.canvas.backgroundImage = undefined;
    this.canvas.backgroundColor = '#ffffff';
    this.pageW = Math.max(1, Math.round(page.width ?? DEFAULT_PAGE.width));
    this.pageH = Math.max(1, Math.round(page.height ?? DEFAULT_PAGE.height));
  }

  // ---- Zoom: the page is a fixed size; zoom only scales the view. ----

  private refreshZoom(): void {
    if (this.fitMode) this.applyFit();
    else this.applyZoom();
  }

  private computeFitZoom(): number {
    // Leave a small margin so the fitted page never touches the edges (no scrollbars).
    const raw = Math.min(this.availW / this.pageW, this.availH / this.pageH) * 0.98;
    return clamp(raw, MIN_ZOOM, MAX_ZOOM);
  }

  private applyFit(): void {
    this.zoom = this.computeFitZoom();
    this.applyZoom();
  }

  private applyZoom(): void {
    this.canvas.setDimensions({
      width: Math.round(this.pageW * this.zoom),
      height: Math.round(this.pageH * this.zoom),
    });
    this.canvas.setZoom(this.zoom);
    this.canvas.requestRenderAll();
    this.emitZoom();
  }

  /** Auto-scale so the whole page fits the stage; grows with the window. */
  fitToViewport(): void {
    this.fitMode = true;
    this.applyFit();
  }

  setZoomPercent(percent: number): void {
    this.fitMode = false;
    this.zoom = clamp(percent / 100, MIN_ZOOM, MAX_ZOOM);
    this.applyZoom();
  }

  zoomIn(): void {
    this.fitMode = false;
    this.zoom = clamp(this.zoom * 1.2, MIN_ZOOM, MAX_ZOOM);
    this.applyZoom();
  }

  zoomOut(): void {
    this.fitMode = false;
    this.zoom = clamp(this.zoom / 1.2, MIN_ZOOM, MAX_ZOOM);
    this.applyZoom();
  }

  private emitZoom(): void {
    this.zoomCb?.({ percent: Math.round(this.zoom * 100), fitMode: this.fitMode });
  }

  /**
   * Center an image on the page. `fillPage` scales it to fill the page as much
   * as possible (may upscale); otherwise it comes in at ≤60% of the page, never
   * upscaled. The page size itself is never changed by an image.
   */
  private placeContained(img: FabricImage, fillPage: boolean): void {
    const iw = img.width || 1;
    const ih = img.height || 1;
    const frac = fillPage ? 1 : 0.6;
    const cap = fillPage ? Infinity : 1;
    const scale = Math.min(cap, (this.pageW * frac) / iw, (this.pageH * frac) / ih);
    img.scale(scale);
    img.set({
      left: (this.pageW - iw * scale) / 2,
      top: (this.pageH - ih * scale) / 2,
      selectable: true,
      evented: true,
    });
  }

  /** Insert a screenshot as a movable image object (does not resize the page). */
  async addImage(imageUrl: string): Promise<{ isFirst: boolean }> {
    const img = await FabricImage.fromURL(imageUrl);
    const isFirst = this.canvas.getObjects().every((o) => !(o instanceof FabricImage));
    this.placeContained(img, isFirst);
    this.canvas.add(img);
    if (isFirst) this.canvas.sendObjectToBack(img);
    this.applyTool('select');
    this.canvas.setActiveObject(img);
    this.canvas.requestRenderAll();
    this.pushHistory();
    return { isFirst };
  }

  /** Scale the selected image to fill the page as much as possible, preserving aspect. */
  fitActiveToCanvas(): void {
    const obj = this.canvas.getActiveObject();
    if (!(obj instanceof FabricImage)) return;
    const iw = obj.width || 1;
    const ih = obj.height || 1;
    const scale = Math.min(this.pageW / iw, this.pageH / ih);
    obj.set({
      scaleX: scale,
      scaleY: scale,
      left: (this.pageW - iw * scale) / 2,
      top: (this.pageH - ih * scale) / 2,
    });
    obj.setCoords();
    this.canvas.requestRenderAll();
    this.pushHistory();
  }

  bringToFront(): void {
    const obj = this.canvas.getActiveObject();
    if (!obj) return;
    this.canvas.bringObjectToFront(obj);
    this.canvas.requestRenderAll();
    this.pushHistory();
  }

  sendToBack(): void {
    const obj = this.canvas.getActiveObject();
    if (!obj) return;
    this.canvas.sendObjectToBack(obj);
    this.canvas.requestRenderAll();
    this.pushHistory();
  }

  /** Lock the active object: it can no longer be selected / moved / resized, only right-clicked. */
  lockActive(): void {
    const obj = this.canvas.getActiveObject();
    if (!obj) return;
    (obj as unknown as LockFlag).tjLocked = true;
    this.canvas.discardActiveObject();
    this.applyTool(this.tool);
    this.canvas.requestRenderAll();
    this.pushHistory();
  }

  /** Unlock the right-clicked object and select it again. */
  unlockContext(): void {
    const obj = this.contextTarget;
    if (!obj) return;
    (obj as unknown as LockFlag).tjLocked = false;
    this.applyTool(this.tool);
    this.canvas.setActiveObject(obj);
    this.canvas.requestRenderAll();
    this.pushHistory();
  }

  bringContextToFront(): void {
    if (!this.contextTarget) return;
    this.canvas.bringObjectToFront(this.contextTarget);
    this.canvas.requestRenderAll();
    this.pushHistory();
  }

  sendContextToBack(): void {
    if (!this.contextTarget) return;
    this.canvas.sendObjectToBack(this.contextTarget);
    this.canvas.requestRenderAll();
    this.pushHistory();
  }

  setTool(tool: Tool): void {
    this.applyTool(tool);
  }

  private applyTool(tool: Tool): void {
    this.tool = tool;
    this.canvas.isDrawingMode = tool === 'draw';
    this.canvas.selection = tool === 'select';
    for (const obj of this.canvas.getObjects()) {
      if (isLocked(obj)) {
        // Pinned: never grabbable, but still hit-tested so right-click can reach it.
        obj.selectable = false;
        obj.evented = true;
        obj.hoverCursor = 'default';
      } else {
        obj.selectable = tool === 'select';
        obj.evented = tool === 'select';
        obj.hoverCursor = null;
      }
    }
    if (tool === 'draw') {
      const brush = new PencilBrush(this.canvas);
      brush.color = this.style.stroke;
      brush.width = this.style.strokeWidth;
      brush.strokeDashArray = dashArray(this.style.dash, this.style.strokeWidth);
      this.canvas.freeDrawingBrush = brush;
    }
    this.canvas.defaultCursor = tool === 'select' ? 'default' : 'crosshair';
    if (tool !== 'select') this.canvas.discardActiveObject();
    this.canvas.requestRenderAll();
    this.toolCb?.(tool);
  }

  getTool(): Tool {
    return this.tool;
  }

  setStyle(patch: Partial<DrawStyle>): void {
    this.style = { ...this.style, ...patch };
    const active = this.canvas.getActiveObjects();
    for (const obj of active) this.applyStylePatch(obj, patch);
    if (active.length > 0) {
      this.canvas.requestRenderAll();
      this.pushHistory();
    }
    if (this.canvas.isDrawingMode && this.canvas.freeDrawingBrush) {
      const brush = this.canvas.freeDrawingBrush;
      if (patch.stroke !== undefined) brush.color = this.style.stroke;
      if (patch.strokeWidth !== undefined) brush.width = this.style.strokeWidth;
      if (patch.strokeWidth !== undefined || patch.dash !== undefined) {
        brush.strokeDashArray = dashArray(this.style.dash, this.style.strokeWidth);
      }
    }
  }

  /** Map a style change onto one object: on a text box Stroke/Fill are the box, plus its own text colour/size. */
  private applyStylePatch(obj: FabricObject, patch: Partial<DrawStyle>): void {
    const borderW = this.style.borderless ? 0 : this.style.strokeWidth;
    if (obj instanceof TextBoxAnnotation) {
      if (patch.stroke !== undefined) obj.boxStroke = patch.stroke;
      if (patch.strokeWidth !== undefined || patch.borderless !== undefined) obj.boxStrokeWidth = borderW;
      if (patch.strokeWidth !== undefined || patch.dash !== undefined) {
        obj.boxDash = dashArray(this.style.dash, this.style.strokeWidth);
      }
      if (patch.fill !== undefined) obj.boxFill = patch.fill;
      if (patch.textColor !== undefined) obj.set('fill', patch.textColor);
      if (patch.fontSize !== undefined) obj.set('fontSize', patch.fontSize);
      if (patch.opacity !== undefined) obj.set('opacity', patch.opacity);
      return;
    }
    if (patch.opacity !== undefined) obj.set('opacity', patch.opacity);
    if (patch.stroke !== undefined) obj.set('stroke', patch.stroke);
    if (obj instanceof Rect) {
      if (patch.strokeWidth !== undefined || patch.borderless !== undefined) obj.set('strokeWidth', borderW);
    } else if (patch.strokeWidth !== undefined) {
      // Lines / arrows are the stroke itself — “no border” never applies to them.
      obj.set('strokeWidth', this.style.strokeWidth);
    }
    if (patch.strokeWidth !== undefined || patch.dash !== undefined) {
      obj.set('strokeDashArray', dashArray(this.style.dash, this.style.strokeWidth));
    }
    if (patch.fill !== undefined && obj instanceof Rect) obj.set('fill', patch.fill);
  }

  getStyle(): DrawStyle {
    return this.style;
  }

  deleteSelected(): void {
    const active = this.canvas.getActiveObjects();
    if (active.length === 0) return;
    this.canvas.remove(...active);
    this.canvas.discardActiveObject();
    this.canvas.requestRenderAll();
    this.pushHistory();
  }

  async undo(): Promise<void> {
    if (this.histIndex <= 0) return;
    this.histIndex -= 1;
    await this.applyState(this.history[this.histIndex]);
  }

  async redo(): Promise<void> {
    if (this.histIndex >= this.history.length - 1) return;
    this.histIndex += 1;
    await this.applyState(this.history[this.histIndex]);
  }

  serialize(): string {
    const data = this.canvas.toObject(['tjLocked', 'boxStroke', 'boxStrokeWidth', 'boxFill', 'boxDash']) as Record<
      string,
      unknown
    >;
    data.tjPage = { width: this.pageW, height: this.pageH };
    return JSON.stringify(data);
  }

  markSaved(): void {
    this.savedIndex = this.histIndex;
    this.emit();
  }

  dispose(): void {
    void this.canvas.dispose();
  }

  private onDown(opt: TPointerEventInfo<TPointerEvent>): void {
    const e = opt.e as MouseEvent;
    if (e.button === 2) {
      this.onRightClick(opt, e);
      return;
    }
    if (this.tool === 'select' || this.tool === 'draw') return;
    const p = this.canvas.getScenePoint(opt.e);
    this.startX = p.x;
    this.startY = p.y;
    this.endX = p.x;
    this.endY = p.y;

    if (this.tool === 'text') {
      const tb = this.makeTextBox(p.x, p.y);
      this.canvas.add(tb);
      this.applyTool('select');
      this.canvas.setActiveObject(tb);
      this.newTextBox = tb;
      tb.enterEditing();
      return;
    }

    this.drawing = true;
    const dash = dashArray(this.style.dash, this.style.strokeWidth);
    if (this.tool === 'rect') {
      this.draft = new Rect({
        left: p.x,
        top: p.y,
        width: 1,
        height: 1,
        fill: this.style.fill,
        stroke: this.style.stroke,
        strokeWidth: this.style.borderless ? 0 : this.style.strokeWidth,
        opacity: this.style.opacity,
        strokeDashArray: dash,
      });
    } else {
      this.draft = new Line([p.x, p.y, p.x, p.y], {
        stroke: this.style.stroke,
        strokeWidth: this.style.strokeWidth,
        opacity: this.style.opacity,
        strokeDashArray: dash,
      });
    }
    this.draft.selectable = false;
    this.draft.evented = false;
    this.canvas.add(this.draft);
  }

  private onRightClick(opt: TPointerEventInfo<TPointerEvent>, e: MouseEvent): void {
    const target = opt.target ?? null;
    this.contextTarget = target;
    const locked = target ? isLocked(target) : false;
    if (target && !locked) {
      this.canvas.setActiveObject(target);
      this.canvas.requestRenderAll();
    }
    this.contextCb?.({
      x: e.clientX,
      y: e.clientY,
      hasSelection: target !== null || this.canvas.getActiveObjects().length > 0,
      isImage: target instanceof FabricImage,
      isLocked: locked,
    });
  }

  private onMove(opt: TPointerEventInfo<TPointerEvent>): void {
    if (!this.drawing || !this.draft) return;
    const p = this.canvas.getScenePoint(opt.e);
    let x = p.x;
    let y = p.y;

    if (this.tool === 'rect') {
      const rect = this.draft as Rect;
      rect.set({
        left: Math.min(this.startX, x),
        top: Math.min(this.startY, y),
        width: Math.abs(x - this.startX),
        height: Math.abs(y - this.startY),
      });
    } else {
      if (this.tool === 'hline') y = this.startY;
      if ((this.tool === 'line' || this.tool === 'arrow') && (opt.e as MouseEvent).ctrlKey) {
        [x, y] = snapTo45(this.startX, this.startY, x, y);
      }
      this.endX = x;
      this.endY = y;
      (this.draft as Line).set({ x2: x, y2: y });
    }
    this.canvas.requestRenderAll();
  }

  private onUp(): void {
    if (!this.drawing) return;
    this.drawing = false;
    const draft = this.draft;
    this.draft = null;
    if (!draft) return;

    let created: FabricObject | null = null;
    if (this.tool === 'rect') {
      const rect = draft as Rect;
      if ((rect.width ?? 0) >= MIN_DRAG || (rect.height ?? 0) >= MIN_DRAG) {
        created = rect;
      } else {
        this.canvas.remove(rect);
      }
    } else {
      // line / hline / arrow: swap the preview for an endpoint-editable segment.
      this.canvas.remove(draft);
      if (Math.hypot(this.endX - this.startX, this.endY - this.startY) >= MIN_DRAG) {
        created = this.makeSegment(this.startX, this.startY, this.endX, this.endY, this.tool === 'arrow');
        this.canvas.add(created);
      }
    }

    if (created) {
      // PPT-style: finishing a shape returns to select so any object is movable on hover.
      this.applyTool('select');
      this.canvas.setActiveObject(created);
      this.canvas.requestRenderAll();
      this.pushHistory();
    } else {
      this.canvas.requestRenderAll();
    }
  }

  private makeSegment(x1: number, y1: number, x2: number, y2: number, arrow: boolean): Polyline {
    const points = [
      { x: x1, y: y1 },
      { x: x2, y: y2 },
    ];
    const options = {
      stroke: this.style.stroke,
      strokeWidth: this.style.strokeWidth,
      fill: '',
      opacity: this.style.opacity,
      strokeDashArray: dashArray(this.style.dash, this.style.strokeWidth),
      strokeLineCap: 'round' as const,
      objectCaching: false,
    };
    const seg = arrow ? new ArrowPoly(points, options) : new Polyline(points, options);
    attachSegmentControls(seg);
    return seg;
  }

  private makeTextBox(x: number, y: number): TextBoxAnnotation {
    const tb = new TextBoxAnnotation('', {
      left: x,
      top: y,
      width: 200,
      fontSize: this.style.fontSize,
      fill: this.style.textColor,
      opacity: this.style.opacity,
      padding: 6,
      objectCaching: false,
      // Wrap per grapheme so narrowing the width always adds lines, even for a
      // single spaceless word or CJK text (Fabric word-wrap can't break those).
      splitByGrapheme: true,
    });
    tb.boxStroke = this.style.stroke;
    tb.boxStrokeWidth = this.style.borderless ? 0 : this.style.strokeWidth;
    tb.boxFill = this.style.fill;
    tb.boxDash = dashArray(this.style.dash, this.style.strokeWidth);
    attachTextControls(tb);
    return tb;
  }

  /** On exit: discard an empty box (Office-style — no text means it was never created); else commit. */
  private onTextEditExit(target: FabricObject | null): void {
    if (target instanceof TextBoxAnnotation) {
      if ((target.text ?? '').trim() === '') {
        this.canvas.remove(target);
        this.canvas.requestRenderAll();
        if (this.newTextBox !== target) this.pushHistory();
      } else {
        this.pushHistory();
      }
    }
    this.newTextBox = null;
  }

  private pushHistory(): void {
    if (this.restoring) return;
    this.history = this.history.slice(0, this.histIndex + 1);
    this.history.push(this.serialize());
    this.histIndex = this.history.length - 1;
    this.emit();
  }

  private async applyState(json: string): Promise<void> {
    this.restoring = true;
    await this.hydrate(safeParse(json) ?? { objects: [] });
    this.refreshZoom();
    this.applyTool(this.tool);
    this.canvas.requestRenderAll();
    this.restoring = false;
    this.emit();
  }

  private emit(): void {
    this.stateCb?.({
      canUndo: this.histIndex > 0,
      canRedo: this.histIndex < this.history.length - 1,
      dirty: this.histIndex !== this.savedIndex,
      hasSelection: this.canvas.getActiveObjects().length > 0,
    });
  }
}

function safeParse(json: string): { objects?: unknown[] } | null {
  try {
    return JSON.parse(json) as { objects?: unknown[] };
  } catch {
    return null;
  }
}
