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
        resourceType: 'work_item',
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
    expect(vm.overview.canRetry).toBe(true); // creative_direction failed
    expect(vm.overview.canCancel).toBe(true); // not terminal
  });

  describe('Retry eligibility gating (TASK-015-REMEDIATION Requirement 1)', () => {
    const baseWorkOrder = {
      id: 'wo-retry-test',
      workspaceId: 'ws-1',
      productId: 'prod-1',
      contextPackageId: 'cp-1',
      missionType: 'single_product_affiliate_launch',
      graphTemplate: 'template_v1',
      graphVersion: 1,
      status: 'in_progress' as const,
      priority: 0,
      createdByUserId: 'u-1',
      failureCategory: null,
      completedAt: null,
      createdAt: '2026-11-18T00:00:00Z',
      updatedAt: '2026-11-18T00:00:00Z',
      version: 1,
    };

    it('enables retry when a planning task has failed', () => {
      const detail: WorkOrderDetailDTO = {
        workOrder: baseWorkOrder,
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
        workItems: [
          {
            id: 'wi-ps',
            workOrderId: 'wo-retry-test',
            roleDefinitionId: 'rd-ps',
            roleKey: 'product_strategist',
            taskKey: 'product_strategy',
            expectedArtifactType: 'product_campaign_plan',
            status: 'failed',
            blockedReasonCode: 'PROVIDER_UNAVAILABLE',
            startedAt: null,
            completedAt: null,
            createdAt: '2026-11-18T00:00:00Z',
            updatedAt: '2026-11-18T00:00:00Z',
            version: 1,
          },
        ],
        assignments: [],
        dependencies: [],
      };

      const vm = mapWorkforceViewModel({ detail, artifacts: [], activities: [] });
      expect(vm.overview.canRetry).toBe(true);
    });

    it('enables retry when scriptwriting task has failed', () => {
      const detail: WorkOrderDetailDTO = {
        workOrder: { ...baseWorkOrder, status: 'failed' },
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
        workItems: [
          {
            id: 'wi-sw',
            workOrderId: 'wo-retry-test',
            roleDefinitionId: 'rd-sw',
            roleKey: 'scriptwriter',
            taskKey: 'scriptwriting',
            expectedArtifactType: 'script_package',
            status: 'failed',
            blockedReasonCode: 'RATE_LIMITED',
            startedAt: null,
            completedAt: null,
            createdAt: '2026-11-18T00:00:00Z',
            updatedAt: '2026-11-18T00:00:00Z',
            version: 1,
          },
        ],
        assignments: [],
        dependencies: [],
      };

      const vm = mapWorkforceViewModel({ detail, artifacts: [], activities: [] });
      expect(vm.overview.canRetry).toBe(true);
    });

    it('denies retry when only compliance review failed (not retriable by planning route)', () => {
      const detail: WorkOrderDetailDTO = {
        workOrder: { ...baseWorkOrder, status: 'failed' },
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
        workItems: [
          {
            id: 'wi-cr',
            workOrderId: 'wo-retry-test',
            roleDefinitionId: 'rd-cr',
            roleKey: 'compliance_reviewer',
            taskKey: 'compliance_review',
            expectedArtifactType: 'compliance_report',
            status: 'failed',
            blockedReasonCode: 'UNSUPPORTED_CLAIM',
            startedAt: null,
            completedAt: null,
            createdAt: '2026-11-18T00:00:00Z',
            updatedAt: '2026-11-18T00:00:00Z',
            version: 1,
          },
        ],
        assignments: [],
        dependencies: [],
      };

      const vm = mapWorkforceViewModel({ detail, artifacts: [], activities: [] });
      expect(vm.overview.canRetry).toBe(false);
    });

    it('denies retry when work order is completed or canceled even if an old item says failed', () => {
      const completedDetail: WorkOrderDetailDTO = {
        workOrder: { ...baseWorkOrder, status: 'completed' },
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
        workItems: [
          {
            id: 'wi-ps',
            workOrderId: 'wo-retry-test',
            roleDefinitionId: 'rd-ps',
            roleKey: 'product_strategist',
            taskKey: 'product_strategy',
            expectedArtifactType: 'product_campaign_plan',
            status: 'failed',
            blockedReasonCode: null,
            startedAt: null,
            completedAt: null,
            createdAt: '2026-11-18T00:00:00Z',
            updatedAt: '2026-11-18T00:00:00Z',
            version: 1,
          },
        ],
        assignments: [],
        dependencies: [],
      };

      const canceledDetail: WorkOrderDetailDTO = {
        ...completedDetail,
        workOrder: { ...baseWorkOrder, status: 'canceled' },
      };

      expect(
        mapWorkforceViewModel({ detail: completedDetail, artifacts: [], activities: [] }).overview
          .canRetry,
      ).toBe(false);
      expect(
        mapWorkforceViewModel({ detail: canceledDetail, artifacts: [], activities: [] }).overview
          .canRetry,
      ).toBe(false);
    });

    it('denies retry when canManage is false (viewer role)', () => {
      const detail: WorkOrderDetailDTO = {
        workOrder: baseWorkOrder,
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
        workItems: [
          {
            id: 'wi-ps',
            workOrderId: 'wo-retry-test',
            roleDefinitionId: 'rd-ps',
            roleKey: 'product_strategist',
            taskKey: 'product_strategy',
            expectedArtifactType: 'product_campaign_plan',
            status: 'failed',
            blockedReasonCode: null,
            startedAt: null,
            completedAt: null,
            createdAt: '2026-11-18T00:00:00Z',
            updatedAt: '2026-11-18T00:00:00Z',
            version: 1,
          },
        ],
        assignments: [],
        dependencies: [],
      };

      const vm = mapWorkforceViewModel({ detail, artifacts: [], activities: [], canManage: false });
      expect(vm.overview.canRetry).toBe(false);
    });
  });

  describe('Activity association and trail correctness (TASK-015-REMEDIATION Requirement 2)', () => {
    const detail: WorkOrderDetailDTO = {
      workOrder: {
        id: 'wo-act-test',
        workspaceId: 'ws-1',
        productId: 'prod-1',
        contextPackageId: 'cp-1',
        missionType: 'single_product_affiliate_launch',
        graphTemplate: 'template_v1',
        graphVersion: 1,
        status: 'in_progress',
        priority: 0,
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
      workItems: [
        {
          id: 'wi-ps-1',
          workOrderId: 'wo-act-test',
          roleDefinitionId: 'rd-ps',
          roleKey: 'product_strategist',
          taskKey: 'product_strategy',
          expectedArtifactType: 'product_campaign_plan',
          status: 'completed',
          blockedReasonCode: null,
          startedAt: null,
          completedAt: null,
          createdAt: '2026-11-18T00:00:00Z',
          updatedAt: '2026-11-18T00:00:00Z',
          version: 1,
        },
        {
          id: 'wi-sw-1',
          workOrderId: 'wo-act-test',
          roleDefinitionId: 'rd-sw',
          roleKey: 'scriptwriter',
          taskKey: 'scriptwriting',
          expectedArtifactType: 'script_package',
          status: 'running',
          blockedReasonCode: null,
          startedAt: null,
          completedAt: null,
          createdAt: '2026-11-18T00:00:00Z',
          updatedAt: '2026-11-18T00:00:00Z',
          version: 1,
        },
      ],
      assignments: [
        {
          id: 'as-ps-1',
          workOrderId: 'wo-act-test',
          roleDefinitionId: 'rd-ps',
          roleKey: 'product_strategist',
          workItemId: 'wi-ps-1',
          officeState: 'completed',
          waitingOnWorkItemId: null,
          latestReportCode: 'DONE',
          createdAt: '2026-11-18T00:00:00Z',
          updatedAt: '2026-11-18T00:00:00Z',
          version: 1,
        },
      ],
      dependencies: [],
    };

    const artifacts: ContentArtifactSummaryDTO[] = [
      {
        id: 'art-ps-plan',
        workspaceId: 'ws-1',
        productId: 'prod-1',
        workOrderId: 'wo-act-test',
        workItemId: 'wi-ps-1',
        assignmentId: 'as-ps-1',
        authorRoleKey: 'product_strategist',
        artifactType: 'product_campaign_plan',
        lifecycleStatus: 'accepted',
        currentRevisionNumber: 1,
        createdAt: '2026-11-18T00:01:00Z',
        updatedAt: '2026-11-18T00:01:00Z',
        version: 1,
      },
    ];

    it('associates content_artifact events with the artifact author role only', () => {
      const activities: WorkOrderActivityDTO[] = [
        {
          id: 'act-art-created',
          action: 'artifact.created',
          resourceType: 'content_artifact',
          resourceId: 'art-ps-plan',
          result: 'succeeded',
          occurredAt: '2026-11-18T00:01:00Z',
          changesJson: { artifactType: 'product_campaign_plan', revisionNumber: 1 },
        },
      ];

      const vm = mapWorkforceViewModel({ detail, artifacts, activities });
      const ps = vm.employees.find((e) => e.roleKey === 'product_strategist')!;
      const sw = vm.employees.find((e) => e.roleKey === 'scriptwriter')!;
      const cr = vm.employees.find((e) => e.roleKey === 'compliance_reviewer')!;

      expect(ps.relevantActivities).toHaveLength(1);
      expect(ps.relevantActivities[0]!.id).toBe('act-art-created');
      expect(sw.relevantActivities).toHaveLength(0);
      expect(cr.relevantActivities).toHaveLength(0);
    });

    it('associates work_item events with the work item role only', () => {
      const activities: WorkOrderActivityDTO[] = [
        {
          id: 'act-wi-failed',
          action: 'work_item.failed',
          resourceType: 'work_item',
          resourceId: 'wi-sw-1',
          result: 'failed',
          occurredAt: '2026-11-18T00:02:00Z',
          changesJson: { workOrderId: 'wo-act-test' },
        },
      ];

      const vm = mapWorkforceViewModel({ detail, artifacts, activities });
      const sw = vm.employees.find((e) => e.roleKey === 'scriptwriter')!;
      const ps = vm.employees.find((e) => e.roleKey === 'product_strategist')!;

      expect(sw.relevantActivities).toHaveLength(1);
      expect(sw.relevantActivities[0]!.id).toBe('act-wi-failed');
      expect(ps.relevantActivities).toHaveLength(0);
    });

    it('excludes work-order-wide events with no safe role association from employee trails', () => {
      const activities: WorkOrderActivityDTO[] = [
        {
          id: 'act-wo-kickoff',
          action: 'work_order.kickoff',
          resourceType: 'work_order',
          resourceId: 'wo-act-test',
          result: 'succeeded',
          occurredAt: '2026-11-18T00:00:00Z',
          changesJson: { missionType: 'single_product_affiliate_launch' },
        },
      ];

      const vm = mapWorkforceViewModel({ detail, artifacts, activities });
      for (const emp of vm.employees) {
        expect(emp.relevantActivities).toHaveLength(0);
      }
    });
  });

  describe('Lifecycle summaries and handoff semantics (TASK-015-REMEDIATION Requirement 4)', () => {
    const baseWo = {
      id: 'wo-summary-test',
      workspaceId: 'ws-1',
      productId: 'prod-1',
      contextPackageId: 'cp-1',
      missionType: 'single_product_affiliate_launch',
      graphTemplate: 'template_v1',
      graphVersion: 1,
      status: 'completed' as const,
      priority: 0,
      createdByUserId: 'u-1',
      failureCategory: null,
      completedAt: '2026-11-18T00:10:00Z',
      createdAt: '2026-11-18T00:00:00Z',
      updatedAt: '2026-11-18T00:10:00Z',
      version: 1,
    };

    const baseDetail: WorkOrderDetailDTO = {
      workOrder: baseWo,
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
      workItems: [],
      assignments: [],
      dependencies: [],
    };

    it('distinguishes review-required summary when deliverables need human action', () => {
      const artifacts: ContentArtifactSummaryDTO[] = [
        {
          id: 'art-sw',
          workspaceId: 'ws-1',
          productId: 'prod-1',
          workOrderId: 'wo-summary-test',
          workItemId: 'wi-1',
          assignmentId: 'as-1',
          authorRoleKey: 'scriptwriter',
          artifactType: 'script_package',
          lifecycleStatus: 'review_required',
          currentRevisionNumber: 1,
          createdAt: '2026-11-18T00:05:00Z',
          updatedAt: '2026-11-18T00:05:00Z',
          version: 1,
        },
      ];

      const vm = mapWorkforceViewModel({
        detail: { ...baseDetail, workOrder: { ...baseWo, status: 'in_progress' } },
        artifacts,
        activities: [],
      });

      expect(vm.overview.screenReaderSummary).toBe(
        'AI Workforce: Deliverables produced. Human review and approval required.',
      );
      expect(vm.overview.humanActionRequired).toBe(true);
    });

    it('distinguishes accepted/completed summary when all deliverables are accepted', () => {
      const artifacts: ContentArtifactSummaryDTO[] = [
        {
          id: 'art-sw',
          workspaceId: 'ws-1',
          productId: 'prod-1',
          workOrderId: 'wo-summary-test',
          workItemId: 'wi-1',
          assignmentId: 'as-1',
          authorRoleKey: 'scriptwriter',
          artifactType: 'script_package',
          lifecycleStatus: 'accepted',
          currentRevisionNumber: 1,
          createdAt: '2026-11-18T00:05:00Z',
          updatedAt: '2026-11-18T00:05:00Z',
          version: 1,
        },
      ];

      const vm = mapWorkforceViewModel({
        detail: baseDetail,
        artifacts,
        activities: [],
      });

      expect(vm.overview.screenReaderSummary).toBe(
        'AI Workforce: All deliverables accepted. Mission completed and approved.',
      );
    });

    it('distinguishes completed without pending reviews summary', () => {
      const vm = mapWorkforceViewModel({
        detail: baseDetail,
        artifacts: [],
        activities: [],
      });

      expect(vm.overview.screenReaderSummary).toBe(
        'AI Workforce: Mission completed. No pending human reviews.',
      );
    });

    it('distinguishes canceled outcome truthfully', () => {
      const vm = mapWorkforceViewModel({
        detail: { ...baseDetail, workOrder: { ...baseWo, status: 'canceled' } },
        artifacts: [],
        activities: [],
      });

      expect(vm.overview.screenReaderSummary).toBe('AI Workforce: Mission was canceled.');
    });
  });

  describe('Operational reason codes normalization (TASK-015-REMEDIATION Requirement 3)', () => {
    it('normalizes lowercase persisted codes and uppercase legacy codes', () => {
      const wiLower: WorkItemSummaryDTO = {
        id: 'wi-1',
        workOrderId: 'wo-1',
        roleDefinitionId: 'rd-1',
        roleKey: 'scriptwriter',
        taskKey: 'scriptwriting',
        expectedArtifactType: 'script_package',
        status: 'blocked',
        blockedReasonCode: 'insufficient_budget',
        startedAt: null,
        completedAt: null,
        createdAt: '2026-11-18T00:00:00Z',
        updatedAt: '2026-11-18T00:00:00Z',
        version: 1,
      };

      const wiRate: WorkItemSummaryDTO = {
        ...wiLower,
        blockedReasonCode: 'rate_limited',
      };

      const wiRetry: WorkItemSummaryDTO = {
        ...wiLower,
        blockedReasonCode: 'retry_wait',
      };

      const vm1 = mapWorkforceViewModel({
        detail: {
          workOrder: {
            id: 'wo-1',
            workspaceId: 'ws-1',
            productId: 'p-1',
            contextPackageId: 'cp-1',
            missionType: 'single_product_affiliate_launch',
            graphTemplate: 't-1',
            graphVersion: 1,
            status: 'in_progress',
            priority: 0,
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
            productId: 'p-1',
            factSetId: 'fs-1',
            contextSchemaVersion: 1,
            contextHashHex: 'hash',
            analysisIds: [],
            createdByUserId: 'u-1',
            createdAt: '2026-11-18T00:00:00Z',
          },
          workItems: [wiLower],
          assignments: [],
          dependencies: [],
        },
        artifacts: [],
        activities: [],
      });

      const sw = vm1.employees.find((e) => e.roleKey === 'scriptwriter')!;
      expect(sw.operationalDetails.isBudgetExhausted).toBe(true);
      expect(sw.operationalDetails.actionableMessage).toContain('budget exhausted');

      const vm2 = mapWorkforceViewModel({
        detail: {
          ...vm1.overview,
          workOrder: {
            id: 'wo-1',
            workspaceId: 'ws-1',
            productId: 'p-1',
            contextPackageId: 'cp-1',
            missionType: 'single_product_affiliate_launch',
            graphTemplate: 't-1',
            graphVersion: 1,
            status: 'in_progress',
            priority: 0,
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
            productId: 'p-1',
            factSetId: 'fs-1',
            contextSchemaVersion: 1,
            contextHashHex: 'hash',
            analysisIds: [],
            createdByUserId: 'u-1',
            createdAt: '2026-11-18T00:00:00Z',
          },
          workItems: [wiRate],
          assignments: [],
          dependencies: [],
        },
        artifacts: [],
        activities: [],
      });

      const sw2 = vm2.employees.find((e) => e.roleKey === 'scriptwriter')!;
      expect(sw2.operationalDetails.isRateLimited).toBe(true);

      const vm3 = mapWorkforceViewModel({
        detail: {
          workOrder: {
            id: 'wo-1',
            workspaceId: 'ws-1',
            productId: 'p-1',
            contextPackageId: 'cp-1',
            missionType: 'single_product_affiliate_launch',
            graphTemplate: 't-1',
            graphVersion: 1,
            status: 'in_progress',
            priority: 0,
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
            productId: 'p-1',
            factSetId: 'fs-1',
            contextSchemaVersion: 1,
            contextHashHex: 'hash',
            analysisIds: [],
            createdByUserId: 'u-1',
            createdAt: '2026-11-18T00:00:00Z',
          },
          workItems: [wiRetry],
          assignments: [],
          dependencies: [],
        },
        artifacts: [],
        activities: [],
      });

      const sw3 = vm3.employees.find((e) => e.roleKey === 'scriptwriter')!;
      expect(sw3.operationalDetails.isRetryWait).toBe(true);
    });
  });
});
