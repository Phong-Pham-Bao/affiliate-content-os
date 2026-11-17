export const MOCK_USER = {
  user: {
    id: '018f4a1b-9b2e-7111-8000-000000000001',
    email: 'boss@example.com',
    displayName: 'Boss Executive',
  },
  session: {
    idleExpiresAt: '2026-11-19T15:00:00Z',
    absoluteExpiresAt: '2026-11-19T23:00:00Z',
  },
  workspaceAccess: {
    items: [
      {
        id: '018f4a1b-9b2e-7222-8000-000000000002',
        name: 'Acme Media OS',
        slug: 'acme-media',
        timezone: 'UTC',
        role: 'editor' as const,
      },
    ],
    hasMore: false,
  },
};

export const MOCK_WORKSPACE = {
  id: '018f4a1b-9b2e-7222-8000-000000000002',
  name: 'Acme Media OS',
  slug: 'acme-media',
  timezone: 'UTC',
  brandVoice: 'Authoritative, sharp, evidence-backed',
  defaultDisclosure: '#ad Sponsored content',
  aiEnabled: true,
  status: 'active' as const,
  role: 'editor' as const,
  createdAt: '2026-11-18T00:00:00Z',
  updatedAt: '2026-11-18T00:00:00Z',
  version: 1,
};

export const MOCK_POLICY = {
  workspaceId: MOCK_WORKSPACE.id,
  aiEnabled: true,
  monthlyBudgetMicrounits: 50000000,
  currentSpendMicrounits: 1200000,
  reservedSpendMicrounits: 500000,
  rateLimitPerMinute: 60,
  budgetPeriodStart: '2026-11-01T00:00:00Z',
  version: 1,
  updatedAt: '2026-11-18T00:00:00Z',
};

export const MOCK_PRODUCT = {
  id: '018f4a1b-9b2e-7333-8000-000000000003',
  workspaceId: MOCK_WORKSPACE.id,
  name: 'Pro Wireless Mic System',
  merchantName: 'AudioMaster',
  canonicalUrl: 'https://example.com/mic',
  category: 'electronics',
  description: 'Dual transmitter wireless lavalier microphone with noise cancellation.',
  audienceNotes: 'Content creators, vloggers',
  allowedClaimsNotes: '48kHz 24bit audio',
  prohibitedClaimsNotes: null,
  currentFactSetId: '018f4a1b-9b2e-7444-8000-000000000004',
  status: 'active' as const,
  createdAt: '2026-11-18T00:00:00Z',
  updatedAt: '2026-11-18T00:00:00Z',
  version: 1,
};

export const MOCK_FACT_SET = {
  id: '018f4a1b-9b2e-7444-8000-000000000004',
  workspaceId: MOCK_WORKSPACE.id,
  productId: MOCK_PRODUCT.id,
  revisionNumber: 1,
  status: 'confirmed' as const,
  summary: 'Verified hardware specifications',
  confirmedByUserId: MOCK_USER.user.id,
  confirmedAt: '2026-11-18T00:00:00Z',
  createdByUserId: MOCK_USER.user.id,
  createdAt: '2026-11-18T00:00:00Z',
  updatedAt: '2026-11-18T00:00:00Z',
  version: 1,
};

export const MOCK_FACTS = [
  {
    id: '018f4a1b-9b2e-7555-8000-000000000005',
    workspaceId: MOCK_WORKSPACE.id,
    productId: MOCK_PRODUCT.id,
    factSetId: MOCK_FACT_SET.id,
    factKey: 'battery_life',
    valueText: '14 hours continuous recording',
    sourceType: 'manual',
    sourceUrl: null,
    sourceExcerpt: null,
    confidence: 'confirmed',
    claimUsage: 'allowed',
    createdAt: '2026-11-18T00:00:00Z',
  },
];

export const MOCK_ANALYSIS = {
  id: '018f4a1b-9b2e-7666-8000-000000000006',
  productId: MOCK_PRODUCT.id,
  analysisType: 'product',
  status: 'accepted' as const,
  factSetRevision: 1,
  provider: 'google',
  model: 'gemini-3.8-flash',
  version: 1,
  createdAt: '2026-11-18T00:00:00Z',
  updatedAt: '2026-11-18T00:00:00Z',
};

export type WorkforceE2EStage =
  'planning' | 'script_generation' | 'compliance' | 'review_required' | 'accepted_handoff';

