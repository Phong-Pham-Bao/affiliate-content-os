import { DomainValidationError } from '../errors.js';
import {
  type CompetitivePositioningItem,
  type NicheAnalysisContent,
  type PainItem,
  type RiskItem,
  type SearchIntentItem,
  type SeasonalityNoteItem,
  type TargetAudienceItem,
  type ThemeItem,
  isIntentType,
  isPainSeverity,
} from './niche-analysis-types.js';
import {
  assertExactPlainObject,
  validateArray,
  validateEvidenceFactIds,
  validateOptionalTrimmedString,
  validateSourceAnalysisIds,
  validateTrimmedString,
} from './validation-helpers.js';

function validateTargetAudience(item: unknown, idx: number): TargetAudienceItem {
  const obj = assertExactPlainObject(
    item,
    ['segment', 'demographics', 'psychographics'],
    `targetAudience[${idx}]`,
  );
  return Object.freeze({
    segment: validateTrimmedString(obj.segment, `targetAudience[${idx}].segment`, 1, 256, false),
    demographics:
      validateOptionalTrimmedString(
        obj.demographics,
        `targetAudience[${idx}].demographics`,
        512,
        false,
      ) ?? undefined,
    psychographics:
      validateOptionalTrimmedString(
        obj.psychographics,
        `targetAudience[${idx}].psychographics`,
        1024,
        true,
      ) ?? undefined,
  });
}

function validatePain(item: unknown, idx: number): PainItem {
  const obj = assertExactPlainObject(
    item,
    ['painPoint', 'severity', 'context', 'evidenceFactIds', 'sourceAnalysisIds'],
    `pains[${idx}]`,
  );
  if (!isPainSeverity(obj.severity)) {
    throw new DomainValidationError(
      `pains[${idx}].severity must be 'low', 'medium', or 'high'`,
      `pains[${idx}].severity`,
    );
  }
  return Object.freeze({
    painPoint: validateTrimmedString(obj.painPoint, `pains[${idx}].painPoint`, 1, 512, false),
    severity: obj.severity,
    context: validateTrimmedString(obj.context, `pains[${idx}].context`, 1, 2048, true),
    evidenceFactIds: validateEvidenceFactIds(obj.evidenceFactIds, `pains[${idx}].evidenceFactIds`),
    sourceAnalysisIds: validateSourceAnalysisIds(
      obj.sourceAnalysisIds,
      `pains[${idx}].sourceAnalysisIds`,
    ),
  });
}

function validateSearchIntent(item: unknown, idx: number): SearchIntentItem {
  const obj = assertExactPlainObject(
    item,
    ['queryOrTrigger', 'intentType', 'notes'],
    `intent[${idx}]`,
  );
  if (!isIntentType(obj.intentType)) {
    throw new DomainValidationError(
      `intent[${idx}].intentType must be 'informational', 'commercial', or 'transactional'`,
      `intent[${idx}].intentType`,
    );
  }
  return Object.freeze({
    queryOrTrigger: validateTrimmedString(
      obj.queryOrTrigger,
      `intent[${idx}].queryOrTrigger`,
      1,
      512,
      false,
    ),
    intentType: obj.intentType,
    notes:
      validateOptionalTrimmedString(obj.notes, `intent[${idx}].notes`, 1024, true) ?? undefined,
  });
}

function validateTheme(item: unknown, idx: number): ThemeItem {
  const obj = assertExactPlainObject(
    item,
    ['theme', 'description', 'relevanceScore', 'evidenceFactIds', 'sourceAnalysisIds'],
    `themes[${idx}]`,
  );
  let relevanceScore: number | undefined;
  if (obj.relevanceScore !== undefined && obj.relevanceScore !== null) {
    if (
      typeof obj.relevanceScore !== 'number' ||
      !Number.isFinite(obj.relevanceScore) ||
      obj.relevanceScore < 0 ||
      obj.relevanceScore > 1
    ) {
      throw new DomainValidationError(
        `themes[${idx}].relevanceScore must be a number between 0 and 1`,
        `themes[${idx}].relevanceScore`,
      );
    }
    relevanceScore = obj.relevanceScore;
  }
  return Object.freeze({
    theme: validateTrimmedString(obj.theme, `themes[${idx}].theme`, 1, 256, false),
    description: validateTrimmedString(
      obj.description,
      `themes[${idx}].description`,
      1,
      2048,
      true,
    ),
    relevanceScore,
    evidenceFactIds: validateEvidenceFactIds(obj.evidenceFactIds, `themes[${idx}].evidenceFactIds`),
    sourceAnalysisIds: validateSourceAnalysisIds(
      obj.sourceAnalysisIds,
      `themes[${idx}].sourceAnalysisIds`,
    ),
  });
}

