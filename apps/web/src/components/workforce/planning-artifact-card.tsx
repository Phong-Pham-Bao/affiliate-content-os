'use client';

import type { ReactElement } from 'react';
import type { ContentArtifactSummaryDTO } from '../../types/workforce.js';

interface PlanningArtifactCardProps {
  readonly artifact: ContentArtifactSummaryDTO;
  readonly onOpen: (artifactId: string) => void;
}

const ARTIFACT_TITLES: Record<string, { title: string; role: string }> = {
  product_campaign_plan: {
    title: 'Product Campaign Plan',
    role: 'Product Strategist',
  },
  audience_insight_board: {
    title: 'Audience Insight Board',
    role: 'Audience Strategist',
  },
  video_series_plan: {
    title: '5-Video Series Plan',
    role: 'Creative Director',
  },
  script_package: {
    title: 'Gói kịch bản 5 video (Script Package)',
    role: 'Scriptwriter',
  },
};

export function PlanningArtifactCard({
  artifact,
  onOpen,
}: PlanningArtifactCardProps): ReactElement {
  const meta = ARTIFACT_TITLES[artifact.artifactType] ?? {
    title: artifact.artifactType,
    role: artifact.authorRoleKey,
  };

  return (
    <div
      className="card planning-artifact-card"
      role="article"
      aria-labelledby={`art-title-${artifact.id}`}
    >
      <div className="card-header d-flex justify-content-between align-items-center">
        <div>
          <h5 id={`art-title-${artifact.id}`} className="card-title mb-1">
            {meta.title}
          </h5>
          <span className="text-muted text-xs">Author: {meta.role}</span>
        </div>
        <span className="badge badge-success">Rev #{artifact.currentRevisionNumber}</span>
      </div>

      <div className="card-body py-2">
        <p className="text-muted text-sm">
          Validated evidence-linked deliverable ready for human review.
        </p>
        <div className="text-xs text-muted mb-2">
          <span>Created: {new Date(artifact.createdAt).toLocaleTimeString()}</span>
        </div>
      </div>

      <div className="card-footer">
        <button
          type="button"
          className="btn-secondary btn-sm w-100"
          onClick={() => onOpen(artifact.id)}
          aria-label={`View ${meta.title}`}
        >
          View Artifact &rarr;
        </button>
      </div>
    </div>
  );
}
