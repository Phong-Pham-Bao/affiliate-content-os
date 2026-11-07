export const CLAIM_RISK_LEVELS = ['low', 'medium', 'high'] as const;
export type ClaimRiskLevel = (typeof CLAIM_RISK_LEVELS)[number];

export function isClaimRiskLevel(value: unknown): value is ClaimRiskLevel {
  return typeof value === 'string' && (CLAIM_RISK_LEVELS as readonly string[]).includes(value);
}

export interface BenefitItem {
  readonly title: string;
  readonly description: string;
  readonly evidenceFactIds?: readonly string[] | undefined;
}

export interface DifferentiatorItem {
  readonly title: string;
  readonly description: string;
  readonly evidenceFactIds?: readonly string[] | undefined;
}

export interface EvidenceGapItem {
  readonly topic: string;
  readonly description: string;
}

export interface ClaimRiskItem {
  readonly claim: string;
  readonly riskLevel: ClaimRiskLevel;
  readonly reason: string;
}

export interface ObjectionItem {
  readonly objection: string;
  readonly counterArgument: string;
  readonly evidenceFactIds?: readonly string[] | undefined;
}

export interface ContentAngleItem {
  readonly angle: string;
  readonly targetPersona: string;
  readonly hookText: string;
  readonly recommendedPoints: readonly string[];
}

export interface ProductAnalysisContent {
  readonly summary: string;
  readonly benefits: readonly BenefitItem[];
  readonly differentiators: readonly DifferentiatorItem[];
  readonly evidenceGaps: readonly EvidenceGapItem[];
  readonly claimRisks: readonly ClaimRiskItem[];
  readonly objections: readonly ObjectionItem[];
  readonly contentAngles: readonly ContentAngleItem[];
}
