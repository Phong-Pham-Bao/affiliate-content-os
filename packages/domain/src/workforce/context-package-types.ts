import { createHash } from 'node:crypto';
import type { AnalysisId } from '../analysis/ids.js';
import type { ProductFactSetId, ProductId } from '../catalog/ids.js';
import type { UserId, WorkspaceId } from '../ids.js';
import type { IsoTimestamp } from '../timestamps.js';
import type { ContextPackageId } from './ids.js';

export interface ContextPackageSnapshot {
  readonly id: ContextPackageId;
  readonly workspaceId: WorkspaceId;
  readonly productId: ProductId;
  readonly factSetId: ProductFactSetId;
  readonly contextSchemaVersion: number;
  readonly contextHash: Uint8Array;
  readonly createdByUserId: UserId;
  readonly createdAt: IsoTimestamp;
}

export interface ContextPackageAnalysisSnapshot {
  readonly workspaceId: WorkspaceId;
  readonly contextPackageId: ContextPackageId;
  readonly analysisId: AnalysisId;
  readonly createdAt: IsoTimestamp;
}

export interface CanonicalContextAnalysisRef {
  readonly analysisId: string;
  readonly version: number;
}

export interface CanonicalContextDescriptor {
  readonly workspaceId: string;
  readonly productId: string;
  readonly productVersion: number;
  readonly factSetId: string;
  readonly factSetVersion: number;
  readonly analyses: readonly CanonicalContextAnalysisRef[];
  readonly schemaVersion: number;
}

export function computeCanonicalContextHash(descriptor: CanonicalContextDescriptor): Uint8Array {
  const analysisMap = new Map<string, number>();
  for (const a of descriptor.analyses) {
    analysisMap.set(String(a.analysisId), Number(a.version));
  }
  const sortedAnalyses = Array.from(analysisMap.entries())
    .map(([analysisId, version]) => ({ analysisId, version }))
    .sort((a, b) => a.analysisId.localeCompare(b.analysisId));

  const canonicalPayload = JSON.stringify({
    analyses: sortedAnalyses,
    factSetId: String(descriptor.factSetId),
    factSetVersion: Number(descriptor.factSetVersion),
    productId: String(descriptor.productId),
    productVersion: Number(descriptor.productVersion),
    schemaVersion: Number(descriptor.schemaVersion),
    workspaceId: String(descriptor.workspaceId),
  });

  const digest = createHash('sha256').update(canonicalPayload, 'utf8').digest();
  return new Uint8Array(digest);
}
