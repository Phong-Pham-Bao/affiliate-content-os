import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AnalysisSummaryDTO, WorkspaceAIPolicyDTO } from '../src/types/analysis.js';
import type { FactDTO, FactSetDTO, ProductDTO } from '../src/types/catalog.js';
import { ProductDetailView } from '../src/components/catalog/product-detail-view.js';
import { AssignToAiTeamDialog } from '../src/components/workforce/assign-to-ai-team-dialog.js';
import { WorkforceCommandCenter } from '../src/components/workforce/workforce-command-center.js';

describe('ProductDetailView & WorkforceCommandCenter Real Data Wiring (Item 3)', () => {
  const dummyProduct: ProductDTO = {
    id: '0192b012-3456-789a-8bcd-ef0123456701',
    workspaceId: '0192b012-3456-789a-8bcd-ef0123456702',
    name: 'Ergonomic Desk Chair',
    merchantName: 'OfficePro',
    canonicalUrl: 'https://officepro.example.com/chair',
    category: 'furniture',
    description: 'High quality ergonomic lumbar support chair.',
    audienceNotes: 'Remote workers',
    allowedClaimsNotes: null,
    prohibitedClaimsNotes: null,
    currentFactSetId: '0192b012-3456-789a-8bcd-ef0123456703',
    status: 'active',
    createdAt: '2026-11-08T12:00:00.000Z',
    updatedAt: '2026-11-08T12:00:00.000Z',
    version: 1,
  };

  const dummyFactSet: FactSetDTO = {
    id: '0192b012-3456-789a-8bcd-ef0123456703',
    workspaceId: dummyProduct.workspaceId,
    productId: dummyProduct.id,
    revisionNumber: 1,
    status: 'confirmed',
    summary: 'Initial specs',
    confirmedByUserId: '0192b012-3456-789a-8bcd-ef0123456704',
    confirmedAt: '2026-11-08T12:00:00.000Z',
    createdByUserId: '0192b012-3456-789a-8bcd-ef0123456704',
    createdAt: '2026-11-08T12:00:00.000Z',
    updatedAt: '2026-11-08T12:00:00.000Z',
    version: 1,
  };

  const dummyFact: FactDTO = {
    id: '0192b012-3456-789a-8bcd-ef0123456705',
    workspaceId: dummyProduct.workspaceId,
    productId: dummyProduct.id,
    factSetId: dummyFactSet.id,
    factKey: 'lumbar_support',
    valueText: 'Dynamic lumbar support',
    sourceType: 'document',
    sourceUrl: null,
    sourceExcerpt: null,
    confidence: 'confirmed',
    claimUsage: 'allowed',
    createdAt: '2026-11-08T12:00:00.000Z',
  };

  const dummyAnalysis: AnalysisSummaryDTO = {
    id: '0192b012-3456-789a-8bcd-ef0123456706',
    productId: dummyProduct.id,
    analysisType: 'product',
    status: 'accepted',
    factSetRevision: 1,
    provider: 'google',
    model: 'gemini-3.8-flash',
    version: 1,
    createdAt: '2026-11-08T12:00:00.000Z',
    updatedAt: '2026-11-08T12:00:00.000Z',
  };

  const dummyPolicy: WorkspaceAIPolicyDTO = {
    workspaceId: dummyProduct.workspaceId,
    aiEnabled: true,
    monthlyBudgetMicrounits: 1000000,
    currentSpendMicrounits: 200000,
    reservedSpendMicrounits: 100000,
    rateLimitPerMinute: 60,
    budgetPeriodStart: '2026-11-01T00:00:00.000Z',
    version: 1,
    updatedAt: '2026-11-08T12:00:00.000Z',
  };

  const renderProductDetail = (overrides?: {
    readonly initialAcceptedAnalyses?: readonly AnalysisSummaryDTO[];
    readonly initialAIPolicy?: WorkspaceAIPolicyDTO | null;
    readonly product?: ProductDTO;
  }) => {
    return renderToStaticMarkup(
      <ProductDetailView
        product={overrides?.product ?? dummyProduct}
        canManage={true}
        affiliates={[]}
        isAffiliatesLoading={false}
        affiliatesError={null}
        factSets={[dummyFactSet]}
        activeRevisionId={dummyFactSet.id}
        selectedRevisionFacts={[dummyFact]}
        isFactSetsLoading={false}
        isFactsLoading={false}
        factSetsError={null}
        onRefreshProduct={async () => {}}
        onUpdateProduct={async () => {}}
        onArchiveProduct={async () => {}}
        onRetryAffiliates={() => {}}
        onCreateAffiliate={async () => {}}
        onUpdateAffiliate={async () => {}}
        onArchiveAffiliate={async () => {}}
        onSelectRevision={() => {}}
        onRetryFactSets={() => {}}
        onProposeFactSet={async () => {}}
        onConfirmFactSet={async () => {}}
        affiliatesHasMore={false}
        isAffiliatesLoadingMore={false}
        onLoadMoreAffiliates={() => {}}
        factSetsHasMore={false}
        isFactSetsLoadingMore={false}
        onLoadMoreFactSets={() => {}}
        initialAcceptedAnalyses={overrides?.initialAcceptedAnalyses}
        initialAIPolicy={overrides?.initialAIPolicy}
      />,
    );
  };

  it('renders ProductDetailView passing real product facts and command center', () => {
    const html = renderProductDetail({
      initialAcceptedAnalyses: [dummyAnalysis],
      initialAIPolicy: dummyPolicy,
    });

    expect(html).toContain('AI Workforce Command Center');
    expect(html).toContain('Assign Mission to AI Team');
  });

  it('AssignToAiTeamDialog fails closed with honest checking message when readiness is loading/undefined', () => {
    const html = renderToStaticMarkup(
      <AssignToAiTeamDialog
        isOpen={true}
        canManage={true}
        hasConfirmedFacts={true}
        confirmedFacts={[dummyFact]}
        acceptedAnalyses={[dummyAnalysis]}
        aiEnabled={undefined}
        availableBudgetMicrounits={undefined}
        isLoadingContext={true}
        isSubmitting={false}
        error={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(html).toContain('Checking workspace AI readiness and budget...');
    expect(html).toContain('disabled');
  });

  it('AssignToAiTeamDialog fails closed when aiEnabled is false in workspace policy', () => {
    const html = renderToStaticMarkup(
      <AssignToAiTeamDialog
        isOpen={true}
        canManage={true}
        hasConfirmedFacts={true}
        confirmedFacts={[dummyFact]}
        acceptedAnalyses={[dummyAnalysis]}
        aiEnabled={false}
        availableBudgetMicrounits={5000000}
        isLoadingContext={false}
        isSubmitting={false}
        error={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(html).toContain('AI features are disabled in workspace AI policy.');
    expect(html).toContain('disabled');
  });

  it('AssignToAiTeamDialog fails closed when available budget is insufficient for 3 planning calls ($0.15 = 150,000)', () => {
    const html = renderToStaticMarkup(
      <AssignToAiTeamDialog
        isOpen={true}
        canManage={true}
        hasConfirmedFacts={true}
        confirmedFacts={[dummyFact]}
        acceptedAnalyses={[dummyAnalysis]}
        aiEnabled={true}
        availableBudgetMicrounits={50000} // only $0.05, needs $0.15
        isLoadingContext={false}
        isSubmitting={false}
        error={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(html).toContain('Insufficient workspace AI budget for the estimated 3 planning calls.');
    expect(html).toContain('disabled');
  });

  it('AssignToAiTeamDialog fails closed when zero accepted analyses exist', () => {
    const html = renderToStaticMarkup(
      <AssignToAiTeamDialog
        isOpen={true}
        canManage={true}
        hasConfirmedFacts={true}
        confirmedFacts={[dummyFact]}
        acceptedAnalyses={[]}
        aiEnabled={true}
        availableBudgetMicrounits={1000000}
        isLoadingContext={false}
        isSubmitting={false}
        error={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(html).toContain('At least one accepted product or niche analysis is required.');
    expect(html).toContain('disabled');
  });

  it('WorkforceCommandCenter contains zero invented budget or optimistic aiEnabled defaults', () => {
    // When rendered without explicit aiEnabled or budget, it must not invent $1000 budget or default to true
    const html = renderToStaticMarkup(
      <WorkforceCommandCenter
        workspaceId={dummyProduct.workspaceId}
        productId={dummyProduct.id}
        canManage={true}
        hasConfirmedFacts={true}
        confirmedFacts={[dummyFact]}
        acceptedAnalyses={[dummyAnalysis]}
      />,
    );

    // It renders command center, and modals will not have fake 1000000000 default
    expect(html).toContain('AI Workforce Command Center');
    expect(html).not.toContain('$1000.00');
  });
});
