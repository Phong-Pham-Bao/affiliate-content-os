import { describe, expect, it } from 'vitest';
import {
  parseAgentRoleDefinitionId,
  parseIsoTimestamp,
  parseWorkItemDependencyId,
  parseWorkItemId,
  parseWorkOrderId,
  parseWorkspaceId,
  type WorkItemDependencySnapshot,
  type WorkItemSnapshot,
} from '@affiliate-content-os/domain';
import { identifyEligibleWorkItems } from '../../src/workforce/index.js';

describe('identifyEligibleWorkItems Application Logic', () => {
  const wsId = parseWorkspaceId('018f0000-0000-7000-8000-000000000001');
  const orderId = parseWorkOrderId('018f0000-0000-7000-8000-000000000002');
  const roleDefId = parseAgentRoleDefinitionId('018f0000-0000-7000-8000-000000000003');
  const ts = parseIsoTimestamp('2026-11-07T10:00:00.000Z');

  const pItem: WorkItemSnapshot = {
    id: parseWorkItemId('018f0000-0000-7000-8000-000000000011'),
    workspaceId: wsId,
    workOrderId: orderId,
    roleDefinitionId: roleDefId,
    taskKey: 'product_strategy',
    expectedArtifactType: 'product_campaign_plan',
    status: 'ready',
    blockedReasonCode: null,
    startedAt: null,
    completedAt: null,
    createdAt: ts,
    updatedAt: ts,
    version: 1,
  };

  const aItem: WorkItemSnapshot = {
    ...pItem,
    id: parseWorkItemId('018f0000-0000-7000-8000-000000000012'),
    taskKey: 'audience_strategy',
    expectedArtifactType: 'audience_insight_board',
  };

  const cItem: WorkItemSnapshot = {
    ...pItem,
    id: parseWorkItemId('018f0000-0000-7000-8000-000000000013'),
    taskKey: 'creative_direction',
    expectedArtifactType: 'video_series_plan',
  };

  const sItem: WorkItemSnapshot = {
    ...pItem,
    id: parseWorkItemId('018f0000-0000-7000-8000-000000000014'),
    taskKey: 'scriptwriting',
    expectedArtifactType: 'script_package',
    status: 'waiting_dependency',
  };

  const qItem: WorkItemSnapshot = {
    ...pItem,
    id: parseWorkItemId('018f0000-0000-7000-8000-000000000015'),
    taskKey: 'compliance_review',
    expectedArtifactType: 'compliance_report',
    status: 'waiting_dependency',
  };

  const dependencies: WorkItemDependencySnapshot[] = [
    {
      id: parseWorkItemDependencyId('018f0000-0000-7000-8000-000000000021'),
      workspaceId: wsId,
      workOrderId: orderId,
      workItemId: sItem.id,
      dependsOnWorkItemId: pItem.id,
      createdAt: ts,
    },
    {
      id: parseWorkItemDependencyId('018f0000-0000-7000-8000-000000000022'),
      workspaceId: wsId,
      workOrderId: orderId,
      workItemId: sItem.id,
      dependsOnWorkItemId: aItem.id,
      createdAt: ts,
    },
    {
      id: parseWorkItemDependencyId('018f0000-0000-7000-8000-000000000023'),
      workspaceId: wsId,
      workOrderId: orderId,
      workItemId: sItem.id,
      dependsOnWorkItemId: cItem.id,
      createdAt: ts,
    },
    {
      id: parseWorkItemDependencyId('018f0000-0000-7000-8000-000000000024'),
      workspaceId: wsId,
      workOrderId: orderId,
      workItemId: qItem.id,
      dependsOnWorkItemId: sItem.id,
      createdAt: ts,
    },
  ];

  const allItems = [pItem, aItem, cItem, sItem, qItem];

  it('identifies zero eligible waiting items when no dependencies are completed', () => {
    const eligible = identifyEligibleWorkItems({
      workItems: allItems,
      dependencies,
      completedWorkItemIds: [],
    });

    expect(eligible).toHaveLength(0);
  });

  it('identifies zero eligible waiting items when only partial dependencies are completed', () => {
    const eligible = identifyEligibleWorkItems({
      workItems: allItems,
      dependencies,
      completedWorkItemIds: [pItem.id, aItem.id],
    });

    expect(eligible).toHaveLength(0);
  });

  it('identifies scriptwriting as eligible when all 3 planning items are completed', () => {
    const eligible = identifyEligibleWorkItems({
      workItems: allItems,
      dependencies,
      completedWorkItemIds: [pItem.id, aItem.id, cItem.id],
    });

    expect(eligible).toHaveLength(1);
    expect(eligible[0]?.id).toBe(sItem.id);
    expect(eligible[0]?.taskKey).toBe('scriptwriting');
  });

  it('identifies compliance_review as eligible only after scriptwriting is completed', () => {
    const eligible = identifyEligibleWorkItems({
      workItems: allItems,
      dependencies,
      completedWorkItemIds: [pItem.id, aItem.id, cItem.id, sItem.id],
    });

    // Both sItem and qItem have all dependencies completed (sItem is still waiting_dependency in this input snapshot)
    expect(eligible.map((e) => e.taskKey)).toEqual(['scriptwriting', 'compliance_review']);
  });
});
