import { describe, expect, it } from 'vitest';
import {
  normalizeOfficeState,
  validateAgentRoleKey,
  validateContentArtifactDetail,
  validateContentArtifactList,
  validateContentArtifactSummary,
  validateKickoffResult,
  validateRetryResult,
  validateWorkItemStatus,
  validateWorkOrderActivityList,
  validateWorkOrderDetail,
  validateWorkOrderList,
  validateWorkOrderMissionType,
  validateWorkOrderStatus,
  validateWorkOrderSummary,
} from '../src/lib/workforce-validators.js';

describe('Workforce Web Validators', () => {
  const validSummary = {
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
  };

  it('validates a correct work order summary', () => {
    const validated = validateWorkOrderSummary(validSummary);
    expect(validated.id).toBe(validSummary.id);
    expect(validated.status).toBe('in_progress');
    expect(validated.priority).toBe(50);
  });

  it('rejects work order summary when not an object', () => {
    expect(() => validateWorkOrderSummary('not an object')).toThrow();
    expect(() => validateWorkOrderSummary(null)).toThrow();
  });

  it('validates work order list response', () => {
    const listRes = {
      items: [validSummary],
      nextCursor: 'next-123',
    };
    const validated = validateWorkOrderList(listRes);
    expect(validated.items).toHaveLength(1);
    expect(validated.nextCursor).toBe('next-123');
  });

  it('validates work order detail response with context, items, and assignments', () => {
    const detailRes = {
      workOrder: validSummary,
      contextPackage: {
        id: '018f6c5b-21a4-789a-8def-000000000004',
        workspaceId: validSummary.workspaceId,
        productId: validSummary.productId,
        factSetId: '018f6c5b-21a4-789a-8def-000000000006',
        contextSchemaVersion: 1,
        contextHashHex: 'abc123hash',
        analysisIds: ['018f6c5b-21a4-789a-8def-000000000007'],
        createdByUserId: validSummary.createdByUserId,
        createdAt: '2026-11-08T12:00:00.000Z',
      },
      workItems: [
        {
          id: '018f6c5b-21a4-789a-8def-000000000008',
          workOrderId: validSummary.id,
          roleDefinitionId: '018f6c5b-21a4-789a-8def-000000000009',
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
      ],
      assignments: [
        {
          id: '018f6c5b-21a4-789a-8def-000000000010',
          workOrderId: validSummary.id,
          roleDefinitionId: '018f6c5b-21a4-789a-8def-000000000009',
          roleKey: 'product_strategist',
          workItemId: '018f6c5b-21a4-789a-8def-000000000008',
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

    const validated = validateWorkOrderDetail(detailRes);
    expect(validated.workOrder.id).toBe(validSummary.id);
    expect(validated.contextPackage.analysisIds).toHaveLength(1);
    expect(validated.workItems).toHaveLength(1);
    expect(validated.assignments).toHaveLength(1);
  });

  it('validates content artifact summary and detail', () => {
    const artSummary = {
      id: '018f6c5b-21a4-789a-8def-000000000020',
      workspaceId: validSummary.workspaceId,
      productId: validSummary.productId,
      workOrderId: validSummary.id,
      workItemId: '018f6c5b-21a4-789a-8def-000000000008',
      assignmentId: '018f6c5b-21a4-789a-8def-000000000010',
      authorRoleKey: 'product_strategist',
      artifactType: 'product_campaign_plan',
      lifecycleStatus: 'review_required',
      currentRevisionNumber: 1,
      createdAt: '2026-11-08T12:01:00.000Z',
      updatedAt: '2026-11-08T12:01:00.000Z',
      version: 1,
    };

    const validatedSummary = validateContentArtifactSummary(artSummary);
    expect(validatedSummary.artifactType).toBe('product_campaign_plan');

    const artList = validateContentArtifactList({ items: [artSummary] });
    expect(artList.items).toHaveLength(1);

    const artDetail = {
      artifact: artSummary,
      latestRevision: {
        id: '018f6c5b-21a4-789a-8def-000000000021',
        workspaceId: validSummary.workspaceId,
        artifactId: artSummary.id,
        revisionNumber: 1,
        contentJson: { summary: 'Plan summary' },
        contentHashHex: 'beef123',
        schemaVersion: 1,
        promptTemplate: 'product_strategy_v1',
        promptVersion: '1.0.0',
        provider: 'google',
        model: 'gemini-3.8-flash',
        tokenInput: 500,
        tokenOutput: 300,
        costMicrounits: 45000,
        costCurrency: 'USD',
        latencyMs: 1200,
        authorRoleKey: 'product_strategist',
        createdAt: '2026-11-08T12:01:00.000Z',
      },
      evidenceReferences: [
        {
          id: '018f6c5b-21a4-789a-8def-000000000022',
          sourceKind: 'product_fact',
          sourceId: '018f6c5b-21a4-789a-8def-000000000030',
          createdAt: '2026-11-08T12:01:00.000Z',
        },
      ],
    };

    const validatedDetail = validateContentArtifactDetail(artDetail);
    expect(validatedDetail.artifact.id).toBe(artSummary.id);
    expect(validatedDetail.latestRevision.model).toBe('gemini-3.8-flash');
    expect(validatedDetail.evidenceReferences).toHaveLength(1);
  });

  it('validates activity list, kickoff result, and retry result', () => {
    const actList = validateWorkOrderActivityList({
      items: [
        {
          id: '018f6c5b-21a4-789a-8def-000000000040',
          action: 'creative.artifact.created',
          resourceType: 'content_artifact',
          resourceId: '018f6c5b-21a4-789a-8def-000000000020',
          result: 'succeeded',
          occurredAt: '2026-11-08T12:01:00.000Z',
          changesJson: {},
        },
      ],
    });
    expect(actList.items).toHaveLength(1);

    const kickoffRes = validateKickoffResult({
      workOrder: validSummary,
      cached: false,
    });
    expect(kickoffRes.cached).toBe(false);

    const retryRes = validateRetryResult({
      workOrder: validSummary,
      retriedItemIds: ['018f6c5b-21a4-789a-8def-000000000008'],
      cached: false,
    });
    expect(retryRes.retriedItemIds).toHaveLength(1);
  });

  describe('Enum allowlist validation and legacy normalization', () => {
    it('validates and normalizes WorkOrderStatus', () => {
      expect(validateWorkOrderStatus('in_progress')).toBe('in_progress');
      expect(validateWorkOrderStatus('preparing')).toBe('preparing');
      expect(validateWorkOrderStatus('waiting_review')).toBe('waiting_review');
      expect(validateWorkOrderStatus('completed')).toBe('completed');
      expect(validateWorkOrderStatus('failed')).toBe('failed');
      expect(validateWorkOrderStatus('blocked')).toBe('blocked');
      expect(validateWorkOrderStatus('canceled')).toBe('canceled');
      // Legacy aliases
      expect(validateWorkOrderStatus('pending')).toBe('preparing');
      expect(validateWorkOrderStatus('cancelled')).toBe('canceled');
      // Unknown values rejected
      expect(() => validateWorkOrderStatus('invalid_status')).toThrow();
      expect(() => validateWorkOrderStatus(123)).toThrow();
    });

    it('validates and normalizes WorkItemStatus', () => {
      expect(validateWorkItemStatus('ready')).toBe('ready');
      expect(validateWorkItemStatus('waiting_dependency')).toBe('waiting_dependency');
      expect(validateWorkItemStatus('queued')).toBe('queued');
      expect(validateWorkItemStatus('running')).toBe('running');
      expect(validateWorkItemStatus('review_required')).toBe('review_required');
      expect(validateWorkItemStatus('completed')).toBe('completed');
      expect(validateWorkItemStatus('failed')).toBe('failed');
      expect(validateWorkItemStatus('blocked')).toBe('blocked');
      expect(validateWorkItemStatus('canceled')).toBe('canceled');
      // Legacy aliases
      expect(validateWorkItemStatus('in_progress')).toBe('running');
      expect(validateWorkItemStatus('cancelled')).toBe('canceled');
      // Unknown values rejected
      expect(() => validateWorkItemStatus('unknown_status')).toThrow();
    });

    it('validates AgentRoleKey with strict canonical allowlist', () => {
      expect(validateAgentRoleKey('chief_of_staff')).toBe('chief_of_staff');
      expect(validateAgentRoleKey('product_strategist')).toBe('product_strategist');
      expect(validateAgentRoleKey('audience_strategist')).toBe('audience_strategist');
      expect(validateAgentRoleKey('creative_director')).toBe('creative_director');
      expect(validateAgentRoleKey('scriptwriter')).toBe('scriptwriter');
      expect(validateAgentRoleKey('compliance_reviewer')).toBe('compliance_reviewer');
      // Unknown role keys rejected
      expect(() => validateAgentRoleKey('marketing_intern')).toThrow();
      expect(() => validateAgentRoleKey('')).toThrow();
    });

    it('validates WorkOrderMissionType with canonical allowlist and default', () => {
      expect(validateWorkOrderMissionType('single_product_affiliate_launch')).toBe(
        'single_product_affiliate_launch',
      );
      expect(validateWorkOrderMissionType('short_video_series')).toBe('short_video_series');
      expect(validateWorkOrderMissionType(undefined)).toBe('single_product_affiliate_launch');
      expect(validateWorkOrderMissionType(null)).toBe('single_product_affiliate_launch');
      expect(validateWorkOrderMissionType('')).toBe('single_product_affiliate_launch');
      // Unknown mission types rejected
      expect(() => validateWorkOrderMissionType('unsupported_mission')).toThrow();
    });

    it('validates and normalizes AssignmentOfficeState', () => {
      expect(normalizeOfficeState('idle')).toBe('idle');
      expect(normalizeOfficeState('preparing')).toBe('preparing');
      expect(normalizeOfficeState('queued')).toBe('queued');
      expect(normalizeOfficeState('running')).toBe('running');
      expect(normalizeOfficeState('waiting_dependency')).toBe('waiting_dependency');
      expect(normalizeOfficeState('review_required')).toBe('review_required');
      expect(normalizeOfficeState('completed')).toBe('completed');
      expect(normalizeOfficeState('blocked')).toBe('blocked');
      expect(normalizeOfficeState('failed')).toBe('failed');
      expect(normalizeOfficeState('canceled')).toBe('canceled');
      // Legacy aliases
      expect(normalizeOfficeState('working')).toBe('running');
      expect(normalizeOfficeState('waiting')).toBe('waiting_dependency');
      expect(normalizeOfficeState('cancelled')).toBe('canceled');
      // Non-string fallback
      expect(normalizeOfficeState(null)).toBe('idle');
      expect(normalizeOfficeState(undefined)).toBe('idle');
      // Unknown office state rejected
      expect(() => normalizeOfficeState('party_time')).toThrow();
    });
  });
});
