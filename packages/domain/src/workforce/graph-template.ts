import { DomainValidationError } from '../errors.js';
import type { AgentRoleKey } from './role-types.js';
import type {
  WorkItemExpectedArtifactType,
  WorkItemStatus,
  WorkItemTaskKey,
} from './work-item-types.js';

export const GRAPH_TEMPLATE_CREATIVE_OFFICE_V1 = 'creative_office_v1';
export const GRAPH_VERSION_CREATIVE_OFFICE_V1 = 1;

export interface GraphTemplateWorkItemSpec {
  readonly taskKey: WorkItemTaskKey;
  readonly roleKey: AgentRoleKey;
  readonly expectedArtifactType: WorkItemExpectedArtifactType;
  readonly initialStatus: WorkItemStatus;
  readonly dependsOnTaskKeys: readonly WorkItemTaskKey[];
}

export const CREATIVE_OFFICE_V1_SPEC: readonly GraphTemplateWorkItemSpec[] = Object.freeze([
  Object.freeze({
    taskKey: 'product_strategy' as const,
    roleKey: 'product_strategist' as const,
    expectedArtifactType: 'product_campaign_plan' as const,
    initialStatus: 'ready' as const,
    dependsOnTaskKeys: Object.freeze([]),
  }),
  Object.freeze({
    taskKey: 'audience_strategy' as const,
    roleKey: 'audience_strategist' as const,
    expectedArtifactType: 'audience_insight_board' as const,
    initialStatus: 'ready' as const,
    dependsOnTaskKeys: Object.freeze([]),
  }),
  Object.freeze({
    taskKey: 'creative_direction' as const,
    roleKey: 'creative_director' as const,
    expectedArtifactType: 'video_series_plan' as const,
    initialStatus: 'ready' as const,
    dependsOnTaskKeys: Object.freeze([]),
  }),
  Object.freeze({
    taskKey: 'scriptwriting' as const,
    roleKey: 'scriptwriter' as const,
    expectedArtifactType: 'script_package' as const,
    initialStatus: 'waiting_dependency' as const,
    dependsOnTaskKeys: Object.freeze<WorkItemTaskKey[]>([
      'product_strategy',
      'audience_strategy',
      'creative_direction',
    ]),
  }),
  Object.freeze({
    taskKey: 'compliance_review' as const,
    roleKey: 'compliance_reviewer' as const,
    expectedArtifactType: 'compliance_report' as const,
    initialStatus: 'waiting_dependency' as const,
    dependsOnTaskKeys: Object.freeze<WorkItemTaskKey[]>(['scriptwriting']),
  }),
]);

export interface GraphEdgeValidationInput {
  readonly fromId: string;
  readonly toId: string;
}

export function validateAcyclicGraph(
  nodeIds: readonly string[],
  edges: readonly GraphEdgeValidationInput[],
): void {
  const nodeSet = new Set(nodeIds);
  const adj = new Map<string, string[]>();

  for (const id of nodeIds) {
    adj.set(id, []);
  }

  const seenEdges = new Set<string>();

  for (const edge of edges) {
    if (edge.fromId === edge.toId) {
      throw new DomainValidationError(
        `Self-dependency detected on node ${edge.fromId}`,
        'dependencies',
      );
    }
    if (!nodeSet.has(edge.fromId) || !nodeSet.has(edge.toId)) {
      throw new DomainValidationError(
        `Dependency edge references unknown node: ${edge.fromId} -> ${edge.toId}`,
        'dependencies',
      );
    }
    const edgeKey = `${edge.fromId}->${edge.toId}`;
    if (seenEdges.has(edgeKey)) {
      throw new DomainValidationError(`Duplicate dependency edge: ${edgeKey}`, 'dependencies');
    }
    seenEdges.add(edgeKey);
    adj.get(edge.fromId)!.push(edge.toId);
  }

  // Cycle detection via DFS (white=0, gray=1, black=2)
  const state = new Map<string, number>();
  for (const id of nodeIds) {
    state.set(id, 0);
  }

  function dfs(curr: string): void {
    state.set(curr, 1);
    for (const neighbor of adj.get(curr) ?? []) {
      const neighborState = state.get(neighbor);
      if (neighborState === 1) {
        throw new DomainValidationError(
          `Cycle detected in workforce task graph involving node ${neighbor}`,
          'dependencies',
        );
      }
      if (neighborState === 0) {
        dfs(neighbor);
      }
    }
    state.set(curr, 2);
  }

  for (const id of nodeIds) {
    if (state.get(id) === 0) {
      dfs(id);
    }
  }
}
