'use client';

import { useEffect, useState, type ReactElement } from 'react';
import type { ContentArtifactDetailDTO } from '../../types/workforce.js';
import { fetchArtifactDetailApi } from '../../lib/workforce-api-client.js';
import { useEscapeKey } from '../../lib/use-escape-key.js';
import {
  RenderAudienceInsightBoard,
  RenderProductCampaignPlan,
  RenderVideoSeriesPlan,
} from './artifact-content-renderers.js';
import { ContentStudio } from './content-studio/content-studio.js';

interface ArtifactViewerModalProps {
  readonly isOpen: boolean;
  readonly workspaceId: string;
  readonly artifactId: string | null;
  readonly onClose: () => void;
}

export function ArtifactViewerModal({
  isOpen,
  workspaceId,
  artifactId,
  onClose,
}: ArtifactViewerModalProps): ReactElement | null {
  const [detail, setDetail] = useState<ContentArtifactDetailDTO | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEscapeKey(onClose, loading, isOpen);

  useEffect(() => {
    if (!isOpen || !artifactId) {
      setDetail(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchArtifactDetailApi(workspaceId, artifactId)
      .then((res) => {
        if (!cancelled) setDetail(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load artifact');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, workspaceId, artifactId]);

  if (!isOpen) return null;

  if (detail?.artifact.artifactType === 'script_package') {
    return (
      <div className="modal-backdrop" role="presentation">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="artifact-modal-title"
          className="modal-content workforce-artifact-modal content-studio-modal-wrapper"
          style={{ maxWidth: '1100px', width: '95vw', maxHeight: '92vh', overflowY: 'auto' }}
        >
          <ContentStudio
            workspaceId={workspaceId}
            artifactId={detail.artifact.id}
            initialDetail={detail}
            onClose={onClose}
          />
        </div>
      </div>
    );
  }

  const renderContent = () => {
    if (!detail) return null;
    const { artifactType } = detail.artifact;
    const content = detail.latestRevision.contentJson;

    switch (artifactType) {
      case 'product_campaign_plan':
        return <RenderProductCampaignPlan content={content} />;
      case 'audience_insight_board':
        return <RenderAudienceInsightBoard content={content} />;
      case 'video_series_plan':
        return <RenderVideoSeriesPlan content={content} />;
      default:
        return <pre className="bg-light p-3 rounded">{JSON.stringify(content, null, 2)}</pre>;
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="artifact-modal-title"
        className="modal-content workforce-artifact-modal"
      >
        <div className="modal-header">
          <div>
            <h3 id="artifact-modal-title" className="modal-title">
              {detail ? detail.artifact.artifactType : 'Artifact Details'}
            </h3>
            {detail && (
              <span className="text-muted text-xs">
                Author: {detail.artifact.authorRoleKey} &bull; Revision #
                {detail.artifact.currentRevisionNumber}
              </span>
            )}
          </div>
          <button type="button" className="btn-close" onClick={onClose} aria-label="Close viewer">
            &times;
          </button>
        </div>

        <div className="modal-body my-3">
          {loading && <p className="text-muted">Loading artifact details...</p>}
          {error && <div className="alert-danger p-2 mb-3">{error}</div>}

          {detail && (
            <>
              <div className="provenance-banner p-2 mb-3 bg-light rounded text-xs d-flex justify-content-between">
                <div>
                  <strong>Model:</strong> {detail.latestRevision.provider} /{' '}
                  {detail.latestRevision.model}
                </div>
                <div>
                  <strong>Cost:</strong>{' '}
                  {detail.latestRevision.costMicrounits
                    ? `$${(detail.latestRevision.costMicrounits / 1000000).toFixed(4)}`
                    : 'N/A'}{' '}
                  &bull; <strong>Latency:</strong> {detail.latestRevision.latencyMs ?? 'N/A'}ms
                </div>
              </div>

              {renderContent()}

              {detail.evidenceReferences.length > 0 && (
                <div className="evidence-refs-section mt-4 pt-3 border-top">
                  <h6>Verified Evidence Sources ({detail.evidenceReferences.length})</h6>
                  <ul className="text-xs text-muted mb-0">
                    {detail.evidenceReferences.map((ref) => (
                      <li key={ref.id}>
                        {ref.sourceKind === 'product_fact' ? 'Product Fact' : 'Analysis'} ID:{' '}
                        <code>{ref.sourceId}</code>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
