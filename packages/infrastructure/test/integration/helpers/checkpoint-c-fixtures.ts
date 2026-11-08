import crypto from 'node:crypto';
import type pg from 'pg';
import type { AIGatewayPort, AIAnalysisGatewayResult } from '@affiliate-content-os/application';
import type {
  AudienceInsightBoard,
  ProductCampaignPlan,
  SingleVideoScript,
  VideoSeriesPlan,
} from '@affiliate-content-os/domain';
import { PostgresJobAdapter } from '../../../src/jobs/postgres-job-adapter.js';
import { settleWorkforcePlanningJobAtomic } from '../../../src/workforce/workforce-planning-settlement.js';

export function createFakeCheckpointCGateway(factId: string, analysisId: string): AIGatewayPort {
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
    executeNicheAnalysis: async () => ({ success: false, usage: fakeUsage, provenance: fakeProv }),

    executeProductCampaignPlan: async (): Promise<
      AIAnalysisGatewayResult<ProductCampaignPlan>
    > => ({
      success: true,
      content: {
        schemaVersion: 1,
        summary: 'Kế hoạch chiến dịch sản phẩm công thái học.',
        positioningStatement: 'Ghế công thái học hàng đầu cho dân văn phòng.',
        campaignGoals: ['Mục tiêu 1'],
        coreBenefits: [{ benefit: 'Đệm đỡ thắt lưng', evidenceRefs: [factId] }],
        targetObjections: [
          { objection: 'Giá cao', counterAngle: 'Bảo hành 5 năm', evidenceRefs: [analysisId] },
        ],
        complianceConstraints: ['Rõ ràng'],
        creativeHypotheses: [{ hypothesis: 'Dân văn phòng IT', rationale: 'Hợp lý' }],
        evidenceReferences: [
          { sourceKind: 'product_fact', sourceId: factId },
          { sourceKind: 'analysis', sourceId: analysisId },
        ],
      },
      usage: fakeUsage,
      provenance: { ...fakeProv, promptTemplate: 'product_strategy_v1' },
    }),

    executeAudienceInsightBoard: async (): Promise<
      AIAnalysisGatewayResult<AudienceInsightBoard>
    > => ({
      success: true,
      content: {
        schemaVersion: 1,
        summary: 'Chân dung khách hàng văn phòng.',
        audienceSegments: [
          {
            segmentName: 'Nhân viên IT 25-40 tuổi',
            description: 'Làm việc 8+ tiếng mỗi ngày',
            awarenessStage: 'problem_aware',
            corePains: ['Đau thắt lưng và cổ vai gáy'],
            desires: ['Ngồi làm việc không mỏi'],
            evidenceRefs: [factId],
          },
        ],
        contentAngles: [
          {
            angleName: 'Góc nhìn công thái học',
            hookConcept: 'Đau lưng mỗi chiều?',
            targetSegment: 'Nhân viên IT 25-40 tuổi',
            creativeHypothesis: 'Dân văn phòng IT cần giải pháp giảm đau lưng',
          },
        ],
        evidenceReferences: [
          { sourceKind: 'product_fact', sourceId: factId },
          { sourceKind: 'analysis', sourceId: analysisId },
        ],
      },
      usage: fakeUsage,
      provenance: { ...fakeProv, promptTemplate: 'audience_strategy_v1' },
    }),

    executeVideoSeriesPlan: async (): Promise<AIAnalysisGatewayResult<VideoSeriesPlan>> => ({
      success: true,
      content: {
        schemaVersion: 1,
        seriesTitle: 'Chuỗi 5 video công thái học ErgoFlow',
        seriesNarrativeArc: 'Từ đau lưng đến giải pháp nâng cao hiệu suất làm việc.',
        episodes: [
          {
            episodeNumber: 1,
            title: 'Nhận thức vấn đề',
            purpose: 'Nhận thức',
            hook: 'Bạn có đau lưng mỗi chiều không?',
            narrativeRole: 'Hook mở đầu',
            visualDirection: 'Nhân viên mệt mỏi bên bàn làm việc',
            callToActionDirection: 'Tìm hiểu ngay giải pháp',
            evidenceRefs: [factId],
          },
          {
            episodeNumber: 2,
            title: 'Tác hại ngồi sai',
            purpose: 'Vấn đề',
            hook: 'Tác hại khôn lường của ngồi sai tư thế',
            narrativeRole: 'Đào sâu nỗi đau',
            visualDirection: 'Mô phỏng cột sống bị thoái hóa',
            callToActionDirection: 'Xem giải pháp công thái học',
            evidenceRefs: [analysisId],
          },
          {
            episodeNumber: 3,
            title: 'Giải pháp ErgoFlow',
            purpose: 'Giải pháp',
            hook: 'Ghế công thái học ErgoFlow thay đổi ngày làm việc của bạn',
            narrativeRole: 'Giới thiệu sản phẩm',
            visualDirection: 'Chi tiết đệm đỡ thắt lưng thông minh',
            callToActionDirection: 'Dùng thử 30 ngày',
            evidenceRefs: [factId],
          },
          {
            episodeNumber: 4,
            title: 'Trải nghiệm thực tế',
            purpose: 'Bằng chứng',
            hook: 'Review thực tế sau 1 tháng sử dụng ghế ErgoFlow',
            narrativeRole: 'Trải nghiệm thực tế',
            visualDirection: 'Khách hàng chia sẻ cảm nhận tích cực',
            callToActionDirection: 'Xem đánh giá chi tiết',
            evidenceRefs: [factId],
          },
          {
            episodeNumber: 5,
            title: 'Ưu đãi và chuyển đổi',
            purpose: 'Chuyển đổi',
            hook: 'Ưu đãi đặc biệt hôm nay cho văn phòng của bạn',
            narrativeRole: 'Ưu đãi & CTA',
            visualDirection: 'Mở hộp & hướng dẫn đặt hàng',
            callToActionDirection: 'Mua ngay tại liên kết bên dưới',
            evidenceRefs: [analysisId],
          },
        ],
        creativeDirection: {
          visualTone: 'Chân thực',
          audioTone: 'Hiện đại',
          pacing: 'Nhanh',
        },
        evidenceReferences: [
          { sourceKind: 'product_fact', sourceId: factId },
          { sourceKind: 'analysis', sourceId: analysisId },
        ],
      },
      usage: fakeUsage,
      provenance: { ...fakeProv, promptTemplate: 'creative_direction_v1' },
    }),

    executeScriptVideo: async () => ({ success: false, usage: fakeUsage, provenance: fakeProv }),
  };
}

