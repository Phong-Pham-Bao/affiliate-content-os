import { describe, expect, it } from 'vitest';
import { DatabaseError } from '../../src/database/errors.js';
import {
  mapAgentAssignmentRowToSummaryDTO,
  mapContextPackageRowToSummaryDTO,
  mapWorkItemDependencyRowToSummaryDTO,
  mapWorkItemRowToSnapshot,
  mapWorkItemRowToSummaryDTO,
  mapWorkOrderRowToSummaryDTO,
} from '../../src/workforce/workforce-mappers.js';
import { parseAnalysisId } from '@affiliate-content-os/domain';

const VALID_UUID_1 = '018f6c5b-21a4-789a-8def-000000000001';
const VALID_UUID_2 = '018f6c5b-21a4-789a-8def-000000000002';
const VALID_UUID_3 = '018f6c5b-21a4-789a-8def-000000000003';
const VALID_UUID_4 = '018f6c5b-21a4-789a-8def-000000000004';
const VALID_UUID_5 = '018f6c5b-21a4-789a-8def-000000000005';
const VALID_UUID_6 = '018f6c5b-21a4-789a-8def-000000000006';

const ISO_NOW = '2026-11-08T00:00:00.000Z';
const ISO_LATER = '2026-11-08T01:00:00.000Z';
const ISO_EARLIER = '2026-11-07T23:00:00.000Z';

function createValidWorkOrderRow(): Record<string, unknown> {
  return {
    id: VALID_UUID_1,
    workspace_id: VALID_UUID_2,
    product_id: VALID_UUID_3,
    context_package_id: VALID_UUID_4,
    mission_type: 'short_video_series',
    graph_template: 'creative_office_v1',
    graph_version: 1,
    status: 'preparing',
    priority: 50,
    created_by_user_id: VALID_UUID_5,
    failure_category: null,
    completed_at: null,
    created_at: ISO_NOW,
    updated_at: ISO_NOW,
    version: 1,
  };
}

function createValidWorkItemRow(roleKey = 'product_strategist'): Record<string, unknown> {
  return {
    id: VALID_UUID_1,
    workspace_id: VALID_UUID_2,
    work_order_id: VALID_UUID_3,
    role_definition_id: VALID_UUID_4,
    role_key: roleKey,
    task_key: 'product_strategy',
    expected_artifact_type: 'product_campaign_plan',
    status: 'ready',
    blocked_reason_code: null,
    started_at: null,
    completed_at: null,
    created_at: ISO_NOW,
    updated_at: ISO_NOW,
    version: 1,
  };
}

function createValidAssignmentRow(roleKey = 'chief_of_staff'): Record<string, unknown> {
  return {
    id: VALID_UUID_1,
    workspace_id: VALID_UUID_2,
    work_order_id: VALID_UUID_3,
    role_definition_id: VALID_UUID_4,
    role_key: roleKey,
    work_item_id: roleKey === 'chief_of_staff' ? null : VALID_UUID_5,
    office_state: 'preparing',
    waiting_on_work_item_id: null,
    latest_report_code: null,
    created_at: ISO_NOW,
    updated_at: ISO_NOW,
    version: 1,
  };
}

function createValidDependencyRow(): Record<string, unknown> {
  return {
    id: VALID_UUID_1,
    workspace_id: VALID_UUID_2,
    work_order_id: VALID_UUID_3,
    work_item_id: VALID_UUID_4,
    depends_on_work_item_id: VALID_UUID_5,
    created_at: ISO_NOW,
  };
}

function createValidContextPackageRow(): Record<string, unknown> {
  return {
    id: VALID_UUID_1,
    workspace_id: VALID_UUID_2,
    product_id: VALID_UUID_3,
    fact_set_id: VALID_UUID_4,
    context_schema_version: 1,
    context_hash: Buffer.alloc(32, 7),
    created_by_user_id: VALID_UUID_5,
    created_at: ISO_NOW,
  };
}

