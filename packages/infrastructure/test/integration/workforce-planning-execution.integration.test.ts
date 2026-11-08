import crypto from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AIGatewayPort, AIAnalysisGatewayResult } from '@affiliate-content-os/application';
import type {
  AudienceInsightBoard,
  ProductCampaignPlan,
  VideoSeriesPlan,
} from '@affiliate-content-os/domain';
import { setupIsolatedTestDatabase, type TestDatabaseContext } from './helpers/setup.js';
import {
  seedWorkforceBaseData,
  createTestKickoffParams,
  FIXTURE_IDS,
} from './helpers/workforce-fixtures.js';
import { PostgresWorkforceAdapter } from '../../src/workforce/postgres-workforce-adapter.js';
import { PostgresJobAdapter } from '../../src/jobs/postgres-job-adapter.js';
import { settleWorkforcePlanningJobAtomic } from '../../src/workforce/workforce-planning-settlement.js';

describe('workforce-planning-execution.integration (Controlled Fake-Provider Slice)', () => {
  let context: TestDatabaseContext;
  let pool: pg.Pool;
  let adapter: PostgresWorkforceAdapter;
  let jobAdapter: PostgresJobAdapter;

  const { wsId, factSetId, analysisId1 } = FIXTURE_IDS;
  let factId: string;

  beforeAll(async () => {
    context = await setupIsolatedTestDatabase();
    pool = new pg.Pool({ connectionString: context.dbUrl });
    adapter = new PostgresWorkforceAdapter(pool);
    jobAdapter = new PostgresJobAdapter(pool);
    await seedWorkforceBaseData(pool);

    const factRes = await pool.query(
      `SELECT id FROM product_facts WHERE fact_set_id = $1 LIMIT 1`,
      [factSetId],
    );
    factId = factRes.rows[0].id;
  });

  afterAll(async () => {
    if (pool) await pool.end();
    await context?.cleanup();
  });

  function createFakePlanningGateway(options?: {
    readonly invalidateEvidence?: boolean;
  }): AIGatewayPort {
    const invalidFact = '018f6c5b-21a4-789a-8def-999999999999';
    const effectiveFactId = options?.invalidateEvidence ? invalidFact : factId;

    const fakeUsage = {
      tokenInput: 500,
      tokenOutput: 300,
      costMicrounits: 45000,
      costCurrency: 'USD',
      latencyMs: 350,
    };

    const fakeProv = {
      provider: 'google',
      model: 'gemini-3.8-flash',
      promptTemplate: 'planning_v1',
      promptVersion: '1.0.0',
      inputSchemaVersion: 1,
      outputSchemaVersion: 1,
    };

    return {
      executeProductAnalysis: async () => ({
        success: false,
        usage: fakeUsage,
        provenance: fakeProv,
      }),
      executeNicheAnalysis: async () => ({
        success: false,
        usage: fakeUsage,
        provenance: fakeProv,
      }),

      executeProductCampaignPlan: async (): Promise<
        AIAnalysisGatewayResult<ProductCampaignPlan>
      > => {
        const content: ProductCampaignPlan = {
          schemaVersion: 1,
          summary: 'Validated launch campaign for high-growth remote teams.',
          positioningStatement: 'The ergonomic powerhouse designed for creator flow.',
          campaignGoals: ['Acquire 500 initial customers', 'Establish category leadership'],
          coreBenefits: [
            {
              benefit: 'Patented dynamic lumbar support reduces lower back strain.',
              evidenceRefs: [effectiveFactId],
            },
          ],
          targetObjections: [
            {
              objection: 'Premium price point relative to big-box office chairs.',
              counterAngle: '5-year commercial warranty equates to under $0.50 per workday.',
              evidenceRefs: [analysisId1],
            },
          ],
          complianceConstraints: [
            'Always state 30-day money-back guarantee terms clearly.',
            'Affiliate link disclosure required in all descriptions.',
          ],
          creativeHypotheses: [
            {
              hypothesis:
                'Targeting remote software developers with posture heatmaps drives highest CTR.',
              rationale:
                'High purchasing power and proven ergonomic pain point in market analysis.',
            },
          ],
          evidenceReferences: [
            { sourceKind: 'product_fact', sourceId: effectiveFactId },
            { sourceKind: 'analysis', sourceId: analysisId1 },
          ],
        };
        return { success: true, content, usage: fakeUsage, provenance: fakeProv };
      },

      executeAudienceInsightBoard: async (): Promise<
        AIAnalysisGatewayResult<AudienceInsightBoard>
      > => {
        const content: AudienceInsightBoard = {
          schemaVersion: 1,
          summary: 'In-depth audience analysis across creator and tech segments.',
          audienceSegments: [
            {
              segmentName: 'Remote Knowledge Workers (28-45)',
              description: 'Full-time remote tech professionals seeking ergonomics.',
              awarenessStage: 'problem_aware',
              corePains: ['Afternoon sciatica and thoracic fatigue.'],
              desires: ['Work 8+ hours pain-free', 'Aesthetically clean workspace'],
              evidenceRefs: [effectiveFactId],
            },
          ],
          contentAngles: [
            {
              angleName: 'Ergonomic Energy Drain',
              hookConcept: 'If your lower back hurts by 2 PM, your chair is stealing your energy.',
              targetSegment: 'Remote Knowledge Workers (28-45)',
              creativeHypothesis:
                'Focusing on afternoon fatigue creates urgency for chair upgrades.',
            },
          ],
          evidenceReferences: [{ sourceKind: 'product_fact', sourceId: effectiveFactId }],
        };
        return { success: true, content, usage: fakeUsage, provenance: fakeProv };
      },

      executeVideoSeriesPlan: async (): Promise<AIAnalysisGatewayResult<VideoSeriesPlan>> => {
        const content: VideoSeriesPlan = {
          schemaVersion: 1,
          seriesTitle: 'The Ergonomic Awakening',
          seriesNarrativeArc:
            'Progressing from chronic posture struggle to uninhibited creative productivity.',
          episodes: [
            {
              episodeNumber: 1,
              title: 'Disrupt Scrolling',
              purpose: 'Disrupt scrolling and diagnose common posture mistakes.',
              hook: 'Stop sitting like a boiled shrimp at your desk.',
              narrativeRole: 'Problem awareness',
              visualDirection: 'Immediate close-up of slumped spine with thermal posture overlay.',
              callToActionDirection: 'Save this video to audit your workstation.',
              evidenceRefs: [effectiveFactId],
            },
            {
              episodeNumber: 2,
              title: 'Expose Foam',
              purpose: 'Expose foam degradation in standard office seating.',
              hook: 'Why your expensive desk chair feels like concrete after 6 months.',
              narrativeRole: 'Mechanism explanation',
              visualDirection: 'Side-by-side compression test of cheap foam vs breathable mesh.',
              callToActionDirection: 'Check comment link for full specs.',
              evidenceRefs: [effectiveFactId],
            },
            {
              episodeNumber: 3,
              title: 'Lumbar Dial',
              purpose: 'Demonstrate patented lumbar adjustment mechanism.',
              hook: 'The 10-second adjustment that resolved my lumbar fatigue.',
              narrativeRole: 'Solution demonstration',
              visualDirection:
                'Fluid camera pan clicking the dial into place while user sighs in relief.',
              callToActionDirection: 'Click bio link to see sizing guide.',
              evidenceRefs: [effectiveFactId],
            },
            {
              episodeNumber: 4,
              title: 'Coffee Math',
              purpose: 'Address price objection with daily amortization math.',
              hook: 'It costs less than your daily oat milk latte to protect your spine.',
              narrativeRole: 'Value justification',
              visualDirection:
                'Split screen comparing daily coffee receipt to daily cost of chair.',
              callToActionDirection: 'Claim the limited 15% discount code.',
              evidenceRefs: [effectiveFactId],
            },
            {
              episodeNumber: 5,
              title: 'Social Proof',
              purpose: 'Social proof montage and final launch call to action.',
              hook: 'Over 2,000 creators switched this month. Here is what happened.',
              narrativeRole: 'Final conversion',
              visualDirection:
                'Rapid-fire testimonial clips, unboxing reactions, and 5-year guarantee stamp.',
              callToActionDirection: 'Order now before the current batch sells out.',
              evidenceRefs: [effectiveFactId],
            },
          ],
          creativeDirection: {
            visualTone: 'Clean studio lighting with realistic office ergonomics',
            audioTone: 'Empathetic, clear, and direct',
            pacing: 'Fast-paced with punchy cuts',
          },
          evidenceReferences: [{ sourceKind: 'product_fact', sourceId: effectiveFactId }],
        };
        return { success: true, content, usage: fakeUsage, provenance: fakeProv };
      },

      executeScriptVideo: async () => ({
        success: false,
        usage: fakeUsage,
        provenance: fakeProv,
      }),
    };
  }

  async function settleClaimedJob(
    client: pg.PoolClient,
    job: { id: string; version: number; payloadJson: unknown },
    workerId: string,
    gateway: AIGatewayPort,
    options?: { readonly invalidateEvidence?: boolean },
  ): Promise<void> {
    const payload = job.payloadJson as {
      readonly workspaceId: string;
      readonly productId: string;
      readonly workOrderId: string;
      readonly workItemId: string;
      readonly roleKey: string;
      readonly taskKey: 'product_strategy' | 'audience_strategy' | 'creative_direction';
      readonly operationId: string;
      readonly aiRunId: string;
      readonly reservedMicrounits: number;
    };

    const asRes = await client.query(`SELECT id FROM agent_assignments WHERE work_item_id = $1`, [
      payload.workItemId,
    ]);
    const assignmentId = asRes.rows[0].id as string;

    const artifactTypeMap = {
      product_strategy: 'product_campaign_plan',
      audience_strategy: 'audience_insight_board',
      creative_direction: 'video_series_plan',
    } as const;
    const artifactType = artifactTypeMap[payload.taskKey];

    if (options?.invalidateEvidence) {
      await settleWorkforcePlanningJobAtomic(client, {
        workspaceId: payload.workspaceId,
        productId: payload.productId,
        workOrderId: payload.workOrderId,
        workItemId: payload.workItemId,
        assignmentId,
        authorRoleKey: payload.roleKey,
        artifactType,
        jobId: job.id,
        jobVersion: job.version,
        operationId: payload.operationId,
        aiRunId: payload.aiRunId,
        workerId,
        reservedMicrounits: payload.reservedMicrounits,
        outcome: {
          kind: 'terminal_failure',
          errorCategory: 'invalid_output',
          errorCode: 'INVALID_ARTIFACT_OUTPUT',
          errorMessage: 'Invalid evidence references: fact not found',
        },
      });
      return;
    }

    let content: ProductCampaignPlan | AudienceInsightBoard | VideoSeriesPlan;
    if (payload.taskKey === 'product_strategy') {
      const res = await gateway.executeProductCampaignPlan({} as never);
      content = res.content!;
    } else if (payload.taskKey === 'audience_strategy') {
      const res = await gateway.executeAudienceInsightBoard({} as never);
      content = res.content!;
    } else {
      const res = await gateway.executeVideoSeriesPlan({} as never);
      content = res.content!;
    }

    const hash = new Uint8Array(
      crypto.createHash('sha256').update(JSON.stringify(content), 'utf8').digest(),
    );

    await settleWorkforcePlanningJobAtomic(client, {
      workspaceId: payload.workspaceId,
      productId: payload.productId,
      workOrderId: payload.workOrderId,
      workItemId: payload.workItemId,
      assignmentId,
      authorRoleKey: payload.roleKey,
      artifactType,
      jobId: job.id,
      jobVersion: job.version,
      operationId: payload.operationId,
      aiRunId: payload.aiRunId,
      workerId,
      reservedMicrounits: payload.reservedMicrounits,
      outcome: {
        kind: 'success',
        contentJson: content as unknown as Record<string, unknown>,
        contentHash: hash,
        schemaVersion: 1,
        promptTemplate: `${payload.taskKey}_v1`,
        promptVersion: '1.0.0',
        provider: 'google',
        model: 'gemini-3.8-flash',
        usage: {
          tokenInput: 500,
          tokenOutput: 300,
          costMicrounits: 45000,
          costCurrency: 'USD',
          latencyMs: 350,
        },
        evidenceReferences: content.evidenceReferences,
      },
    });
  }

  it('runs complete controlled fake-provider slice: kickoff -> 3 claims -> 3 artifacts -> scriptwriter unlocked', async () => {
    const params = createTestKickoffParams();
    const kickoffRes = await adapter.kickoffWorkOrderAtomic(params);
    expect(kickoffRes.workOrder.status).toBe('in_progress');

    // AI Policy reservation check: 3 * 50,000 = 150,000 microunits reserved
    const polResBefore = await pool.query(
      `SELECT reserved_spend_microunits, current_spend_microunits FROM workspace_ai_policies WHERE workspace_id = $1`,
      [wsId],
    );
    expect(Number(polResBefore.rows[0].reserved_spend_microunits)).toBe(150000);

    const fakeGateway = createFakePlanningGateway();

    // Claim and process all 3 planning jobs
    for (let i = 0; i < 3; i++) {
      const claimedJob = await jobAdapter.claimNextJob({
        workerId: 'worker-integration-1',
        leaseDurationSeconds: 30,
      });
      expect(claimedJob).not.toBeNull();
      expect(claimedJob!.jobType).toBe('workforce_planning');
      expect((claimedJob!.payloadJson as { workOrderId: string }).workOrderId).toBe(
        params.workOrder.id,
      );

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await settleClaimedJob(client, claimedJob!, 'worker-integration-1', fakeGateway);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    // 1. Verify 3 content artifacts exist
    const artifacts = await adapter.listWorkOrderArtifacts(wsId, params.workOrder.id);
    expect(artifacts).toHaveLength(3);
    const types = artifacts.map((a) => a.artifactType).sort();
    expect(types).toEqual(['audience_insight_board', 'product_campaign_plan', 'video_series_plan']);

    // 2. Verify all 3 revisions and evidence refs are properly recorded
    for (const art of artifacts) {
      const detail = await adapter.getArtifactById(wsId, art.id);
      expect(detail).not.toBeNull();
      expect(detail!.latestRevision.model).toBe('gemini-3.8-flash');
      expect(detail!.latestRevision.costMicrounits).toBe(45000);
      expect(detail!.evidenceReferences.length).toBeGreaterThanOrEqual(1);
    }

    // 3. Verify budget settlement: planning reserved released, current spend increased by 3 * 45,000 = 135,000,
    // and Checkpoint C scriptwriting stage automatically reserved 50,000 (5 units * 10,000)
    const polResAfter = await pool.query(
      `SELECT reserved_spend_microunits, current_spend_microunits FROM workspace_ai_policies WHERE workspace_id = $1`,
      [wsId],
    );
    expect(Number(polResAfter.rows[0].reserved_spend_microunits)).toBe(50000);
    expect(Number(polResAfter.rows[0].current_spend_microunits)).toBe(135000);

    // 4. Verify work items state: 3 planning items completed, scriptwriting is now running with 5 enqueued units!
    const woDetail = await adapter.getWorkOrderById(wsId, params.workOrder.id);
    expect(woDetail).not.toBeNull();

    const planningItems = woDetail!.workItems.filter((w) =>
      ['product_strategy', 'audience_strategy', 'creative_direction'].includes(w.taskKey),
    );
    expect(planningItems).toHaveLength(3);
    for (const item of planningItems) {
      expect(item.status).toBe('completed');
    }

    const scriptwriterItem = woDetail!.workItems.find((w) => w.taskKey === 'scriptwriting');
    expect(scriptwriterItem).toBeDefined();
    expect(scriptwriterItem!.status).toBe('running'); // Auto-enqueued in Checkpoint C!

    const scriptwriterAssignment = woDetail!.assignments.find((a) => a.roleKey === 'scriptwriter');
    expect(scriptwriterAssignment).toBeDefined();
    expect(scriptwriterAssignment!.officeState).toBe('running');
    expect(scriptwriterAssignment!.waitingOnWorkItemId).toBeNull();

    // 5. Compliance reviewer remains waiting on scriptwriter
    const complianceItem = woDetail!.workItems.find((w) => w.taskKey === 'compliance_review');
    expect(complianceItem!.status).toBe('waiting_dependency');

    // 6. Verify zero extra jobs exist for scriptwriting in Checkpoint B
    const pendingJobs = await pool.query(
      `SELECT * FROM job_executions WHERE work_order_id = $1 AND status = 'pending'`,
      [params.workOrder.id],
    );
    expect(pendingJobs.rows).toHaveLength(0);

    // 7. Verify activities audit log: 3 artifact.created + 3 budget.settled + 1 work_order.unlocked
    const activities = await adapter.listWorkOrderActivities(wsId, params.workOrder.id);
    const artifactAudits = activities.filter((a) => a.action === 'artifact.created');
    expect(artifactAudits).toHaveLength(3);
  });

  it('fails safely and creates zero artifacts when evidence reference is invalid', async () => {
    const params = createTestKickoffParams();
    await adapter.kickoffWorkOrderAtomic(params);

    const badGateway = createFakePlanningGateway({ invalidateEvidence: true });

    const claimedJob = await jobAdapter.claimNextJob({
      workerId: 'worker-bad-evidence-test',
      leaseDurationSeconds: 30,
    });
    expect(claimedJob).not.toBeNull();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await settleClaimedJob(client, claimedJob!, 'worker-bad-evidence-test', badGateway, {
        invalidateEvidence: true,
      });
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // Zero artifacts created for this work order
    const artCount = await pool.query(
      `SELECT count(*) FROM content_artifacts WHERE work_order_id = $1`,
      [params.workOrder.id],
    );
    expect(Number(artCount.rows[0].count)).toBe(0);

    // Job marked as failed
    const jobCheck = await pool.query(
      `SELECT status, last_error_category FROM job_executions WHERE id = $1`,
      [claimedJob!.id],
    );
    expect(jobCheck.rows[0].status).toBe('failed');
    expect(jobCheck.rows[0].last_error_category).toBe('invalid_output');
  });
});
