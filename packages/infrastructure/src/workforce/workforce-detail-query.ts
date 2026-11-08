import type pg from 'pg';
import type { WorkOrderDetailDTO } from '@affiliate-content-os/application';
import { parseAnalysisId, type WorkOrderId, type WorkspaceId } from '@affiliate-content-os/domain';
import {
  mapAgentAssignmentRowToSummaryDTO,
  mapContextPackageRowToSummaryDTO,
  mapWorkItemDependencyRowToSummaryDTO,
  mapWorkItemRowToSummaryDTO,
  mapWorkOrderRowToSummaryDTO,
} from './workforce-mappers.js';

export async function queryWorkOrderDetail(
  pool: pg.Pool,
  workspaceId: WorkspaceId,
  workOrderId: WorkOrderId,
): Promise<WorkOrderDetailDTO | null> {
  const orderRes = await pool.query(
    `SELECT * FROM work_orders WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, workOrderId],
  );

  if (orderRes.rows.length === 0) return null;
  const orderRow = orderRes.rows[0];
  const workOrder = mapWorkOrderRowToSummaryDTO(orderRow);

  const pkgRes = await pool.query(
    `SELECT * FROM context_packages WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, orderRow.context_package_id],
  );
  const pkgAnalysesRes = await pool.query(
    `SELECT analysis_id FROM context_package_analyses
     WHERE workspace_id = $1 AND context_package_id = $2
     ORDER BY analysis_id ASC`,
    [workspaceId, orderRow.context_package_id],
  );
  const analysisIds = pkgAnalysesRes.rows.map((r: { readonly analysis_id: string }) =>
    parseAnalysisId(r.analysis_id),
  );
  const contextPackage = mapContextPackageRowToSummaryDTO(pkgRes.rows[0], analysisIds);

  const itemsRes = await pool.query(
    `SELECT wi.*, ard.role_key
     FROM work_items wi
     JOIN agent_role_definitions ard ON ard.id = wi.role_definition_id
     WHERE wi.workspace_id = $1 AND wi.work_order_id = $2
     ORDER BY wi.created_at ASC, wi.id ASC`,
    [workspaceId, workOrderId],
  );
  const workItems = itemsRes.rows.map(mapWorkItemRowToSummaryDTO);

  const assignRes = await pool.query(
    `SELECT aa.*, ard.role_key
     FROM agent_assignments aa
     JOIN agent_role_definitions ard ON ard.id = aa.role_definition_id
     WHERE aa.workspace_id = $1 AND aa.work_order_id = $2
     ORDER BY aa.created_at ASC, aa.id ASC`,
    [workspaceId, workOrderId],
  );
  const assignments = assignRes.rows.map(mapAgentAssignmentRowToSummaryDTO);

  const depRes = await pool.query(
    `SELECT * FROM work_item_dependencies
     WHERE workspace_id = $1 AND work_order_id = $2
     ORDER BY created_at ASC, id ASC`,
    [workspaceId, workOrderId],
  );
  const dependencies = depRes.rows.map(mapWorkItemDependencyRowToSummaryDTO);

  return Object.freeze({
    workOrder: Object.freeze(workOrder),
    contextPackage: Object.freeze({
      ...contextPackage,
      analysisIds: Object.freeze([...contextPackage.analysisIds]),
    }),
    workItems: Object.freeze(workItems.map((item) => Object.freeze(item))),
    assignments: Object.freeze(assignments.map((a) => Object.freeze(a))),
    dependencies: Object.freeze(dependencies.map((d) => Object.freeze(d))),
  });
}
