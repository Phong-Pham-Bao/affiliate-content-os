import { DomainValidationError } from '../errors.js';
import {
  sanitizeBoundedText,
  validateEvidenceReferencesArray,
} from './artifact-validation-common.js';
import type { ScriptPackage, ScriptVideo, SingleVideoScript } from './script-package-types.js';
import {
  validateCta,
  validateDisclosure,
  validateHook,
  validateOverlays,
  validateScenes,
  validateShots,
  validateVariants,
} from './script-package-validators.js';

export function validateScriptVideo(raw: unknown, expectedVideoNumber?: number): ScriptVideo {
  if (typeof raw !== 'object' || raw === null) {
    throw new DomainValidationError('Video must be an object', 'video');
  }
  const v = raw as Record<string, unknown>;
  const num = Number(v.videoNumber);
  if (![1, 2, 3, 4, 5].includes(num)) {
    throw new DomainValidationError('videoNumber must be between 1 and 5', 'videoNumber');
  }
  if (expectedVideoNumber !== undefined && num !== expectedVideoNumber) {
    throw new DomainValidationError(
      `Expected videoNumber ${expectedVideoNumber}, got ${num}`,
      'videoNumber',
    );
  }

  const videoNumber = num as 1 | 2 | 3 | 4 | 5;
  const title = sanitizeBoundedText(v.title, 'title', 1, 256);
  const objective = sanitizeBoundedText(v.objective, 'objective', 1, 500);

  const dur = Number(v.targetDurationSeconds ?? 60);
  if (!Number.isFinite(dur) || dur < 15 || dur > 120) {
    throw new DomainValidationError(
      'targetDurationSeconds must be between 15 and 120',
      'targetDurationSeconds',
    );
  }

  const hook = validateHook(v.hook, 'hook');
  const voiceOver = sanitizeBoundedText(v.voiceOver, 'voiceOver', 1, 4000);
  const scenes = validateScenes(v.scenes, 'scenes');
  const onScreenOverlays = validateOverlays(v.onScreenOverlays ?? [], 'onScreenOverlays');
  const callToAction = validateCta(v.callToAction, 'callToAction');
  const disclosure = validateDisclosure(v.disclosure, 'disclosure');
  const shotList = validateShots(v.shotList, 'shotList');

  const rawVariants =
    Array.isArray(v.variants) && v.variants.length > 0
      ? v.variants
      : [
          {
            variantNumber: 1,
            label: 'Biến thể chính',
            hook,
            voiceOver,
            scenes,
            callToAction,
          },
        ];
  const variants = validateVariants(rawVariants, 'variants');

  const rawHypotheses = Array.isArray(v.creativeHypotheses) ? v.creativeHypotheses : [];
  const creativeHypotheses = rawHypotheses
    .slice(0, 10)
    .map((h, idx) => sanitizeBoundedText(h, `creativeHypotheses[${idx}]`, 1, 500));

  const evidenceReferences = validateEvidenceReferencesArray(
    v.evidenceReferences,
    'evidenceReferences',
  );

  return Object.freeze({
    videoNumber,
    title,
    objective,
    targetDurationSeconds: dur,
    hook,
    voiceOver,
    scenes,
    onScreenOverlays,
    callToAction,
    disclosure,
    shotList,
    variants,
    evidenceReferences,
    creativeHypotheses: Object.freeze(creativeHypotheses),
  });
}

export function validateSingleVideoScript(
  raw: unknown,
  expectedVideoNumber: number,
): SingleVideoScript {
  if (typeof raw !== 'object' || raw === null) {
    throw new DomainValidationError('Single video script must be an object', 'script');
  }
  const obj = raw as Record<string, unknown>;
  if (obj.schemaVersion !== 1) {
    throw new DomainValidationError('schemaVersion must be 1', 'schemaVersion');
  }
  const video = validateScriptVideo(obj.video, expectedVideoNumber);
  return Object.freeze({
    schemaVersion: 1 as const,
    video,
  });
}

export function validateScriptPackage(raw: unknown): ScriptPackage {
  if (typeof raw !== 'object' || raw === null) {
    throw new DomainValidationError('Script package must be an object', 'package');
  }
  const obj = raw as Record<string, unknown>;
  if (obj.schemaVersion !== 1) {
    throw new DomainValidationError('schemaVersion must be 1', 'schemaVersion');
  }

  const seriesTitle = sanitizeBoundedText(obj.seriesTitle, 'seriesTitle', 1, 256);
  const targetAudienceSummary = sanitizeBoundedText(
    obj.targetAudienceSummary,
    'targetAudienceSummary',
    1,
    1000,
  );
  const creativeDirectionSummary = sanitizeBoundedText(
    obj.creativeDirectionSummary,
    'creativeDirectionSummary',
    1,
    1000,
  );

  if (!Array.isArray(obj.videos) || obj.videos.length !== 5) {
    throw new DomainValidationError('videos must contain exactly 5 videos', 'videos');
  }

  const validatedVideos: ScriptVideo[] = [];
  for (let i = 0; i < 5; i++) {
    validatedVideos.push(validateScriptVideo(obj.videos[i], i + 1));
  }

  const evidenceReferences = validateEvidenceReferencesArray(
    obj.evidenceReferences,
    'evidenceReferences',
  );

  return Object.freeze({
    schemaVersion: 1 as const,
    seriesTitle,
    targetAudienceSummary,
    creativeDirectionSummary,
    videos: validatedVideos as unknown as readonly [
      ScriptVideo,
      ScriptVideo,
      ScriptVideo,
      ScriptVideo,
      ScriptVideo,
    ],
    evidenceReferences,
  });
}