export const MOCK_WORK_ORDER_ID = '018f4a1b-9b2e-7777-8000-000000000007';

export function createMockWorkOrderDetail(stage: WorkforceE2EStage) {
  const isPlanningDone = stage !== 'planning';
  const isScriptsDone =
    stage === 'compliance' || stage === 'review_required' || stage === 'accepted_handoff';
  const isComplianceDone = stage === 'review_required' || stage === 'accepted_handoff';
  const isHandoffAccepted = stage === 'accepted_handoff';

  return {
    workOrder: {
      id: MOCK_WORK_ORDER_ID,
      workspaceId: MOCK_WORKSPACE.id,
      productId: MOCK_PRODUCT.id,
      contextPackageId: '018f4a1b-9b2e-7888-8000-000000000008',
      missionType: 'single_product_affiliate_launch' as const,
      graphTemplate: 'single_product_affiliate_launch',
      graphVersion: 1,
      status: (isHandoffAccepted ? 'completed' : 'in_progress') as const,
      priority: 1,
      createdByUserId: MOCK_USER.user.id,
      failureCategory: null,
      completedAt: isHandoffAccepted ? '2026-11-18T00:06:00Z' : null,
      createdAt: '2026-11-18T00:00:00Z',
      updatedAt: '2026-11-18T00:06:00Z',
      version: 1,
    },
    contextPackage: {
      id: '018f4a1b-9b2e-7888-8000-000000000008',
      workspaceId: MOCK_WORKSPACE.id,
      productId: MOCK_PRODUCT.id,
      factSetId: MOCK_FACT_SET.id,
      contextSchemaVersion: 1,
      contextHashHex: 'f0e1d2c3b4a5',
      analysisIds: [MOCK_ANALYSIS.id],
      createdByUserId: MOCK_USER.user.id,
      createdAt: '2026-11-18T00:00:00Z',
    },
    workItems: [
      {
        id: 'wi-cos',
        workOrderId: '018f4a1b-9b2e-7777-8000-000000000007',
        roleDefinitionId: '018f0000-0000-7000-8000-000000000001',
        roleKey: 'chief_of_staff' as const,
        taskKey: 'orchestration',
        expectedArtifactType: 'work_plan',
        status: 'completed' as const,
        blockedReasonCode: null,
        startedAt: '2026-11-18T00:00:00Z',
        completedAt: '2026-11-18T00:00:30Z',
        createdAt: '2026-11-18T00:00:00Z',
        updatedAt: '2026-11-18T00:00:30Z',
        version: 1,
      },
      {
        id: 'wi-ps',
        workOrderId: '018f4a1b-9b2e-7777-8000-000000000007',
        roleDefinitionId: '018f0000-0000-7000-8000-000000000002',
        roleKey: 'product_strategist' as const,
        taskKey: 'product_strategy',
        expectedArtifactType: 'product_campaign_plan',
        status: (isPlanningDone ? 'completed' : 'in_progress') as const,
        blockedReasonCode: null,
        startedAt: '2026-11-18T00:00:30Z',
        completedAt: isPlanningDone ? '2026-11-18T00:01:30Z' : null,
        createdAt: '2026-11-18T00:00:00Z',
        updatedAt: '2026-11-18T00:01:30Z',
        version: 1,
      },
      {
        id: 'wi-as',
        workOrderId: '018f4a1b-9b2e-7777-8000-000000000007',
        roleDefinitionId: '018f0000-0000-7000-8000-000000000003',
        roleKey: 'audience_strategist' as const,
        taskKey: 'audience_strategy',
        expectedArtifactType: 'audience_insight_board',
        status: (isPlanningDone ? 'completed' : 'in_progress') as const,
        blockedReasonCode: null,
        startedAt: '2026-11-18T00:00:30Z',
        completedAt: isPlanningDone ? '2026-11-18T00:01:30Z' : null,
        createdAt: '2026-11-18T00:00:00Z',
        updatedAt: '2026-11-18T00:01:30Z',
        version: 1,
      },
      {
        id: 'wi-cd',
        workOrderId: '018f4a1b-9b2e-7777-8000-000000000007',
        roleDefinitionId: '018f0000-0000-7000-8000-000000000004',
        roleKey: 'creative_director' as const,
        taskKey: 'creative_direction',
        expectedArtifactType: 'video_series_plan',
        status: (isPlanningDone ? 'completed' : 'in_progress') as const,
        blockedReasonCode: null,
        startedAt: '2026-11-18T00:00:30Z',
        completedAt: isPlanningDone ? '2026-11-18T00:01:30Z' : null,
        createdAt: '2026-11-18T00:00:00Z',
        updatedAt: '2026-11-18T00:01:30Z',
        version: 1,
      },
      {
        id: 'wi-sw',
        workOrderId: '018f4a1b-9b2e-7777-8000-000000000007',
        roleDefinitionId: '018f0000-0000-7000-8000-000000000005',
        roleKey: 'scriptwriter' as const,
        taskKey: 'script_package',
        expectedArtifactType: 'script_package',
        status: (isScriptsDone
          ? 'completed'
          : isPlanningDone
            ? 'in_progress'
            : 'waiting_dependency') as const,
        blockedReasonCode: null,
        startedAt: isPlanningDone ? '2026-11-18T00:02:00Z' : null,
        completedAt: isScriptsDone ? '2026-11-18T00:04:00Z' : null,
        createdAt: '2026-11-18T00:00:00Z',
        updatedAt: '2026-11-18T00:04:00Z',
        version: 1,
      },
      {
        id: 'wi-cr',
        workOrderId: MOCK_WORK_ORDER_ID,
        roleDefinitionId: '018f0000-0000-7000-8000-000000000006',
        roleKey: 'compliance_reviewer' as const,
        taskKey: 'compliance_review',
        expectedArtifactType: 'compliance_report',
        status: (isComplianceDone
          ? 'completed'
          : isScriptsDone
            ? 'in_progress'
            : 'waiting_dependency') as const,
        blockedReasonCode: null,
        startedAt: isScriptsDone ? '2026-11-18T00:04:00Z' : null,
        completedAt: isComplianceDone ? '2026-11-18T00:04:30Z' : null,
        createdAt: '2026-11-18T00:00:00Z',
        updatedAt: '2026-11-18T00:04:30Z',
        version: 1,
      },
    ],
    assignments: [
      {
        id: 'as-cos',
        workOrderId: '018f4a1b-9b2e-7777-8000-000000000007',
        roleDefinitionId: '018f0000-0000-7000-8000-000000000001',
        roleKey: 'chief_of_staff' as const,
        workItemId: 'wi-cos',
        officeState: 'completed' as const,
        waitingOnWorkItemId: null,
        latestReportCode: 'ORCHESTRATION_READY',
        createdAt: '2026-11-18T00:00:00Z',
        updatedAt: '2026-11-18T00:00:30Z',
        version: 1,
      },
      {
        id: 'as-ps',
        workOrderId: '018f4a1b-9b2e-7777-8000-000000000007',
        roleDefinitionId: '018f0000-0000-7000-8000-000000000002',
        roleKey: 'product_strategist' as const,
        workItemId: 'wi-ps',
        officeState: (isPlanningDone ? 'completed' : 'running') as const,
        waitingOnWorkItemId: null,
        latestReportCode: isPlanningDone ? 'STRATEGY_PERSISTED' : null,
        createdAt: '2026-11-18T00:00:00Z',
        updatedAt: '2026-11-18T00:01:30Z',
        version: 1,
      },
      {
        id: 'as-as',
        workOrderId: '018f4a1b-9b2e-7777-8000-000000000007',
        roleDefinitionId: '018f0000-0000-7000-8000-000000000003',
        roleKey: 'audience_strategist' as const,
        workItemId: 'wi-as',
        officeState: (isPlanningDone ? 'completed' : 'running') as const,
        waitingOnWorkItemId: null,
        latestReportCode: isPlanningDone ? 'AUDIENCE_PERSISTED' : null,
        createdAt: '2026-11-18T00:00:00Z',
        updatedAt: '2026-11-18T00:01:30Z',
        version: 1,
      },
      {
        id: 'as-cd',
        workOrderId: '018f4a1b-9b2e-7777-8000-000000000007',
        roleDefinitionId: '018f0000-0000-7000-8000-000000000004',
        roleKey: 'creative_director' as const,
        workItemId: 'wi-cd',
        officeState: (isPlanningDone ? 'completed' : 'running') as const,
        waitingOnWorkItemId: null,
        latestReportCode: isPlanningDone ? 'SERIES_PERSISTED' : null,
        createdAt: '2026-11-18T00:00:00Z',
        updatedAt: '2026-11-18T00:01:30Z',
        version: 1,
      },
      {
        id: 'as-sw',
        workOrderId: MOCK_WORK_ORDER_ID,
        roleDefinitionId: '018f0000-0000-7000-8000-000000000005',
        roleKey: 'scriptwriter' as const,
        workItemId: 'wi-sw',
        officeState: (isHandoffAccepted
          ? 'completed'
          : stage === 'review_required'
            ? 'review_required'
            : stage === 'compliance'
              ? 'completed'
              : isPlanningDone
                ? 'running'
                : 'waiting_dependency') as const,
        waitingOnWorkItemId: isPlanningDone ? null : 'wi-ps',
        latestReportCode: isHandoffAccepted
          ? 'SCRIPTS_ACCEPTED'
          : isScriptsDone
            ? 'SCRIPTS_5_READY'
            : null,
        createdAt: '2026-11-18T00:00:00Z',
        updatedAt: '2026-11-18T00:04:00Z',
        version: 1,
      },
      {
        id: 'as-cr',
        workOrderId: MOCK_WORK_ORDER_ID,
        roleDefinitionId: '018f0000-0000-7000-8000-000000000006',
        roleKey: 'compliance_reviewer' as const,
        workItemId: 'wi-cr',
        officeState: (isComplianceDone
          ? 'completed'
          : stage === 'compliance'
            ? 'running'
            : 'waiting_dependency') as const,
        waitingOnWorkItemId: stage === 'planning' || stage === 'script_generation' ? 'wi-sw' : null,
        latestReportCode: isComplianceDone ? 'COMPLIANCE_PASSED' : null,
        createdAt: '2026-11-18T00:00:00Z',
        updatedAt: '2026-11-18T00:04:30Z',
        version: 1,
      },
    ],
    dependencies: [
      {
        id: 'dep-1',
        workOrderId: MOCK_WORK_ORDER_ID,
        workItemId: 'wi-sw',
        dependsOnWorkItemId: 'wi-ps',
        createdAt: '2026-11-18T00:00:00Z',
      },
      {
        id: 'dep-2',
        workOrderId: MOCK_WORK_ORDER_ID,
        workItemId: 'wi-cr',
        dependsOnWorkItemId: 'wi-sw',
        createdAt: '2026-11-18T00:00:00Z',
      },
    ],
  };
}

