'use client';

import type { ReactElement } from 'react';

interface CoreBenefitItem {
  readonly benefit?: string;
  readonly evidenceRefs?: readonly unknown[];
}

interface CreativeHypothesisItem {
  readonly hypothesis?: string;
  readonly rationale?: string;
}

interface PainPointItem {
  readonly painPoint?: string;
  readonly impact?: string;
}

interface RecommendedHookItem {
  readonly hook?: string;
  readonly emotionalTrigger?: string;
}

interface VideoDeliverableItem {
  readonly videoNumber?: number;
  readonly purpose?: string;
  readonly narrativeRole?: string;
  readonly hook?: string;
  readonly visualDirection?: string;
  readonly ctaDirection?: string;
}

export function RenderProductCampaignPlan({
  content,
}: {
  readonly content: Record<string, unknown>;
}): ReactElement {
  const summary = typeof content.summary === 'string' ? content.summary : '';
  const positioningStatement =
    typeof content.positioningStatement === 'string' ? content.positioningStatement : '';
  const campaignGoals = Array.isArray(content.campaignGoals)
    ? (content.campaignGoals as readonly string[])
    : null;
  const coreBenefits = Array.isArray(content.coreBenefits)
    ? (content.coreBenefits as readonly CoreBenefitItem[])
    : null;
  const creativeHypotheses = Array.isArray(content.creativeHypotheses)
    ? (content.creativeHypotheses as readonly CreativeHypothesisItem[])
    : null;

  return (
    <div className="rendered-plan text-sm">
      <div className="mb-3">
        <h6>Summary & Positioning</h6>
        <p className="text-muted">{summary}</p>
        <blockquote className="p-2 bg-light border-left">
          <strong>Positioning:</strong> {positioningStatement}
        </blockquote>
      </div>

      {campaignGoals && (
        <div className="mb-3">
          <h6>Campaign Goals</h6>
          <ul>
            {campaignGoals.map((g, idx) => (
              <li key={idx}>{g}</li>
            ))}
          </ul>
        </div>
      )}

      {coreBenefits && (
        <div className="mb-3">
          <h6>Core Benefits</h6>
          {coreBenefits.map((b, idx) => (
            <div key={idx} className="mb-1">
              <span>&bull; {b.benefit}</span>
              {Array.isArray(b.evidenceRefs) && b.evidenceRefs.length > 0 && (
                <span className="badge badge-info ms-2 text-xs">
                  {b.evidenceRefs.length} Evidence Ref(s)
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {creativeHypotheses && (
        <div className="mb-3">
          <h6>Creative Hypotheses (Unverified Angles)</h6>
          {creativeHypotheses.map((h, idx) => (
            <div key={idx} className="mb-2 p-2 bg-light rounded text-xs">
              <strong>Hypothesis:</strong> {h.hypothesis}
              <br />
              <span className="text-muted">Rationale: {h.rationale}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function RenderAudienceInsightBoard({
  content,
}: {
  readonly content: Record<string, unknown>;
}): ReactElement {
  const summary = typeof content.summary === 'string' ? content.summary : '';
  const primaryTargetSegment =
    typeof content.primaryTargetSegment === 'string' ? content.primaryTargetSegment : '';
  const coreDesires = Array.isArray(content.coreDesires)
    ? (content.coreDesires as readonly string[])
    : null;
  const criticalPainPoints = Array.isArray(content.criticalPainPoints)
    ? (content.criticalPainPoints as readonly PainPointItem[])
    : null;
  const recommendedHooks = Array.isArray(content.recommendedHooks)
    ? (content.recommendedHooks as readonly RecommendedHookItem[])
    : null;

  return (
    <div className="rendered-plan text-sm">
      <div className="mb-3">
        <h6>Audience Overview</h6>
        <p className="text-muted">{summary}</p>
        <p>
          <strong>Primary Target:</strong> {primaryTargetSegment}
        </p>
      </div>

      {coreDesires && (
        <div className="mb-3">
          <h6>Core Desires</h6>
          <ul>
            {coreDesires.map((d, idx) => (
              <li key={idx}>{d}</li>
            ))}
          </ul>
        </div>
      )}

      {criticalPainPoints && (
        <div className="mb-3">
          <h6>Critical Pain Points</h6>
          {criticalPainPoints.map((p, idx) => (
            <div key={idx} className="mb-2">
              <strong>{p.painPoint}</strong>
              <p className="text-muted text-xs mb-0">Impact: {p.impact}</p>
            </div>
          ))}
        </div>
      )}

      {recommendedHooks && (
        <div className="mb-3">
          <h6>Recommended Hooks</h6>
          {recommendedHooks.map((h, idx) => (
            <div key={idx} className="mb-1 p-2 bg-light rounded">
              <em>&ldquo;{h.hook}&rdquo;</em>
              <span className="text-muted text-xs ms-2">[{h.emotionalTrigger}]</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function RenderVideoSeriesPlan({
  content,
}: {
  readonly content: Record<string, unknown>;
}): ReactElement {
  const seriesTitle = typeof content.seriesTitle === 'string' ? content.seriesTitle : '';
  const summary = typeof content.summary === 'string' ? content.summary : '';
  const narrativeConcept =
    typeof content.narrativeConcept === 'string' ? content.narrativeConcept : '';
  const videos = Array.isArray(content.videos)
    ? (content.videos as readonly VideoDeliverableItem[])
    : null;

  return (
    <div className="rendered-plan text-sm">
      <div className="mb-3">
        <h6>{seriesTitle || 'Video Series Concept'}</h6>
        <p className="text-muted">{summary}</p>
        <p className="text-xs">
          <strong>Narrative Arc:</strong> {narrativeConcept}
        </p>
      </div>

      <h6>Approved 5-Video Mission Deliverables</h6>
      {videos && (
        <div className="video-ideas-list">
          {videos.map((v, idx) => (
            <div key={idx} className="video-card p-3 mb-2 border rounded bg-white">
              <div className="d-flex justify-content-between">
                <strong>
                  Video #{v.videoNumber ?? idx + 1}: {v.purpose}
                </strong>
                <span className="badge badge-primary">{v.narrativeRole}</span>
              </div>
              <div className="my-2">
                <strong>Hook:</strong> <em>&ldquo;{v.hook}&rdquo;</em>
              </div>
              <div className="text-xs text-muted mb-1">
                <strong>Visual Direction:</strong> {v.visualDirection}
              </div>
              <div className="text-xs text-muted">
                <strong>Call to Action:</strong> {v.ctaDirection}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
