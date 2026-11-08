import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AnalysisSummaryDTO } from '../src/types/analysis.js';
import type { FactDTO } from '../src/types/catalog.js';
import type { ContentArtifactSummaryDTO, WorkOrderDetailDTO } from '../src/types/workforce.js';
import { AssignToAiTeamDialog } from '../src/components/workforce/assign-to-ai-team-dialog.js';
import { WorkOrderTimeline } from '../src/components/workforce/work-order-timeline.js';
import { PlanningArtifactCard } from '../src/components/workforce/planning-artifact-card.js';
import { RenderVideoSeriesPlan } from '../src/components/workforce/artifact-content-renderers.js';
import { WorkforceHeaderControls } from '../src/components/workforce/workforce-header-controls.js';

describe('Workforce Web Components Rendering', () => {
  const mockFact: FactDTO = {
    id: 'f-1',
    workspaceId: '018f6c5b-21a4-789a-8def-000000000002',
    productId: '018f6c5b-21a4-789a-8def-000000000003',
    factSetId: 'fact-1',
    factKey: 'claim',
    valueText: '100% natural',
    sourceType: 'document',
    sourceUrl: null,
    sourceExcerpt: null,
    confidence: 'confirmed',
    claimUsage: 'allowed',
    createdAt: '2026-11-08T12:00:00.000Z',
  };

  const mockAnalysis: AnalysisSummaryDTO = {
    id: 'a-1',
    productId: '018f6c5b-21a4-789a-8def-000000000003',
    analysisType: 'product',
    status: 'accepted',
    factSetRevision: 1,
    provider: 'google',
    model: 'gemini-3.8-flash',
    version: 1,
    createdAt: '2026-11-08T12:00:00.000Z',
    updatedAt: '2026-11-08T12:00:00.000Z',
  };
  const dummyDetail: WorkOrderDetailDTO = {
    workOrder: {
      id: '018f6c5b-21a4-789a-8def-000000000001',
      workspaceId: '018f6c5b-21a4-789a-8def-000000000002',
      productId: '018f6c5b-21a4-789a-8def-000000000003',
      contextPackageId: '018f6c5b-21a4-789a-8def-000000000004',
      missionType: 'single_product_affiliate_launch',
      graphTemplate: 'creative_office_v1',
      graphVersion: 1,
      status: 'in_progress',
      priority: 50,
      createdByUserId: '018f6c5b-21a4-789a-8def-000000000005',
      failureCategory: null,
      completedAt: null,
      createdAt: '2026-11-08T12:00:00.000Z',
      updatedAt: '2026-11-08T12:00:00.000Z',
      version: 1,
    },
    contextPackage: {
      id: '018f6c5b-21a4-789a-8def-000000000004',
      workspaceId: '018f6c5b-21a4-789a-8def-000000000002',
      productId: '018f6c5b-21a4-789a-8def-000000000003',
      factSetId: 'fact-1',
      contextSchemaVersion: 1,
      contextHashHex: 'hash',
      analysisIds: [],
      createdByUserId: '018f6c5b-21a4-789a-8def-000000000005',
      createdAt: '2026-11-08T12:00:00.000Z',
    },
    workItems: [
      {
        id: 'wi-1',
        workOrderId: '018f6c5b-21a4-789a-8def-000000000001',
        roleDefinitionId: 'rd-1',
        roleKey: 'product_strategist',
        taskKey: 'product_strategy',
        expectedArtifactType: 'product_campaign_plan',
        status: 'queued',
        blockedReasonCode: null,
        startedAt: null,
        completedAt: null,
        createdAt: '2026-11-08T12:00:00.000Z',
        updatedAt: '2026-11-08T12:00:00.000Z',
        version: 1,
      },
      {
        id: 'wi-4',
        workOrderId: '018f6c5b-21a4-789a-8def-000000000001',
        roleDefinitionId: 'rd-4',
        roleKey: 'scriptwriter',
        taskKey: 'scriptwriting',
        expectedArtifactType: 'script_package',
        status: 'waiting_dependency',
        blockedReasonCode: 'waiting_on_planning',
        startedAt: null,
        completedAt: null,
        createdAt: '2026-11-08T12:00:00.000Z',
        updatedAt: '2026-11-08T12:00:00.000Z',
        version: 1,
      },
    ],
    assignments: [
      {
        id: 'as-1',
        workOrderId: '018f6c5b-21a4-789a-8def-000000000001',
        roleDefinitionId: 'rd-1',
        roleKey: 'product_strategist',
        workItemId: 'wi-1',
        officeState: 'queued',
        waitingOnWorkItemId: null,
        latestReportCode: null,
        createdAt: '2026-11-08T12:00:00.000Z',
        updatedAt: '2026-11-08T12:00:00.000Z',
        version: 1,
      },
    ],
    dependencies: [],
  };

  it('renders AssignToAiTeamDialog with execution summary and 3 planning calls cap', () => {
    const html = renderToStaticMarkup(
      <AssignToAiTeamDialog
        isOpen={true}
        canManage={true}
        hasConfirmedFacts={true}
        confirmedFacts={[mockFact]}
        acceptedAnalyses={[mockAnalysis]}
        aiEnabled={true}
        availableBudgetMicrounits={1000000}
        isSubmitting={false}
        error={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(html).toContain('Assign Mission to AI Team');
    expect(html).toContain('Single-Product Affiliate Launch');
    expect(html).toContain('3 parallel calls');
    expect(html).toContain('$0.15');
    expect(html).toContain('Product Analysis (a-1)');
  });

  it('renders AssignToAiTeamDialog with disabled reason when missing confirmed facts', () => {
    const html = renderToStaticMarkup(
      <AssignToAiTeamDialog
        isOpen={true}
        canManage={true}
        hasConfirmedFacts={false}
        confirmedFacts={[]}
        acceptedAnalyses={[mockAnalysis]}
        aiEnabled={true}
        availableBudgetMicrounits={1000000}
        isSubmitting={false}
        error={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(html).toContain('A confirmed fact set is required before assigning to the AI team.');
  });

  it('renders WorkOrderTimeline with all 6 employees and dependency notice', () => {
    const html = renderToStaticMarkup(
      <WorkOrderTimeline detail={dummyDetail} onInspectEmployee={vi.fn()} />,
    );

    expect(html).toContain('Chief of Staff');
    expect(html).toContain('Product Strategist');
    expect(html).toContain('Audience Strategist');
    expect(html).toContain('Creative Director');
    expect(html).toContain('Scriptwriter');
    expect(html).toContain('Compliance Reviewer');
    expect(html).toContain(
      'Waiting for: Product Strategist, Audience Strategist, Creative Director',
    );
    expect(html).toContain('Inspect Employee →');
  });

  it('renders PlanningArtifactCard with role and revision badge', () => {
    const artifact: ContentArtifactSummaryDTO = {
      id: 'art-1',
      workspaceId: 'ws-1',
      productId: 'prod-1',
      workOrderId: 'wo-1',
      workItemId: 'wi-1',
      assignmentId: 'as-1',
      authorRoleKey: 'product_strategist',
      artifactType: 'product_campaign_plan',
      lifecycleStatus: 'review_required',
      currentRevisionNumber: 2,
      createdAt: '2026-11-08T12:00:00.000Z',
      updatedAt: '2026-11-08T12:00:00.000Z',
      version: 1,
    };

    const html = renderToStaticMarkup(
      <PlanningArtifactCard artifact={artifact} onOpen={vi.fn()} />,
    );

    expect(html).toContain('Product Campaign Plan');
    expect(html).toContain('Author: Product Strategist');
    expect(html).toContain('Rev #2');
    expect(html).toContain('View Artifact →');
  });

  it('renders RenderVideoSeriesPlan showing 5 video deliverables', () => {
    const content = {
      seriesTitle: 'ErgoComfort 5-Day Launch',
      summary: 'High impact launch series',
      narrativeConcept: 'From chronic pain to flow state',
      videos: [
        {
          videoNumber: 1,
          purpose: 'Disrupt scrolling with lumbar pain test',
          hook: 'If you sit like this for 4 hours, stop.',
          narrativeRole: 'Pain agitator',
          visualDirection: 'Close up of poor posture with red thermal overlay',
          ctaDirection: 'Save this post to check your desk setup',
        },
        {
          videoNumber: 2,
          purpose: 'Expose cheap foam padding degradation',
          hook: 'Why your $200 office chair ruined your back in 3 months.',
          narrativeRole: 'Mechanism breakdown',
          visualDirection: 'Cut-away view of standard foam vs patented mesh',
          ctaDirection: 'Link in bio for full breakdown',
        },
        {
          videoNumber: 3,
          purpose: 'Demo active lumbar support adjustment',
          hook: 'The 10-second adjustment that relieved my sciatica.',
          narrativeRole: 'Solution demonstration',
          visualDirection: 'Side angle clicking lumbar dial into place',
          ctaDirection: 'Check current discount code in bio',
        },
        {
          videoNumber: 4,
          purpose: 'Address high price objection with daily math',
          hook: 'Cheaper than your daily oat milk latte.',
          narrativeRole: 'Value justification',
          visualDirection: 'Split screen coffee cup vs 5-year warranty chair',
          ctaDirection: 'Grab the limited 30-day trial',
        },
        {
          videoNumber: 5,
          purpose: 'Urgency & final social proof roundup',
          hook: 'Last chance before the early bird inventory sells out.',
          narrativeRole: 'Final call to action',
          visualDirection: 'Fast cuts of user reviews and unboxing clip',
          ctaDirection: 'Use coupon code FLOW20 at checkout',
        },
      ],
    };

    const html = renderToStaticMarkup(<RenderVideoSeriesPlan content={content} />);

    expect(html).toContain('ErgoComfort 5-Day Launch');
    expect(html).toContain('Approved 5-Video Mission Deliverables');
    expect(html).toContain('Video #1: Disrupt scrolling with lumbar pain test');
    expect(html).toContain('Video #5: Urgency &amp; final social proof roundup');
  });

  it('renders WorkforceHeaderControls with retry button on failure', () => {
    const failedDetail: WorkOrderDetailDTO = {
      ...dummyDetail,
      workOrder: {
        ...dummyDetail.workOrder,
        status: 'failed',
      },
    };

    const html = renderToStaticMarkup(
      <WorkforceHeaderControls
        workOrders={[dummyDetail.workOrder]}
        selectedWorkOrderId={dummyDetail.workOrder.id}
        activeDetail={failedDetail}
        isRetrying={false}
        onSelectWorkOrder={vi.fn()}
        onOpenAssignDialog={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(html).toContain('Retry Planning Steps');
  });
});