export function createMockArtifacts(stage: WorkforceE2EStage) {
  if (stage === 'planning') {
    return [];
  }

  const items = [
    {
      id: 'art-1',
      workspaceId: MOCK_WORKSPACE.id,
      productId: MOCK_PRODUCT.id,
      workOrderId: MOCK_WORK_ORDER_ID,
      workItemId: 'wi-ps',
      assignmentId: 'as-ps',
      authorRoleKey: 'product_strategist' as const,
      artifactType: 'product_campaign_plan',
      lifecycleStatus: 'accepted' as const,
      currentRevisionNumber: 1,
      createdAt: '2026-11-18T00:01:00Z',
      updatedAt: '2026-11-18T00:01:00Z',
      version: 1,
    },
    {
      id: 'art-2',
      workspaceId: MOCK_WORKSPACE.id,
      productId: MOCK_PRODUCT.id,
      workOrderId: MOCK_WORK_ORDER_ID,
      workItemId: 'wi-as',
      assignmentId: 'as-as',
      authorRoleKey: 'audience_strategist' as const,
      artifactType: 'audience_insight_board',
      lifecycleStatus: 'accepted' as const,
      currentRevisionNumber: 1,
      createdAt: '2026-11-18T00:01:10Z',
      updatedAt: '2026-11-18T00:01:10Z',
      version: 1,
    },
    {
      id: 'art-3',
      workspaceId: MOCK_WORKSPACE.id,
      productId: MOCK_PRODUCT.id,
      workOrderId: MOCK_WORK_ORDER_ID,
      workItemId: 'wi-cd',
      assignmentId: 'as-cd',
      authorRoleKey: 'creative_director' as const,
      artifactType: 'video_series_plan',
      lifecycleStatus: 'accepted' as const,
      currentRevisionNumber: 1,
      createdAt: '2026-11-18T00:01:20Z',
      updatedAt: '2026-11-18T00:01:20Z',
      version: 1,
    },
  ];

  if (stage === 'compliance') {
    items.push({
      id: 'art-4',
      workspaceId: MOCK_WORKSPACE.id,
      productId: MOCK_PRODUCT.id,
      workOrderId: MOCK_WORK_ORDER_ID,
      workItemId: 'wi-sw',
      assignmentId: 'as-sw',
      authorRoleKey: 'scriptwriter' as const,
      artifactType: 'script_package',
      lifecycleStatus: 'draft' as const,
      currentRevisionNumber: 1,
      createdAt: '2026-11-18T00:04:00Z',
      updatedAt: '2026-11-18T00:04:00Z',
      version: 1,
    });
  } else if (stage === 'review_required' || stage === 'accepted_handoff') {
    items.push(
      {
        id: 'art-4',
        workspaceId: MOCK_WORKSPACE.id,
        productId: MOCK_PRODUCT.id,
        workOrderId: MOCK_WORK_ORDER_ID,
        workItemId: 'wi-sw',
        assignmentId: 'as-sw',
        authorRoleKey: 'scriptwriter' as const,
        artifactType: 'script_package',
        lifecycleStatus:
          stage === 'accepted_handoff' ? ('accepted' as const) : ('review_required' as const),
        currentRevisionNumber: 1,
        createdAt: '2026-11-18T00:04:00Z',
        updatedAt: '2026-11-18T00:04:00Z',
        version: 1,
      },
      {
        id: 'art-5',
        workspaceId: MOCK_WORKSPACE.id,
        productId: MOCK_PRODUCT.id,
        workOrderId: MOCK_WORK_ORDER_ID,
        workItemId: 'wi-cr',
        assignmentId: 'as-cr',
        authorRoleKey: 'compliance_reviewer' as const,
        artifactType: 'compliance_report',
        lifecycleStatus: 'accepted' as const,
        currentRevisionNumber: 1,
        createdAt: '2026-11-18T00:04:30Z',
        updatedAt: '2026-11-18T00:04:30Z',
        version: 1,
      },
    );
  }

  return items;
}

