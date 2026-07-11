import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FabricObject } from 'fabric';
import sharp from 'sharp';
import type { Db } from '../db';
import type {
  AiAffineTransform,
  AiBarAlignmentProbe,
  AiPixelRect,
  AiPoint,
  AiProgressiveReveal,
  AiProgressiveRevealAdvanceRequest,
  AiProgressiveRevealFrame,
  AiResourceRead,
  AiResolvedBar,
  AiScreenshotInstance,
  AiUniformBarAlignment,
  AiVisualAnnotation,
  AiVisualAsset,
  AiVisualArtifactChunk,
  AiVisualArtifactChunkRequest,
  AiVisualArtifactItem,
  AiVisualArtifactKind,
  AiVisualArtifactPlan,
  AiVisualArtifactPlanRequest,
  AiVisualEvidenceManifest,
  AiVisualEvidenceQuery,
  AiVisualGeometry,
} from '../../shared/aiAccess';
import type { Bounds } from '../../shared/domain';
import type { AiReadRepository } from './readRepository';

interface EntryVisualRow {
  id: string;
  canvas_json: string;
  updated_at: number;
}

interface CanvasDocument {
  tjPage?: { width?: number; height?: number };
  objects?: unknown[];
}

interface SceneObject {
  data: Record<string, unknown>;
  matrix: AiAffineTransform;
  zIndex: number;
}

interface ScreenshotData extends AiScreenshotInstance {
  bytes: Buffer;
  mimeType: AiVisualAsset['mimeType'];
  objectWidth: number;
  objectHeight: number;
  cropX: number;
  cropY: number;
}

interface AnnotationData {
  manifest: AiVisualAnnotation;
  points: AiPoint[];
}

interface CachedAsset {
  mimeType: string;
  bytes: Buffer;
}

interface CachedBundle {
  entryId: string;
  sessionId: string;
  updatedAt: number;
  evidenceRevision: string;
  expiresAt: number;
  byteCount: number;
  assets: Map<string, CachedAsset>;
  pageWidth: number;
  pageHeight: number;
  scene: SceneObject[];
  screenshots: Array<Omit<ScreenshotData, 'bytes'>>;
  annotations: AnnotationData[];
}

interface CachedArtifactItem extends CachedAsset {
  descriptor: AiVisualArtifactItem;
}

interface CachedReveal {
  descriptor: AiProgressiveReveal;
  bars: AiResolvedBar[];
  source: Buffer;
  currentFrame: number;
  highestRevealedFrame: number;
}

interface CachedArtifactPlan {
  manifest: AiVisualArtifactPlan;
  sessionId: string;
  bundleId: string;
  expiresAt: number;
  byteCount: number;
  items: Map<string, CachedArtifactItem>;
  reveals: Map<string, CachedReveal>;
}

const BUNDLE_TTL_MS = 10 * 60 * 1000;
const MAX_BUNDLES = 20;
const MAX_ARTIFACT_PLANS = 20;
const MAX_BUNDLE_BYTES = 32 * 1024 * 1024;
const MAX_CACHE_BYTES = 128 * 1024 * 1024;
const MAX_ARTIFACT_PLAN_BYTES = 64 * 1024 * 1024;
const MAX_ARTIFACT_EXPORT_BYTES = 512 * 1024 * 1024;
const MAX_REVEAL_FRAMES = 240;
const MAX_CANVAS_BYTES = 8 * 1024 * 1024;
const MAX_RENDER_PIXELS = 8_000_000;
const OVERVIEW_MAX_WIDTH = 1800;
const GUTTER = 42;
const SOURCE_MARGIN_X = 320;
const SOURCE_MARGIN_Y = 160;
const IMAGE_HASH = /^[a-f0-9]{64}$/;
const IDENTITY: AiAffineTransform = [1, 0, 0, 1, 0, 0];

export class VisualEvidenceService {
  private readonly bundles = new Map<string, CachedBundle>();
  private readonly artifactPlans = new Map<string, CachedArtifactPlan>();

  constructor(
    private readonly database: Db,
    private readonly repository: AiReadRepository,
    private readonly imagesDir: string,
    private readonly journalInstanceId: string,
  ) {}

  async create(input: AiVisualEvidenceQuery, sessionId: string): Promise<AiVisualEvidenceManifest> {
    this.prune();
    const row = this.entryRow(input.entryId);
    if (Buffer.byteLength(row.canvas_json, 'utf8') > MAX_CANVAS_BYTES) throw new Error('Entry canvas is too large for visual evidence');
    const parsed = JSON.parse(row.canvas_json) as CanvasDocument;
    const pageWidth = finitePositive(parsed.tjPage?.width, 2900);
    const pageHeight = finitePositive(parsed.tjPage?.height, 1600);
    if (pageWidth * pageHeight > MAX_RENDER_PIXELS) throw new Error('Entry page exceeds the visual evidence pixel limit');
    const scene = flattenScene(Array.isArray(parsed.objects) ? parsed.objects : []);
    const screenshots = await this.loadScreenshots(scene);
    const context = this.repository.entryContext(input.entryId);
    const indexed = new Map(context.annotations.map((annotation) => [annotation.annotationId, annotation]));
    const requestedIds = [...new Set(input.annotationIds)];
    for (const annotationId of requestedIds) {
      if (!indexed.has(annotationId)) throw new Error(`annotation does not belong to Entry: ${annotationId}`);
    }
    const sceneByAnnotation = new Map(
      scene
        .filter((object) => typeof object.data.tjId === 'string')
        .map((object) => [object.data.tjId as string, object]),
    );
    const warnings: string[] = [];
    const annotations: AnnotationData[] = requestedIds.map((annotationId, index) => {
      const indexFact = indexed.get(annotationId)!;
      const object = sceneByAnnotation.get(annotationId);
      if (!object) {
        warnings.push(`Annotation ${annotationId} is indexed but missing from committed canvas geometry.`);
        const points = boundsPoints(indexFact.bounds);
        return {
          points,
          manifest: {
            markId: `A${index + 1}`,
            annotationId,
            indexBounds: indexFact.bounds,
            paintBounds: indexFact.bounds,
            geometry: { kind: 'unsupported', reason: 'indexed annotation missing from canvas geometry' },
            visualStyle: {},
            zIndex: -1,
            tags: indexFact.tags,
            result: indexFact.result,
            links: indexFact.links,
            text: indexFact.text,
            association: { kind: 'none', screenshotIds: [] },
          },
        };
      }
      const geometry = geometryFor(object);
      const points = geometryPoints(geometry);
      const geometrySupported = geometry.kind !== 'unsupported';
      const effectivePoints = points.length > 0 ? points : boundsPoints(indexFact.bounds);
      const strokeWidth = finite(object.data.strokeWidth, 0);
      const paintBounds = expandedBounds(pointsBounds(effectivePoints), Math.max(2, strokeWidth / 2));
      const association = geometrySupported
        ? associate(geometry, screenshots)
        : { kind: 'unsupported' as const, candidates: [] };
      return {
        points: effectivePoints,
        manifest: {
          markId: `A${index + 1}`,
          annotationId,
          indexBounds: indexFact.bounds,
          paintBounds,
          geometry,
          visualStyle: {
            stroke: stringValue(object.data.stroke) ?? stringValue(object.data.boxStroke),
            strokeWidth,
            fill: stringValue(object.data.fill) ?? stringValue(object.data.boxFill),
            opacity: finite(object.data.opacity, 1),
          },
          zIndex: object.zIndex,
          tags: indexFact.tags,
          result: indexFact.result,
          links: indexFact.links,
          text: indexFact.text,
          association: { kind: association.kind, screenshotIds: association.candidates.map((candidate) => candidate.id) },
        },
      };
    });

    const renderWidth = Math.max(1, Math.min(pageWidth, OVERVIEW_MAX_WIDTH));
    const scale = renderWidth / pageWidth;
    const renderHeight = Math.max(1, Math.round(pageHeight * scale));
    const pageToRender: AiAffineTransform = [scale, 0, 0, scale, 0, GUTTER];
    const cleanPage = await renderPage(scene, screenshots, pageWidth, pageHeight, renderWidth, renderHeight);
    const bundleId = randomUUID();
    const evidenceRevision = createHash('sha256')
      .update(row.canvas_json)
      .update(String(row.updated_at))
      .update(screenshots.map((screenshot) => screenshot.hash).join(','))
      .digest('hex');
    const expiresAt = Date.now() + BUNDLE_TTL_MS;
    const assets = new Map<string, CachedAsset>();
    const assetDescriptors: AiVisualAsset[] = [];

    const overview = await addGutter(cleanPage, renderWidth, renderHeight);
    this.addAsset(bundleId, assets, assetDescriptors, {
      id: 'overview',
      kind: 'overview',
      bytes: overview,
      width: renderWidth,
      height: renderHeight + GUTTER,
      warnings: [],
    });
    const locatorOverlay = locatorSvg(renderWidth, renderHeight + GUTTER, annotations, pageToRender);
    const locator = await sharp(overview).composite([{ input: Buffer.from(locatorOverlay), left: 0, top: 0 }]).png().toBuffer();
    this.addAsset(bundleId, assets, assetDescriptors, {
      id: 'locator',
      kind: 'locator',
      bytes: locator,
      width: renderWidth,
      height: renderHeight + GUTTER,
      warnings: ['AI locator overlay; do not use this asset for bar counting.'],
    });
    for (const annotation of annotations) {
      await this.addFocusAsset(bundleId, assets, assetDescriptors, annotation, cleanPage, scale, renderWidth, renderHeight);
      await this.addSourcePair(bundleId, assets, assetDescriptors, annotation, screenshots);
    }

    const manifest: AiVisualEvidenceManifest = {
      bundleId,
      entryId: input.entryId,
      evidenceRevision,
      page: { width: pageWidth, height: pageHeight, pageToRender },
      screenshots: screenshots.map((screenshot) => ({
        id: screenshot.id,
        hash: screenshot.hash,
        nativeWidth: screenshot.nativeWidth,
        nativeHeight: screenshot.nativeHeight,
        pageQuad: screenshot.pageQuad,
        sourceToPage: screenshot.sourceToPage,
        pageToSource: screenshot.pageToSource,
        zIndex: screenshot.zIndex,
      })),
      annotations: annotations.map((annotation) => annotation.manifest),
      assets: assetDescriptors,
      evidenceTrust: 'untrusted-journal-evidence',
      warnings,
      expiresAt: new Date(expiresAt).toISOString(),
    };
    const manifestUri = this.uri(bundleId, 'manifest');
    assets.set(manifestUri, { mimeType: 'application/json', bytes: Buffer.from(JSON.stringify(manifest)) });
    const byteCount =
      Buffer.byteLength(row.canvas_json, 'utf8') +
      [...assets.values()].reduce((total, asset) => total + asset.bytes.byteLength, 0);
    if (byteCount > MAX_BUNDLE_BYTES) throw new Error('Visual evidence bundle exceeds the encoded byte limit');
    this.bundles.set(bundleId, {
      entryId: input.entryId,
      sessionId,
      updatedAt: row.updated_at,
      evidenceRevision,
      expiresAt,
      byteCount,
      assets,
      pageWidth,
      pageHeight,
      scene,
      screenshots: screenshots.map((screenshot) => ({
        id: screenshot.id,
        hash: screenshot.hash,
        nativeWidth: screenshot.nativeWidth,
        nativeHeight: screenshot.nativeHeight,
        pageQuad: screenshot.pageQuad,
        sourceToPage: screenshot.sourceToPage,
        pageToSource: screenshot.pageToSource,
        zIndex: screenshot.zIndex,
        mimeType: screenshot.mimeType,
        objectWidth: screenshot.objectWidth,
        objectHeight: screenshot.objectHeight,
        cropX: screenshot.cropX,
        cropY: screenshot.cropY,
      })),
      annotations,
    });
    this.enforceBundleLimit();
    return manifest;
  }

