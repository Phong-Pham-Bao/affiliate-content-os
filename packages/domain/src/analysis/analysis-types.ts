import type { IsoTimestamp } from '../timestamps.js';
import type { UserId, WorkspaceId } from '../ids.js';
import type { ProductFactSetId, ProductId } from '../catalog/ids.js';
import type { AIRunId, AnalysisId } from './ids.js';

export const ANALYSIS_TYPES = ['product', 'niche', 'performance'] as const;
export type AnalysisType = (typeof ANALYSIS_TYPES)[number];

export function isAnalysisType(value: unknown): value is AnalysisType {
  return typeof value === 'string' && (ANALYSIS_TYPES as readonly string[]).includes(value);
}

export const ANALYSIS_STATUSES = ['generated', 'accepted', 'rejected'] as const;
export type AnalysisStatus = (typeof ANALYSIS_STATUSES)[number];

export function isAnalysisStatus(value: unknown): value is AnalysisStatus {
  return typeof value === 'string' && (ANALYSIS_STATUSES as readonly string[]).includes(value);
}

export const ANALYSIS_SUBJECT_TYPES = ['product', 'fact_set', 'analysis'] as const;
export type AnalysisSubjectType = (typeof ANALYSIS_SUBJECT_TYPES)[number];

export function isAnalysisSubjectType(value: unknown): value is AnalysisSubjectType {
  return typeof value === 'string' && (ANALYSIS_SUBJECT_TYPES as readonly string[]).includes(value);
}

export const ANALYSIS_SUBJECT_ROLES = [
  'primary_subject',
  'grounding_source',
  'input_analysis',
] as const;
export type AnalysisSubjectRole = (typeof ANALYSIS_SUBJECT_ROLES)[number];

export function isAnalysisSubjectRole(value: unknown): value is AnalysisSubjectRole {
  return typeof value === 'string' && (ANALYSIS_SUBJECT_ROLES as readonly string[]).includes(value);
}

export interface AnalysisSnapshot<TContent = unknown> {
  readonly id: AnalysisId;
  readonly workspaceId: WorkspaceId;
  readonly productId: ProductId;
  readonly analysisType: AnalysisType;
  readonly revisionNumber: number;
  readonly factSetId: ProductFactSetId;
  readonly aiRunId: AIRunId;
  readonly contentJson: TContent;
  readonly schemaVersion: number;
  readonly status: AnalysisStatus;
  readonly reviewedByUserId: UserId | null;
  readonly reviewedAt: IsoTimestamp | null;
  readonly reviewReason: string | null;
  readonly createdByUserId: UserId;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
  readonly version: number;
}

export interface AnalysisSubjectSnapshot {
  readonly workspaceId: WorkspaceId;
  readonly analysisId: AnalysisId;
  readonly subjectType: AnalysisSubjectType;
  readonly role: AnalysisSubjectRole;
  readonly subjectProductId: ProductId | null;
  readonly subjectFactSetId: ProductFactSetId | null;
  readonly subjectAnalysisId: AnalysisId | null;
  readonly createdAt: IsoTimestamp;
}