export function createMockActivities(stage: WorkforceE2EStage) {
  const activities = [
    {
      id: 'act-1',
      action: 'orchestrate',
      resourceType: 'work_order',
      resourceId: MOCK_WORK_ORDER_ID,
      result: 'success',
      occurredAt: '2026-11-18T00:00:10Z',
      changesJson: { workOrderId: MOCK_WORK_ORDER_ID, roleKey: 'chief_of_staff' },
    },
    {
      id: 'act-2',
      action: 'start_strategy',
      resourceType: 'work_item',
      resourceId: 'wi-ps',
      result: 'started',
      occurredAt: '2026-11-18T00:00:30Z',
      changesJson: { workOrderId: MOCK_WORK_ORDER_ID, workItemId: 'wi-ps' },
    },
  ];

  if (stage !== 'planning') {
    activities.push(
      {
        id: 'act-3',
        action: 'persist_strategy',
        resourceType: 'content_artifact',
        resourceId: 'art-1',
        result: 'success',
        occurredAt: '2026-11-18T00:01:30Z',
        changesJson: { workOrderId: MOCK_WORK_ORDER_ID, artifactId: 'art-1' },
      },
      {
        id: 'act-4',
        action: 'start_scriptwriting',
        resourceType: 'work_item',
        resourceId: 'wi-sw',
        result: 'started',
        occurredAt: '2026-11-18T00:02:00Z',
        changesJson: { workOrderId: MOCK_WORK_ORDER_ID, workItemId: 'wi-sw' },
      },
    );
  }

  if (stage === 'compliance' || stage === 'review_required' || stage === 'accepted_handoff') {
    activities.push(
      {
        id: 'act-5',
        action: 'produce_scripts',
        resourceType: 'content_artifact',
        resourceId: 'art-4',
        result: 'success',
        occurredAt: '2026-11-18T00:04:00Z',
        changesJson: { workOrderId: MOCK_WORK_ORDER_ID, artifactId: 'art-4' },
      },
      {
        id: 'act-6',
        action: 'start_compliance',
        resourceType: 'work_item',
        resourceId: 'wi-cr',
        result: 'started',
        occurredAt: '2026-11-18T00:04:10Z',
        changesJson: { workOrderId: MOCK_WORK_ORDER_ID, workItemId: 'wi-cr' },
      },
    );
  }

  if (stage === 'review_required' || stage === 'accepted_handoff') {
    activities.push({
      id: 'act-7',
      action: 'complete_compliance',
      resourceType: 'content_artifact',
      resourceId: 'art-5',
      result: 'success',
      occurredAt: '2026-11-18T00:04:30Z',
      changesJson: { workOrderId: MOCK_WORK_ORDER_ID, artifactId: 'art-5' },
    });
  }

  if (stage === 'accepted_handoff') {
    activities.push({
      id: 'act-8',
      action: 'accept_deliverables',
      resourceType: 'content_artifact',
      resourceId: 'art-4',
      result: 'success',
      occurredAt: '2026-11-18T00:06:00Z',
      changesJson: {
        workOrderId: MOCK_WORK_ORDER_ID,
        artifactId: 'art-4',
        roleKey: 'scriptwriter',
      },
    });
  }

  return activities;
}

