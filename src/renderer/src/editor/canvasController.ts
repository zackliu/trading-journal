import {
  Canvas,
  FabricImage,
  Gradient,
  Line,
  PencilBrush,
  Polyline,
  Rect,
  util,
  type FabricObject,
  type TPointerEvent,
  type TPointerEventInfo,
} from 'fabric';
import type { Annotation, Result, Tag } from '../../../shared/domain';
import {
  ArrowPoly,
  TextBoxAnnotation,
  TJ_PROPS,
  attachSegmentControls,
  attachTextControls,
  ensureAnnotation,
  isAnnotation,
  isChrome,
  isGhost,
  isLocked,
  reattachControls,
  tjMeta,
} from './annotations';

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

/** The annotation data the right-click “Tags & result…” popover edits. */
export interface AnnotationSelection {
  id: string;
  tags: Tag[];
  result: Result;
  links: string[];
}

/** A right-click on the canvas, asking the shell to open the canvas context menu. */
export interface CanvasContextRequest {
  x: number;
  y: number;
  hasSelection: boolean;
  isImage: boolean;
  isLocked: boolean;
  /** The right-clicked taggable annotation (id/tags/result/links), or null for a screenshot / empty space. */
  annotation: AnnotationSelection | null;
}

type Region = 'page' | 'strip';

const MIN_DRAG = 3;
const DEFAULT_PAGE = { width: 2500, height: 1600 };
// The stamp strip lives to the right of the review page on the SAME canvas, so both share one
// zoom (drag-in / drag-out keep their size) and dragging across is continuous (never clipped).
const GAP = 20; // scene px between page and strip — a thin divider band
const STRIP_W = 760; // scene px width of the stamp strip
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

function snapTo45(x1: number, y1: number, x2: number, y2: number): [number, number] {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return [x1 + len * Math.cos(angle), y1 + len * Math.sin(angle)];
}

/** Live state of a locked-palette drag-out: a translucent copy tracks the cursor; the source never moves. */
interface GhostDrag {
  source: FabricObject; // the pinned stamp being copied out
  obj: FabricObject | null; // the translucent clone (null until the async enliven resolves)
  grab: { dx: number; dy: number }; // cursor offset within the object at grab time
  lastP: { x: number; y: number }; // latest scene-space cursor position
  opacity: number; // the source's real opacity, restored on the solid copy
  moved: boolean; // whether the cursor has moved since grab (a plain click makes no copy)
}

