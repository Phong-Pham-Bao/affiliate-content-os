import crypto from 'node:crypto';
import type { ProductId } from '../catalog/ids.js';
import type { WorkspaceId } from '../ids.js';
import type { WorkOrderId } from './ids.js';
import type { ProductCampaignPlan } from './product-campaign-plan-types.js';
import type { AudienceInsightBoard } from './audience-insight-board-types.js';
import type { VideoSeriesPlan } from './video-series-plan-types.js';

export interface PlanningRevisionsMeta {
  readonly productCampaignPlanRevisionId: string;
  readonly productCampaignPlanRevisionNumber: number;
  readonly audienceInsightBoardRevisionId: string;
  readonly audienceInsightBoardRevisionNumber: number;
  readonly videoSeriesPlanRevisionId: string;
  readonly videoSeriesPlanRevisionNumber: number;
}

export interface ContentBriefProductSummary {
  readonly productName: string;
  readonly merchantName: string;
  readonly category: string;
  readonly description: string;
}

export interface ContentBrief {
  readonly schemaVersion: 1;
  readonly workspaceId: WorkspaceId;
  readonly productId: ProductId;
  readonly workOrderId: WorkOrderId;
  readonly briefVersion: number;
  readonly directiveText: string;
  readonly brandVoice?: string | null | undefined;
  readonly disclosureRequirement?: string | null | undefined;
  readonly productSummary: ContentBriefProductSummary;
  readonly planningRevisions: PlanningRevisionsMeta;
  readonly campaignPlan: ProductCampaignPlan;
  readonly audienceBoard: AudienceInsightBoard;
  readonly seriesPlan: VideoSeriesPlan;
  readonly eligibleFactIds: readonly string[];
  readonly eligibleAnalysisIds: readonly string[];
  readonly createdAt: string;
}

function canonicalize(val: unknown): unknown {
  if (val === null || typeof val !== 'object') {
    return val;
  }
  if (Array.isArray(val)) {
    return val.map(canonicalize);
  }
  const obj = val as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const result: Record<string, unknown> = {};
  for (const k of sortedKeys) {
    if (obj[k] !== undefined) {
      result[k] = canonicalize(obj[k]);
    }
  }
  return result;
}

export function computeContentBriefHash(brief: ContentBrief): Uint8Array {
  const canonical = canonicalize({
    schemaVersion: brief.schemaVersion,
    workspaceId: brief.workspaceId,
    productId: brief.productId,
    workOrderId: brief.workOrderId,
    briefVersion: brief.briefVersion,
    directiveText: brief.directiveText,
    brandVoice: brief.brandVoice ?? null,
    disclosureRequirement: brief.disclosureRequirement ?? null,
    productSummary: brief.productSummary,
    planningRevisions: brief.planningRevisions,
    campaignPlan: brief.campaignPlan,
    audienceBoard: brief.audienceBoard,
    seriesPlan: brief.seriesPlan,
    eligibleFactIds: [...brief.eligibleFactIds].sort(),
    eligibleAnalysisIds: [...brief.eligibleAnalysisIds].sort(),
  });
  const jsonStr = JSON.stringify(canonical);
  const hash = crypto.createHash('sha256').update(jsonStr, 'utf8').digest();
  return new Uint8Array(hash);
}