  async createArtifacts(input: AiVisualArtifactPlanRequest, sessionId: string): Promise<AiVisualArtifactPlan> {
    this.prune();
    const bundle = this.requireBundle(input.bundleId, sessionId);
    const planId = randomUUID();
    const planHash = createHash('sha256')
      .update(JSON.stringify({ bundleId: input.bundleId, evidenceRevision: bundle.evidenceRevision, specs: input.specs }))
      .digest('hex');
    const expiresAt = Math.min(bundle.expiresAt, Date.now() + BUNDLE_TTL_MS);
    const items = new Map<string, CachedArtifactItem>();
    const descriptors: AiVisualArtifactItem[] = [];
    const probes: AiBarAlignmentProbe[] = [];
    const reveals = new Map<string, CachedReveal>();
    const revealDescriptors: AiProgressiveReveal[] = [];
    let itemNumber = 0;
    let hydrated: ScreenshotData[] | undefined;
    const screenshots = async (): Promise<ScreenshotData[]> => {
      hydrated ??= await this.hydrateScreenshots(bundle);
      return hydrated;
    };
    const addItem = (
      kind: AiVisualArtifactKind,
      bytes: Buffer,
      mimeType: AiVisualArtifactItem['mimeType'],
      width: number,
      height: number,
      details: Partial<Pick<AiVisualArtifactItem, 'screenshotId' | 'annotationId' | 'sourceRoi' | 'pageRoi'>>,
      warnings: string[] = [],
    ): string => {
      itemNumber += 1;
      const id = `I${String(itemNumber).padStart(3, '0')}`;
      const extension = mimeExtension(mimeType);
      const uri = this.artifactUri(planId, id);
      const descriptor: AiVisualArtifactItem = {
        id,
        kind,
        uri,
        mimeType,
        filename: `${id}-${kind}.${extension}`,
        width,
        height,
        byteCount: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        ...details,
        derived: kind !== 'source-original',
        evidenceTrust: 'untrusted-journal-evidence',
        warnings,
      };
      descriptors.push(descriptor);
      items.set(uri, { mimeType, bytes, descriptor });
      return id;
    };

    for (const spec of input.specs) {
      if (spec.kind === 'source-original') {
        const screenshot = screenshotById(await screenshots(), spec.screenshotId);
        addItem(
          spec.kind,
          screenshot.bytes,
          screenshot.mimeType,
          screenshot.nativeWidth,
          screenshot.nativeHeight,
          { screenshotId: screenshot.id, sourceRoi: { x: 0, y: 0, width: screenshot.nativeWidth, height: screenshot.nativeHeight } },
        );
        continue;
      }
      if (spec.kind === 'instance-source-window') {
        const screenshot = screenshotById(await screenshots(), spec.screenshotId);
        const roi = sourceWindowRect(screenshot);
        const bytes = await extractPng(screenshot.bytes, roi);
        addItem(spec.kind, bytes, 'image/png', roi.width, roi.height, { screenshotId: screenshot.id, sourceRoi: roi });
        continue;
      }
      if (spec.kind === 'source-region') {
        const screenshot = screenshotById(await screenshots(), spec.screenshotId);
        const roi = strictPixelRect(spec.roi, screenshot.nativeWidth, screenshot.nativeHeight, 'source ROI');
        const bytes = await extractPng(screenshot.bytes, roi);
        addItem(spec.kind, bytes, 'image/png', roi.width, roi.height, { screenshotId: screenshot.id, sourceRoi: roi });
        continue;
      }
      if (spec.kind === 'page-region') {
        const roi = strictPixelRect(spec.roi, bundle.pageWidth, bundle.pageHeight, 'page ROI');
        const pageScene =
          spec.composition === 'committed-page'
            ? bundle.scene
            : bundle.scene.filter((object) => stringValue(object.data.src)?.startsWith('tj-image://'));
        const page = await renderPage(
          pageScene,
          await screenshots(),
          bundle.pageWidth,
          bundle.pageHeight,
          bundle.pageWidth,
          bundle.pageHeight,
        );
        const bytes = await extractPng(page, roi);
        addItem(
          spec.kind,
          bytes,
          'image/png',
          roi.width,
          roi.height,
          { pageRoi: roi },
          spec.composition === 'clean-underlay'
            ? ['Derived page underlay with journal annotations removed; do not treat it as the user-visible composition.']
            : [],
        );
        continue;
      }
      if (spec.kind === 'annotation-context') {
        const annotation = annotationById(bundle.annotations, spec.annotationId);
        if (spec.composition === 'committed-page') {
          const { roi, clipped } = contextRect(
            annotation.manifest.paintBounds,
            spec.contextPx,
            bundle.pageWidth,
            bundle.pageHeight,
          );
          const page = await renderPage(
            bundle.scene,
            await screenshots(),
            bundle.pageWidth,
            bundle.pageHeight,
            bundle.pageWidth,
            bundle.pageHeight,
          );
          const bytes = await extractPng(page, roi);
          addItem(spec.kind, bytes, 'image/png', roi.width, roi.height, { annotationId: spec.annotationId, pageRoi: roi }, clipped ? ['Context is clipped by the page edge.'] : []);
          continue;
        }
        if (annotation.manifest.association.kind !== 'unique') {
          throw new Error('annotation source context requires one unambiguous screenshot instance');
        }
        const screenshot = screenshotById(await screenshots(), annotation.manifest.association.screenshotIds[0]);
        if (!screenshot.pageToSource) throw new Error('annotation source transform is unavailable');
        const sourcePoints = annotation.points.map((point) => transform(point, screenshot.pageToSource!));
        const visible = { x: screenshot.cropX, y: screenshot.cropY, width: screenshot.objectWidth, height: screenshot.objectHeight };
        if (!sourcePoints.every((point) => pointInBounds(point, visible))) {
          throw new Error('annotation geometry is clipped by the screenshot source window');
        }
        const { roi, clipped } = contextRect(
          pointsBounds(sourcePoints),
          spec.contextPx,
          screenshot.nativeWidth,
          screenshot.nativeHeight,
        );
        const bytes = await extractPng(screenshot.bytes, roi);
        addItem(spec.kind, bytes, 'image/png', roi.width, roi.height, { annotationId: spec.annotationId, screenshotId: screenshot.id, sourceRoi: roi }, clipped ? ['Context is clipped by the source image edge.'] : []);
        continue;
      }
      if (spec.kind === 'bar-alignment-probe') {
        const screenshot = screenshotById(await screenshots(), spec.screenshotId);
        const roi = strictPixelRect(spec.roi, screenshot.nativeWidth, screenshot.nativeHeight, 'bar probe ROI');
        const resolvedBars = resolveUniformBars(roi, spec.proposal);
        const proposalHash = createHash('sha256')
          .update(JSON.stringify({ evidenceRevision: bundle.evidenceRevision, screenshotId: screenshot.id, roi, proposal: spec.proposal, resolvedBars }))
          .digest('hex');
        const probeId = randomUUID();
        const probeAssets = await createProbeAssets(screenshot.bytes, roi, resolvedBars);
        const assetIds = probeAssets.map((asset) =>
          addItem(asset.kind, asset.bytes, 'image/png', asset.width, asset.height, { screenshotId: screenshot.id, sourceRoi: asset.roi }),
        );
        probes.push({
          probeId,
          proposalHash,
          screenshotId: screenshot.id,
          roi,
          proposal: spec.proposal,
          resolvedBars,
          assetIds,
          calibrationExposedFuture: true,
          warnings: [
            'This proposal was supplied by an agent or user; Trading Journal did not detect or verify candles.',
            'Calibration exposes future pixels and cannot itself be treated as a blind replay.',
          ],
        });
        continue;
      }
      if (spec.kind === 'bar-reveal') {
        const accepted = this.findProbe(spec.acceptedProbeId, spec.acceptedProposalHash, input.bundleId, sessionId);
        if (spec.fromBar > spec.toBar) throw new Error('bar reveal fromBar must not follow toBar');
        const bars = accepted.probe.resolvedBars.filter((bar) => bar.bar >= spec.fromBar && bar.bar <= spec.toBar);
        if (bars.length === 0 || bars[0].bar !== spec.fromBar || bars.at(-1)?.bar !== spec.toBar) {
          throw new Error('bar reveal range must match resolved probe bars');
        }
        if (bars.length > MAX_REVEAL_FRAMES) throw new Error('bar reveal exceeds the 240-frame limit');
        const screenshot = screenshotById(await screenshots(), accepted.probe.screenshotId);
        const source = await extractPng(screenshot.bytes, accepted.probe.roi);
        const revealId = randomUUID();
        const descriptor: AiProgressiveReveal = {
          revealId,
          probeId: accepted.probe.probeId,
          screenshotId: screenshot.id,
          roi: accepted.probe.roi,
          fromBar: spec.fromBar,
          toBar: spec.toBar,
          frameCount: bars.length,
          calibrationExposedFuture: true,
          warnings: [
            'Progressive reveal masks future pixels in a static screenshot; it is not chart replay.',
            'Indicators, drawings, labels, or outcome marks already present on revealed pixels may still leak future information.',
          ],
        };
        revealDescriptors.push(descriptor);
        reveals.set(revealId, { descriptor, bars, source, currentFrame: -1, highestRevealedFrame: -1 });
      }
    }

    const itemBytes = [...items.values()].reduce((total, item) => total + item.bytes.byteLength, 0);
    const revealEstimate = [...reveals.values()].reduce(
      (total, reveal) => total + reveal.source.byteLength * reveal.descriptor.frameCount,
      0,
    );
    const estimatedByteCount = itemBytes + revealEstimate;
    const estimatedFileCount = descriptors.length + revealDescriptors.reduce((total, reveal) => total + reveal.frameCount, 0) + 2;
    if (estimatedFileCount > 512 || estimatedByteCount > MAX_ARTIFACT_EXPORT_BYTES) {
      throw new Error('visual artifact plan exceeds the export file or byte limit');
    }
    const memoryBytes = itemBytes + [...reveals.values()].reduce((total, reveal) => total + reveal.source.byteLength, 0);
    if (memoryBytes > MAX_ARTIFACT_PLAN_BYTES) throw new Error('visual artifact plan exceeds the in-memory byte limit');
    const manifest: AiVisualArtifactPlan = {
      planId,
      planHash,
      bundleId: input.bundleId,
      entryId: bundle.entryId,
      evidenceRevision: bundle.evidenceRevision,
      items: descriptors,
      probes,
      reveals: revealDescriptors,
      estimatedFileCount,
      estimatedByteCount,
      evidenceTrust: 'untrusted-journal-evidence',
      warnings: [],
      expiresAt: new Date(expiresAt).toISOString(),
    };
    this.artifactPlans.set(planId, {
      manifest,
      sessionId,
      bundleId: input.bundleId,
      expiresAt,
      byteCount: memoryBytes,
      items,
      reveals,
    });
    this.enforceArtifactPlanLimit();
    return manifest;
  }