export const MOCK_SCRIPT_PACKAGE = {
  schemaVersion: 1,
  seriesTitle: 'Pro Wireless Mic Launch Series',
  targetAudienceSummary: 'Content creators, vloggers, remote workers',
  creativeDirectionSummary:
    'Punchy product demo with clear audio proof and side-by-side comparison',
  evidenceReferences: [
    {
      sourceKind: 'product_fact' as const,
      sourceId: MOCK_FACTS[0]!.id,
    },
  ],
  videos: [
    {
      videoNumber: 1 as const,
      title: 'Episode 1: The Sound Test Challenge',
      objective: 'Prove audio quality in noisy environments',
      targetDurationSeconds: 45,
      hook: {
        spokenHook: 'Stop recording bad audio with your phone microphone.',
        visualHook: 'Side by side comparison shot in busy subway station',
      },
      voiceOver:
        'Episode 1 full voice-over: Testing the Pro Wireless Mic System in real world conditions. Dual transmitter delivers crystal clear sound.',
      scenes: [
        {
          sceneNumber: 1,
          timeRangeSeconds: { start: 0, end: 15 },
          visualDescription: 'Noisy cafe street',
          spokenText: 'Listen to this background noise.',
          audioCue: 'Street noise cut',
        },
        {
          sceneNumber: 2,
          timeRangeSeconds: { start: 15, end: 45 },
          visualDescription: 'Clear studio speech with Pro Mic active',
          spokenText: 'Now listen to the Pro Wireless Mic. Crystal clear voice clarity anywhere.',
        },
      ],
      onScreenOverlays: [
        {
          text: '14 Hours Continuous Battery Life',
          timeRangeSeconds: { start: 5, end: 12 },
          placement: 'lower_third' as const,
        },
      ],
      callToAction: {
        text: 'Tap the link below for 20% off launch pricing',
        visualDirection: 'Point down to link in description',
      },
      disclosure: {
        placement: 'bottom',
        text: '#ad Sponsored launch review',
      },
      shotList: [
        {
          shotNumber: 1,
          durationSeconds: 5,
          description: 'Close-up of transmitter clipped to collar',
          cameraAngle: 'Eye level',
          framing: 'Close-up',
          movement: 'Static',
          props: ['Transmitter', 'Lapel clip'],
        },
      ],
      variants: [],
      evidenceReferences: [
        {
          sourceKind: 'product_fact' as const,
          sourceId: MOCK_FACTS[0]!.id,
        },
      ],
      creativeHypotheses: ['Contrast hook drives 3x higher retention on short-form video'],
    },
    {
      videoNumber: 2 as const,
      title: 'Episode 2: Battery Endurance Test',
      objective: 'Demonstrate all-day 14-hour continuous recording',
      targetDurationSeconds: 40,
      hook: {
        spokenHook: 'Did your wireless mic die mid-shoot again?',
        visualHook: 'Dead battery icon flashing on smartphone',
      },
      voiceOver: 'Episode 2: With 14 hours of continuous battery life, you never miss a take.',
      scenes: [],
      onScreenOverlays: [],
      callToAction: {
        text: 'Order today with 30-day money-back guarantee',
        visualDirection: 'Show retail box',
      },
      disclosure: {
        placement: 'bottom',
        text: '#ad Sponsored content',
      },
      shotList: [],
      variants: [],
      evidenceReferences: [
        {
          sourceKind: 'product_fact' as const,
          sourceId: MOCK_FACTS[0]!.id,
        },
      ],
      creativeHypotheses: ['Battery anxiety angle appeals to field creators'],
    },
    {
      videoNumber: 3 as const,
      title: 'Episode 3: Dual Transmitter Setup',
      objective: 'Demonstrate two-person interview setup in seconds',
      targetDurationSeconds: 45,
      hook: {
        spokenHook: 'Two voices, one receiver, zero hassle.',
        visualHook: 'Two hosts clipping on matching microphones',
      },
      voiceOver: 'Episode 3: Dual transmitter pairing right out of the charging case.',
      scenes: [],
      onScreenOverlays: [],
      callToAction: {
        text: 'Upgrade your interview audio now',
        visualDirection: 'Point to screen',
      },
      disclosure: {
        placement: 'bottom',
        text: '#ad Sponsored content',
      },
      shotList: [],
      variants: [],
      evidenceReferences: [],
      creativeHypotheses: [],
    },
    {
      videoNumber: 4 as const,
      title: 'Episode 4: Noise Cancellation Demo',
      objective: 'Test noise cancellation against street construction',
      targetDurationSeconds: 35,
      hook: {
        spokenHook: 'Can you hear me over this jackhammer?',
        visualHook: 'Creator standing near loud construction site',
      },
      voiceOver: 'Episode 4: Instant active noise reduction cuts background chaos.',
      scenes: [],
      onScreenOverlays: [],
      callToAction: {
        text: 'Hear the difference yourself — link in bio',
        visualDirection: 'Point to bio',
      },
      disclosure: {
        placement: 'bottom',
        text: '#ad Sponsored content',
      },
      shotList: [],
      variants: [],
      evidenceReferences: [],
      creativeHypotheses: [],
    },
    {
      videoNumber: 5 as const,
      title: 'Episode 5: The Creator Verdict',
      objective: 'Summary recommendation and final launch offer',
      targetDurationSeconds: 50,
      hook: {
        spokenHook: 'Is this the best mic under $100 this year?',
        visualHook: 'Holding mic case up to camera',
      },
      voiceOver: 'Episode 5: Everything you need for studio sound anywhere. Highly recommended.',
      scenes: [],
      onScreenOverlays: [],
      callToAction: {
        text: 'Limited launch bundle available at link below',
        visualDirection: 'Hold product box',
      },
      disclosure: {
        placement: 'bottom',
        text: '#ad Sponsored content',
      },
      shotList: [],
      variants: [],
      evidenceReferences: [],
      creativeHypotheses: [],
    },
  ],
};

