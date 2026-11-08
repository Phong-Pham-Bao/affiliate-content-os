import { describe, expect, it } from 'vitest';
import { DomainValidationError } from '../../src/errors.js';
import {
  AGENT_ROLE_KEYS,
  ASSIGNMENT_OFFICE_STATES,
  computeCanonicalContextHash,
  CREATIVE_OFFICE_V1_SPEC,
  GRAPH_TEMPLATE_CREATIVE_OFFICE_V1,
  GRAPH_VERSION_CREATIVE_OFFICE_V1,
  isAgentAssignmentId,
  isAgentRoleDefinitionId,
  isAgentRoleKey,
  isAssignmentOfficeState,
  isContextPackageId,
  isWorkItemDependencyId,
  isWorkItemExpectedArtifactType,
  isWorkItemId,
  isWorkItemStatus,
  isWorkItemTaskKey,
  isWorkOrderMissionType,
  isWorkOrderStatus,
  parseAgentAssignmentId,
  parseAgentRoleDefinitionId,
  parseContextPackageId,
  parseWorkItemDependencyId,
  parseWorkItemId,
  parseWorkOrderId,
  SEEDED_ROLE_DEFINITIONS,
  validateAcyclicGraph,
  validateDirectiveText,
  validateWorkOrderPriority,
  WORK_ITEM_EXPECTED_ARTIFACT_TYPES,
  WORK_ITEM_STATUSES,
  WORK_ITEM_TASK_KEYS,
  WORK_ORDER_MISSION_TYPES,
  WORK_ORDER_STATUSES,
} from '../../src/workforce/index.js';

