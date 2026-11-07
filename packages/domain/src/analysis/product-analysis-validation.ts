import { DomainValidationError } from '../errors.js';
import {
  type BenefitItem,
  type ClaimRiskItem,
  type ContentAngleItem,
  type DifferentiatorItem,
  type EvidenceGapItem,
  type ObjectionItem,
  type ProductAnalysisContent,
  isClaimRiskLevel,
} from './product-analysis-types.js';
import {
  assertExactPlainObject,
  validateArray,
  validateEvidenceFactIds,
  validateTrimmedString,
} from './validation-helpers.js';

function validateBenefit(item: unknown, idx: number): BenefitItem {
  const obj = assertExactPlainObject(
    item,
    ['title', 'description', 'evidenceFactIds'],
    `benefits[${idx}]`,
  );
  return Object.freeze({
    title: validateTrimmedString(obj.title, `benefits[${idx}].title`, 1, 256, false),
    description: validateTrimmedString(
      obj.description,
      `benefits[${idx}].description`,
      1,
      2048,
      true,
    ),
    evidenceFactIds: validateEvidenceFactIds(
      obj.evidenceFactIds,
      `benefits[${idx}].evidenceFactIds`,
    ),
  });
}

function validateDifferentiator(item: unknown, idx: number): DifferentiatorItem {
  const obj = assertExactPlainObject(
    item,
    ['title', 'description', 'evidenceFactIds'],
    `differentiators[${idx}]`,
  );
  return Object.freeze({
    title: validateTrimmedString(obj.title, `differentiators[${idx}].title`, 1, 256, false),
    description: validateTrimmedString(
      obj.description,
      `differentiators[${idx}].description`,
      1,
      2048,
      true,
    ),
    evidenceFactIds: validateEvidenceFactIds(
      obj.evidenceFactIds,
      `differentiators[${idx}].evidenceFactIds`,
    ),
  });
}

function validateEvidenceGap(item: unknown, idx: number): EvidenceGapItem {
  const obj = assertExactPlainObject(item, ['topic', 'description'], `evidenceGaps[${idx}]`);
  return Object.freeze({
    topic: validateTrimmedString(obj.topic, `evidenceGaps[${idx}].topic`, 1, 256, false),
    description: validateTrimmedString(
      obj.description,
      `evidenceGaps[${idx}].description`,
      1,
      2048,
      true,
    ),
  });
}

function validateClaimRisk(item: unknown, idx: number): ClaimRiskItem {
  const obj = assertExactPlainObject(item, ['claim', 'riskLevel', 'reason'], `claimRisks[${idx}]`);
  if (!isClaimRiskLevel(obj.riskLevel)) {
    throw new DomainValidationError(
      `claimRisks[${idx}].riskLevel must be 'low', 'medium', or 'high'`,
      `claimRisks[${idx}].riskLevel`,
    );
  }
  return Object.freeze({
    claim: validateTrimmedString(obj.claim, `claimRisks[${idx}].claim`, 1, 512, false),
    riskLevel: obj.riskLevel,
    reason: validateTrimmedString(obj.reason, `claimRisks[${idx}].reason`, 1, 2048, true),
  });
}

function validateObjection(item: unknown, idx: number): ObjectionItem {
  const obj = assertExactPlainObject(
    item,
    ['objection', 'counterArgument', 'evidenceFactIds'],
    `objections[${idx}]`,
  );
  return Object.freeze({
    objection: validateTrimmedString(obj.objection, `objections[${idx}].objection`, 1, 512, false),
    counterArgument: validateTrimmedString(
      obj.counterArgument,
      `objections[${idx}].counterArgument`,
      1,
      2048,
      true,
    ),
    evidenceFactIds: validateEvidenceFactIds(
      obj.evidenceFactIds,
      `objections[${idx}].evidenceFactIds`,
    ),
  });
}

function validateContentAngle(item: unknown, idx: number): ContentAngleItem {
  const obj = assertExactPlainObject(
    item,
    ['angle', 'targetPersona', 'hookText', 'recommendedPoints'],
    `contentAngles[${idx}]`,
  );
  const points = validateArray(
    obj.recommendedPoints,
    `contentAngles[${idx}].recommendedPoints`,
    1,
    10,
    (p, pIdx) =>
      validateTrimmedString(p, `contentAngles[${idx}].recommendedPoints[${pIdx}]`, 1, 512, false),
  );
  return Object.freeze({
    angle: validateTrimmedString(obj.angle, `contentAngles[${idx}].angle`, 1, 256, false),
    targetPersona: validateTrimmedString(
      obj.targetPersona,
      `contentAngles[${idx}].targetPersona`,
      1,
      256,
      false,
    ),
    hookText: validateTrimmedString(obj.hookText, `contentAngles[${idx}].hookText`, 1, 1024, true),
    recommendedPoints: points,
  });
}

export function validateProductAnalysisContent(raw: unknown): ProductAnalysisContent {
  const obj = assertExactPlainObject(
    raw,
    [
      'summary',
      'benefits',
      'differentiators',
      'evidenceGaps',
      'claimRisks',
      'objections',
      'contentAngles',
    ],
    'productAnalysisContent',
  );
  const summary = validateTrimmedString(obj.summary, 'summary', 1, 4000, true);
  const benefits = validateArray(obj.benefits, 'benefits', 1, 20, validateBenefit);
  const differentiators = validateArray(
    obj.differentiators,
    'differentiators',
    1,
    20,
    validateDifferentiator,
  );
  const evidenceGaps = validateArray(
    obj.evidenceGaps ?? [],
    'evidenceGaps',
    0,
    20,
    validateEvidenceGap,
  );
  const claimRisks = validateArray(obj.claimRisks ?? [], 'claimRisks', 0, 20, validateClaimRisk);
  const objections = validateArray(obj.objections ?? [], 'objections', 0, 20, validateObjection);
  const contentAngles = validateArray(
    obj.contentAngles,
    'contentAngles',
    1,
    20,
    validateContentAngle,
  );

  return Object.freeze({
    summary,
    benefits,
    differentiators,
    evidenceGaps,
    claimRisks,
    objections,
    contentAngles,
  });
}