  async advanceReveal(input: AiProgressiveRevealAdvanceRequest, sessionId: string): Promise<AiProgressiveRevealFrame> {
    this.prune();
    const plan = this.requireArtifactPlan(input.planId, sessionId);
    if (plan.manifest.planHash !== input.planHash) throw new Error('visual artifact plan hash does not match');
    const reveal = plan.reveals.get(input.revealId);
    if (!reveal) throw new Error('progressive reveal not found in this plan');
    if (input.action === 'start') {
      reveal.currentFrame = 0;
      reveal.highestRevealedFrame = Math.max(0, reveal.highestRevealedFrame);
    } else if (input.action === 'next') {
      if (reveal.currentFrame < 0) throw new Error('start the progressive reveal before advancing it');
      if (reveal.currentFrame + 1 >= reveal.bars.length) throw new Error('progressive reveal is already at the final frame');
      reveal.currentFrame += 1;
      reveal.highestRevealedFrame = Math.max(reveal.highestRevealedFrame, reveal.currentFrame);
    } else if (input.action === 'previous') {
      if (reveal.currentFrame <= 0) throw new Error('progressive reveal has no previous frame');
      reveal.currentFrame -= 1;
    } else {
      if (input.frameIndex === undefined) throw new Error('seek requires frameIndex');
      if (input.frameIndex < 0 || input.frameIndex > reveal.highestRevealedFrame) {
        throw new Error('seek cannot expose a frame beyond the highest revealed frame');
      }
      reveal.currentFrame = input.frameIndex;
    }
    const bar = reveal.bars[reveal.currentFrame];
    const localCutoff = clamp(Math.round(bar.cutoffX - reveal.descriptor.roi.x), 0, reveal.descriptor.roi.width);
    const bytes = await maskFuturePixels(reveal.source, reveal.descriptor.roi.width, reveal.descriptor.roi.height, localCutoff);
    const itemId = `${reveal.descriptor.revealId}-F${String(reveal.currentFrame + 1).padStart(3, '0')}`;
    const uri = this.artifactUri(plan.manifest.planId, itemId);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const item: AiVisualArtifactItem = {
      id: itemId,
      kind: 'bar-reveal-frame',
      uri,
      mimeType: 'image/png',
      filename: `bar-reveal-${String(reveal.currentFrame + 1).padStart(3, '0')}-bar-${bar.bar}.png`,
      width: reveal.descriptor.roi.width,
      height: reveal.descriptor.roi.height,
      byteCount: bytes.byteLength,
      sha256,
      screenshotId: reveal.descriptor.screenshotId,
      sourceRoi: reveal.descriptor.roi,
      derived: true,
      evidenceTrust: 'untrusted-journal-evidence',
      warnings: reveal.descriptor.warnings,
    };
    const existing = plan.items.get(uri);
    const nextPlanBytes = plan.byteCount - (existing?.bytes.byteLength ?? 0) + bytes.byteLength;
    if (nextPlanBytes > MAX_ARTIFACT_PLAN_BYTES) throw new Error('revealed frames exceed the in-memory artifact plan limit');
    plan.byteCount = nextPlanBytes;
    plan.items.set(uri, { mimeType: 'image/png', bytes, descriptor: item });
    return {
      revealId: reveal.descriptor.revealId,
      frameIndex: reveal.currentFrame,
      highestRevealedFrame: reveal.highestRevealedFrame,
      frameCount: reveal.bars.length,
      bar: bar.bar,
      centerX: bar.centerX,
      cutoffX: bar.cutoffX,
      width: reveal.descriptor.roi.width,
      height: reveal.descriptor.roi.height,
      mimeType: 'image/png',
      byteCount: bytes.byteLength,
      sha256,
      item,
      blob: bytes.toString('base64'),
      evidenceTrust: 'untrusted-journal-evidence',
      warnings: reveal.descriptor.warnings,
    };
  }

