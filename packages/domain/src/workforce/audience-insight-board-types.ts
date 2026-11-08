import { DomainValidationError } from '../errors.js';
import {
  isValidUuid,
  sanitizeBoundedText,
  validateEvidenceReferencesArray,
  validateStringArray,
  type DomainEvidenceReference,
} from './artifact-validation-common.js';

export const AWARENESS_STAGES = [
  'unaware',
  'problem_aware',
  'solution_aware',
  'product_aware',
  'most_aware',
] as const;

export type AwarenessStage = (typeof AWARENESS_STAGES)[number];

export interface AudienceSegment {
  readonly segmentName: string;
  readonly description: string;
  readonly awarenessStage: AwarenessStage;
  readonly corePains: readonly string[];
  readonly desires: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface AudienceContentAngle {
  readonly angleName: string;
  readonly hookConcept: string;
  readonly targetSegment: string;
  readonly creativeHypothesis: string;
}

export interface AudienceInsightBoard {
  readonly schemaVersion: 1;
  readonly summary: string;
  readonly audienceSegments: readonly AudienceSegment[];
  readonly contentAngles: readonly AudienceContentAngle[];
  readonly evidenceReferences: readonly DomainEvidenceReference[];
}

function validateRefIds(raw: unknown, prefix: string): readonly string[] {
  if (!Array.isArray(raw)) {
    throw new DomainValidationError(`${prefix} must be an array of IDs`, prefix);
  }
  const result: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const val = raw[i];
    if (typeof val !== 'string' || !isValidUuid(val)) {
      throw new DomainValidationError(
        `${prefix}[${i}] must be a valid UUID string`,
        `${prefix}[${i}]`,
      );
    }
    result.push(val.toLowerCase());
  }
  return Object.freeze([...new Set(result)]);
}

export function validateAudienceInsightBoard(raw: unknown): AudienceInsightBoard {
  if (typeof raw !== 'object' || raw === null) {
    throw new DomainValidationError('Audience insight board must be an object', 'board');
  }
  const obj = raw as Record<string, unknown>;

  if (obj.schemaVersion !== 1) {
    throw new DomainValidationError('schemaVersion must be 1', 'schemaVersion');
  }

  const summary = sanitizeBoundedText(obj.summary, 'summary', 1, 2000);

  // Validate audienceSegments
  if (
    !Array.isArray(obj.audienceSegments) ||
    obj.audienceSegments.length < 1 ||
    obj.audienceSegments.length > 10
  ) {
    throw new DomainValidationError(
      'audienceSegments must contain between 1 and 10 items',
      'audienceSegments',
    );
  }
  const audienceSegments: AudienceSegment[] = [];
  for (let i = 0; i < obj.audienceSegments.length; i++) {
    const s = obj.audienceSegments[i];
    if (typeof s !== 'object' || s === null) {
      throw new DomainValidationError(
        `audienceSegments[${i}] must be an object`,
        `audienceSegments[${i}]`,
      );
    }
    const sObj = s as Record<string, unknown>;
    const segmentName = sanitizeBoundedText(
      sObj.segmentName,
      `audienceSegments[${i}].segmentName`,
      1,
      256,
    );
    const description = sanitizeBoundedText(
      sObj.description,
      `audienceSegments[${i}].description`,
      1,
      1000,
    );

    const stage = sObj.awarenessStage;
    if (typeof stage !== 'string' || !AWARENESS_STAGES.includes(stage as AwarenessStage)) {
      throw new DomainValidationError(
        `audienceSegments[${i}].awarenessStage must be one of: ${AWARENESS_STAGES.join(', ')}`,
        `audienceSegments[${i}].awarenessStage`,
      );
    }

    const corePains = validateStringArray(
      sObj.corePains,
      `audienceSegments[${i}].corePains`,
      1,
      10,
      1,
      500,
    );
    const desires = validateStringArray(
      sObj.desires,
      `audienceSegments[${i}].desires`,
      1,
      10,
      1,
      500,
    );
    const evidenceRefs = validateRefIds(sObj.evidenceRefs, `audienceSegments[${i}].evidenceRefs`);

    audienceSegments.push(
      Object.freeze({
        segmentName,
        description,
        awarenessStage: stage as AwarenessStage,
        corePains,
        desires,
        evidenceRefs,
      }),
    );
  }

  // Validate contentAngles
  if (
    !Array.isArray(obj.contentAngles) ||
    obj.contentAngles.length < 1 ||
    obj.contentAngles.length > 10
  ) {
    throw new DomainValidationError(
      'contentAngles must contain between 1 and 10 items',
      'contentAngles',
    );
  }
  const contentAngles: AudienceContentAngle[] = [];
  for (let i = 0; i < obj.contentAngles.length; i++) {
    const a = obj.contentAngles[i];
    if (typeof a !== 'object' || a === null) {
      throw new DomainValidationError(
        `contentAngles[${i}] must be an object`,
        `contentAngles[${i}]`,
      );
    }
    const aObj = a as Record<string, unknown>;
    const angleName = sanitizeBoundedText(aObj.angleName, `contentAngles[${i}].angleName`, 1, 256);
    const hookConcept = sanitizeBoundedText(
      aObj.hookConcept,
      `contentAngles[${i}].hookConcept`,
      1,
      500,
    );
    const targetSegment = sanitizeBoundedText(
      aObj.targetSegment,
      `contentAngles[${i}].targetSegment`,
      1,
      256,
    );
    const creativeHypothesis = sanitizeBoundedText(
      aObj.creativeHypothesis,
      `contentAngles[${i}].creativeHypothesis`,
      1,
      500,
    );

    contentAngles.push(
      Object.freeze({
        angleName,
        hookConcept,
        targetSegment,
        creativeHypothesis,
      }),
    );
  }

  const evidenceReferences = validateEvidenceReferencesArray(
    obj.evidenceReferences,
    'evidenceReferences',
    1,
    50,
  );

  return Object.freeze({
    schemaVersion: 1,
    summary,
    audienceSegments: Object.freeze(audienceSegments),
    contentAngles: Object.freeze(contentAngles),
    evidenceReferences,
  });
}