describe('workforce-mappers.unit', () => {
  describe('mapWorkOrderRowToSummaryDTO', () => {
    it('maps valid work order row and freezes result', () => {
      const row = createValidWorkOrderRow();
      const dto = mapWorkOrderRowToSummaryDTO(row);

      expect(dto.id).toBe(VALID_UUID_1);
      expect(dto.missionType).toBe('short_video_series');
      expect(dto.status).toBe('preparing');
      expect(dto.priority).toBe(50);
      expect(Object.isFrozen(dto)).toBe(true);
    });

    it('rejects proxy objects and invalid prototype', () => {
      const proxyRow = new Proxy(createValidWorkOrderRow(), {});
      expect(() => mapWorkOrderRowToSummaryDTO(proxyRow)).toThrow(DatabaseError);

      const invalidProto = Object.create({ foo: 'bar' });
      Object.assign(invalidProto, createValidWorkOrderRow());
      expect(() => mapWorkOrderRowToSummaryDTO(invalidProto)).toThrow(DatabaseError);
    });

    it('fails closed on unknown mission type without substituting defaults', () => {
      const row = { ...createValidWorkOrderRow(), mission_type: 'spam_everything' };
      expect(() => mapWorkOrderRowToSummaryDTO(row)).toThrow(DatabaseError);
    });

    it('fails closed on unknown status without substituting defaults', () => {
      const row = { ...createValidWorkOrderRow(), status: 'flying_around' };
      expect(() => mapWorkOrderRowToSummaryDTO(row)).toThrow(DatabaseError);
    });

    it('fails closed on invalid priority', () => {
      expect(() =>
        mapWorkOrderRowToSummaryDTO({ ...createValidWorkOrderRow(), priority: 0 }),
      ).toThrow(DatabaseError);
      expect(() =>
        mapWorkOrderRowToSummaryDTO({ ...createValidWorkOrderRow(), priority: 101 }),
      ).toThrow(DatabaseError);
      expect(() =>
        mapWorkOrderRowToSummaryDTO({ ...createValidWorkOrderRow(), priority: 'NaN' }),
      ).toThrow(DatabaseError);
    });

    it('fails closed when updated_at precedes created_at', () => {
      const row = { ...createValidWorkOrderRow(), created_at: ISO_NOW, updated_at: ISO_EARLIER };
      expect(() => mapWorkOrderRowToSummaryDTO(row)).toThrow(DatabaseError);
    });

    it('fails closed when terminal work order lacks completed_at', () => {
      const row = { ...createValidWorkOrderRow(), status: 'completed', completed_at: null };
      expect(() => mapWorkOrderRowToSummaryDTO(row)).toThrow(DatabaseError);
    });

    it('fails closed when non-terminal work order has completed_at', () => {
      const row = { ...createValidWorkOrderRow(), status: 'preparing', completed_at: ISO_LATER };
      expect(() => mapWorkOrderRowToSummaryDTO(row)).toThrow(DatabaseError);
    });

    it('fails closed when completed_at precedes created_at', () => {
      const row = {
        ...createValidWorkOrderRow(),
        status: 'completed',
        created_at: ISO_NOW,
        completed_at: ISO_EARLIER,
      };
      expect(() => mapWorkOrderRowToSummaryDTO(row)).toThrow(DatabaseError);
    });

    it('sanitizes error message: no directive text or tenant values in error', () => {
      const row = {
        ...createValidWorkOrderRow(),
        status: 'invalid_status_xyz',
        directive_text: 'SECRET DIRECTIVE WITH CONFIDENTIAL DATA',
      };
      try {
        mapWorkOrderRowToSummaryDTO(row);
        expect.unreachable('Should have thrown DatabaseError');
      } catch (err) {
        expect(err).toBeInstanceOf(DatabaseError);
        expect((err as Error).message).not.toContain('SECRET DIRECTIVE');
        expect((err as Error).message).not.toContain(VALID_UUID_2);
      }
    });
  });

  describe('mapWorkItemRowToSummaryDTO & mapWorkItemRowToSnapshot', () => {
    it('maps valid work item row to snapshot and freezes result', () => {
      const row = createValidWorkItemRow();
      const snapshot = mapWorkItemRowToSnapshot(row);
      expect(snapshot.id).toBe(VALID_UUID_1);
      expect(snapshot.taskKey).toBe('product_strategy');
      expect(snapshot.status).toBe('ready');
      expect(Object.isFrozen(snapshot)).toBe(true);
    });

    it('maps valid work item row and freezes result', () => {
      const row = createValidWorkItemRow();
      const dto = mapWorkItemRowToSummaryDTO(row);
      expect(dto.id).toBe(VALID_UUID_1);
      expect(dto.roleKey).toBe('product_strategist');
      expect(dto.taskKey).toBe('product_strategy');
      expect(dto.expectedArtifactType).toBe('product_campaign_plan');
      expect(Object.isFrozen(dto)).toBe(true);
    });

    it('fails closed on unknown task key', () => {
      const row = { ...createValidWorkItemRow(), task_key: 'make_coffee' };
      expect(() => mapWorkItemRowToSummaryDTO(row)).toThrow(DatabaseError);
    });

    it('fails closed on unknown expected artifact type', () => {
      const row = { ...createValidWorkItemRow(), expected_artifact_type: 'random_junk' };
      expect(() => mapWorkItemRowToSummaryDTO(row)).toThrow(DatabaseError);
    });

    it('fails closed on unknown status', () => {
      const row = { ...createValidWorkItemRow(), status: 'unknown_state' };
      expect(() => mapWorkItemRowToSummaryDTO(row)).toThrow(DatabaseError);
    });

    it('fails closed when role_key is missing or invalid in summary DTO', () => {
      const missingRole = { ...createValidWorkItemRow() };
      delete (missingRole as Record<string, unknown>).role_key;
      expect(() => mapWorkItemRowToSummaryDTO(missingRole)).toThrow(DatabaseError);

      const invalidRole = { ...createValidWorkItemRow(), role_key: 'hacker_role' };
      expect(() => mapWorkItemRowToSummaryDTO(invalidRole)).toThrow(DatabaseError);
    });

    it('fails closed when blocked work item lacks blocked_reason_code', () => {
      const row = { ...createValidWorkItemRow(), status: 'blocked', blocked_reason_code: null };
      expect(() => mapWorkItemRowToSummaryDTO(row)).toThrow(DatabaseError);
    });

    it('fails closed when non-blocked work item has blocked_reason_code', () => {
      const row = {
        ...createValidWorkItemRow(),
        status: 'ready',
        blocked_reason_code: 'policy_block',
      };
      expect(() => mapWorkItemRowToSummaryDTO(row)).toThrow(DatabaseError);
    });

    it('fails closed when completed_at precedes started_at', () => {
      const row = {
        ...createValidWorkItemRow(),
        status: 'completed',
        created_at: ISO_EARLIER,
        started_at: ISO_LATER,
        completed_at: ISO_NOW,
      };
      expect(() => mapWorkItemRowToSummaryDTO(row)).toThrow(DatabaseError);
    });
  });

  describe('mapAgentAssignmentRowToSummaryDTO', () => {
    it('maps valid chief of staff assignment with null work_item_id', () => {
      const row = createValidAssignmentRow('chief_of_staff');
      const dto = mapAgentAssignmentRowToSummaryDTO(row);
      expect(dto.roleKey).toBe('chief_of_staff');
      expect(dto.workItemId).toBeNull();
      expect(Object.isFrozen(dto)).toBe(true);
    });

    it('maps valid non-chief of staff assignment with non-null work_item_id', () => {
      const row = createValidAssignmentRow('product_strategist');
      const dto = mapAgentAssignmentRowToSummaryDTO(row);
      expect(dto.roleKey).toBe('product_strategist');
      expect(dto.workItemId).toBe(VALID_UUID_5);
    });

    it('fails closed when chief of staff has work_item_id', () => {
      const row = { ...createValidAssignmentRow('chief_of_staff'), work_item_id: VALID_UUID_5 };
      expect(() => mapAgentAssignmentRowToSummaryDTO(row)).toThrow(DatabaseError);
    });

    it('fails closed when non-chief of staff lacks work_item_id', () => {
      const row = { ...createValidAssignmentRow('product_strategist'), work_item_id: null };
      expect(() => mapAgentAssignmentRowToSummaryDTO(row)).toThrow(DatabaseError);
    });

    it('fails closed on unknown office_state', () => {
      const row = { ...createValidAssignmentRow(), office_state: 'partying' };
      expect(() => mapAgentAssignmentRowToSummaryDTO(row)).toThrow(DatabaseError);
    });

    it('fails closed when waiting_dependency assignment lacks waiting_on_work_item_id', () => {
      const row = {
        ...createValidAssignmentRow('scriptwriter'),
        office_state: 'waiting_dependency',
        waiting_on_work_item_id: null,
      };
      expect(() => mapAgentAssignmentRowToSummaryDTO(row)).toThrow(DatabaseError);
    });

    it('fails closed when non-waiting_dependency assignment has waiting_on_work_item_id', () => {
      const row = {
        ...createValidAssignmentRow('chief_of_staff'),
        office_state: 'preparing',
        waiting_on_work_item_id: VALID_UUID_6,
      };
      expect(() => mapAgentAssignmentRowToSummaryDTO(row)).toThrow(DatabaseError);
    });
  });

  describe('mapWorkItemDependencyRowToSummaryDTO', () => {
    it('maps valid dependency row', () => {
      const row = createValidDependencyRow();
      const dto = mapWorkItemDependencyRowToSummaryDTO(row);
      expect(dto.id).toBe(VALID_UUID_1);
      expect(dto.workItemId).toBe(VALID_UUID_4);
      expect(dto.dependsOnWorkItemId).toBe(VALID_UUID_5);
      expect(Object.isFrozen(dto)).toBe(true);
    });

    it('fails closed on self dependency', () => {
      const row = {
        ...createValidDependencyRow(),
        work_item_id: VALID_UUID_4,
        depends_on_work_item_id: VALID_UUID_4,
      };
      expect(() => mapWorkItemDependencyRowToSummaryDTO(row)).toThrow(DatabaseError);
    });
  });

  describe('mapContextPackageRowToSummaryDTO', () => {
    it('maps valid context package row and converts 32-byte hash to hex', () => {
      const row = createValidContextPackageRow();
      const analysisId = parseAnalysisId(VALID_UUID_6);
      const dto = mapContextPackageRowToSummaryDTO(row, [analysisId]);

      expect(dto.id).toBe(VALID_UUID_1);
      expect(dto.contextHashHex).toBe(Buffer.alloc(32, 7).toString('hex'));
      expect(dto.analysisIds).toEqual([analysisId]);
      expect(Object.isFrozen(dto)).toBe(true);
      expect(Object.isFrozen(dto.analysisIds)).toBe(true);
    });

    it('fails closed when context_hash is not 32 bytes', () => {
      const shortHash = { ...createValidContextPackageRow(), context_hash: Buffer.alloc(16) };
      expect(() => mapContextPackageRowToSummaryDTO(shortHash, [])).toThrow(DatabaseError);

      const longHash = { ...createValidContextPackageRow(), context_hash: Buffer.alloc(64) };
      expect(() => mapContextPackageRowToSummaryDTO(longHash, [])).toThrow(DatabaseError);
    });

    it('fails closed when context_hash is proxy', () => {
      const proxyHash = {
        ...createValidContextPackageRow(),
        context_hash: new Proxy(Buffer.alloc(32), {}),
      };
      expect(() => mapContextPackageRowToSummaryDTO(proxyHash, [])).toThrow(DatabaseError);
    });

    it('defensive-copies analysisIds: caller mutation cannot alter mapped result', () => {
      const row = createValidContextPackageRow();
      const analysisIds = [parseAnalysisId(VALID_UUID_6)];
      const dto = mapContextPackageRowToSummaryDTO(row, analysisIds);

      // Caller mutates original array
      analysisIds.push(parseAnalysisId('018f6c5b-21a4-789a-8def-999999999999'));
      expect(dto.analysisIds).toHaveLength(1);
      expect(() => (dto.analysisIds as unknown[]).push('test')).toThrow();
    });
  });
});