  readArtifactChunk(input: AiVisualArtifactChunkRequest, sessionId: string): AiVisualArtifactChunk {
    this.prune();
    const plan = this.requireArtifactPlan(input.planId, sessionId);
    if (plan.manifest.planHash !== input.planHash) throw new Error('visual artifact plan hash does not match');
    const item = [...plan.items.values()].find((candidate) => candidate.descriptor.id === input.itemId);
    if (!item) throw new Error('visual artifact item not found or not yet revealed');
    if (!Number.isInteger(input.offset) || input.offset < 0 || input.offset >= item.bytes.byteLength) {
      throw new Error('visual artifact chunk offset is outside the item');
    }
    if (!Number.isInteger(input.maxBytes) || input.maxBytes < 1 || input.maxBytes > 786_432) {
      throw new Error('visual artifact chunk maxBytes must be between 1 and 786432');
    }
    const end = Math.min(item.bytes.byteLength, input.offset + input.maxBytes);
    const bytes = item.bytes.subarray(input.offset, end);
    return {
      planId: input.planId,
      itemId: item.descriptor.id,
      filename: item.descriptor.filename,
      mimeType: item.descriptor.mimeType,
      encoding: 'base64',
      offset: input.offset,
      byteCount: bytes.byteLength,
      totalByteCount: item.bytes.byteLength,
      ...(end < item.bytes.byteLength ? { nextOffset: end } : {}),
      sha256: item.descriptor.sha256,
      data: bytes.toString('base64'),
    };
  }

  read(uri: string, sessionId: string): AiResourceRead {
    this.prune();
    const artifactPlanId = artifactPlanIdFromUri(uri);
    if (artifactPlanId) {
      const plan = this.requireArtifactPlan(artifactPlanId, sessionId);
      const item = plan.items.get(uri);
      if (!item) throw new Error('visual artifact resource not found');
      return { uri, mimeType: item.mimeType, blob: item.bytes.toString('base64') };
    }
    const bundleId = bundleIdFromUri(uri);
    const bundle = bundleId ? this.bundles.get(bundleId) : undefined;
    if (!bundleId || !bundle) throw new Error('visual evidence bundle expired or was evicted');
    if (bundle.sessionId !== sessionId) throw new Error('visual evidence bundle does not belong to this session');
    const current = this.database.prepare('SELECT updated_at FROM entries WHERE id = ?').get(bundle.entryId) as
      | { updated_at: number }
      | undefined;
    if (!current || current.updated_at !== bundle.updatedAt) {
      this.bundles.delete(bundleId);
      throw new Error('visual evidence bundle expired because the Entry changed');
    }
    const asset = bundle.assets.get(uri);
    if (!asset) throw new Error('visual evidence resource not found');
    if (asset.mimeType === 'application/json') return { uri, mimeType: asset.mimeType, text: asset.bytes.toString('utf8') };
    return { uri, mimeType: asset.mimeType, blob: asset.bytes.toString('base64') };
  }

  clear(): void {
    this.bundles.clear();
    this.artifactPlans.clear();
  }

  clearSession(sessionId: string): void {
    for (const [bundleId, bundle] of this.bundles) {
      if (bundle.sessionId === sessionId) this.bundles.delete(bundleId);
    }
    for (const [planId, plan] of this.artifactPlans) {
      if (plan.sessionId === sessionId) this.artifactPlans.delete(planId);
    }
  }

  private requireBundle(bundleId: string, sessionId: string): CachedBundle {
    const bundle = this.bundles.get(bundleId);
    if (!bundle || bundle.expiresAt <= Date.now()) throw new Error('visual evidence bundle expired or was evicted');
    if (bundle.sessionId !== sessionId) throw new Error('visual evidence bundle does not belong to this session');
    const current = this.database.prepare('SELECT updated_at FROM entries WHERE id = ?').get(bundle.entryId) as
      | { updated_at: number }
      | undefined;
    if (!current || current.updated_at !== bundle.updatedAt) {
      this.bundles.delete(bundleId);
      for (const [planId, plan] of this.artifactPlans) {
        if (plan.bundleId === bundleId) this.artifactPlans.delete(planId);
      }
      throw new Error('visual evidence bundle expired because the Entry changed');
    }
    return bundle;
  }

  private requireArtifactPlan(planId: string, sessionId: string): CachedArtifactPlan {
    const plan = this.artifactPlans.get(planId);
    if (!plan || plan.expiresAt <= Date.now()) throw new Error('visual artifact plan expired or was evicted');
    if (plan.sessionId !== sessionId) throw new Error('visual artifact plan does not belong to this session');
    this.requireBundle(plan.bundleId, sessionId);
    return plan;
  }

  private async hydrateScreenshots(bundle: CachedBundle): Promise<ScreenshotData[]> {
    return Promise.all(
      bundle.screenshots.map(async (screenshot) => {
        const bytes = readFileSync(join(this.imagesDir, screenshot.hash));
        const metadata = await sharp(bytes).metadata();
        if (metadata.width !== screenshot.nativeWidth || metadata.height !== screenshot.nativeHeight) {
          throw new Error('screenshot bytes no longer match the evidence bundle');
        }
        return { ...screenshot, bytes };
      }),
    );
  }

  private findProbe(
    probeId: string,
    proposalHash: string,
    bundleId: string,
    sessionId: string,
  ): { probe: AiBarAlignmentProbe; plan: CachedArtifactPlan } {
    for (const plan of this.artifactPlans.values()) {
      if (plan.sessionId !== sessionId || plan.bundleId !== bundleId) continue;
      const probe = plan.manifest.probes.find((candidate) => candidate.probeId === probeId);
      if (!probe) continue;
      if (probe.proposalHash !== proposalHash) throw new Error('bar alignment proposal hash does not match');
      this.requireArtifactPlan(plan.manifest.planId, sessionId);
      return { probe, plan };
    }
    throw new Error('bar alignment probe expired or does not belong to this bundle');
  }

