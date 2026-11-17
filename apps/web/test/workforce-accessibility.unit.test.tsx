import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { WorkOrderDetailDTO } from '../src/types/workforce.js';
import { mapWorkforceViewModel } from '../src/lib/workforce-view-model.js';
import { OfficeView } from '../src/components/workforce/office-view.js';
import { BoardView } from '../src/components/workforce/board-view.js';
import { ViewModeToggle } from '../src/components/workforce/view-mode-toggle.js';
import { OperationalStatusBanner } from '../src/components/workforce/operational-status-banner.js';
import { EmployeeInspector } from '../src/components/workforce/employee-inspector.js';
import { DeliverablesSection } from '../src/components/workforce/deliverables-section.js';

const mockDetail: WorkOrderDetailDTO = {
  workOrder: {
    id: 'wo-a11y-1',
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
  workItems: [
    {
      id: 'wi-1',
      workOrderId: 'wo-a11y-1',
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
      id: 'wi-5',
      workOrderId: 'wo-a11y-1',
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
  ],
  assignments: [
    {
      id: 'as-1',
      workOrderId: 'wo-a11y-1',
      roleDefinitionId: 'rd-1',
      roleKey: 'chief_of_staff',
      workItemId: 'wi-1',
      officeState: 'completed',
      waitingOnWorkItemId: null,
      latestReportCode: 'HANDOFF_OK',
      createdAt: '2026-11-18T00:00:00Z',
      updatedAt: '2026-11-18T00:01:00Z',
      version: 1,
    },
    {
      id: 'as-5',
      workOrderId: 'wo-a11y-1',
      roleDefinitionId: 'rd-5',
      roleKey: 'scriptwriter',
      workItemId: 'wi-5',
      officeState: 'waiting_dependency',
      waitingOnWorkItemId: 'wi-1',
      latestReportCode: null,
      createdAt: '2026-11-18T00:00:00Z',
      updatedAt: '2026-11-18T00:00:00Z',
      version: 1,
    },
  ],
  dependencies: [
    {
      id: 'dep-1',
      workOrderId: 'wo-a11y-1',
      workItemId: 'wi-5',
      dependsOnWorkItemId: 'wi-1',
      createdAt: '2026-11-18T00:00:00Z',
    },
  ],
};

describe('Workforce Accessibility & Semantic DOM (TASK-015 Item 6)', () => {
  it('renders OfficeView with semantic regions, stations, and accessible names', () => {
    const vm = mapWorkforceViewModel({ detail: mockDetail, artifacts: [], activities: [] });
    const html = renderToStaticMarkup(
      <OfficeView employees={vm.employees} onInspectEmployee={vi.fn()} />,
    );

    expect(html).toContain('role="region"');
    expect(html).toContain('aria-label="Virtual AI Company Office Map"');
    expect(html).toContain('id="station-chief_of_staff"');
    expect(html).toContain('id="station-scriptwriter"');
    expect(html).toContain(
      'aria-label="Inspect Chief of Staff, Department: Strategy room, Status: Completed"',
    );
    expect(html).toContain('Waiting on: Chief of Staff');
    expect(html).toContain('Executive Review Lane');
  });

  it('renders BoardView with equivalent 6 employees, status labels, and non-color cues', () => {
    const vm = mapWorkforceViewModel({ detail: mockDetail, artifacts: [], activities: [] });
    const html = renderToStaticMarkup(
      <BoardView employees={vm.employees} onInspectEmployee={vi.fn()} />,
    );

    expect(html).toContain('role="region"');
    expect(html).toContain('aria-label="AI Workforce Operational Board"');
    expect(html).toContain('id="board-chief_of_staff"');
    expect(html).toContain('id="board-compliance_reviewer"');
    expect(html).toContain('badge-success');
    expect(html).toContain('Completed');
    expect(html).toContain('badge-warning');
    expect(html).toContain('Waiting on Dependency');
  });

  it('renders ViewModeToggle with aria-pressed attributes reflecting current state', () => {
    const officeHtml = renderToStaticMarkup(<ViewModeToggle mode="office" onChange={vi.fn()} />);
    expect(officeHtml).toContain('aria-pressed="true"');
    expect(officeHtml).toContain('Office View');

    const boardHtml = renderToStaticMarkup(<ViewModeToggle mode="board" onChange={vi.fn()} />);
    expect(boardHtml).toContain('aria-pressed="true"');
    expect(boardHtml).toContain('Board View');
  });

  it('renders OperationalStatusBanner with alert semantics on error and status on stale', () => {
    const vm = mapWorkforceViewModel({ detail: mockDetail, artifacts: [], activities: [] });
    const alertHtml = renderToStaticMarkup(
      <OperationalStatusBanner
        overview={vm.overview}
        isStale={true}
        isRefreshing={false}
        pollingError="Network disconnected"
        lastUpdatedAt="2026-11-18T00:01:00Z"
        onRefresh={vi.fn()}
      />,
    );

    expect(alertHtml).toContain('role="alert"');
    expect(alertHtml).toContain('Network disconnected');
    expect(alertHtml).toContain('Retry Refresh');
    expect(alertHtml).toContain('Last synchronized:');
  });

  it('renders EmployeeInspector dialog with role="dialog", aria-modal="true", and mandate', () => {
    const vm = mapWorkforceViewModel({ detail: mockDetail, artifacts: [], activities: [] });
    const cosEmp = vm.employees.find((e) => e.roleKey === 'chief_of_staff')!;

    const html = renderToStaticMarkup(
      <EmployeeInspector
        isOpen={true}
        employee={cosEmp}
        canManage={true}
        onClose={vi.fn()}
        onSelectArtifact={vi.fn()}
      />,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="inspector-heading"');
    expect(html).toContain('Chief of Staff');
    expect(html).toContain('Role Mandate');
    expect(html).toContain('Persisted Execution State');
    expect(html).toContain('HANDOFF_OK');
  });

  it('renders DeliverablesSection grouped by stages with accessible buttons', () => {
    const artifacts = [
      {
        id: 'art-1',
        workspaceId: 'ws-1',
        productId: 'prod-1',
        workOrderId: 'wo-a11y-1',
        workItemId: 'wi-1',
        assignmentId: 'as-1',
        authorRoleKey: 'product_strategist' as const,
        artifactType: 'product_campaign_plan' as const,
        lifecycleStatus: 'accepted',
        currentRevisionNumber: 1,
        createdAt: '2026-11-18T00:00:00Z',
        updatedAt: '2026-11-18T00:00:00Z',
        version: 1,
      },
    ];

    const html = renderToStaticMarkup(
      <DeliverablesSection artifacts={artifacts} onOpenArtifact={vi.fn()} />,
    );

    expect(html).toContain('Campaign Deliverables &amp; Verified Reports');
    expect(html).toContain('Stage 1: Strategy &amp; Planning Intelligence');
    expect(html).toContain('Product Campaign Plan');
    expect(html).toContain('Rev #1');
    expect(html).toContain('accepted');
  });
});
