import type { WorkItemId, WorkItemStatus, WorkItemTaskKey } from '@affiliate-content-os/domain';

export interface WorkItemReadinessItem {
  readonly id: WorkItemId;
  readonly status: WorkItemStatus;
  readonly taskKey: WorkItemTaskKey;
}

export interface WorkItemReadinessDependency {
  readonly workItemId: WorkItemId;
  readonly dependsOnWorkItemId: WorkItemId;
}

export interface IdentifyEligibleWorkItemsInput<
  TItem extends WorkItemReadinessItem = WorkItemReadinessItem,
> {
  readonly workItems: readonly TItem[];
  readonly dependencies: readonly WorkItemReadinessDependency[];
  readonly completedWorkItemIds: ReadonlySet<WorkItemId> | readonly WorkItemId[];
}

export function identifyEligibleWorkItems<TItem extends WorkItemReadinessItem>(
  input: IdentifyEligibleWorkItemsInput<TItem>,
): readonly TItem[] {
  const completedSet =
    input.completedWorkItemIds instanceof Set
      ? input.completedWorkItemIds
      : new Set<WorkItemId>(input.completedWorkItemIds);

  // Group prerequisite IDs by target work item ID
  const depsByWorkItem = new Map<WorkItemId, WorkItemId[]>();
  for (const dep of input.dependencies) {
    let list = depsByWorkItem.get(dep.workItemId);
    if (!list) {
      list = [];
      depsByWorkItem.set(dep.workItemId, list);
    }
    list.push(dep.dependsOnWorkItemId);
  }

  const eligible: TItem[] = [];

  for (const item of input.workItems) {
    if (item.status !== 'waiting_dependency') {
      continue;
    }

    const prereqs = depsByWorkItem.get(item.id) ?? [];
    if (prereqs.length === 0) {
      // If marked as waiting_dependency but has no prerequisites, it is eligible
      eligible.push(item);
      continue;
    }

    const allCompleted = prereqs.every((prereqId) => completedSet.has(prereqId));
    if (allCompleted) {
      eligible.push(item);
    }
  }

  return Object.freeze(eligible);
}