  private async loadScreenshots(scene: SceneObject[]): Promise<ScreenshotData[]> {
    const screenshots: ScreenshotData[] = [];
    for (const object of scene) {
      const src = stringValue(object.data.src);
      if (!src?.startsWith('tj-image://')) continue;
      const hash = src.slice('tj-image://'.length).replace(/^\/+/, '').split(/[/?#]/, 1)[0];
      if (!IMAGE_HASH.test(hash)) throw new Error('Entry contains an invalid image reference');
      const bytes = readFileSync(join(this.imagesDir, hash));
      const metadata = await sharp(bytes).metadata();
      if (!metadata.width || !metadata.height) throw new Error(`Could not read image dimensions: ${hash}`);
      const objectWidth = finitePositive(object.data.width, metadata.width);
      const objectHeight = finitePositive(object.data.height, metadata.height);
      const cropX = finite(object.data.cropX, 0);
      const cropY = finite(object.data.cropY, 0);
      const sourceToLocal: AiAffineTransform = [1, 0, 0, 1, -cropX - objectWidth / 2, -cropY - objectHeight / 2];
      const sourceToPage = multiply(object.matrix, sourceToLocal);
      const hasUnsupportedVisualTransform = object.data.clipPath !== undefined ||
        (Array.isArray(object.data.filters) && object.data.filters.length > 0);
      const pageToSource = hasUnsupportedVisualTransform ? undefined : invert(sourceToPage);
      screenshots.push({
        id: `S${screenshots.length + 1}`,
        hash,
        nativeWidth: metadata.width,
        nativeHeight: metadata.height,
        pageQuad: [
          transform({ x: cropX, y: cropY }, sourceToPage),
          transform({ x: cropX + objectWidth, y: cropY }, sourceToPage),
          transform({ x: cropX + objectWidth, y: cropY + objectHeight }, sourceToPage),
          transform({ x: cropX, y: cropY + objectHeight }, sourceToPage),
        ],
        sourceToPage,
        pageToSource,
        zIndex: object.zIndex,
        bytes,
        mimeType: sharpMime(metadata.format),
        objectWidth,
        objectHeight,
        cropX,
        cropY,
      });
    }
    return screenshots;
  }

  private async addFocusAsset(
    bundleId: string,
    assets: Map<string, CachedAsset>,
    descriptors: AiVisualAsset[],
    annotation: AnnotationData,
    cleanPage: Buffer,
    scale: number,
    renderWidth: number,
    renderHeight: number,
  ): Promise<void> {
    const bounds = expandedBounds(annotation.manifest.paintBounds, 100);
    const left = clamp(Math.floor(bounds.x * scale), 0, renderWidth - 1);
    const top = clamp(Math.floor(bounds.y * scale), 0, renderHeight - 1);
    const right = clamp(Math.ceil((bounds.x + bounds.width) * scale), left + 1, renderWidth);
    const bottom = clamp(Math.ceil((bounds.y + bounds.height) * scale), top + 1, renderHeight);
    const width = right - left;
    const height = bottom - top;
    const crop = await sharp(cleanPage).extract({ left, top, width, height }).png().toBuffer();
    const frame = await addGutter(crop, width, height);
    const center = {
      x: (annotation.manifest.paintBounds.x + annotation.manifest.paintBounds.width / 2) * scale - left,
      y: (annotation.manifest.paintBounds.y + annotation.manifest.paintBounds.height / 2) * scale - top + GUTTER,
    };
    const marked = await sharp(frame)
      .composite([{ input: Buffer.from(singleMarkSvg(width, height + GUTTER, annotation.manifest.markId, center)), left: 0, top: 0 }])
      .png()
      .toBuffer();
    this.addAsset(bundleId, assets, descriptors, {
      id: `${annotation.manifest.markId}-focus`,
      kind: 'focus',
      bytes: marked,
      width,
      height: height + GUTTER,
      annotation: annotation.manifest,
      warnings: [],
    });
  }

  private async addSourcePair(
    bundleId: string,
    assets: Map<string, CachedAsset>,
    descriptors: AiVisualAsset[],
    annotation: AnnotationData,
    screenshots: ScreenshotData[],
  ): Promise<void> {
    if (annotation.manifest.association.kind !== 'unique') return;
    const screenshot = screenshots.find((candidate) => candidate.id === annotation.manifest.association.screenshotIds[0]);
    if (!screenshot?.pageToSource) return;
    const sourcePoints = annotation.points.map((point) => transform(point, screenshot.pageToSource!));
    const visible = { x: screenshot.cropX, y: screenshot.cropY, width: screenshot.objectWidth, height: screenshot.objectHeight };
    if (!sourcePoints.every((point) => pointInBounds(point, visible))) return;
    const target = pointsBounds(sourcePoints);
    const left = clamp(Math.floor(target.x - SOURCE_MARGIN_X), 0, screenshot.nativeWidth - 1);
    const top = clamp(Math.floor(target.y - SOURCE_MARGIN_Y), 0, screenshot.nativeHeight - 1);
    const right = clamp(Math.ceil(target.x + target.width + SOURCE_MARGIN_X), left + 1, screenshot.nativeWidth);
    const bottom = clamp(Math.ceil(target.y + target.height + SOURCE_MARGIN_Y), top + 1, screenshot.nativeHeight);
    const width = right - left;
    const height = bottom - top;
    if (width * (height + GUTTER) > MAX_RENDER_PIXELS) return;
    const rawCrop = await sharp(screenshot.bytes).extract({ left, top, width, height }).png().toBuffer();
    const clean = await addGutter(rawCrop, width, height);
    const sourceToFrame = multiply([1, 0, 0, 1, -left, GUTTER - top], screenshot.pageToSource);
    const center = { x: target.x + target.width / 2 - left, y: target.y + target.height / 2 - top + GUTTER };
    const locatorSvgText = svgDocument(
      width,
      height + GUTTER,
      `${geometryToSvg(annotation.manifest.geometry, sourceToFrame, '#c026a3', 2)}${markLeader(annotation.manifest.markId, center, 12)}`,
    );
    const locator = await sharp(clean).composite([{ input: Buffer.from(locatorSvgText), left: 0, top: 0 }]).png().toBuffer();
    const cleanId = `${annotation.manifest.markId}-source-clean`;
    const locatorId = `${annotation.manifest.markId}-source-locator`;
    this.addAsset(bundleId, assets, descriptors, {
      id: locatorId,
      kind: 'source-locator',
      bytes: locator,
      width,
      height: height + GUTTER,
      annotation: annotation.manifest,
      pairedAssetId: cleanId,
      warnings: ['Derived locator overlay on decoded native screenshot pixels.'],
    });
    this.addAsset(bundleId, assets, descriptors, {
      id: cleanId,
      kind: 'source-clean',
      bytes: clean,
      width,
      height: height + GUTTER,
      annotation: annotation.manifest,
      pairedAssetId: locatorId,
      warnings:
        left === 0 || top === 0 || right === screenshot.nativeWidth || bottom === screenshot.nativeHeight
          ? ['Context margin is clipped by the source image edge.']
          : [],
    });
  }

  private addAsset(
    bundleId: string,
    assets: Map<string, CachedAsset>,
    descriptors: AiVisualAsset[],
    input: {
      id: string;
      kind: AiVisualAsset['kind'];
      bytes: Buffer;
      width: number;
      height: number;
      annotation?: AiVisualAnnotation;
      pairedAssetId?: string;
      warnings: string[];
    },
  ): void {
    const uri = this.uri(bundleId, input.id);
    assets.set(uri, { mimeType: 'image/png', bytes: input.bytes });
    descriptors.push({
      id: input.id,
      kind: input.kind,
      uri,
      mimeType: 'image/png',
      width: input.width,
      height: input.height,
      annotationId: input.annotation?.annotationId,
      markId: input.annotation?.markId,
      pairedAssetId: input.pairedAssetId,
      derived: true,
      evidenceTrust: 'untrusted-journal-evidence',
      warnings: input.warnings,
    });
  }

  private uri(bundleId: string, assetId: string): string {
    return `trading-journal://journal/${this.journalInstanceId}/evidence/${bundleId}/${assetId}`;
  }

  private artifactUri(planId: string, itemId: string): string {
    return `trading-journal://journal/${this.journalInstanceId}/artifacts/${planId}/${itemId}`;
  }

  private entryRow(entryId: string): EntryVisualRow {
    const row = this.database
      .prepare('SELECT id, canvas_json, updated_at FROM entries WHERE id = ?')
      .get(entryId) as EntryVisualRow | undefined;
    if (!row) throw new Error(`entry not found: ${entryId}`);
    return row;
  }

  private prune(): void {
    const now = Date.now();
    for (const [bundleId, bundle] of this.bundles) if (bundle.expiresAt <= now) this.bundles.delete(bundleId);
    for (const [planId, plan] of this.artifactPlans) {
      if (plan.expiresAt <= now || !this.bundles.has(plan.bundleId)) this.artifactPlans.delete(planId);
    }
  }

  private enforceBundleLimit(): void {
    const totalBytes = (): number =>
      [...this.bundles.values()].reduce((total, bundle) => total + bundle.byteCount, 0);
    while (this.bundles.size > MAX_BUNDLES || totalBytes() > MAX_CACHE_BYTES) {
      const oldest = this.bundles.keys().next().value as string | undefined;
      if (!oldest) return;
      this.bundles.delete(oldest);
    }
  }

  private enforceArtifactPlanLimit(): void {
    const totalBytes = (): number =>
      [...this.artifactPlans.values()].reduce((total, plan) => total + plan.byteCount, 0);
    while (this.artifactPlans.size > MAX_ARTIFACT_PLANS || totalBytes() > MAX_CACHE_BYTES) {
      const oldest = this.artifactPlans.keys().next().value as string | undefined;
      if (!oldest) return;
      this.artifactPlans.delete(oldest);
    }
  }
}

interface ProbeAssetBuild {
  kind: Extract<
    AiVisualArtifactKind,
    'bar-probe-clean' | 'bar-probe-locator' | 'bar-probe-magnifier-clean' | 'bar-probe-magnifier-locator'
  >;
  bytes: Buffer;
  width: number;
  height: number;
  roi: AiPixelRect;
}

function screenshotById(screenshots: ScreenshotData[], screenshotId: string): ScreenshotData {
  const screenshot = screenshots.find((candidate) => candidate.id === screenshotId);
  if (!screenshot) throw new Error('screenshot instance does not belong to this evidence bundle');
  return screenshot;
}

function annotationById(annotations: AnnotationData[], annotationId: string): AnnotationData {
  const annotation = annotations.find((candidate) => candidate.manifest.annotationId === annotationId);
  if (!annotation) throw new Error('annotation was not selected into this evidence bundle');
  return annotation;
}

function strictPixelRect(raw: AiPixelRect, maxWidth: number, maxHeight: number, label: string): AiPixelRect {
  if (![raw.x, raw.y, raw.width, raw.height].every(Number.isInteger)) throw new Error(`${label} must use integer pixels`);
  if (raw.x < 0 || raw.y < 0 || raw.width < 1 || raw.height < 1) throw new Error(`${label} is invalid`);
  if (raw.x + raw.width > maxWidth || raw.y + raw.height > maxHeight) {
    throw new Error(`${label} must be fully inside its declared pixel space`);
  }
  return { ...raw };
}

function sourceWindowRect(screenshot: ScreenshotData): AiPixelRect {
  const left = Math.floor(screenshot.cropX);
  const top = Math.floor(screenshot.cropY);
  const right = Math.ceil(screenshot.cropX + screenshot.objectWidth);
  const bottom = Math.ceil(screenshot.cropY + screenshot.objectHeight);
  return strictPixelRect(
    { x: left, y: top, width: right - left, height: bottom - top },
    screenshot.nativeWidth,
    screenshot.nativeHeight,
    'screenshot instance source window',
  );
}

function contextRect(
  bounds: Bounds,
  contextPx: number,
  maxWidth: number,
  maxHeight: number,
): { roi: AiPixelRect; clipped: boolean } {
  const requested = {
    left: Math.floor(bounds.x - contextPx),
    top: Math.floor(bounds.y - contextPx),
    right: Math.ceil(bounds.x + bounds.width + contextPx),
    bottom: Math.ceil(bounds.y + bounds.height + contextPx),
  };
  const left = clamp(requested.left, 0, maxWidth - 1);
  const top = clamp(requested.top, 0, maxHeight - 1);
  const right = clamp(requested.right, left + 1, maxWidth);
  const bottom = clamp(requested.bottom, top + 1, maxHeight);
  return {
    roi: { x: left, y: top, width: right - left, height: bottom - top },
    clipped: left !== requested.left || top !== requested.top || right !== requested.right || bottom !== requested.bottom,
  };
}

async function extractPng(bytes: Buffer, roi: AiPixelRect): Promise<Buffer> {
  return sharp(bytes).extract({ left: roi.x, top: roi.y, width: roi.width, height: roi.height }).png().toBuffer();
}

function resolveUniformBars(roi: AiPixelRect, proposal: AiUniformBarAlignment): AiResolvedBar[] {
  if (proposal.direction !== 'left-to-right') throw new Error('only left-to-right bar alignment is supported');
  if (!Number.isInteger(proposal.anchorBar) || proposal.anchorBar < 0) throw new Error('anchorBar must be a non-negative integer');
  if (!Number.isFinite(proposal.anchorCenterX)) throw new Error('anchorCenterX must be finite');
  if (!Number.isFinite(proposal.spacingPx) || proposal.spacingPx < 2) throw new Error('spacingPx must be at least 2 pixels');
  const firstOffset = Math.ceil((roi.x - proposal.anchorCenterX) / proposal.spacingPx);
  const lastOffset = Math.floor((roi.x + roi.width - Number.EPSILON - proposal.anchorCenterX) / proposal.spacingPx);
  if (proposal.anchorBar + firstOffset < 0) throw new Error('alignment resolves to a negative bar index; increase anchorBar');
  const bars: AiResolvedBar[] = [];
  for (let offset = firstOffset; offset <= lastOffset; offset += 1) {
    const centerX = proposal.anchorCenterX + offset * proposal.spacingPx;
    const nextCenterX = centerX + proposal.spacingPx;
    bars.push({
      bar: proposal.anchorBar + offset,
      centerX,
      cutoffX: Math.min(roi.x + roi.width, (centerX + nextCenterX) / 2),
    });
  }
  if (bars.length < 3) throw new Error('bar alignment probe must resolve at least 3 bars inside the ROI');
  if (bars.length > MAX_REVEAL_FRAMES) throw new Error('bar alignment probe exceeds the 240-bar limit');
  bars.at(-1)!.cutoffX = roi.x + roi.width;
  return bars;
}

async function createProbeAssets(source: Buffer, roi: AiPixelRect, bars: AiResolvedBar[]): Promise<ProbeAssetBuild[]> {
  const assets: ProbeAssetBuild[] = [];
  const clean = await extractPng(source, roi);
  assets.push({ kind: 'bar-probe-clean', bytes: clean, width: roi.width, height: roi.height, roi });
  const locator = await overlayBarGuides(clean, roi, bars);
  assets.push({ kind: 'bar-probe-locator', bytes: locator, width: roi.width, height: roi.height, roi });
  const sampleIndexes = [...new Set([0, Math.floor((bars.length - 1) / 2), bars.length - 1])];
  for (const sampleIndex of sampleIndexes) {
    const bar = bars[sampleIndex];
    const width = Math.min(192, roi.width);
    const left = clamp(Math.round(bar.centerX - width / 2), roi.x, roi.x + roi.width - width);
    const sampleRoi = { x: left, y: roi.y, width, height: roi.height };
    const sampleClean = await extractPng(source, sampleRoi);
    assets.push({
      kind: 'bar-probe-magnifier-clean',
      bytes: sampleClean,
      width: sampleRoi.width,
      height: sampleRoi.height,
      roi: sampleRoi,
    });
    const sampleBars = bars.filter((candidate) => candidate.centerX >= sampleRoi.x && candidate.centerX < sampleRoi.x + sampleRoi.width);
    const sampleLocator = await overlayBarGuides(sampleClean, sampleRoi, sampleBars, bar.bar);
    assets.push({
      kind: 'bar-probe-magnifier-locator',
      bytes: sampleLocator,
      width: sampleRoi.width,
      height: sampleRoi.height,
      roi: sampleRoi,
    });
  }
  return assets;
}

async function overlayBarGuides(
  clean: Buffer,
  roi: AiPixelRect,
  bars: AiResolvedBar[],
  emphasizedBar?: number,
): Promise<Buffer> {
  const guides = bars
    .map((bar) => {
      const x = bar.centerX - roi.x;
      const emphasized = bar.bar === emphasizedBar;
      const color = emphasized ? '#dc2626' : '#0891b2';
      const width = emphasized ? 2 : 1;
      const label = bars.length <= 40 || emphasized ? `<text x="${x + 3}" y="14" font-size="10" fill="${color}">${bar.bar}</text>` : '';
      return `<line x1="${x}" y1="0" x2="${x}" y2="${roi.height}" stroke="${color}" stroke-width="${width}"/>${label}`;
    })
    .join('');
  const ruler = `<line x1="0" y1="${Math.max(0, roi.height - 1)}" x2="${roi.width}" y2="${Math.max(0, roi.height - 1)}" stroke="#111827"/><text x="4" y="${Math.max(12, roi.height - 5)}" font-size="10" fill="#111827">source px ${roi.x}..${roi.x + roi.width}</text>`;
  return sharp(clean)
    .composite([{ input: Buffer.from(svgDocument(roi.width, roi.height, `${guides}${ruler}`)), left: 0, top: 0 }])
    .png()
    .toBuffer();
}

async function maskFuturePixels(source: Buffer, width: number, height: number, cutoff: number): Promise<Buffer> {
  if (cutoff >= width) return sharp(source).png().toBuffer();
  const maskWidth = width - cutoff;
  const mask = await sharp({ create: { width: maskWidth, height, channels: 4, background: '#e5e7eb' } }).png().toBuffer();
  return sharp(source).composite([{ input: mask, left: cutoff, top: 0 }]).png().toBuffer();
}

function mimeExtension(mimeType: AiVisualArtifactItem['mimeType']): string {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/gif') return 'gif';
  return 'png';
}

function flattenScene(rawObjects: unknown[]): SceneObject[] {
  const result: SceneObject[] = [];
  let zIndex = 0;
  const visit = (raw: unknown, parent: AiAffineTransform): void => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
    const data = raw as Record<string, unknown>;
    const matrix = multiply(parent, ownMatrix(data));
    result.push({ data, matrix, zIndex: zIndex++ });
    if (Array.isArray(data.objects)) for (const child of data.objects) visit(child, matrix);
  };
  for (const object of rawObjects.slice(0, 2_000)) visit(object, IDENTITY);
  return result;
}

function ownMatrix(data: Record<string, unknown>): AiAffineTransform {
  const object = new FabricObject({
    left: finite(data.left, 0),
    top: finite(data.top, 0),
    width: finite(data.width, 0),
    height: finite(data.height, 0),
    originX: (stringValue(data.originX) ?? 'left') as 'left',
    originY: (stringValue(data.originY) ?? 'top') as 'top',
    scaleX: finite(data.scaleX, 1),
    scaleY: finite(data.scaleY, 1),
    angle: finite(data.angle, 0),
    skewX: finite(data.skewX, 0),
    skewY: finite(data.skewY, 0),
    flipX: data.flipX === true,
    flipY: data.flipY === true,
    strokeWidth: finite(data.strokeWidth, 0),
    strokeUniform: data.strokeUniform === true,
  });
  return object.calcOwnMatrix() as AiAffineTransform;
}

function geometryFor(object: SceneObject): AiVisualGeometry {
  const type = stringValue(object.data.type) ?? 'unknown';
  if (
    object.data.clipPath !== undefined ||
    (Array.isArray(object.data.filters) && object.data.filters.length > 0)
  ) {
    return { kind: 'unsupported', reason: `${type} uses an unsupported clip or filter` };
  }
  const width = finite(object.data.width, 0);
  const height = finite(object.data.height, 0);
  if (type === 'Polyline' || type === 'ArrowPoly') {
    const points = pointArray(object.data.points);
    if (points.length < 2) return { kind: 'unsupported', reason: `${type} has fewer than two points` };
    const serializedOffset = pointValue(object.data.pathOffset);
    const offset = serializedOffset ?? pointsCenter(points);
    const local = points.map((point) => ({ x: point.x - offset.x, y: point.y - offset.y }));
    const transformed = local.map((point) => transform(point, object.matrix));
    if (type === 'ArrowPoly') {
      const previous = local.at(-2)!;
      const tip = local.at(-1)!;
      const angle = Math.atan2(tip.y - previous.y, tip.x - previous.x);
      const size = 9 + finite(object.data.strokeWidth, 1) * 2.4;
      const wing = (x: number, y: number): AiPoint => ({
        x: tip.x + x * Math.cos(angle) - y * Math.sin(angle),
        y: tip.y + x * Math.sin(angle) + y * Math.cos(angle),
      });
      const arrowHead: [AiPoint, AiPoint, AiPoint] = [
        transform(tip, object.matrix),
        transform(wing(-size, -size * 0.5), object.matrix),
        transform(wing(-size, size * 0.5), object.matrix),
      ];
      return {
        kind: 'arrow',
        start: transformed[0],
        end: transformed.at(-1)!,
        arrowTip: transformed.at(-1)!,
        arrowHead,
      };
    }
    return transformed.length === 2
      ? { kind: 'segment', start: transformed[0], end: transformed[1] }
      : { kind: 'polyline', points: transformed, precision: 'exact' };
  }
  if (type === 'MeasuredMove') {
    return {
      kind: 'composite',
      children: [-height / 2, 0, height / 2].map((y) => ({
        kind: 'segment' as const,
        start: transform({ x: -width / 2, y }, object.matrix),
        end: transform({ x: width / 2, y }, object.matrix),
      })),
    };
  }
  if (type === 'Path') return { kind: 'unsupported', reason: 'freehand Path flattening is not implemented' };
  if (type !== 'Rect' && type !== 'Textbox' && type !== 'TextBoxAnnotation' && type !== 'Group') {
    return { kind: 'unsupported', reason: `unsupported Fabric object type: ${type}` };
  }
  const pad = type === 'TextBoxAnnotation' ? 6 : 0;
  return {
    kind: 'quad',
    points: [
      transform({ x: -width / 2 - pad, y: -height / 2 - pad }, object.matrix),
      transform({ x: width / 2 + pad, y: -height / 2 - pad }, object.matrix),
      transform({ x: width / 2 + pad, y: height / 2 + pad }, object.matrix),
      transform({ x: -width / 2 - pad, y: height / 2 + pad }, object.matrix),
    ],
  };
}

function associate(
  geometry: AiVisualGeometry,
  screenshots: ScreenshotData[],
): { kind: AiVisualAnnotation['association']['kind']; candidates: ScreenshotData[] } {
  const intersecting = screenshots.filter((screenshot) => geometryIntersectsPolygon(geometry, screenshot.pageQuad));
  if (intersecting.some((screenshot) => !screenshot.pageToSource)) {
    return { kind: 'unsupported', candidates: intersecting };
  }
  const candidates = intersecting.filter((screenshot) => screenshot.pageToSource);
  if (candidates.length === 0) return { kind: 'none', candidates };
  return { kind: candidates.length === 1 ? 'unique' : 'ambiguous', candidates };
}

async function renderPage(
  scene: SceneObject[],
  screenshots: ScreenshotData[],
  pageWidth: number,
  pageHeight: number,
  renderWidth: number,
  renderHeight: number,
): Promise<Buffer> {
  const body: string[] = [];
  const definitions = screenshots
    .map(
      (screenshot) =>
        `<clipPath id="clip-${screenshot.id}" clipPathUnits="userSpaceOnUse"><polygon points="${screenshot.pageQuad
          .map((point) => `${point.x},${point.y}`)
          .join(' ')}"/></clipPath>`,
    )
    .join('');
  let screenshotIndex = 0;
  for (const object of scene) {
    const src = stringValue(object.data.src);
    if (src?.startsWith('tj-image://')) {
      const screenshot = screenshots[screenshotIndex++];
      if (screenshot) {
        body.push(
          `<g clip-path="url(#clip-${screenshot.id})"><image href="data:${screenshot.mimeType};base64,${screenshot.bytes.toString('base64')}" width="${screenshot.nativeWidth}" height="${screenshot.nativeHeight}" transform="${svgMatrix(screenshot.sourceToPage)}"/></g>`,
        );
      }
    } else {
      body.push(sceneObjectSvg(object));
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${renderWidth}" height="${renderHeight}" viewBox="0 0 ${pageWidth} ${pageHeight}"><defs>${definitions}</defs><rect width="100%" height="100%" fill="#fff"/><g>${body.join('')}</g></svg>`;
  return sharp(Buffer.from(svg)).resize(renderWidth, renderHeight, { fit: 'fill' }).png().toBuffer();
}

function sceneObjectSvg(object: SceneObject): string {
  const type = stringValue(object.data.type) ?? '';
  const width = finite(object.data.width, 0);
  const height = finite(object.data.height, 0);
  const stroke = xml(stringValue(object.data.boxStroke) ?? stringValue(object.data.stroke) ?? 'none');
  const strokeWidth = finite(object.data.boxStrokeWidth, finite(object.data.strokeWidth, 1));
  const fill = xml(stringValue(object.data.boxFill) ?? stringValue(object.data.fill) ?? 'none');
  const opacity = finite(object.data.opacity, 1);
  const common = `transform="${svgMatrix(object.matrix)}" opacity="${opacity}"`;
  if (type === 'Polyline' || type === 'ArrowPoly') {
    if (type === 'ArrowPoly') {
      return `<g opacity="${opacity}">${geometryToSvg(geometryFor(object), IDENTITY, stroke, strokeWidth)}</g>`;
    }
    const points = pointArray(object.data.points);
    const offset = pointsCenter(points);
    return `<polyline ${common} points="${points.map((point) => `${point.x - offset.x},${point.y - offset.y}`).join(' ')}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
  }
  if (type === 'MeasuredMove') {
    return `<g ${common} stroke="${stroke}" stroke-width="${strokeWidth}">${[-height / 2, 0, height / 2]
      .map((y) => `<line x1="${-width / 2}" y1="${y}" x2="${width / 2}" y2="${y}"/>`)
      .join('')}</g>`;
  }
  if (type === 'TextBoxAnnotation' || type === 'Textbox') {
    const text = xml(stringValue(object.data.text) ?? '');
    const fontSize = finite(object.data.fontSize, 32);
    return `<g ${common}><rect x="${-width / 2 - 6}" y="${-height / 2 - 6}" width="${width + 12}" height="${height + 12}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/><text x="${-width / 2}" y="${-height / 2 + fontSize}" font-size="${fontSize}" fill="${xml(stringValue(object.data.fill) ?? '#111')}">${text}</text></g>`;
  }
  if (type === 'Rect') {
    return `<rect ${common} x="${-width / 2}" y="${-height / 2}" width="${width}" height="${height}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
  }
  return '';
}

function locatorSvg(width: number, height: number, annotations: AnnotationData[], pageToRender: AiAffineTransform): string {
  return svgDocument(
    width,
    height,
    annotations
      .map((annotation, index) => {
        const bounds = annotation.manifest.paintBounds;
        const center = transform({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }, pageToRender);
        return `${geometryToSvg(annotation.manifest.geometry, pageToRender, '#c026a3', 2)}${markLeader(annotation.manifest.markId, center, 12 + index * 52)}`;
      })
      .join(''),
  );
}

function singleMarkSvg(width: number, height: number, markId: string, center: AiPoint): string {
  return svgDocument(width, height, markLeader(markId, center, 12));
}

function markLeader(markId: string, center: AiPoint, x: number): string {
  return `<g><rect x="${x}" y="7" width="34" height="24" rx="4" fill="#c026a3"/><text x="${x + 17}" y="24" text-anchor="middle" font-family="Arial" font-size="13" font-weight="700" fill="#fff">${xml(markId)}</text><line x1="${x + 17}" y1="31" x2="${center.x}" y2="${center.y}" stroke="#c026a3" stroke-width="1.5" stroke-dasharray="5 4"/></g>`;
}

function geometryToSvg(geometry: AiVisualGeometry, matrix: AiAffineTransform, color: string, width: number): string {
  if (geometry.kind === 'unsupported') return '';
  if (geometry.kind === 'composite') return geometry.children.map((child) => geometryToSvg(child, matrix, color, width)).join('');
  const points = geometryPoints(geometry).map((point) => transform(point, matrix));
  if (geometry.kind === 'quad') return `<polygon points="${points.map((point) => `${point.x},${point.y}`).join(' ')}" fill="none" stroke="${color}" stroke-width="${width}"/>`;
  if (geometry.kind === 'segment') return `<line x1="${points[0].x}" y1="${points[0].y}" x2="${points[1].x}" y2="${points[1].y}" stroke="${color}" stroke-width="${width}"/>`;
  if (geometry.kind === 'arrow') {
    const head = geometry.arrowHead.map((point) => transform(point, matrix));
    return `<line x1="${points[0].x}" y1="${points[0].y}" x2="${points[1].x}" y2="${points[1].y}" stroke="${color}" stroke-width="${width}"/><polygon points="${head.map((point) => `${point.x},${point.y}`).join(' ')}" fill="none" stroke="${color}" stroke-width="${width}"/>`;
  }
  return `<polyline points="${points.map((point) => `${point.x},${point.y}`).join(' ')}" fill="none" stroke="${color}" stroke-width="${width}"/>`;
}

function geometryPoints(geometry: AiVisualGeometry): AiPoint[] {
  if (geometry.kind === 'quad' || geometry.kind === 'polyline' || geometry.kind === 'path') return geometry.points;
  if (geometry.kind === 'segment') return [geometry.start, geometry.end];
  if (geometry.kind === 'arrow') return [geometry.start, geometry.end, ...geometry.arrowHead];
  if (geometry.kind === 'composite') return geometry.children.flatMap(geometryPoints);
  return [];
}

function boundsPoints(bounds: Bounds): AiPoint[] {
  return [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    { x: bounds.x, y: bounds.y + bounds.height },
  ];
}

function pointsBounds(points: AiPoint[]): Bounds {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

function expandedBounds(bounds: Bounds, amount: number): Bounds {
  return { x: bounds.x - amount, y: bounds.y - amount, width: bounds.width + amount * 2, height: bounds.height + amount * 2 };
}

function pointArray(raw: unknown): AiPoint[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((point): point is Record<string, unknown> => !!point && typeof point === 'object' && !Array.isArray(point))
    .map((point) => ({ x: finite(point.x, 0), y: finite(point.y, 0) }));
}

function pointsCenter(points: AiPoint[]): AiPoint {
  if (points.length === 0) return { x: 0, y: 0 };
  const bounds = pointsBounds(points);
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

function multiply(left: AiAffineTransform, right: AiAffineTransform): AiAffineTransform {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ];
}

function invert(matrix: AiAffineTransform): AiAffineTransform | undefined {
  const determinant = matrix[0] * matrix[3] - matrix[1] * matrix[2];
  if (Math.abs(determinant) < 1e-10) return undefined;
  const a = matrix[3] / determinant;
  const b = -matrix[1] / determinant;
  const c = -matrix[2] / determinant;
  const d = matrix[0] / determinant;
  return [a, b, c, d, -(a * matrix[4] + c * matrix[5]), -(b * matrix[4] + d * matrix[5])];
}

function transform(point: AiPoint, matrix: AiAffineTransform): AiPoint {
  return { x: matrix[0] * point.x + matrix[2] * point.y + matrix[4], y: matrix[1] * point.x + matrix[3] * point.y + matrix[5] };
}

function pointInBounds(point: AiPoint, bounds: Bounds): boolean {
  return point.x >= bounds.x && point.x <= bounds.x + bounds.width && point.y >= bounds.y && point.y <= bounds.y + bounds.height;
}

function finite(raw: unknown, fallback: number): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback;
}

function finitePositive(raw: unknown, fallback: number): number {
  const value = finite(raw, fallback);
  return value > 0 ? value : fallback;
}

function stringValue(raw: unknown): string | undefined {
  return typeof raw === 'string' ? raw : undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function svgMatrix(matrix: AiAffineTransform): string {
  return `matrix(${matrix.map((value) => Number(value.toFixed(6))).join(' ')})`;
}

function svgDocument(width: number, height: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${body}</svg>`;
}

function xml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function sharpMime(format: string | undefined): ScreenshotData['mimeType'] {
  if (format === 'jpeg') return 'image/jpeg';
  if (format === 'webp') return 'image/webp';
  if (format === 'gif') return 'image/gif';
  return 'image/png';
}

async function addGutter(image: Buffer, width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height: height + GUTTER, channels: 4, background: '#ffffff' } })
    .composite([{ input: image, left: 0, top: GUTTER }])
    .png()
    .toBuffer();
}

function bundleIdFromUri(uri: string): string | undefined {
  try {
    const parts = new URL(uri).pathname.split('/').filter(Boolean);
    const evidence = parts.indexOf('evidence');
    return evidence >= 0 ? parts[evidence + 1] : undefined;
  } catch {
    return undefined;
  }
}

function artifactPlanIdFromUri(uri: string): string | undefined {
  try {
    const parts = new URL(uri).pathname.split('/').filter(Boolean);
    const artifacts = parts.indexOf('artifacts');
    return artifacts >= 0 ? parts[artifacts + 1] : undefined;
  } catch {
    return undefined;
  }
}

function pointValue(raw: unknown): AiPoint | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const point = raw as Record<string, unknown>;
  return typeof point.x === 'number' && Number.isFinite(point.x) && typeof point.y === 'number' && Number.isFinite(point.y)
    ? { x: point.x, y: point.y }
    : undefined;
}