export const MOCK_SCRIPT_PACKAGE_ARTIFACT = {
  artifact: {
    id: 'art-4',
    workspaceId: MOCK_WORKSPACE.id,
    productId: MOCK_PRODUCT.id,
    workOrderId: MOCK_WORK_ORDER_ID,
    workItemId: 'wi-sw',
    assignmentId: 'as-sw',
    authorRoleKey: 'scriptwriter' as const,
    artifactType: 'script_package',
    lifecycleStatus: 'review_required' as const,
    currentRevisionNumber: 1,
    createdAt: '2026-11-18T00:04:00Z',
    updatedAt: '2026-11-18T00:04:00Z',
    version: 1,
  },
  latestRevision: {
    id: 'rev-1',
    workspaceId: MOCK_WORKSPACE.id,
    artifactId: 'art-4',
    revisionNumber: 1,
    contentJson: MOCK_SCRIPT_PACKAGE,
    contentHashHex: 'a1b2c3d4e5f6',
    schemaVersion: 1,
    promptTemplate: 'script_package_v1',
    promptVersion: '1.0',
    provider: 'google',
    model: 'gemini-3.8-flash',
    tokenInput: 1500,
  },
  evidenceReferences: [
    {
      sourceKind: 'product_fact' as const,
      sourceId: MOCK_FACTS[0]!.id,
    },
  ],
  lineage: null,
};

export const MOCK_COMPLIANCE_EVALUATION = {
  id: '018f4a1b-9b2e-7999-8000-000000000009',
  workspaceId: MOCK_WORKSPACE.id,
  artifactId: 'art-4',
  revisionNumber: 1,
  contentHashHex: 'a1b2c3d4e5f6',
  policyVersion: '1.0',
  policyHashHex: 'e6f5d4c3b2a1',
  status: 'completed' as const,
  result: 'passed' as const,
  aiAdvisoryStatus: 'completed' as const,
  blockingCount: 0,
  warningCount: 0,
  infoCount: 0,
  evaluatedAt: '2026-11-18T00:04:30Z',
  evaluatedByActorType: 'system' as const,
  evaluatedByActorId: 'compliance_service',
  findings: [],
};