describe('Workforce Domain Foundation', () => {
  const validUuidV7 = '018f0000-0000-7000-8000-000000000001';
  const invalidUuid = 'not-a-uuid';
  const uuidV4 = 'a0000000-0000-4000-8000-000000000001';

  describe('Branded UUIDv7 parsers and guards', () => {
    it('validates and parses WorkOrderId', () => {
      expect(parseWorkOrderId(validUuidV7)).toBe(validUuidV7);
      expect(() => parseWorkOrderId(invalidUuid)).toThrow(DomainValidationError);
      expect(() => parseWorkOrderId(uuidV4)).toThrow(DomainValidationError);
    });

    it('validates and parses WorkItemId', () => {
      expect(isWorkItemId(validUuidV7)).toBe(true);
      expect(isWorkItemId(invalidUuid)).toBe(false);
      expect(parseWorkItemId(validUuidV7)).toBe(validUuidV7);
      expect(() => parseWorkItemId(invalidUuid)).toThrow(DomainValidationError);
    });

    it('validates and parses AgentRoleDefinitionId', () => {
      expect(isAgentRoleDefinitionId(validUuidV7)).toBe(true);
      expect(parseAgentRoleDefinitionId(validUuidV7)).toBe(validUuidV7);
      expect(() => parseAgentRoleDefinitionId(invalidUuid)).toThrow(DomainValidationError);
    });

    it('validates and parses AgentAssignmentId', () => {
      expect(isAgentAssignmentId(validUuidV7)).toBe(true);
      expect(parseAgentAssignmentId(validUuidV7)).toBe(validUuidV7);
      expect(() => parseAgentAssignmentId(invalidUuid)).toThrow(DomainValidationError);
    });

    it('validates and parses ContextPackageId', () => {
      expect(isContextPackageId(validUuidV7)).toBe(true);
      expect(parseContextPackageId(validUuidV7)).toBe(validUuidV7);
      expect(() => parseContextPackageId(invalidUuid)).toThrow(DomainValidationError);
    });

    it('validates and parses WorkItemDependencyId', () => {
      expect(isWorkItemDependencyId(validUuidV7)).toBe(true);
      expect(parseWorkItemDependencyId(validUuidV7)).toBe(validUuidV7);
      expect(() => parseWorkItemDependencyId(invalidUuid)).toThrow(DomainValidationError);
    });
  });

  describe('Normative Role Keys and Seed Definitions', () => {
    it('contains exactly the 6 normative role keys', () => {
      expect(AGENT_ROLE_KEYS).toEqual([
        'chief_of_staff',
        'product_strategist',
        'audience_strategist',
        'creative_director',
        'scriptwriter',
        'compliance_reviewer',
      ]);
      for (const k of AGENT_ROLE_KEYS) {
        expect(isAgentRoleKey(k)).toBe(true);
      }
      expect(isAgentRoleKey('marketing_lead')).toBe(false);
    });

    it('has 6 seeded role definitions matching normative specs', () => {
      expect(SEEDED_ROLE_DEFINITIONS).toHaveLength(6);
      const keys = SEEDED_ROLE_DEFINITIONS.map((r) => r.roleKey);
      expect(keys).toEqual([...AGENT_ROLE_KEYS]);
      for (const role of SEEDED_ROLE_DEFINITIONS) {
        expect(role.roleVersion).toBe(1);
        expect(role.displayName.length).toBeGreaterThan(0);
        expect(role.department.length).toBeGreaterThan(0);
        expect(role.allowedArtifactTypes.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Normative Enums and Types', () => {
    it('validates mission types', () => {
      expect(WORK_ORDER_MISSION_TYPES).toEqual([
        'single_product_affiliate_launch',
        'short_video_series',
        'product_launch_plan',
        'objection_handling_series',
        'educational_series',
        'custom',
      ]);
      expect(isWorkOrderMissionType('single_product_affiliate_launch')).toBe(true);
      expect(isWorkOrderMissionType('short_video_series')).toBe(true);
      expect(isWorkOrderMissionType('unsupported')).toBe(false);
    });

    it('validates work order statuses', () => {
      expect(WORK_ORDER_STATUSES).toEqual([
        'preparing',
        'in_progress',
        'waiting_review',
        'completed',
        'blocked',
        'failed',
        'canceled',
      ]);
      expect(isWorkOrderStatus('preparing')).toBe(true);
      expect(isWorkOrderStatus('running')).toBe(false);
    });

    it('validates work item statuses', () => {
      expect(WORK_ITEM_STATUSES).toEqual([
        'ready',
        'waiting_dependency',
        'queued',
        'running',
        'review_required',
        'completed',
        'blocked',
        'failed',
        'canceled',
      ]);
      expect(isWorkItemStatus('ready')).toBe(true);
      expect(isWorkItemStatus('waiting_dependency')).toBe(true);
    });

    it('validates assignment office states', () => {
      expect(ASSIGNMENT_OFFICE_STATES).toEqual([
        'preparing',
        'queued',
        'running',
        'waiting_dependency',
        'review_required',
        'completed',
        'blocked',
        'failed',
        'canceled',
      ]);
      expect(isAssignmentOfficeState('preparing')).toBe(true);
      expect(isAssignmentOfficeState('ready')).toBe(false);
    });

    it('validates task keys and artifact types', () => {
      expect(WORK_ITEM_TASK_KEYS).toEqual([
        'product_strategy',
        'audience_strategy',
        'creative_direction',
        'scriptwriting',
        'compliance_review',
      ]);
      expect(WORK_ITEM_EXPECTED_ARTIFACT_TYPES).toEqual([
        'product_campaign_plan',
        'audience_insight_board',
        'video_series_plan',
        'script_package',
        'compliance_report',
      ]);
      expect(isWorkItemTaskKey('product_strategy')).toBe(true);
      expect(isWorkItemExpectedArtifactType('video_series_plan')).toBe(true);
    });
  });

  describe('Canonical Context Descriptor Hashing', () => {
    it('generates a 32-byte hash that is stable regardless of analysis input order', () => {
      const a1 = '018f0000-0000-7000-8000-000000000010';
      const a2 = '018f0000-0000-7000-8000-000000000020';

      const desc1 = {
        workspaceId: '018f0000-0000-7000-8000-000000000001',
        productId: '018f0000-0000-7000-8000-000000000002',
        productVersion: 1,
        factSetId: '018f0000-0000-7000-8000-000000000003',
        factSetVersion: 2,
        analyses: [
          { analysisId: a2, version: 1 },
          { analysisId: a1, version: 1 },
        ],
        schemaVersion: 1,
      };

      const desc2 = {
        ...desc1,
        analyses: [
          { analysisId: a1, version: 1 },
          { analysisId: a2, version: 1 },
        ],
      };

      const hash1 = computeCanonicalContextHash(desc1);
      const hash2 = computeCanonicalContextHash(desc2);

      expect(hash1.length).toBe(32);
      expect(Buffer.compare(Buffer.from(hash1), Buffer.from(hash2))).toBe(0);
    });

    it('changes when any version or ID changes', () => {
      const base = {
        workspaceId: '018f0000-0000-7000-8000-000000000001',
        productId: '018f0000-0000-7000-8000-000000000002',
        productVersion: 1,
        factSetId: '018f0000-0000-7000-8000-000000000003',
        factSetVersion: 1,
        analyses: [],
        schemaVersion: 1,
      };

      const h1 = computeCanonicalContextHash(base);
      const h2 = computeCanonicalContextHash({ ...base, productVersion: 2 });
      expect(Buffer.compare(Buffer.from(h1), Buffer.from(h2))).not.toBe(0);
    });
  });

  describe('Deterministic Creative Office V1 Graph Template', () => {
    it('defines creative_office_v1 with 5 work items', () => {
      expect(GRAPH_TEMPLATE_CREATIVE_OFFICE_V1).toBe('creative_office_v1');
      expect(GRAPH_VERSION_CREATIVE_OFFICE_V1).toBe(1);
      expect(CREATIVE_OFFICE_V1_SPEC).toHaveLength(5);
    });

    it('validates acyclic graph successfully on creative_office_v1 structure', () => {
      const nodeIds = CREATIVE_OFFICE_V1_SPEC.map((s) => s.taskKey);
      const edges = [
        { fromId: 'scriptwriting', toId: 'product_strategy' },
        { fromId: 'scriptwriting', toId: 'audience_strategy' },
        { fromId: 'scriptwriting', toId: 'creative_direction' },
        { fromId: 'compliance_review', toId: 'scriptwriting' },
      ];

      expect(() => validateAcyclicGraph(nodeIds, edges)).not.toThrow();
    });

    it('rejects self-dependencies', () => {
      const nodeIds = ['task_a', 'task_b'];
      const edges = [{ fromId: 'task_a', toId: 'task_a' }];
      expect(() => validateAcyclicGraph(nodeIds, edges)).toThrow(/Self-dependency/);
    });

    it('rejects cycles', () => {
      const nodeIds = ['task_a', 'task_b', 'task_c'];
      const edges = [
        { fromId: 'task_a', toId: 'task_b' },
        { fromId: 'task_b', toId: 'task_c' },
        { fromId: 'task_c', toId: 'task_a' },
      ];
      expect(() => validateAcyclicGraph(nodeIds, edges)).toThrow(/Cycle detected/);
    });

    it('rejects duplicate edges', () => {
      const nodeIds = ['task_a', 'task_b'];
      const edges = [
        { fromId: 'task_a', toId: 'task_b' },
        { fromId: 'task_a', toId: 'task_b' },
      ];
      expect(() => validateAcyclicGraph(nodeIds, edges)).toThrow(/Duplicate/);
    });
  });

  describe('Directive & Priority Validation', () => {
    it('validates correct directive text', () => {
      const text = 'Lập kế hoạch nội dung và đạo diễn một series 5 video ngắn.';
      expect(validateDirectiveText(text)).toBe(text);
    });

    it('rejects leading/trailing whitespace', () => {
      expect(() => validateDirectiveText('  spaced directive  ')).toThrow(DomainValidationError);
    });

    it('rejects empty or whitespace-only directive', () => {
      expect(() => validateDirectiveText('')).toThrow(DomainValidationError);
      expect(() => validateDirectiveText('   ')).toThrow(DomainValidationError);
    });

    it('rejects directives exceeding 4000 characters', () => {
      const longText = 'a'.repeat(4001);
      expect(() => validateDirectiveText(longText)).toThrow(DomainValidationError);
    });

    it('rejects control characters', () => {
      expect(() => validateDirectiveText('hello\x00world')).toThrow(DomainValidationError);
      expect(() => validateDirectiveText('hello\x07world')).toThrow(DomainValidationError);
    });

    it('validates priority within 1-100 range and defaults to 50', () => {
      expect(validateWorkOrderPriority(undefined)).toBe(50);
      expect(validateWorkOrderPriority(null)).toBe(50);
      expect(validateWorkOrderPriority(1)).toBe(1);
      expect(validateWorkOrderPriority(100)).toBe(100);
      expect(validateWorkOrderPriority(75)).toBe(75);
      expect(() => validateWorkOrderPriority(0)).toThrow(DomainValidationError);
      expect(() => validateWorkOrderPriority(101)).toThrow(DomainValidationError);
      expect(() => validateWorkOrderPriority(50.5)).toThrow(DomainValidationError);
    });
  });
});
