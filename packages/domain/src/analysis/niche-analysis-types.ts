export const INTENT_TYPES = ['informational', 'commercial', 'transactional'] as const;
export type IntentType = (typeof INTENT_TYPES)[number];

export function isIntentType(value: unknown): value is IntentType {
  return typeof value === 'string' && (INTENT_TYPES as readonly string[]).includes(value);
}

export const PAIN_SEVERITIES = ['low', 'medium', 'high'] as const;
export type PainSeverity = (typeof PAIN_SEVERITIES)[number];

export function isPainSeverity(value: unknown): value is PainSeverity {
  return typeof value === 'string' && (PAIN_SEVERITIES as readonly string[]).includes(value);
}

export interface TargetAudienceItem {
  readonly segment: string;
  readonly demographics?: string | undefined;
  readonly psychographics?: string | undefined;
}

export interface PainItem {
  readonly painPoint: string;
  readonly severity: PainSeverity;
  readonly context: string;
  readonly evidenceFactIds?: readonly string[] | undefined;
  readonly sourceAnalysisIds?: readonly string[] | undefined;
}

export interface SearchIntentItem {
  readonly queryOrTrigger: string;
  readonly intentType: IntentType;
  readonly notes?: string | undefined;
}

export interface ThemeItem {
  readonly theme: string;
  readonly description: string;
  readonly relevanceScore?: number | undefined;
  readonly evidenceFactIds?: readonly string[] | undefined;
  readonly sourceAnalysisIds?: readonly string[] | undefined;
}

export interface CompetitivePositioningItem {
  readonly competitorOrAlternative: string;
  readonly differentiator: string;
  readonly takeaway: string;
  readonly evidenceFactIds?: readonly string[] | undefined;
  readonly sourceAnalysisIds?: readonly string[] | undefined;
}

export interface SeasonalityNoteItem {
  readonly period: string;
  readonly trend: string;
  readonly impact: string;
}

export interface RiskItem {
  readonly riskType: string;
  readonly description: string;
  readonly mitigation?: string | undefined;
  readonly evidenceFactIds?: readonly string[] | undefined;
  readonly sourceAnalysisIds?: readonly string[] | undefined;
}

export interface NicheAnalysisContent {
  readonly targetAudience: readonly TargetAudienceItem[];
  readonly pains: readonly PainItem[];
  readonly intent: readonly SearchIntentItem[];
  readonly themes: readonly ThemeItem[];
  readonly competitivePositioning: readonly CompetitivePositioningItem[];
  readonly seasonalityNotes: readonly SeasonalityNoteItem[];
  readonly risks: readonly RiskItem[];
}