function validateCompetitivePositioning(item: unknown, idx: number): CompetitivePositioningItem {
  const obj = assertExactPlainObject(
    item,
    [
      'competitorOrAlternative',
      'differentiator',
      'takeaway',
      'evidenceFactIds',
      'sourceAnalysisIds',
    ],
    `competitivePositioning[${idx}]`,
  );
  return Object.freeze({
    competitorOrAlternative: validateTrimmedString(
      obj.competitorOrAlternative,
      `competitivePositioning[${idx}].competitorOrAlternative`,
      1,
      256,
      false,
    ),
    differentiator: validateTrimmedString(
      obj.differentiator,
      `competitivePositioning[${idx}].differentiator`,
      1,
      2048,
      true,
    ),
    takeaway: validateTrimmedString(
      obj.takeaway,
      `competitivePositioning[${idx}].takeaway`,
      1,
      1024,
      true,
    ),
    evidenceFactIds: validateEvidenceFactIds(
      obj.evidenceFactIds,
      `competitivePositioning[${idx}].evidenceFactIds`,
    ),
    sourceAnalysisIds: validateSourceAnalysisIds(
      obj.sourceAnalysisIds,
      `competitivePositioning[${idx}].sourceAnalysisIds`,
    ),
  });
}

function validateSeasonalityNote(item: unknown, idx: number): SeasonalityNoteItem {
  const obj = assertExactPlainObject(
    item,
    ['period', 'trend', 'impact'],
    `seasonalityNotes[${idx}]`,
  );
  return Object.freeze({
    period: validateTrimmedString(obj.period, `seasonalityNotes[${idx}].period`, 1, 128, false),
    trend: validateTrimmedString(obj.trend, `seasonalityNotes[${idx}].trend`, 1, 512, false),
    impact: validateTrimmedString(obj.impact, `seasonalityNotes[${idx}].impact`, 1, 1024, true),
  });
}

function validateRisk(item: unknown, idx: number): RiskItem {
  const obj = assertExactPlainObject(
    item,
    ['riskType', 'description', 'mitigation', 'evidenceFactIds', 'sourceAnalysisIds'],
    `risks[${idx}]`,
  );
  return Object.freeze({
    riskType: validateTrimmedString(obj.riskType, `risks[${idx}].riskType`, 1, 256, false),
    description: validateTrimmedString(obj.description, `risks[${idx}].description`, 1, 2048, true),
    mitigation:
      validateOptionalTrimmedString(obj.mitigation, `risks[${idx}].mitigation`, 2048, true) ??
      undefined,
    evidenceFactIds: validateEvidenceFactIds(obj.evidenceFactIds, `risks[${idx}].evidenceFactIds`),
    sourceAnalysisIds: validateSourceAnalysisIds(
      obj.sourceAnalysisIds,
      `risks[${idx}].sourceAnalysisIds`,
    ),
  });
}

export function validateNicheAnalysisContent(raw: unknown): NicheAnalysisContent {
  const obj = assertExactPlainObject(
    raw,
    [
      'targetAudience',
      'pains',
      'intent',
      'themes',
      'competitivePositioning',
      'seasonalityNotes',
      'risks',
    ],
    'nicheAnalysisContent',
  );
  const targetAudience = validateArray(
    obj.targetAudience,
    'targetAudience',
    1,
    20,
    validateTargetAudience,
  );
  const pains = validateArray(obj.pains, 'pains', 1, 20, validatePain);
  const intent = validateArray(obj.intent, 'intent', 1, 20, validateSearchIntent);
  const themes = validateArray(obj.themes, 'themes', 1, 20, validateTheme);
  const competitivePositioning = validateArray(
    obj.competitivePositioning,
    'competitivePositioning',
    1,
    20,
    validateCompetitivePositioning,
  );
  const seasonalityNotes = validateArray(
    obj.seasonalityNotes ?? [],
    'seasonalityNotes',
    0,
    20,
    validateSeasonalityNote,
  );
  const risks = validateArray(obj.risks ?? [], 'risks', 0, 20, validateRisk);

  return Object.freeze({
    targetAudience,
    pains,
    intent,
    themes,
    competitivePositioning,
    seasonalityNotes,
    risks,
  });
}
