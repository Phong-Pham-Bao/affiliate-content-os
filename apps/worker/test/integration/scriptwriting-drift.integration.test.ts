import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AIGatewayPort, AIScriptVideoInput } from '@affiliate-content-os/application';
import { generateUuidV7 } from '@affiliate-content-os/application';
import type { ContentBrief, ScriptPackage, ScriptVideo } from '@affiliate-content-os/domain';
import { computeCanonicalContextHash, validateScriptPackage } from '@affiliate-content-os/domain';
import { PostgresJobAdapter } from '@affiliate-content-os/infrastructure/jobs';
import { requestScriptChangesTransaction } from '@affiliate-content-os/infrastructure/workforce';
import { processScriptwritingJob } from '../../src/scriptwriting-job-processor.js';
import {
  setupWorkforceWorkerDatabase,
  type WorkforceWorkerSeedContext,
} from './helpers/setup-workforce-worker-db.js';

describe('scriptwriting-drift.integration (Worker Authoritative-Context Drift Handling)', () => {
  let dbContext: WorkforceWorkerSeedContext;
  let jobAdapter: PostgresJobAdapter;
  let workOrderId: string;
  let artifactId: string;

  function makeTestIdemp(routeKey: string, key = 'test-worker-drift') {
    const rawKey = `${key}-${Date.now()}-${Math.random()}`;
    return {
      rawKey,
      keyHash: new Uint8Array(crypto.createHash('sha256').update(rawKey).digest()),
      requestHash: new Uint8Array(crypto.createHash('sha256').update(rawKey).digest()),
      routeKey,
    };
  }

  function createFakeSingleVideoScript(
    videoNumber: 1 | 2 | 3 | 4 | 5,
    factId: string,
  ): { schemaVersion: 1; video: ScriptVideo } {
    return {
      schemaVersion: 1,
      video: {
        videoNumber,
        title: `Video ${videoNumber}: Giải pháp công thái học`,
        objective: `Mục tiêu chuyển đổi cho Video ${videoNumber}`,
        targetDurationSeconds: 45,
        hook: {
          spokenHook: `Bạn có đang đau mỏi lưng mỗi ngày? (Video ${videoNumber})`,
          visualHook: 'Cận cảnh nhân viên mệt mỏi',
        },
        voiceOver: 'Ghế công thái học mang lại sự thoải mái tuyệt đối cho ngày làm việc dài.',
        scenes: [
          {
            sceneNumber: 1,
            timeRangeSeconds: { start: 0, end: 5 },
            visualDescription: 'Nhân viên ôm lưng',
            spokenText: `Bạn có đang đau mỏi lưng mỗi ngày? (Video ${videoNumber})`,
            audioCue: null,
          },
          {
            sceneNumber: 2,
            timeRangeSeconds: { start: 5, end: 45 },
            visualDescription: 'Trải nghiệm ngồi thoải mái',
            spokenText: 'Ghế công thái học mang lại sự thoải mái tuyệt đối.',
            audioCue: 'Nhạc nhẹ',
          },
        ],
        onScreenOverlays: [
          {
            text: 'Giảm 40% áp lực cột sống',
            timeRangeSeconds: { start: 5, end: 15 },
            placement: 'lower_third',
          },
        ],
        callToAction: {
          text: 'Bấm ngay vào link bên dưới để nhận ưu đãi 20%!',
          visualDirection: 'Trỏ tay vào link affiliate',
        },
        disclosure: {
          placement: 'Góc trên bên phải',
          text: '#quangcao Hợp tác tiếp thị liên kết cùng ErgoFlow',
        },
        shotList: [
          {
            shotNumber: 1,
            durationSeconds: 5,
            description: 'Cận cảnh khuôn mặt',
            cameraAngle: 'Eye level',
            framing: 'Close-up',
            movement: 'Static',
            props: ['Laptop'],
          },
        ],
        variants: [],
        evidenceReferences: [{ sourceKind: 'product_fact', sourceId: factId }],
        creativeHypotheses: ['Nhắm trúng dân văn phòng'],
      },
    };
  }

  beforeAll(async () => {
    dbContext = await setupWorkforceWorkerDatabase();
    jobAdapter = new PostgresJobAdapter(dbContext.pool);

    const { pool, wsId, userId, prodId, factSetId, factId, analysisId } = dbContext;

    // 1. Create context package
    const cpId = generateUuidV7();
    const contextHash = computeCanonicalContextHash({
      workspaceId: wsId,
      productId: prodId,
      productVersion: 1,
      factSetId,
      factSetVersion: 1,
      analyses: [{ analysisId, version: 1 }],
      schemaVersion: 1,
    });

    await pool.query(
      `INSERT INTO context_packages (
         id, workspace_id, product_id, fact_set_id, context_schema_version, context_hash, created_by_user_id, created_at
       ) VALUES ($1, $2, $3, $4, 1, $5, $6, NOW())`,
      [cpId, wsId, prodId, factSetId, contextHash, userId],
    );

    // 2. Create work order
    workOrderId = generateUuidV7();
    await pool.query(
      `INSERT INTO work_orders (
         id, workspace_id, product_id, context_package_id, mission_type, directive_text,
         graph_template, graph_version, status, created_by_user_id, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, 'short_video_series', 'Drift test mission', 'creative_office_v1', 1, 'in_progress', $5, NOW(), NOW())`,
      [workOrderId, wsId, prodId, cpId, userId],
    );

    // 3. Scriptwriter role definition
    const roleRes = await pool.query(
      `SELECT id FROM agent_role_definitions WHERE role_key = 'scriptwriter'`,
    );
    const scriptwriterRoleId = roleRes.rows[0].id;

    const wiId = generateUuidV7();
    await pool.query(
      `INSERT INTO work_items (
         id, workspace_id, work_order_id, role_definition_id, task_key, expected_artifact_type,
         status, started_at, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, 'scriptwriting', 'script_package', 'running', NOW(), NOW(), NOW())`,
      [wiId, wsId, workOrderId, scriptwriterRoleId],
    );

    const asgId = generateUuidV7();
    await pool.query(
      `INSERT INTO agent_assignments (
         id, workspace_id, work_order_id, role_definition_id, work_item_id, office_state, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, 'running', NOW(), NOW())`,
      [asgId, wsId, workOrderId, scriptwriterRoleId, wiId],
    );

    // 4. Seed the 3 planning artifacts and their revisions
    const planningArtifacts = [
      { type: 'product_campaign_plan', title: 'Product Campaign Plan' },
      { type: 'audience_insight_board', title: 'Audience Insight Board' },
      { type: 'video_series_plan', title: 'Video Series Plan' },
    ];

    const planningRevs: Record<string, { id: string; num: number }> = {};

    for (const pa of planningArtifacts) {
      const pArtId = generateUuidV7();
      const pRevId = generateUuidV7();
      const pContent = { schemaVersion: 1, name: pa.title };
      const pHash = crypto.createHash('sha256').update(JSON.stringify(pContent)).digest();

      await pool.query(
        `INSERT INTO content_artifacts (
           id, workspace_id, product_id, work_order_id, work_item_id, assignment_id,
           lifecycle_status, artifact_type, author_role_key, current_revision_number, version, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, 'review_required', $7, 'product_strategist', 1, 1, NOW(), NOW())`,
        [pArtId, wsId, prodId, workOrderId, wiId, asgId, pa.type],
      );

      await pool.query(
        `INSERT INTO content_artifact_revisions (
           id, workspace_id, artifact_id, revision_number, author_role_key,
           schema_version, prompt_template, prompt_version, provider, model,
           content_hash, content_json, created_at
         ) VALUES ($1, $2, $3, 1, 'product_strategist', 1, 'planning', '1.0.0', 'google', 'gemini-3.8-flash', $4, $5::jsonb, NOW())`,
        [pRevId, wsId, pArtId, pHash, JSON.stringify(pContent)],
      );

      planningRevs[pa.type] = { id: pRevId, num: 1 };
    }

    // 5. Persist content brief
    const brief: ContentBrief = {
      schemaVersion: 1,
      workspaceId: wsId as never,
      productId: prodId as never,
      workOrderId: workOrderId as never,
      briefVersion: 1,
      directiveText: 'Directive text',
      productSummary: {
        productName: 'Ergo Chair',
        merchantName: 'Ergo Corp',
        category: 'Chairs',
        description: 'Office chair',
      },
      eligibleFactIds: [factId],
      eligibleAnalysisIds: [analysisId],
      createdAt: new Date().toISOString() as never,
      campaignPlan: {
        schemaVersion: 1,
        summary: 'Brief Campaign Summary',
        positioningStatement: 'Positioning',
        campaignGoals: ['Goal 1'],
        coreBenefits: [{ benefit: 'Ergonomic lumbar support', evidenceRefs: [factId] }],
        targetObjections: [
          { objection: 'Cost', counterAngle: 'Durability', evidenceRefs: [analysisId] },
        ],
        complianceConstraints: ['No false medical claims'],
        creativeHypotheses: [{ hypothesis: 'Posture relief', rationale: 'Clinically tested' }],
        evidenceReferences: [{ sourceKind: 'product_fact', sourceId: factId }],
      },
      audienceBoard: {
        schemaVersion: 1,
        summary: 'Desk Workers',
        audienceSegments: [
          {
            segmentName: 'Remote professionals',
            description: 'Works at desk',
            awarenessStage: 'problem_aware',
            corePains: ['Back stiffness'],
            desires: ['Work comfort'],
            evidenceRefs: [factId],
          },
        ],
        contentAngles: [
          {
            angleName: 'Angle 1',
            hookConcept: 'Hook 1',
            targetSegment: 'Remote professionals',
            creativeHypothesis: 'Hypothesis 1',
          },
        ],
        evidenceReferences: [{ sourceKind: 'product_fact', sourceId: factId }],
      },
      seriesPlan: {
        schemaVersion: 1,
        seriesTitle: 'Posture Transformation Series',
        seriesNarrativeArc: 'From discomfort to sustained energy',
        creativeDirection: {
          visualTone: 'Clean & Informative',
          audioTone: 'Modern',
          pacing: 'Brisk',
        },
        episodes: [1, 2, 3, 4, 5].map((vNum) => ({
          episodeNumber: vNum,
          title: `Episode ${vNum}`,
          purpose: 'Benefit',
          hook: `Hook for episode ${vNum}`,
          narrativeRole: 'Core',
          visualDirection: 'Visual direction',
          callToActionDirection: 'CTA direction',
          evidenceRefs: [factId],
        })) as never,
        evidenceReferences: [{ sourceKind: 'product_fact', sourceId: factId }],
      },
      planningRevisions: {
        productCampaignPlanRevisionId: planningRevs.product_campaign_plan!.id,
        productCampaignPlanRevisionNumber: planningRevs.product_campaign_plan!.num,
        audienceInsightBoardRevisionId: planningRevs.audience_insight_board!.id,
        audienceInsightBoardRevisionNumber: planningRevs.audience_insight_board!.num,
        videoSeriesPlanRevisionId: planningRevs.video_series_plan!.id,
        videoSeriesPlanRevisionNumber: planningRevs.video_series_plan!.num,
      },
    };
    const briefHash = crypto.createHash('sha256').update(JSON.stringify(brief)).digest();

    await pool.query(
      `INSERT INTO content_briefs (
         id, workspace_id, product_id, work_order_id, brief_version, brief_json, brief_hash, created_at
       ) VALUES ($1, $2, $3, $4, 1, $5::jsonb, $6, NOW())`,
      [generateUuidV7(), wsId, prodId, workOrderId, JSON.stringify(brief), briefHash],
    );

    // 6. Persist initial script_package artifact and revision 1
    artifactId = generateUuidV7();
    const vList: ScriptVideo[] = [1, 2, 3, 4, 5].map(
      (n) => createFakeSingleVideoScript(n as 1 | 2 | 3 | 4 | 5, factId).video,
    );
    const initialPkg: ScriptPackage = validateScriptPackage({
      schemaVersion: 1,
      seriesTitle: 'Posture Transformation Series',
      targetAudienceSummary: 'Desk Workers',
      creativeDirectionSummary: 'Clean & Informative',
      videos: vList,
      evidenceReferences: [{ sourceKind: 'product_fact', sourceId: factId }],
    });
    const initialPkgHash = crypto.createHash('sha256').update(JSON.stringify(initialPkg)).digest();

    await pool.query(
      `INSERT INTO content_artifacts (
         id, workspace_id, product_id, work_order_id, work_item_id, assignment_id,
         lifecycle_status, artifact_type, author_role_key, current_revision_number, version, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, 'review_required', 'script_package', 'scriptwriter', 1, 1, NOW(), NOW())`,
      [artifactId, wsId, prodId, workOrderId, wiId, asgId],
    );

    await pool.query(
      `INSERT INTO content_artifact_revisions (
         id, workspace_id, artifact_id, revision_number, author_role_key,
         schema_version, prompt_template, prompt_version, provider, model,
         content_hash, content_json, created_at
       ) VALUES ($1, $2, $3, 1, 'scriptwriter', 1, 'scriptwriting', '1.0.0', 'google', 'gemini-3.8-flash', $4, $5::jsonb, NOW())`,
      [generateUuidV7(), wsId, artifactId, initialPkgHash, JSON.stringify(initialPkg)],
    );
  });

  afterAll(async () => {
    if (dbContext?.database) await dbContext.database.close();
    await dbContext?.context?.cleanup();
  });

  async function getArtifactState() {
    const artRes = await dbContext.pool.query(
      `SELECT version, current_revision_number FROM content_artifacts WHERE id = $1`,
      [artifactId],
    );
    const revNum = Number(artRes.rows[0].current_revision_number);
    const revRes = await dbContext.pool.query(
      `SELECT content_hash, content_json FROM content_artifact_revisions WHERE artifact_id = $1 AND revision_number = $2`,
      [artifactId, revNum],
    );
    return {
      version: Number(artRes.rows[0].version),
      currentRevisionNumber: revNum,
      contentHashHex: Buffer.from(revRes.rows[0].content_hash).toString('hex'),
      contentJson: revRes.rows[0].content_json as ScriptPackage,
    };
  }

  it('detects pre-provider context drift and terminalizes without invoking the gateway (gateway calls = 0)', async () => {
    const { pool, wsId, userId } = dbContext;
    const artState = await getArtifactState();

    // 1. Create a change request targeting video 1
    const crClient = await pool.connect();
    let crId: string;
    try {
      await crClient.query('BEGIN');
      const crRes = await requestScriptChangesTransaction(crClient, {
        workspaceId: wsId as never,
        artifactId,
        actorUserId: userId as never,
        expectedVersion: artState.version,
        baseRevisionNumber: artState.currentRevisionNumber,
        baseContentHashHex: artState.contentHashHex,
        instructionText: 'Sharpen hook for testing drift',
        selectedVideoNumbers: [1],
        targetVariantCount: 1,
        idempotency: makeTestIdemp('req-changes-drift-pre'),
      });
      crId = crRes.id;
      await crClient.query('COMMIT');
    } finally {
      crClient.release();
    }

    // 2. Claim the scriptwriting job for this change request
    const claimed = await jobAdapter.claimNextJob({
      workerId: 'worker-drift-test',
      leaseDurationSeconds: 30,
    });
    expect(claimed).not.toBeNull();

    // 3. Simulate drift in authoritative context BEFORE worker runs:
    await pool.query(
      `UPDATE content_artifacts
       SET current_revision_number = 999
       WHERE workspace_id = $1 AND work_order_id = $2 AND artifact_type = 'product_campaign_plan'`,
      [wsId, workOrderId],
    );

    let gatewayCallCount = 0;
    const countingGateway: AIGatewayPort = {
      executeProductAnalysis: async () => ({
        success: false,
        usage: {} as never,
        provenance: {} as never,
      }),
      executeNicheAnalysis: async () => ({
        success: false,
        usage: {} as never,
        provenance: {} as never,
      }),
      executeAudienceInsightBoard: async () => ({
        success: false,
        usage: {} as never,
        provenance: {} as never,
      }),
      executeVideoSeriesPlan: async () => ({
        success: false,
        usage: {} as never,
        provenance: {} as never,
      }),
      executeProductCampaignPlan: async () => ({
        success: false,
        usage: {} as never,
        provenance: {} as never,
      }),
      executeScriptVideo: async () => {
        gatewayCallCount++;
        return { success: false, usage: {} as never, provenance: {} as never };
      },
    };

    // 4. Run worker processor
    await processScriptwritingJob(claimed!, {
      workerId: 'worker-drift-test',
      gatewayPort: countingGateway,
      pool,
    });

    // Gateway must NOT have been called!
    expect(gatewayCallCount).toBe(0);

    // Verify job is failed and error category is invalid_evidence
    const jobCheck = await pool.query(
      `SELECT status, last_error_category FROM job_executions WHERE id = $1`,
      [claimed!.id],
    );
    expect(jobCheck.rows[0].status).toBe('failed');
    expect(jobCheck.rows[0].last_error_category).toBe('invalid_evidence');

    // Verify change request is marked failed with context_drift
    const crCheck = await pool.query(
      `SELECT status, failure_code FROM artifact_change_requests WHERE id = $1`,
      [crId],
    );
    expect(crCheck.rows[0].status).toBe('failed');
    expect(crCheck.rows[0].failure_code).toBe('context_drift');

    // Verify Scriptwriter assignment is transitioned out of running to failed
    const asgCheck = await pool.query(
      `SELECT aa.office_state
       FROM agent_assignments aa
       JOIN agent_role_definitions rd ON rd.id = aa.role_definition_id
       WHERE aa.workspace_id = $1 AND aa.work_order_id = $2 AND rd.role_key = 'scriptwriter'`,
      [wsId, workOrderId],
    );
    expect(asgCheck.rows[0].office_state).toBe('failed');

    // Restore planning artifact current revision number for subsequent tests
    await pool.query(
      `UPDATE content_artifacts
       SET current_revision_number = 1
       WHERE workspace_id = $1 AND work_order_id = $2 AND artifact_type = 'product_campaign_plan'`,
      [wsId, workOrderId],
    );
  });

  it('handles post-provider context drift at assembly deterministically with exactly one gateway call and no rollback into retry', async () => {
    const { pool, wsId, userId, factId } = dbContext;
    const artState = await getArtifactState();

    // Reset assignment to running for this test
    await pool.query(
      `UPDATE agent_assignments aa
       SET office_state = 'running'
       FROM agent_role_definitions rd
       WHERE aa.role_definition_id = rd.id
         AND aa.workspace_id = $1 AND aa.work_order_id = $2 AND rd.role_key = 'scriptwriter'`,
      [wsId, workOrderId],
    );

    // 1. Create change request
    const crClient = await pool.connect();
    let crId: string;
    try {
      await crClient.query('BEGIN');
      const crRes = await requestScriptChangesTransaction(crClient, {
        workspaceId: wsId as never,
        artifactId,
        actorUserId: userId as never,
        expectedVersion: artState.version,
        baseRevisionNumber: artState.currentRevisionNumber,
        baseContentHashHex: artState.contentHashHex,
        instructionText: 'Update hook post provider drift',
        selectedVideoNumbers: [2],
        targetVariantCount: 1,
        idempotency: makeTestIdemp('req-changes-drift-post'),
      });
      crId = crRes.id;
      await crClient.query('COMMIT');
    } finally {
      crClient.release();
    }

    const claimed = await jobAdapter.claimNextJob({
      workerId: 'worker-post-drift',
      leaseDurationSeconds: 30,
    });
    expect(claimed).not.toBeNull();

    let gatewayCallCount = 0;
    const validScript = createFakeSingleVideoScript(2, factId);

    const countingGateway: AIGatewayPort = {
      executeProductAnalysis: async () => ({
        success: false,
        usage: {} as never,
        provenance: {} as never,
      }),
      executeNicheAnalysis: async () => ({
        success: false,
        usage: {} as never,
        provenance: {} as never,
      }),
      executeAudienceInsightBoard: async () => ({
        success: false,
        usage: {} as never,
        provenance: {} as never,
      }),
      executeVideoSeriesPlan: async () => ({
        success: false,
        usage: {} as never,
        provenance: {} as never,
      }),
      executeProductCampaignPlan: async () => ({
        success: false,
        usage: {} as never,
        provenance: {} as never,
      }),
      executeScriptVideo: async (_input: AIScriptVideoInput) => {
        gatewayCallCount++;
        // Simulate race condition: between provider start and return/assembly, planning revision changes!
        await pool.query(
          `UPDATE content_artifacts
           SET current_revision_number = 999
           WHERE workspace_id = $1 AND work_order_id = $2 AND artifact_type = 'video_series_plan'`,
          [wsId, workOrderId],
        );
        return {
          success: true,
          content: validScript,
          usage: {
            tokenInput: 500,
            tokenOutput: 300,
            costMicrounits: 8500,
            costCurrency: 'USD',
            latencyMs: 350,
          },
          provenance: {
            provider: 'google',
            model: 'gemini-3.8-flash',
            promptTemplate: 'scriptwriting',
            promptVersion: '1.0.0',
            inputSchemaVersion: 1,
            outputSchemaVersion: 1,
          },
        };
      },
    };

    // Run processor: provider succeeds, but assembly detects context drift post-provider
    await processScriptwritingJob(claimed!, {
      workerId: 'worker-post-drift',
      gatewayPort: countingGateway,
      pool,
    });

    // Provider was called exactly ONCE
    expect(gatewayCallCount).toBe(1);

    // The unit itself succeeded with provider, so job is marked succeeded and budget settled
    const jobCheck = await pool.query(`SELECT status FROM job_executions WHERE id = $1`, [
      claimed!.id,
    ]);
    expect(jobCheck.rows[0].status).toBe('succeeded');

    // But change request is terminalized as failed with context_drift (NO artifact revision created from stale context)
    const crCheck = await pool.query(
      `SELECT status, failure_code, resulting_revision_number FROM artifact_change_requests WHERE id = $1`,
      [crId],
    );
    expect(crCheck.rows[0].status).toBe('failed');
    expect(crCheck.rows[0].failure_code).toBe('context_drift');
    expect(crCheck.rows[0].resulting_revision_number).toBeNull();

    // Scriptwriter assignment is transitioned out of running to failed
    const asgCheck = await pool.query(
      `SELECT aa.office_state
       FROM agent_assignments aa
       JOIN agent_role_definitions rd ON rd.id = aa.role_definition_id
       WHERE aa.workspace_id = $1 AND aa.work_order_id = $2 AND rd.role_key = 'scriptwriter'`,
      [wsId, workOrderId],
    );
    expect(asgCheck.rows[0].office_state).toBe('failed');

    // Restore series plan current revision
    await pool.query(
      `UPDATE content_artifacts
       SET current_revision_number = 1
       WHERE workspace_id = $1 AND work_order_id = $2 AND artifact_type = 'video_series_plan'`,
      [wsId, workOrderId],
    );
  });
});