function geometryIntersectsPolygon(geometry: AiVisualGeometry, polygon: AiPoint[]): boolean {
  if (geometry.kind === 'unsupported') return false;
  if (geometry.kind === 'composite') return geometry.children.some((child) => geometryIntersectsPolygon(child, polygon));
  const points = geometryPoints(geometry);
  if (points.some((point) => pointInPolygon(point, polygon))) return true;
  if (geometry.kind === 'quad' && polygon.some((point) => pointInPolygon(point, geometry.points))) return true;
  const geometrySegments = segmentsForGeometry(geometry);
  const polygonSegments = polygon.map((point, index) => [point, polygon[(index + 1) % polygon.length]] as const);
  return geometrySegments.some(([from, to]) =>
    polygonSegments.some(([edgeFrom, edgeTo]) => segmentsIntersect(from, to, edgeFrom, edgeTo)),
  );
}

function segmentsForGeometry(geometry: AiVisualGeometry): Array<readonly [AiPoint, AiPoint]> {
  if (geometry.kind === 'unsupported') return [];
  if (geometry.kind === 'composite') return geometry.children.flatMap(segmentsForGeometry);
  if (geometry.kind === 'segment') return [[geometry.start, geometry.end]];
  if (geometry.kind === 'arrow') {
    return [
      [geometry.start, geometry.end],
      [geometry.arrowHead[0], geometry.arrowHead[1]],
      [geometry.arrowHead[1], geometry.arrowHead[2]],
      [geometry.arrowHead[2], geometry.arrowHead[0]],
    ];
  }
  const points = geometry.points;
  const segments = points.slice(0, -1).map((point, index) => [point, points[index + 1]] as const);
  if (geometry.kind === 'quad') segments.push([points.at(-1)!, points[0]]);
  return segments;
}

