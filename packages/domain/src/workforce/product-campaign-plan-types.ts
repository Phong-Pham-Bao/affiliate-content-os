import { DomainValidationError } from '../errors.js';
import {
  isValidUuid,
  sanitizeBoundedText,
  validateEvidenceReferencesArray,
  validateStringArray,
  type DomainEvidenceReference,
} from './artifact-validation-common.js';

export interface ProductCampaignBenefit {
  readonly benefit: string;
  readonly evidenceRefs: readonly string[];
}

export interface ProductCampaignObjection {
  readonly objection: string;
  readonly counterAngle: string;
  readonly evidenceRefs: readonly string[];
}

export interface ProductCampaignCreativeHypothesis {
  readonly hypothesis: string;
  readonly rationale: string;
}

export interface ProductCampaignPlan {
  readonly schemaVersion: 1;
  readonly summary: string;
  readonly positioningStatement: string;
  readonly campaignGoals: readonly string[];
  readonly coreBenefits: readonly ProductCampaignBenefit[];
  readonly targetObjections: readonly ProductCampaignObjection[];
  readonly complianceConstraints: readonly string[];
  readonly creativeHypotheses: readonly ProductCampaignCreativeHypothesis[];
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

export function validateProductCampaignPlan(raw: unknown): ProductCampaignPlan {
  if (typeof raw !== 'object' || raw === null) {
    throw new DomainValidationError('Product campaign plan must be an object', 'plan');
  }
  const obj = raw as Record<string, unknown>;

  if (obj.schemaVersion !== 1) {
    throw new DomainValidationError('schemaVersion must be 1', 'schemaVersion');
  }

  const summary = sanitizeBoundedText(obj.summary, 'summary', 1, 2000);
  const positioningStatement = sanitizeBoundedText(
    obj.positioningStatement,
    'positioningStatement',
    1,
    1000,
  );
  const campaignGoals = validateStringArray(obj.campaignGoals, 'campaignGoals', 1, 10, 1, 500);
  const complianceConstraints = validateStringArray(
    obj.complianceConstraints,
    'complianceConstraints',
    1,
    10,
    1,
    500,
  );

  // Validate coreBenefits
  if (
    !Array.isArray(obj.coreBenefits) ||
    obj.coreBenefits.length < 1 ||
    obj.coreBenefits.length > 10
  ) {
    throw new DomainValidationError(
      'coreBenefits must contain between 1 and 10 items',
      'coreBenefits',
    );
  }
  const coreBenefits: ProductCampaignBenefit[] = [];
  for (let i = 0; i < obj.coreBenefits.length; i++) {
    const b = obj.coreBenefits[i];
    if (typeof b !== 'object' || b === null) {
      throw new DomainValidationError(`coreBenefits[${i}] must be an object`, `coreBenefits[${i}]`);
    }
    const bObj = b as Record<string, unknown>;
    const benefit = sanitizeBoundedText(bObj.benefit, `coreBenefits[${i}].benefit`, 1, 500);
    const evidenceRefs = validateRefIds(bObj.evidenceRefs, `coreBenefits[${i}].evidenceRefs`);
    coreBenefits.push(Object.freeze({ benefit, evidenceRefs }));
  }

  // Validate targetObjections
  if (
    !Array.isArray(obj.targetObjections) ||
    obj.targetObjections.length < 1 ||
    obj.targetObjections.length > 10
  ) {
    throw new DomainValidationError(
      'targetObjections must contain between 1 and 10 items',
      'targetObjections',
    );
  }
  const targetObjections: ProductCampaignObjection[] = [];
  for (let i = 0; i < obj.targetObjections.length; i++) {
    const o = obj.targetObjections[i];
    if (typeof o !== 'object' || o === null) {
      throw new DomainValidationError(
        `targetObjections[${i}] must be an object`,
        `targetObjections[${i}]`,
      );
    }
    const oObj = o as Record<string, unknown>;
    const objection = sanitizeBoundedText(
      oObj.objection,
      `targetObjections[${i}].objection`,
      1,
      500,
    );
    const counterAngle = sanitizeBoundedText(
      oObj.counterAngle,
      `targetObjections[${i}].counterAngle`,
      1,
      500,
    );
    const evidenceRefs = validateRefIds(oObj.evidenceRefs, `targetObjections[${i}].evidenceRefs`);
    targetObjections.push(Object.freeze({ objection, counterAngle, evidenceRefs }));
  }

  // Validate creativeHypotheses
  if (
    !Array.isArray(obj.creativeHypotheses) ||
    obj.creativeHypotheses.length < 1 ||
    obj.creativeHypotheses.length > 10
  ) {
    throw new DomainValidationError(
      'creativeHypotheses must contain between 1 and 10 items',
      'creativeHypotheses',
    );
  }
  const creativeHypotheses: ProductCampaignCreativeHypothesis[] = [];
  for (let i = 0; i < obj.creativeHypotheses.length; i++) {
    const h = obj.creativeHypotheses[i];
    if (typeof h !== 'object' || h === null) {
      throw new DomainValidationError(
        `creativeHypotheses[${i}] must be an object`,
        `creativeHypotheses[${i}]`,
      );
    }
    const hObj = h as Record<string, unknown>;
    const hypothesis = sanitizeBoundedText(
      hObj.hypothesis,
      `creativeHypotheses[${i}].hypothesis`,
      1,
      500,
    );
    const rationale = sanitizeBoundedText(
      hObj.rationale,
      `creativeHypotheses[${i}].rationale`,
      1,
      500,
    );
    creativeHypotheses.push(Object.freeze({ hypothesis, rationale }));
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
    positioningStatement,
    campaignGoals,
    coreBenefits: Object.freeze(coreBenefits),
    targetObjections: Object.freeze(targetObjections),
    complianceConstraints,
    creativeHypotheses: Object.freeze(creativeHypotheses),
    evidenceReferences,
  });
}
