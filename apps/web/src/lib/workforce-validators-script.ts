import { isPlainObject, ApiError } from './api-validators-common.js';
import type {
  ArtifactChangeRequestDTO,
  ContentArtifactLineageDTO,
  ScriptPackage,
  ScriptVideo,
} from '../types/script-studio.js';
import type { ContentArtifactRevisionDTO } from '../types/workforce.js';
import { validateContentArtifactRevision } from './workforce-validators-artifact.js';

function invalid(msg: string): never {
  throw new ApiError(500, {
    status: 500,
    title: 'Validation Error',
    detail: msg,
  });
}

export function validateContentArtifactRevisionList(val: unknown): {
  readonly items: readonly ContentArtifactRevisionDTO[];
} {
  if (!isPlainObject(val)) invalid('Artifact revision list response must be an object');
  const rawItems = Array.isArray(val.items) ? val.items : [];
  return { items: rawItems.map(validateContentArtifactRevision) };
}

export function validateContentArtifactLineage(val: unknown): ContentArtifactLineageDTO {
  if (!isPlainObject(val)) invalid('Artifact lineage must be an object');
  return {
    id: String(val.id),
    artifactId: String(val.artifactId),
    revisionNumber: Number(val.revisionNumber ?? 1),
    parentRevisionNumber:
      val.parentRevisionNumber !== null && val.parentRevisionNumber !== undefined
        ? Number(val.parentRevisionNumber)
        : null,
    lineageType: val.lineageType as 'ai_generated' | 'human_edited' | 'change_request',
    changeRequestId: val.changeRequestId ? String(val.changeRequestId) : null,
    contentBriefHashHex: String(val.contentBriefHashHex ?? ''),
    contentBriefVersion: Number(val.contentBriefVersion ?? 1),
    planningRevisionIds: isPlainObject(val.planningRevisionIds) ? val.planningRevisionIds : {},
    sourceScriptUnitIds: Array.isArray(val.sourceScriptUnitIds)
      ? val.sourceScriptUnitIds.map(String)
      : [],
    metadata: isPlainObject(val.metadata) ? val.metadata : {},
    createdAt: String(val.createdAt ?? ''),
  };
}

export function validateArtifactChangeRequest(val: unknown): ArtifactChangeRequestDTO {
  if (!isPlainObject(val)) invalid('Artifact change request must be an object');
  const selectedVideos = Array.isArray(val.selectedVideoNumbers)
    ? (val.selectedVideoNumbers.map(Number) as (1 | 2 | 3 | 4 | 5)[])
    : [];
  return {
    id: String(val.id),
    artifactId: String(val.artifactId),
    baseRevisionNumber: Number(val.baseRevisionNumber ?? 1),
    baseContentHashHex: String(val.baseContentHashHex ?? ''),
    requestedByUserId: String(val.requestedByUserId ?? ''),
    instructionText: String(val.instructionText ?? ''),
    selectedVideoNumbers: selectedVideos,
    targetVariantCount: Number(val.targetVariantCount ?? 1),
    status: (val.status as ArtifactChangeRequestDTO['status']) ?? 'pending',
    resultingRevisionNumber:
      val.resultingRevisionNumber !== null && val.resultingRevisionNumber !== undefined
        ? Number(val.resultingRevisionNumber)
        : null,
    failureReason: val.failureReason ? String(val.failureReason) : null,
    createdAt: String(val.createdAt ?? ''),
    updatedAt: String(val.updatedAt ?? ''),
    version: Number(val.version ?? 1),
  };
}

