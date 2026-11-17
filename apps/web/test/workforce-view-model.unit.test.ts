import { describe, expect, it } from 'vitest';
import type {
  ContentArtifactSummaryDTO,
  WorkItemSummaryDTO,
  WorkOrderDetailDTO,
  WorkOrderActivityDTO,
} from '../src/types/workforce.js';
import { mapWorkforceViewModel, ORDERED_ROLES } from '../src/lib/workforce-view-model.js';

describe('workforce-view-model pure mapping layer', () => {
  it('maps empty/null detail into an honest idle workforce state with 6 canonical roles', () => {
    const vm = mapWorkforceViewModel({
      detail: null,
      artifacts: [],
      activities: [],
    });

    expect(vm.employees).toHaveLength(6);
    expect(vm.employees.map((e) => e.roleKey)).toEqual(ORDERED_ROLES);
    for (const emp of vm.employees) {
      expect(emp.officeState).toBe('idle');
      expect(emp.positionClass).toBe('pos-idle');
      expect(emp.statusLabel).toBe('Idle');
      expect(emp.badgeVariant).toBe('secondary');
      expect(emp.deliverables).toHaveLength(0);
      expect(emp.relevantActivities).toHaveLength(0);
    }
    expect(vm.overview.status).toBe('no_order');
    expect(vm.overview.screenReaderSummary).toBe('AI Workforce: No active mission assigned.');
    expect(vm.overview.canRetry).toBe(false);
    expect(vm.overview.canCancel).toBe(false);
  });

  it('maps every real office state and position class correctly', () => {
    const workItems: WorkItemSummaryDTO[] = [
      {
        id: 'wi-1',
        workOrderId: 'wo-1',
        roleDefinitionId: 'rd-1',
        roleKey: 'chief_of_staff',
        taskKey: 'orchestration',
        expectedArtifactType: 'work_plan',
        status: 'completed',
        blockedReasonCode: null,
        startedAt: '2026-11-18T00:00:00Z',
        completedAt: '2026-11-18T00:01:00Z',
        createdAt: '2026-11-18T00:00:00Z',
        updatedAt: '2026-11-18T00:01:00Z',
        version: 1,
      },
      {
        id: 'wi-2',
        workOrderId: 'wo-1',
        roleDefinitionId: 'rd-2',
        roleKey: 'product_strategist',
        taskKey: 'product_strategy',
        expectedArtifactType: 'product_campaign_plan',
        status: 'in_progress',
        blockedReasonCode: null,
        startedAt: '2026-11-18T00:00:00Z',
        completedAt: null,
        createdAt: '2026-11-18T00:00:00Z',
        updatedAt: '2026-11-18T00:00:00Z',
        version: 1,
      },
      {
        id: 'wi-3',
        workOrderId: 'wo-1',
        roleDefinitionId: 'rd-3',
        roleKey: 'audience_strategist',
        taskKey: 'audience_strategy',
        expectedArtifactType: 'audience_insight_board',
        status: 'waiting_dependency',
        blockedReasonCode: null,
        startedAt: null,
        completedAt: null,
        createdAt: '2026-11-18T00:00:00Z',
        updatedAt: '2026-11-18T00:00:00Z',
        version: 1,
      },
      {
        id: 'wi-4',
        workOrderId: 'wo-1',
        roleDefinitionId: 'rd-4',
        roleKey: 'creative_director',
        taskKey: 'creative_direction',
        expectedArtifactType: 'video_series_plan',
        status: 'failed',
        blockedReasonCode: 'PROVIDER_UNAVAILABLE',
        startedAt: '2026-11-18T00:00:00Z',
        completedAt: null,
        createdAt: '2026-11-18T00:00:00Z',
        updatedAt: '2026-11-18T00:00:00Z',
        version: 1,
      },
      {
        id: 'wi-5',
        workOrderId: 'wo-1',
        roleDefinitionId: 'rd-5',
        roleKey: 'scriptwriter',
        taskKey: 'script_package',
        expectedArtifactType: 'script_package',
        status: 'waiting_dependency',
        blockedReasonCode: null,
        startedAt: null,
        completedAt: null,
        createdAt: '2026-11-18T00:00:00Z',
        updatedAt: '2026-11-18T00:00:00Z',
        version: 1,
      },
      {
        id: 'wi-6',
        workOrderId: 'wo-1',
        roleDefinitionId: 'rd-6',
        roleKey: 'compliance_reviewer',
        taskKey: 'compliance_review',
        expectedArtifactType: 'compliance_report',
        status: 'ready',
        blockedReasonCode: null,
        startedAt: null,
        completedAt: null,
        createdAt: '2026-11-18T00:00:00Z',
        updatedAt: '2026-11-18T00:00:00Z',
        version: 1,
      },
    ];

    const detail: WorkOrderDetailDTO = {
      workOrder: {
        id: 'wo-1',
        workspaceId: 'ws-1',
        productId: 'prod-1',
        contextPackageId: 'cp-1',
        missionType: 'single_product_affiliate_launch',
        graphTemplate: 'single_product_affiliate_launch',
        graphVersion: 1,
        status: 'in_progress',
        priority: 1,
        createdByUserId: 'u-1',
        failureCategory: null,
        completedAt: null,
        createdAt: '2026-11-18T00:00:00Z',
        updatedAt: '2026-11-18T00:00:00Z',
        version: 1,
      },
      contextPackage: {
        id: 'cp-1',
        workspaceId: 'ws-1',
        productId: 'prod-1',
        factSetId: 'fs-1',
        contextSchemaVersion: 1,
        contextHashHex: 'hash',
        analysisIds: [],
        createdByUserId: 'u-1',
        createdAt: '2026-11-18T00:00:00Z',
      },
      workItems,
      assignments: [
        {
          id: 'as-1',
          workOrderId: 'wo-1',
          roleDefinitionId: 'rd-1',
          roleKey: 'chief_of_staff',
          workItemId: 'wi-1',
          officeState: 'completed',
          waitingOnWorkItemId: null,
          latestReportCode: 'HANDOFF_READY',
          createdAt: '2026-11-18T00:00:00Z',
          updatedAt: '2026-11-18T00:01:00Z',
          version: 1,
        },
        {
          id: 'as-2',
          workOrderId: 'wo-1',
          roleDefinitionId: 'rd-2',
          roleKey: 'product_strategist',
          workItemId: 'wi-2',
          officeState: 'running',
          waitingOnWorkItemId: null,
          latestReportCode: null,
          createdAt: '2026-11-18T00:00:00Z',
          updatedAt: '2026-11-18T00:00:00Z',
          version: 1,
        },
        {
          id: 'as-3',
          workOrderId: 'wo-1',
          roleDefinitionId: 'rd-3',
          roleKey: 'audience_strategist',
          workItemId: 'wi-3',
          officeState: 'waiting_dependency',
          waitingOnWorkItemId: 'wi-1',
          latestReportCode: null,
          createdAt: '2026-11-18T00:00:00Z',
          updatedAt: '2026-11-18T00:00:00Z',
          version: 1,
        },
        {
          id: 'as-4',
          workOrderId: 'wo-1',
          roleDefinitionId: 'rd-4',
          roleKey: 'creative_director',
          workItemId: 'wi-4',
          officeState: 'failed',
          waitingOnWorkItemId: null,
          latestReportCode: 'ERR_TIMEOUT',
          createdAt: '2026-11-18T00:00:00Z',
          updatedAt: '2026-11-18T00:00:00Z',
          version: 1,
        },
        {
          id: 'as-5',
          workOrderId: 'wo-1',
          roleDefinitionId: 'rd-5',
          roleKey: 'scriptwriter',
          workItemId: 'wi-5',
          officeState: 'review_required',
          waitingOnWorkItemId: null,
          latestReportCode: null,
          createdAt: '2026-11-18T00:00:00Z',
          updatedAt: '2026-11-18T00:00:00Z',
          version: 1,
        },
        {
          id: 'as-6',
          workOrderId: 'wo-1',
          roleDefinitionId: 'rd-6',
          roleKey: 'compliance_reviewer',
          workItemId: 'wi-6',
          officeState: 'preparing',
          waitingOnWorkItemId: null,
          latestReportCode: null,
          createdAt: '2026-11-18T00:00:00Z',
          updatedAt: '2026-11-18T00:00:00Z',
          version: 1,
        },
      ],
      dependencies: [
        {
          id: 'dep-1',
          workOrderId: 'wo-1',
          workItemId: 'wi-3',
          dependsOnWorkItemId: 'wi-1',
          createdAt: '2026-11-18T00:00:00Z',
        },
      ],
    };

    const artifacts: ContentArtifactSummaryDTO[] = [
      {
        id: 'art-1',
        workspaceId: 'ws-1',
        productId: 'prod-1',
        workOrderId: 'wo-1',
        workItemId: 'wi-1',
        assignmentId: 'as-1',
        authorRoleKey: 'chief_of_staff',
        artifactType: 'product_campaign_plan',
        lifecycleStatus: 'accepted',
        currentRevisionNumber: 1,
        createdAt: '2026-11-18T00:01:00Z',
        updatedAt: '2026-11-18T00:01:00Z',
        version: 1,
      },
    ];

    const activities: WorkOrderActivityDTO[] = [
      {
        id: 'act-1',
        action: 'work_item.started',
        resourceType: 'product_strategist',
        resourceId: 'wi-2',
        result: 'success',
        occurredAt: '2026-11-18T00:00:00Z',
        changesJson: {},
      },
    ];

    const vm = mapWorkforceViewModel({
      detail,
      artifacts,
      activities,
      isStale: false,
      isRefreshing: true,
      lastUpdatedAt: '2026-11-18T00:02:00Z',
    });

    expect(vm.isRefreshing).toBe(true);
    expect(vm.lastUpdatedAt).toBe('2026-11-18T00:02:00Z');

    // Chief of Staff -> completed, pos-archive
    const cos = vm.employees.find((e) => e.roleKey === 'chief_of_staff')!;
    expect(cos.officeState).toBe('completed');
    expect(cos.positionClass).toBe('pos-archive');
    expect(cos.statusLabel).toBe('Completed');
    expect(cos.deliverables).toHaveLength(1);
    expect(cos.latestReportCode).toBe('HANDOFF_READY');

    // Product Strategist -> running, pos-desk
    const ps = vm.employees.find((e) => e.roleKey === 'product_strategist')!;
    expect(ps.officeState).toBe('running');
    expect(ps.positionClass).toBe('pos-desk');
    expect(ps.statusLabel).toBe('Running');
    expect(ps.relevantActivities).toHaveLength(1);

    // Audience Strategist -> waiting_dependency, pos-dependency, named dependency
    const as = vm.employees.find((e) => e.roleKey === 'audience_strategist')!;
    expect(as.officeState).toBe('waiting_dependency');
    expect(as.positionClass).toBe('pos-dependency');
    expect(as.statusLabel).toBe('Waiting on Dependency');
    expect(as.namedDependencies).toHaveLength(1);
    expect(as.namedDependencies[0]!.roleName).toBe('Chief of Staff');

    // Creative Director -> failed, pos-attention, operational error derived
    const cd = vm.employees.find((e) => e.roleKey === 'creative_director')!;
    expect(cd.officeState).toBe('failed');
    expect(cd.positionClass).toBe('pos-attention');
    expect(cd.statusLabel).toBe('Failed');
    expect(cd.operationalDetails.isProviderOutage).toBe(true);
    expect(cd.operationalDetails.actionableMessage).toContain('temporarily unavailable');

    // Scriptwriter -> review_required, pos-review
    const sw = vm.employees.find((e) => e.roleKey === 'scriptwriter')!;
    expect(sw.officeState).toBe('review_required');
    expect(sw.positionClass).toBe('pos-review');
    expect(sw.statusLabel).toBe('Review Required');

    // Compliance Reviewer -> preparing, pos-desk
    const cr = vm.employees.find((e) => e.roleKey === 'compliance_reviewer')!;
    expect(cr.officeState).toBe('preparing');
    expect(cr.positionClass).toBe('pos-desk');
    expect(cr.statusLabel).toBe('Preparing');

    // Overview flags
    expect(vm.overview.counts.completed).toBe(1);
    expect(vm.overview.counts.running).toBe(1);
    expect(vm.overview.counts.waitingDependency).toBe(1);
    expect(vm.overview.counts.failed).toBe(1);
    expect(vm.overview.counts.reviewRequired).toBe(1);
    expect(vm.overview.counts.preparing).toBe(1);
    expect(vm.overview.humanActionRequired).toBe(true);
    expect(vm.overview.canRetry).toBe(true); // failure present
    expect(vm.overview.canCancel).toBe(true); // not terminal
  });
});
