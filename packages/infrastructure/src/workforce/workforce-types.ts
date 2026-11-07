export interface RawWorkOrderRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly product_id: string;
  readonly context_package_id: string;
  readonly mission_type: string;
  readonly graph_template: string;
  readonly graph_version: number | string;
  readonly status: string;
  readonly priority: number | string;
  readonly created_by_user_id: string;
  readonly failure_category?: string | null;
  readonly completed_at?: Date | string | null;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
  readonly version: number | string;
}

export interface RawWorkItemRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly work_order_id: string;
  readonly role_definition_id: string;
  readonly role_key?: string;
  readonly task_key: string;
  readonly expected_artifact_type: string;
  readonly status: string;
  readonly blocked_reason_code?: string | null;
  readonly started_at?: Date | string | null;
  readonly completed_at?: Date | string | null;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
  readonly version: number | string;
}

export interface RawAgentAssignmentRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly work_order_id: string;
  readonly role_definition_id: string;
  readonly role_key?: string;
  readonly work_item_id?: string | null;
  readonly office_state: string;
  readonly waiting_on_work_item_id?: string | null;
  readonly latest_report_code?: string | null;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
  readonly version: number | string;
}

export interface RawWorkItemDependencyRow {
  readonly id: string;
  readonly work_order_id: string;
  readonly work_item_id: string;
  readonly depends_on_work_item_id: string;
  readonly created_at: Date | string;
}

export interface RawContextPackageRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly product_id: string;
  readonly fact_set_id: string;
  readonly context_schema_version: number | string;
  readonly context_hash: Buffer | Uint8Array;
  readonly created_by_user_id: string;
  readonly created_at: Date | string;
}