export function validateScriptPackage(val: unknown): ScriptPackage {
  if (!isPlainObject(val)) invalid('Script package content must be an object');
  if (val.schemaVersion !== 1) invalid('Invalid schemaVersion: expected 1');
  if (typeof val.seriesTitle !== 'string') invalid('seriesTitle must be a string');
  if (!Array.isArray(val.videos) || val.videos.length !== 5) {
    invalid('videos must be an array of exactly 5 videos');
  }

  const validatedVideos = val.videos.map((v, idx) => {
    if (!isPlainObject(v)) invalid(`Video at index ${idx} must be an object`);
    const num = Number(v.videoNumber ?? idx + 1) as 1 | 2 | 3 | 4 | 5;
    return {
      videoNumber: num,
      title: String(v.title ?? ''),
      objective: String(v.objective ?? ''),
      targetDurationSeconds: Number(v.targetDurationSeconds ?? 60),
      hook: isPlainObject(v.hook)
        ? {
            spokenHook: String(v.hook.spokenHook ?? ''),
            visualHook: String(v.hook.visualHook ?? ''),
          }
        : { spokenHook: '', visualHook: '' },
      voiceOver: String(v.voiceOver ?? ''),
      scenes: Array.isArray(v.scenes)
        ? v.scenes.map((s, sIdx) => ({
            sceneNumber: Number(s.sceneNumber ?? sIdx + 1),
            timeRangeSeconds: isPlainObject(s.timeRangeSeconds)
              ? {
                  start: Number(s.timeRangeSeconds.start ?? 0),
                  end: Number(s.timeRangeSeconds.end ?? 0),
                }
              : { start: 0, end: 0 },
            visualDescription: String(s.visualDescription ?? ''),
            spokenText: String(s.spokenText ?? ''),
            audioCue: s.audioCue ? String(s.audioCue) : null,
          }))
        : [],
      onScreenOverlays: Array.isArray(v.onScreenOverlays)
        ? v.onScreenOverlays.map((o) => ({
            text: String(o.text ?? ''),
            timeRangeSeconds: isPlainObject(o.timeRangeSeconds)
              ? {
                  start: Number(o.timeRangeSeconds.start ?? 0),
                  end: Number(o.timeRangeSeconds.end ?? 0),
                }
              : { start: 0, end: 0 },
            placement:
              (o.placement as import('../types/script-studio.js').ScriptOverlay['placement']) ??
              'bottom',
          }))
        : [],
      callToAction: isPlainObject(v.callToAction)
        ? {
            text: String(v.callToAction.text ?? ''),
            visualDirection: String(v.callToAction.visualDirection ?? ''),
          }
        : { text: '', visualDirection: '' },
      disclosure: isPlainObject(v.disclosure)
        ? {
            placement: String(v.disclosure.placement ?? ''),
            text: String(v.disclosure.text ?? ''),
          }
        : { placement: '', text: '' },
      shotList: Array.isArray(v.shotList)
        ? v.shotList.map((sh, shIdx) => ({
            shotNumber: Number(sh.shotNumber ?? shIdx + 1),
            durationSeconds: Number(sh.durationSeconds ?? 5),
            description: String(sh.description ?? ''),
            cameraAngle: String(sh.cameraAngle ?? ''),
            framing: String(sh.framing ?? ''),
            movement: String(sh.movement ?? ''),
            props: Array.isArray(sh.props) ? sh.props.map(String) : [],
          }))
        : [],
      variants: Array.isArray(v.variants)
        ? v.variants.map((vr) => ({
            variantNumber: Number(vr.variantNumber ?? 1) as 1 | 2 | 3,
            label: vr.label ? String(vr.label) : undefined,
            hook: isPlainObject(vr.hook)
              ? {
                  spokenHook: String(vr.hook.spokenHook ?? ''),
                  visualHook: String(vr.hook.visualHook ?? ''),
                }
              : { spokenHook: '', visualHook: '' },
            voiceOver: String(vr.voiceOver ?? ''),
            scenes: Array.isArray(vr.scenes) ? vr.scenes : [],
            callToAction: isPlainObject(vr.callToAction)
              ? {
                  text: String(vr.callToAction.text ?? ''),
                  visualDirection: String(vr.callToAction.visualDirection ?? ''),
                }
              : { text: '', visualDirection: '' },
            creativeHypotheses: Array.isArray(vr.creativeHypotheses)
              ? vr.creativeHypotheses.map(String)
              : undefined,
          }))
        : [],
      evidenceReferences: Array.isArray(v.evidenceReferences)
        ? v.evidenceReferences.map((e) => ({
            sourceKind: (e.sourceKind as 'product_fact' | 'analysis') ?? 'product_fact',
            sourceId: String(e.sourceId ?? ''),
          }))
        : [],
      creativeHypotheses: Array.isArray(v.creativeHypotheses)
        ? v.creativeHypotheses.map(String)
        : [],
    };
  }) as unknown as [ScriptVideo, ScriptVideo, ScriptVideo, ScriptVideo, ScriptVideo];

  return {
    schemaVersion: 1,
    seriesTitle: String(val.seriesTitle),
    targetAudienceSummary: String(val.targetAudienceSummary ?? ''),
    creativeDirectionSummary: String(val.creativeDirectionSummary ?? ''),
    videos: validatedVideos,
    evidenceReferences: Array.isArray(val.evidenceReferences)
      ? val.evidenceReferences.map((e) => ({
          sourceKind: (e.sourceKind as 'product_fact' | 'analysis') ?? 'product_fact',
          sourceId: String(e.sourceId ?? ''),
        }))
      : [],
  };
}
