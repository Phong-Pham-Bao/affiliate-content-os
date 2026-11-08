'use client';

import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import type {
  AnalysisDTO,
  AnalysisSummaryDTO,
  EnqueueAnalysisPayload,
  OperationDTO,
} from '../../types/analysis.js';
import {
  acceptAnalysisApi,
  enqueueAnalysisApi,
  fetchAnalysesApi,
  fetchAnalysisApi,
  pollOperationApi,
  rejectAnalysisApi,
} from '../../lib/catalog-api-client.js';
import { AnalysisCard } from './analysis-card.js';
import { AnalysisViewerModal } from './analysis-viewer-modal.js';
import { RequestAnalysisDialog } from './request-analysis-dialog.js';

interface AnalysesSectionProps {
  readonly workspaceId: string;
  readonly productId: string;
  readonly factSetId: string | null;
  readonly factSetRevision?: number | null | undefined;
  readonly canManage?: boolean | undefined;
  readonly onAnalysesChanged?: ((analyses: readonly AnalysisSummaryDTO[]) => void) | undefined;
}

export function AnalysesSection({
  workspaceId,
  productId,
  factSetId,
  factSetRevision,
  canManage = true,
  onAnalysesChanged,
}: AnalysesSectionProps): ReactElement {
  const [analyses, setAnalyses] = useState<readonly AnalysisSummaryDTO[]>([]);
  const [activeOperation, setActiveOperation] = useState<OperationDTO | null>(null);
  const [isRequestOpen, setIsRequestOpen] = useState(false);
  const [selectedAnalysis, setSelectedAnalysis] = useState<AnalysisDTO | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const loadAnalyses = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchAnalysesApi(workspaceId, productId);
      setAnalyses(res.items);
      onAnalysesChanged?.(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analyses.');
    } finally {
      setLoading(false);
    }
  }, [workspaceId, productId]);

  useEffect(() => {
    void loadAnalyses();
    return () => {
      abortControllerRef.current?.abort();
    };
  }, [loadAnalyses]);

  const handleEnqueue = async (payload: EnqueueAnalysisPayload, idempotencyKey: string) => {
    setError(null);
    const res = await enqueueAnalysisApi(workspaceId, productId, payload, idempotencyKey);
    setIsRequestOpen(false);

    abortControllerRef.current?.abort();
    const ctrl = new AbortController();
    abortControllerRef.current = ctrl;

    try {
      setActiveOperation({
        id: res.operationId,
        workspaceId,
        operationType: payload.analysisType === 'product' ? 'product_analysis' : 'niche_analysis',
        status: res.status,
        resourceId: productId,
        resourceType: 'product',
        progressPercent: null,
        errorCode: null,
        errorCategory: null,
        errorMessage: null,
        startedAt: null,
        completedAt: null,
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      const completed = await pollOperationApi(workspaceId, res.operationId, ctrl.signal, (op) => {
        setActiveOperation(op);
      });
      setActiveOperation(completed);
      await loadAnalyses();
    } catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) {
        setError(err instanceof Error ? err.message : 'Operation polling failed.');
      }
    }
  };

  const handleViewAnalysis = async (analysisId: string) => {
    try {
      const analysis = await fetchAnalysisApi(workspaceId, analysisId);
      setSelectedAnalysis(analysis);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analysis details.');
    }
  };

  const handleAccept = async (analysisId: string, version: number) => {
    await acceptAnalysisApi(workspaceId, analysisId, version);
    await loadAnalyses();
  };

  const handleReject = async (analysisId: string, version: number, reason?: string) => {
    await rejectAnalysisApi(workspaceId, analysisId, version, reason);
    await loadAnalyses();
  };

  const acceptedProductAnalyses = analyses.filter(
    (a) => a.analysisType === 'product' && a.status === 'accepted',
  );

  return (
    <div className="analyses-section" style={{ marginTop: '2rem' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '1rem',
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: '1.25rem' }}>AI Content Analyses</h3>
          <p style={{ margin: 0, fontSize: '0.875rem', color: '#6b7280' }}>
            Authoritative, evidence-grounded content analysis and synthesis.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setIsRequestOpen(true)}
            className="btn btn-primary"
            style={{ fontSize: '0.875rem' }}
          >
            + Request Analysis
          </button>
        )}
      </div>

      {error && (
        <div className="banner banner-error" role="alert" style={{ marginBottom: '1rem' }}>
          {error}
        </div>
      )}

      {activeOperation && activeOperation.status !== 'succeeded' && (
        <div
          className="banner banner-info"
          role="status"
          style={{
            marginBottom: '1rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <strong>Operation in Progress:</strong> {activeOperation.status.toUpperCase()}
            {activeOperation.errorMessage && (
              <div style={{ color: '#b91c1c', marginTop: '0.25rem' }}>
                Error: {activeOperation.errorMessage}
              </div>
            )}
          </div>
          {activeOperation.status === 'failed' && canManage && (
            <button
              type="button"
              onClick={() => setIsRequestOpen(true)}
              className="btn btn-outline"
              style={{ fontSize: '0.75rem' }}
            >
              Retry
            </button>
          )}
        </div>
      )}

      {loading && analyses.length === 0 ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af' }}>
          Loading analyses...
        </div>
      ) : analyses.length === 0 ? (
        <div
          style={{
            padding: '2rem',
            textAlign: 'center',
            color: '#9ca3af',
            border: '1px dashed #e5e7eb',
            borderRadius: '0.5rem',
          }}
        >
          No analyses generated yet for this product.
        </div>
      ) : (
        <div className="analyses-list">
          {analyses.map((a) => (
            <AnalysisCard key={a.id} analysis={a} onView={handleViewAnalysis} />
          ))}
        </div>
      )}

      {isRequestOpen && (
        <RequestAnalysisDialog
          productId={productId}
          factSetId={factSetId}
          factSetRevision={factSetRevision}
          availableSourceAnalyses={acceptedProductAnalyses}
          onEnqueue={handleEnqueue}
          onCancel={() => setIsRequestOpen(false)}
        />
      )}

      {selectedAnalysis && (
        <AnalysisViewerModal
          analysis={selectedAnalysis}
          onClose={() => setSelectedAnalysis(null)}
          onAccept={canManage ? handleAccept : undefined}
          onReject={canManage ? handleReject : undefined}
        />
      )}
    </div>
  );
}