export function createFakeSingleVideoScript(
  videoNumber: 1 | 2 | 3 | 4 | 5,
  factId: string,
): SingleVideoScript {
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
      voiceOver: `Ghế công thái học ErgoFlow Vietnam mang lại sự thoải mái tuyệt đối cho ngày làm việc dài. Được kiểm nghiệm giúp giảm 40% áp lực cột sống.`,
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
          spokenText: 'Ghế công thái học ErgoFlow Vietnam mang lại sự thoải mái tuyệt đối.',
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

export async function processThreePlanningJobs(
  pool: pg.Pool,
  jobAdapter: PostgresJobAdapter,
  gateway: AIGatewayPort,
): Promise<void> {
  for (let i = 0; i < 3; i++) {
    const job = await jobAdapter.claimNextJob({
      workerId: 'worker-checkpoint-c-test',
      leaseDurationSeconds: 30,
    });
    if (!job) throw new Error(`Expected claimable planning job ${i + 1}`);

    const payload = job.payloadJson as {
      workspaceId: string;
      productId: string;
      workOrderId: string;
      workItemId: string;
      taskKey: string;
      roleKey: string;
      operationId: string;
      aiRunId: string;
      reservedMicrounits: number;
    };

    const asgRes = await pool.query(
      `SELECT id FROM agent_assignments WHERE work_item_id = $1 AND workspace_id = $2`,
      [payload.workItemId, payload.workspaceId],
    );
    const assignmentId = asgRes.rows[0].id;

    let content: ProductCampaignPlan | AudienceInsightBoard | VideoSeriesPlan;
    let artifactType: string;

    if (payload.taskKey === 'product_strategy') {
      const res = await gateway.executeProductCampaignPlan({} as never);
      content = res.content!;
      artifactType = 'product_campaign_plan';
    } else if (payload.taskKey === 'audience_strategy') {
      const res = await gateway.executeAudienceInsightBoard({} as never);
      content = res.content!;
      artifactType = 'audience_insight_board';
    } else {
      const res = await gateway.executeVideoSeriesPlan({} as never);
      content = res.content!;
      artifactType = 'video_series_plan';
    }

    const hash = new Uint8Array(
      crypto.createHash('sha256').update(JSON.stringify(content), 'utf8').digest(),
    );

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await settleWorkforcePlanningJobAtomic(client, {
        workspaceId: payload.workspaceId,
        productId: payload.productId,
        workOrderId: payload.workOrderId,
        workItemId: payload.workItemId,
        assignmentId,
        authorRoleKey: payload.roleKey as never,
        artifactType,
        jobId: job.id,
        jobVersion: job.version,
        operationId: payload.operationId,
        aiRunId: payload.aiRunId,
        workerId: 'worker-checkpoint-c-test',
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
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
