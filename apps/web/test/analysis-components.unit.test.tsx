import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AnalysisDTO, AnalysisSummaryDTO } from '../src/types/analysis.js';
import { AnalysisCard } from '../src/components/catalog/analysis-card.js';
import { AnalysisViewerModal } from '../src/components/catalog/analysis-viewer-modal.js';
import { RequestAnalysisDialog } from '../src/components/catalog/request-analysis-dialog.js';
import { AIPolicyPanel } from '../src/components/ai-policy-panel.js';

describe('Analysis Web Components Rendering', () => {
  const dummySummary: AnalysisSummaryDTO = {
    id: '0192b012-3456-789a-8bcd-ef0123456701',
    productId: '0192b012-3456-789a-8bcd-ef0123456702',
    analysisType: 'product',
    status: 'generated',
    factSetRevision: 2,
    provider: 'google',
    model: 'gemini-3.8-flash',
    version: 1,
    createdAt: '2026-11-06T12:00:00Z',
    updatedAt: '2026-11-06T12:00:00Z',
  };

  const dummyFullAnalysis: AnalysisDTO = {
    ...dummySummary,
    workspaceId: '0192b012-3456-789a-8bcd-ef0123456703',
    factSetId: '0192b012-3456-789a-8bcd-ef0123456704',
    content: {
      summary: 'High quality ergonomic desk chair',
      keyBenefits: ['Lumbar support', 'Breathable mesh'],
    },
    contentHash: 'hash-abc',
    isRepair: false,
    reviewedByUserId: null,
    reviewedAt: null,
    rejectionReason: null,
  };

  it('renders AnalysisCard with Pending Review and Unapproved Warning badge', () => {
    const html = renderToStaticMarkup(<AnalysisCard analysis={dummySummary} onView={vi.fn()} />);

    expect(html).toContain('PRODUCT');
    expect(html).toContain('Pending Review');
    expect(html).toContain('Revision #2');
    expect(html).toContain('gemini-3.8-flash');
    expect(html).toContain('AI Generated — Unapproved / Unverified');
  });

  it('renders AnalysisCard with Accepted badge without warning', () => {
    const acceptedSummary: AnalysisSummaryDTO = {
      ...dummySummary,
      status: 'accepted',
    };
    const html = renderToStaticMarkup(<AnalysisCard analysis={acceptedSummary} onView={vi.fn()} />);

    expect(html).toContain('Accepted');
    expect(html).not.toContain('Unapproved / Unverified');
  });

  it('renders AnalysisViewerModal with content and review buttons', () => {
    const html = renderToStaticMarkup(
      <AnalysisViewerModal
        analysis={dummyFullAnalysis}
        onClose={vi.fn()}
        onAccept={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(html).toContain('PRODUCT Analysis');
    expect(html).toContain('High quality ergonomic desk chair');
    expect(html).toContain('Accept Analysis');
    expect(html).toContain('Reject');
    expect(html).toContain('AI Generated — Unapproved / Unverified');
  });

  it('renders RequestAnalysisDialog with warning when no confirmed fact set exists', () => {
    const html = renderToStaticMarkup(
      <RequestAnalysisDialog
        productId="0192b012-3456-789a-8bcd-ef0123456702"
        factSetId={null}
        onEnqueue={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(html).toContain('does not have a confirmed fact set revision');
  });

  it('renders RequestAnalysisDialog form when fact set exists', () => {
    const html = renderToStaticMarkup(
      <RequestAnalysisDialog
        productId="0192b012-3456-789a-8bcd-ef0123456702"
        factSetId="0192b012-3456-789a-8bcd-ef0123456704"
        factSetRevision={1}
        onEnqueue={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(html).toContain('Request AI Content Analysis');
    expect(html).toContain('Product Analysis');
    expect(html).toContain('Niche Synthesis');
    expect(html).toContain('Request Analysis');
  });

  it('renders an accessible loading state for the owner AI policy panel', () => {
    const html = renderToStaticMarkup(
      <AIPolicyPanel workspaceId="0192b012-3456-789a-8bcd-ef0123456703" />,
    );

    expect(html).toContain('AI Policy &amp; Budget');
    expect(html).toContain('Loading AI policy...');
    expect(html).toContain('role="status"');
  });
});
