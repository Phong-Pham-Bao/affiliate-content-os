'use client';

import type { ReactElement } from 'react';
import type { ContentArtifactSummaryDTO } from '../../types/workforce.js';
import { ROLE_METADATA } from '../../lib/workforce-view-model-roles.js';

interface DeliverablesSectionProps {
  readonly artifacts: readonly ContentArtifactSummaryDTO[];
  readonly onOpenArtifact: (artifactId: string) => void;
}

const STAGES = [
  {
    id: 'planning',
    title: 'Stage 1: Strategy & Planning Intelligence',
    types: ['work_plan', 'product_campaign_plan', 'audience_insight_board', 'video_series_plan'],
  },
  {
    id: 'content',
    title: 'Stage 2: Scriptwriting & Creative Direction',
    types: ['script_package', 'script', 'shot_list', 'caption_variant'],
  },
  {
    id: 'quality',
    title: 'Stage 3: Advisory Compliance Evaluation',
    types: ['compliance_report', 'executive_summary'],
  },
];

function humanizeType(type: string): string {
  return type
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function getBadgeClass(status: string): string {
  switch (status) {
    case 'accepted':
      return 'badge-success';
    case 'review_required':
      return 'badge-warning';
    case 'rejected':
      return 'badge-danger';
    default:
      return 'badge-secondary';
  }
}

export function DeliverablesSection({
  artifacts,
  onOpenArtifact,
}: DeliverablesSectionProps): ReactElement | null {
  if (artifacts.length === 0) return null;

  return (
    <section
      className="deliverables-section mt-4"
      role="region"
      aria-label="Campaign Deliverables & Reports"
    >
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h3 className="section-title m-0 text-base">Campaign Deliverables & Verified Reports</h3>
        <span className="badge badge-info">{artifacts.length} Total Artifacts</span>
      </div>

      <div className="stages-container d-flex flex-column gap-3">
        {STAGES.map((stage) => {
          const stageArtifacts = artifacts.filter((a) => stage.types.includes(a.artifactType));
          if (stageArtifacts.length === 0) return null;

          return (
            <div key={stage.id} className="stage-group p-3 border rounded bg-white">
              <h4 className="stage-title text-sm text-uppercase text-muted mb-2">{stage.title}</h4>
              <div className="stage-artifacts-grid d-flex flex-wrap gap-2">
                {stageArtifacts.map((art) => {
                  const roleMeta = ROLE_METADATA[art.authorRoleKey];
                  const roleTitle = roleMeta ? roleMeta.title : art.authorRoleKey;
                  const isReviewRequired = art.lifecycleStatus === 'review_required';

                  return (
                    <div
                      key={art.id}
                      className={`deliverable-card p-3 border rounded ${isReviewRequired ? 'border-warning bg-warning-subtle' : 'bg-light'}`}
                      style={{ minWidth: '240px', flex: '1 1 240px' }}
                    >
                      <div className="d-flex justify-content-between align-items-start mb-1">
                        <div>
                          <strong className="artifact-type text-sm d-block">
                            {humanizeType(art.artifactType)}
                          </strong>
                          <span className="artifact-author text-xs text-muted">By {roleTitle}</span>
                        </div>
                        <span className={`badge ${getBadgeClass(art.lifecycleStatus)}`}>
                          {art.lifecycleStatus}
                        </span>
                      </div>

                      <div className="d-flex justify-content-between align-items-center mt-2 pt-2 border-top text-xs text-muted">
                        <span>Rev #{art.currentRevisionNumber}</span>
                        <button
                          type="button"
                          className="btn btn-primary btn-xs"
                          onClick={() => onOpenArtifact(art.id)}
                          aria-label={`Open deliverable: ${humanizeType(art.artifactType)}`}
                        >
                          View Deliverable &rarr;
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