function pointInPolygon(point: AiPoint, polygon: AiPoint[]): boolean {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    const a = polygon[current];
    const b = polygon[previous];
    if (
      (a.y > point.y) !== (b.y > point.y) &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function segmentsIntersect(a: AiPoint, b: AiPoint, c: AiPoint, d: AiPoint): boolean {
  const cross = (first: AiPoint, second: AiPoint, third: AiPoint): number =>
    (second.x - first.x) * (third.y - first.y) - (second.y - first.y) * (third.x - first.x);
  const onSegment = (first: AiPoint, point: AiPoint, second: AiPoint): boolean =>
    point.x >= Math.min(first.x, second.x) - 1e-9 &&
    point.x <= Math.max(first.x, second.x) + 1e-9 &&
    point.y >= Math.min(first.y, second.y) - 1e-9 &&
    point.y <= Math.max(first.y, second.y) + 1e-9;
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  if (Math.abs(abC) < 1e-9 && onSegment(a, c, b)) return true;
  if (Math.abs(abD) < 1e-9 && onSegment(a, d, b)) return true;
  if (Math.abs(cdA) < 1e-9 && onSegment(c, a, d)) return true;
  if (Math.abs(cdB) < 1e-9 && onSegment(c, b, d)) return true;
  return (abC > 0) !== (abD > 0) && (cdA > 0) !== (cdB > 0);
}