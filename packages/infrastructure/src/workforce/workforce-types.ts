export type KickoffInsertStage =
  | 'context_packages'
  | 'context_package_analyses'
  | 'work_orders'
  | 'work_items'
  | 'work_item_dependencies'
  | 'agent_assignments'
  | 'idempotency_keys'
  | 'audit_events';

export interface KickoffTestHooks {
  readonly onAfterStage?: (stage: KickoffInsertStage) => Promise<void> | void;
}

export interface RawWorkOrderRow {
  readonly id: unknown;
  readonly workspace_id: unknown;
  readonly product_id: unknown;
  readonly context_package_id: unknown;
  readonly mission_type: unknown;
  readonly graph_template: unknown;
  readonly graph_version: unknown;
  readonly status: unknown;
  readonly priority: unknown;
  readonly created_by_user_id: unknown;
  readonly failure_category?: unknown;
  readonly completed_at?: unknown;
  readonly created_at: unknown;
  readonly updated_at: unknown;
  readonly version: unknown;
}

export interface RawWorkItemRow {
  readonly id: unknown;
  readonly workspace_id?: unknown;
  readonly work_order_id: unknown;
  readonly role_definition_id: unknown;
  readonly role_key?: unknown;
  readonly task_key: unknown;
  readonly expected_artifact_type: unknown;
  readonly status: unknown;
  readonly blocked_reason_code?: unknown;
  readonly started_at?: unknown;
  readonly completed_at?: unknown;
  readonly created_at: unknown;
  readonly updated_at: unknown;
  readonly version: unknown;
}

export interface RawAgentAssignmentRow {
  readonly id: unknown;
  readonly workspace_id?: unknown;
  readonly work_order_id: unknown;
  readonly role_definition_id: unknown;
  readonly role_key?: unknown;
  readonly work_item_id?: unknown;
  readonly office_state: unknown;
  readonly waiting_on_work_item_id?: unknown;
  readonly latest_report_code?: unknown;
  readonly created_at: unknown;
  readonly updated_at: unknown;
  readonly version: unknown;
}

export interface RawWorkItemDependencyRow {
  readonly id: unknown;
  readonly workspace_id?: unknown;
  readonly work_order_id: unknown;
  readonly work_item_id: unknown;
  readonly depends_on_work_item_id: unknown;
  readonly created_at: unknown;
}

export interface RawContextPackageRow {
  readonly id: unknown;
  readonly workspace_id: unknown;
  readonly product_id: unknown;
  readonly fact_set_id: unknown;
  readonly context_schema_version: unknown;
  readonly context_hash: unknown;
  readonly created_by_user_id: unknown;
  readonly created_at: unknown;
}