/**
 * Imperative Fabric wrapper for one Entry's review page AND the global stamp palette, rendered as
 * one continuous white surface: the review page on the left, a thin divider, then the stamp strip
 * on the right. Both share a single zoom, so a drawing keeps its size when dragged between them and
 * the drag is never clipped at a canvas edge. Storage still splits by region — page-region objects
 * belong to the Entry, strip-region objects are global stamps.
 *
 * Lives outside React: React owns the surrounding shell/ribbon and calls these methods; the canvas
 * is mounted once and never re-rendered by the framework. Geometry is page-pixel coordinates; a fit
 * zoom scales the view only. Page size travels in the Entry JSON as `tjPage`.
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
  private paletteLocked = true;
  private dragHome: { obj: FabricObject; left: number; top: number; region: Region } | null = null;
  private didMove = false;
  // A locked-palette drag pulls out a translucent COPY (the original stays put) that lands solid on the page.
  private ghostDrag: GhostDrag | null = null;
  private stateCb: ((s: EditorState) => void) | null = null;
  private toolCb: ((t: Tool) => void) | null = null;
  private contextCb: ((r: CanvasContextRequest) => void) | null = null;
  private zoomCb: ((z: { percent: number; fitMode: boolean }) => void) | null = null;
  private stripChangedCb: (() => void) | null = null;
  private contextTarget: FabricObject | null = null;
  private newTextBox: TextBoxAnnotation | null = null;

  constructor(el: HTMLCanvasElement) {
    this.canvas = new Canvas(el, {
      selection: true,
      preserveObjectStacking: true,
      fireRightClick: true,
      stopContextMenu: true,
      // Office-style corners: dragging a corner stretches width and height freely; hold Shift to keep aspect.
      uniformScaling: false,
    });
    this.canvas.on('mouse:down', (opt) => this.onDown(opt));
    this.canvas.on('mouse:move', (opt) => this.onMove(opt));
    this.canvas.on('mouse:up', () => this.onUp());
    this.canvas.on('object:moving', () => {
      this.didMove = true;
    });
    this.canvas.on('path:created', (e) => {
      const path = (e as unknown as { path?: FabricObject }).path;
      if (path) {
        ensureAnnotation(path);
        this.pushHistory();
        if (this.regionOf(path) === 'strip') this.stripChangedCb?.();
      }
    });
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

  /** Fired after an edit that may have changed the stamp strip, so the shell can persist both stores. */
  onStripChanged(cb: () => void): void {
    this.stripChangedCb = cb;
  }

  /** The visible stage area (px). Re-fits the surface while in fit mode. */
  setViewport(w: number, h: number): void {
    this.availW = Math.max(1, w);
    this.availH = Math.max(1, h);
    if (this.fitMode && !this.restoring) this.applyFit();
  }

  // ---- Scene = page + gap + strip, all on one canvas. ----

  private sceneW(): number {
    return this.pageW + GAP + STRIP_W;
  }

  private sceneH(): number {
    return this.pageH;
  }

  /** Which paper an object sits on, by its centre (the strip starts after the divider). */
  private regionOf(obj: FabricObject): Region {
    return obj.getCenterPoint().x >= this.pageW + GAP / 2 ? 'strip' : 'page';
  }

  /** The (non-serialized) seam between the two white papers: a soft warm light-shadow groove, not a hard line. */
  private addChrome(): void {
    for (const o of this.canvas.getObjects()) if (isChrome(o)) this.canvas.remove(o);
    const divider = new Rect({
      left: this.pageW,
      top: 0,
      width: GAP,
      height: this.pageH,
      selectable: false,
      evented: false,
      excludeFromExport: true,
      // A gentle recessed valley: shadow deepest at the centre, fading to fully transparent at both
      // edges so it melts into the white page on the left and the white strip on the right.
      fill: new Gradient({
        type: 'linear',
        gradientUnits: 'pixels',
        coords: { x1: 0, y1: 0, x2: GAP, y2: 0 },
        colorStops: [
          { offset: 0, color: 'rgba(116, 104, 82, 0)' },
          { offset: 0.3, color: 'rgba(96, 84, 62, 0.05)' },
          { offset: 0.5, color: 'rgba(72, 62, 44, 0.13)' },
          { offset: 0.7, color: 'rgba(96, 84, 62, 0.05)' },
          { offset: 1, color: 'rgba(116, 104, 82, 0)' },
        ],
      }),
    });
    tjMeta(divider).tjChrome = true;
    this.canvas.add(divider);
    this.canvas.sendObjectToBack(divider);
  }

  async loadEntry(canvasJson: string, coverUrl: string | null, stampJson: string): Promise<void> {
    this.restoring = true;
    const pageData = safeParse(canvasJson);
    const stripData = safeParse(stampJson);
    const page = (pageData?.tjPage as { width?: number; height?: number } | undefined) ?? DEFAULT_PAGE;
    this.pageW = Math.max(1, Math.round(page.width ?? DEFAULT_PAGE.width));
    this.pageH = Math.max(1, Math.round(page.height ?? DEFAULT_PAGE.height));

    const pageObjs = (pageData?.objects as unknown[] | undefined) ?? [];
    const stripObjs = (stripData?.objects as unknown[] | undefined) ?? [];

    this.canvas.remove(...this.canvas.getObjects());
    this.canvas.backgroundImage = undefined;
    this.canvas.backgroundColor = '#ffffff';

    const combined = [...pageObjs, ...stripObjs];
    if (combined.length > 0) {
      const objs = await util.enlivenObjects<FabricObject>(combined);
      const stripStart = pageObjs.length;
      const stripX = this.pageW + GAP;
      objs.forEach((obj, i) => {
        reattachControls(obj);
        // Invariant: a library stamp lives in the strip region. Heal any stamp that arrives at
        // page coordinates (data from before the unified canvas) so it never bleeds onto the page
        // or gets projected as an Entry annotation.
        if (i >= stripStart && this.regionOf(obj) === 'page') {
          obj.set({ left: (obj.left ?? 0) + stripX });
          obj.setCoords();
        }
        this.canvas.add(obj);
      });
    }
    if (pageObjs.length === 0 && coverUrl) {
      // Fresh page but a cover exists: materialise it as the base image.
      const img = await FabricImage.fromURL(coverUrl);
      this.placeContained(img, true);
      this.canvas.add(img);
      this.canvas.sendObjectToBack(img);
    }

    this.addChrome();
    this.fitMode = true;
    this.refreshZoom();
    this.applyTool('select');
    this.canvas.requestRenderAll();
    this.restoring = false;

    this.history = [this.serializeAll()];
    this.histIndex = 0;
    this.savedIndex = 0;
    this.emit();
  }

  private async hydrate(data: Record<string, unknown>): Promise<void> {
    const page = (data.tjPage as { width?: number; height?: number } | undefined) ?? DEFAULT_PAGE;
    await this.canvas.loadFromJSON(data);
    for (const obj of this.canvas.getObjects()) {
      reattachControls(obj);
    }
    this.canvas.backgroundImage = undefined;
    this.canvas.backgroundColor = '#ffffff';
    this.pageW = Math.max(1, Math.round(page.width ?? DEFAULT_PAGE.width));
    this.pageH = Math.max(1, Math.round(page.height ?? DEFAULT_PAGE.height));
    this.addChrome();
  }

  // ---- Zoom: the surface is a fixed size; zoom only scales the view. ----

  private refreshZoom(): void {
    if (this.fitMode) this.applyFit();
    else this.applyZoom();
  }

  private computeFitZoom(): number {
    // Leave a small margin so the fitted surface never touches the edges (no scrollbars).
    const raw = Math.min(this.availW / this.sceneW(), this.availH / this.sceneH()) * 0.98;
    return clamp(raw, MIN_ZOOM, MAX_ZOOM);
  }

  private applyFit(): void {
    this.zoom = this.computeFitZoom();
    this.applyZoom();
  }

  private applyZoom(): void {
    this.canvas.setDimensions({
      width: Math.round(this.sceneW() * this.zoom),
      height: Math.round(this.sceneH() * this.zoom),
    });
    this.canvas.setZoom(this.zoom);
    this.canvas.requestRenderAll();
    this.emitZoom();
  }

  /** Auto-scale so the whole surface fits the stage; grows with the window. */
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

  /** Insert a screenshot as a movable image object on the review page (never resizes the page). */
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
    tjMeta(obj).tjLocked = true;
    this.canvas.discardActiveObject();
    this.applyTool(this.tool);
    this.canvas.requestRenderAll();
    this.pushHistory();
  }

  /** Unlock the right-clicked object and select it again. */
  unlockContext(): void {
    const obj = this.contextTarget;
    if (!obj) return;
    tjMeta(obj).tjLocked = false;
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
      if (isChrome(obj) || isGhost(obj)) {
        obj.selectable = false;
        obj.evented = false;
        continue;
      }
      if (isLocked(obj)) {
        // Pinned: never grabbable, but still hit-tested so right-click can reach it.
        obj.selectable = false;
        obj.evented = true;
        obj.hoverCursor = 'default';
        continue;
      }
      if (this.paletteLocked && isAnnotation(obj) && this.regionOf(obj) === 'strip') {
        // A locked palette stamp is not draggable in place; pressing it pulls out a translucent copy.
        obj.selectable = false;
        obj.evented = tool === 'select';
        obj.hoverCursor = 'copy';
        continue;
      }
      obj.selectable = tool === 'select';
      obj.evented = tool === 'select';
      obj.hoverCursor = null;
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

  /**
   * Locked (default): the strip is a fixed library — a drag pulls out a translucent COPY (ghost).
   * Unlocked: the whole surface is one canvas — stamps move freely across the divider (drag a stamp
   * out onto the page = move it out of the palette; drag a drawing in = it becomes a stamp).
   * Re-run the tool so stamp selectability matches the new mode immediately.
   */
  setPaletteLocked(locked: boolean): void {
    if (this.paletteLocked === locked) return;
    this.paletteLocked = locked;
    this.applyTool(this.tool);
  }

  setStyle(patch: Partial<DrawStyle>): void {
    this.style = { ...this.style, ...patch };
    const active = this.canvas.getActiveObjects();
    for (const obj of active) this.applyStylePatch(obj, patch);
    if (active.length > 0) {
      this.canvas.requestRenderAll();
      this.pushHistory();
      if (active.some((o) => this.regionOf(o) === 'strip')) this.stripChangedCb?.();
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
    const touchedStrip = active.some((o) => this.regionOf(o) === 'strip');
    this.canvas.remove(...active);
    this.canvas.discardActiveObject();
    this.canvas.requestRenderAll();
    this.pushHistory();
    if (touchedStrip) this.stripChangedCb?.();
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

  // ---- Serialization: split the one canvas by region. ----

  private editableObjects(): FabricObject[] {
    return this.canvas.getObjects().filter((o) => !isChrome(o) && !isGhost(o));
  }

  private objectsJson(objs: FabricObject[], withPage: boolean): string {
    const data: Record<string, unknown> = { version: '6', objects: objs.map((o) => o.toObject([...TJ_PROPS])) };
    if (withPage) data.tjPage = { width: this.pageW, height: this.pageH };
    return JSON.stringify(data);
  }

  /** The review page's objects (+ page size) — the Entry's durable canvas JSON. */
  serializePage(): string {
    return this.objectsJson(
      this.editableObjects().filter((o) => this.regionOf(o) === 'page'),
      true,
    );
  }

  /** The stamp strip's objects — the global stamp library document. */
  serializeStrip(): string {
    return this.objectsJson(
      this.editableObjects().filter((o) => this.regionOf(o) === 'strip'),
      false,
    );
  }

  /** Everything editable (page + strip) — the undo/redo snapshot. */
  private serializeAll(): string {
    return this.objectsJson(this.editableObjects(), true);
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
    if (this.tool === 'select') {
      // Remember where a drag starts so a cross-region drop can copy / move / snap back.
      const t = opt.target ?? null;
      this.didMove = false;
      if (t && !isChrome(t) && isAnnotation(t) && this.paletteLocked && this.regionOf(t) === 'strip') {
        // Locked palette: dragging a stamp pulls out a translucent COPY; the original stays put.
        const p = this.canvas.getScenePoint(opt.e);
        this.startGhostDrag(t, p.x, p.y);
        this.dragHome = null;
        return;
      }
      this.dragHome =
        t && !isChrome(t) && !isLocked(t)
          ? { obj: t, left: t.left ?? 0, top: t.top ?? 0, region: this.regionOf(t) }
          : null;
      return;
    }
    if (this.tool === 'draw') return;
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
      annotation: target && isAnnotation(target) ? this.readAnnotation(target) : null,
    });
  }

  private onMove(opt: TPointerEventInfo<TPointerEvent>): void {
    if (this.ghostDrag) {
      const drag = this.ghostDrag;
      const p = this.canvas.getScenePoint(opt.e);
      drag.lastP = { x: p.x, y: p.y };
      drag.moved = true;
      if (drag.obj) {
        drag.obj.visible = true;
        drag.obj.set({ left: p.x - drag.grab.dx, top: p.y - drag.grab.dy });
        drag.obj.setCoords();
        this.canvas.requestRenderAll();
      }
      return;
    }
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
    if (this.ghostDrag) {
      this.finishGhostDrag();
      return;
    }
    if (this.dragHome && this.didMove) {
      this.handleDrop();
      this.dragHome = null;
      this.didMove = false;
    }
    if (!this.drawing) return;
    this.drawing = false;
    const draft = this.draft;
    this.draft = null;
    if (!draft) return;

    let created: FabricObject | null = null;
    if (this.tool === 'rect') {
      const rect = draft as Rect;
      if ((rect.width ?? 0) >= MIN_DRAG || (rect.height ?? 0) >= MIN_DRAG) {
        ensureAnnotation(rect);
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
      if (this.regionOf(created) === 'strip') this.stripChangedCb?.();
    } else {
      this.canvas.requestRenderAll();
    }
  }

  /**
   * Resolve a drag that just ended. Region crossings decide the outcome:
   * pulling a stamp onto the page leaves a fresh copy (the palette keeps the original); dropping a
   * page drawing into an unlocked strip turns it into a stamp; disallowed moves snap back.
   */
  private handleDrop(): void {
    const home = this.dragHome;
    if (!home || !this.canvas.getObjects().includes(home.obj)) return;
    const obj = home.obj;
    const start = home.region;
    const end = this.regionOf(obj);
    const isImg = obj instanceof FabricImage;

    if (this.paletteLocked) {
      if (end === 'strip') this.snapBack(obj, home); // locked: can't add to the palette by dragging in
    } else if (isImg && end === 'strip') {
      this.snapBack(obj, home); // screenshots can't become stamps
    }
    // Otherwise the palette is unlocked and the canvas behaves as one continuous surface: a stamp
    // dragged onto the page MOVES out of the palette, a drawing dragged into the strip becomes a
    // stamp, and a same-region drag just rearranges — all kept exactly where they were dropped.

    obj.setCoords();
    this.canvas.requestRenderAll();
    this.pushHistory();
    if (start === 'strip' || end === 'strip') this.stripChangedCb?.();
  }

  private snapBack(obj: FabricObject, home: { left: number; top: number }): void {
    obj.set({ left: home.left, top: home.top });
    obj.setCoords();
  }

  // ---- Locked-palette drag-out: a translucent copy follows the cursor; the original never moves. ----

  private startGhostDrag(source: FabricObject, px: number, py: number): void {
    const drag: GhostDrag = {
      source,
      obj: null,
      grab: { dx: px - (source.left ?? 0), dy: py - (source.top ?? 0) },
      lastP: { x: px, y: py },
      opacity: source.opacity ?? 1,
      moved: false,
    };
    this.ghostDrag = drag;
    this.canvas.discardActiveObject();
    this.canvas.selection = false; // no rubber-band marquee while a ghost is being dragged
    const serialized = source.toObject([...TJ_PROPS]) as Record<string, unknown>;
    void (async () => {
      const [g] = await util.enlivenObjects<FabricObject>([serialized]);
      if (this.ghostDrag !== drag) return; // gesture ended before the clone was ready
      reattachControls(g);
      tjMeta(g).tjGhost = true;
      g.set({ opacity: drag.opacity * 0.45, selectable: false, evented: false });
      g.visible = drag.moved; // stay hidden until the first move (no flicker on a plain click)
      g.set({ left: drag.lastP.x - drag.grab.dx, top: drag.lastP.y - drag.grab.dy });
      g.setCoords();
      drag.obj = g;
      this.canvas.add(g);
      this.canvas.requestRenderAll();
    })();
  }

  private finishGhostDrag(): void {
    const drag = this.ghostDrag;
    this.ghostDrag = null;
    this.canvas.selection = this.tool === 'select';
    if (!drag) return;
    if (drag.obj) this.canvas.remove(drag.obj);
    // Solidify only if the copy was actually dragged onto the page (the copy is built from the
    // source, not the ghost, so it works even if the async ghost never rendered).
    if (drag.moved && drag.lastP.x < this.pageW + GAP / 2) {
      void this.solidifyCopy(drag.source, drag.lastP.x - drag.grab.dx, drag.lastP.y - drag.grab.dy, drag.opacity);
    } else {
      this.canvas.requestRenderAll();
    }
  }

  /** Enliven a serialized drawing into a fresh, independent annotation (new id; optionally drop result/links). */
  private async reviveClone(
    serialized: Record<string, unknown>,
    opts: { dropResultLinks?: boolean } = {},
  ): Promise<FabricObject> {
    const [obj] = await util.enlivenObjects<FabricObject>([serialized]);
    reattachControls(obj);
    const a = tjMeta(obj);
    a.tjId = crypto.randomUUID();
    if (opts.dropResultLinks) {
      a.tjResult = undefined;
      a.tjLinks = undefined;
    }
    return obj;
  }

  /** Add a freshly-built object to the page, select it, and record one history step. */
  private placeNew(obj: FabricObject): void {
    obj.setCoords();
    this.canvas.add(obj);
    this.applyTool('select');
    this.canvas.setActiveObject(obj);
    this.canvas.requestRenderAll();
    this.pushHistory();
  }

  /** Materialise the dragged-out copy as a solid, independent page annotation (new id, no result / links). */
  private async solidifyCopy(source: FabricObject, left: number, top: number, opacity: number): Promise<void> {
    const obj = await this.reviveClone(source.toObject([...TJ_PROPS]) as Record<string, unknown>, {
      dropResultLinks: true,
    });
    obj.set({ left, top, opacity, selectable: true, evented: true });
    this.placeNew(obj);
    this.stripChangedCb?.();
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
    ensureAnnotation(seg);
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
    ensureAnnotation(tb);
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
        if (this.regionOf(target) === 'strip') this.stripChangedCb?.();
      }
    }
    this.newTextBox = null;
  }

  private pushHistory(): void {
    if (this.restoring) return;
    this.history = this.history.slice(0, this.histIndex + 1);
    this.history.push(this.serializeAll());
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

  // ---- Annotation data: any page drawing carries id + tags + result + links. ----

  /** The review-page annotations, projected for the index (screenshots and stamps are excluded). */
  extractAnnotations(): Annotation[] {
    const out: Annotation[] = [];
    for (const obj of this.canvas.getObjects()) {
      const a = tjMeta(obj);
      if (typeof a.tjId !== 'string') continue; // images (screenshots) / chrome are not annotations
      if (isGhost(obj)) continue; // a transient drag-out ghost is not an annotation
      if (this.regionOf(obj) === 'strip') continue; // strip stamps belong to the palette, not the Entry
      obj.setCoords();
      const box = obj.getBoundingRect();
      const ann: Annotation = {
        id: a.tjId,
        bounds: { x: box.left, y: box.top, width: box.width, height: box.height },
        tags: (a.tjTags ?? []).map((t) => ({ group: t.group, value: t.value })),
      };
      if (a.tjResult && Object.keys(a.tjResult).length > 0) ann.result = { ...a.tjResult };
      if (a.tjLinks && a.tjLinks.length > 0) ann.links = [...a.tjLinks];
      out.push(ann);
    }
    return out;
  }

  /** Read an annotation object's tag / result / link data (a snapshot for the popover). */
  private readAnnotation(obj: FabricObject): AnnotationSelection {
    const a = tjMeta(obj);
    return {
      id: a.tjId as string,
      tags: (a.tjTags ?? []).map((t) => ({ group: t.group, value: t.value })),
      result: { ...(a.tjResult ?? {}) },
      links: [...(a.tjLinks ?? [])],
    };
  }

  /** Select an annotation by id (following a link); false if it is not on this page. */
  selectAnnotationById(annotationId: string): boolean {
    const obj = this.canvas.getObjects().find((o) => tjMeta(o).tjId === annotationId);
    if (!obj) return false;
    this.applyTool('select');
    this.canvas.setActiveObject(obj);
    this.canvas.requestRenderAll();
    return true;
  }

  /** Commit the popover's edits onto an annotation (whole-value replace), then it can be saved. */
  applyAnnotationEdits(id: string, tags: Tag[], result: Result, links: string[]): void {
    const obj = this.canvas.getObjects().find((o) => tjMeta(o).tjId === id);
    if (!obj) return;
    const a = tjMeta(obj);
    a.tjTags = tags.map((t) => ({ group: t.group, value: t.value }));
    a.tjResult = Object.keys(result).length > 0 ? { ...result } : undefined;
    a.tjLinks = links.length > 0 ? [...links] : undefined;
    this.canvas.requestRenderAll();
    this.pushHistory();
  }

  // ---- Clipboard: Ctrl+C / Ctrl+V duplicates a drawing on the page. ----

  /** Serialize the active annotation for the internal clipboard (Ctrl+C); null if none / a screenshot. */
  copyActiveAnnotation(): Record<string, unknown> | null {
    const obj = this.canvas.getActiveObject();
    if (!obj || !isAnnotation(obj)) return null;
    return obj.toObject([...TJ_PROPS]) as Record<string, unknown>;
  }

  /** Paste a serialized drawing as an independent new annotation, offset from the original (Ctrl+V). */
  async pasteSerializedAnnotation(serialized: Record<string, unknown>): Promise<void> {
    const obj = await this.reviveClone(serialized);
    obj.set({ left: (obj.left ?? 0) + 24, top: (obj.top ?? 0) + 24 });
    this.placeNew(obj);
    if (this.regionOf(obj) === 'strip') this.stripChangedCb?.();
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

function safeParse(json: string): { objects?: unknown[]; tjPage?: unknown } | null {
  try {
    return JSON.parse(json) as { objects?: unknown[]; tjPage?: unknown };
  } catch {
    return null;
  }
}
