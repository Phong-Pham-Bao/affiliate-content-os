import { describe, expect, it } from 'vitest';
import {
  computeContentBriefHash,
  validateScriptPackage,
  validateScriptVideo,
  validateSingleVideoScript,
  type AudienceInsightBoard,
  type ContentBrief,
  type ProductCampaignPlan,
  type ScriptPackage,
  type ScriptVideo,
  type VideoSeriesPlan,
  type WorkOrderId,
} from '../../src/workforce/index.js';
import { DomainValidationError } from '../../src/errors.js';
import type { WorkspaceId } from '../../src/ids.js';
import type { ProductId } from '../../src/catalog/ids.js';

const FACT_ID_1 = '01931000-0000-7000-8000-000000000001';
const FACT_ID_2 = '01931000-0000-7000-8000-000000000002';

function makeValidVideo(num: 1 | 2 | 3 | 4 | 5): ScriptVideo {
  return {
    videoNumber: num,
    title: `Video ${num}: Đánh giá chi tiết sản phẩm chất lượng cao`,
    objective: `Mục tiêu video ${num}: Giải thích tính năng cốt lõi và thuyết phục người mua`,
    targetDurationSeconds: 45,
    hook: {
      spokenHook: 'Bạn có biết sản phẩm này có thể giúp bạn tiết kiệm 50% thời gian không?',
      visualHook: 'Cận cảnh mở hộp sản phẩm với ánh sáng tự nhiên',
    },
    voiceOver: 'Giọng đọc tự nhiên, ấm áp, nhịp điệu vừa phải.',
    scenes: [
      {
        sceneNumber: 1,
        timeRangeSeconds: { start: 0, end: 5 },
        visualDescription: 'Mở đầu ấn tượng với sản phẩm trên bàn làm việc',
        spokenText: 'Xin chào các bạn, hôm nay chúng ta cùng trải nghiệm sản phẩm nhé!',
        audioCue: 'Nhạc nền nhẹ nhàng, tăng dần',
      },
      {
        sceneNumber: 2,
        timeRangeSeconds: { start: 5, end: 45 },
        visualDescription: 'Trình diễn tính năng thực tế',
        spokenText: 'Tính năng này hoạt động rất mượt mà và bền bỉ.',
      },
    ],
    onScreenOverlays: [
      {
        text: 'Tiết kiệm 50% thời gian',
        timeRangeSeconds: { start: 1, end: 5 },
        placement: 'lower_third',
      },
    ],
    callToAction: {
      text: 'Nhấn vào giỏ hàng bên dưới để nhận ưu đãi ngay hôm nay!',
      visualDirection: 'Mũi tên chỉ xuống góc trái màn hình',
    },
    disclosure: {
      placement: 'Góc trên bên phải & mô tả video',
      text: 'Video có chứa liên kết tiếp thị liên kết (Affiliate Link)',
    },
    shotList: [
      {
        shotNumber: 1,
        durationSeconds: 5,
        description: 'Góc quay cận mặt người dẫn và sản phẩm',
        cameraAngle: 'Eye level',
        framing: 'Medium close-up',
        movement: 'Static',
        props: ['Sản phẩm', 'Hộp đựng'],
      },
    ],
    variants: [
      {
        variantNumber: 1,
        label: 'Biến thể chính',
        hook: {
          spokenHook: 'Bạn có biết sản phẩm này có thể giúp bạn tiết kiệm 50% thời gian không?',
          visualHook: 'Cận cảnh mở hộp',
        },
        voiceOver: 'Nội dung voice-over biến thể 1',
        scenes: [
          {
            sceneNumber: 1,
            timeRangeSeconds: { start: 0, end: 5 },
            visualDescription: 'Mở đầu ấn tượng',
            spokenText: 'Xin chào các bạn!',
          },
        ],
        callToAction: {
          text: 'Mua ngay!',
          visualDirection: 'Chỉ tay',
        },
      },
    ],
    evidenceReferences: [{ sourceKind: 'product_fact', sourceId: FACT_ID_1 }],
    creativeHypotheses: ['Góc quay cận cảnh tạo cảm giác tin cậy cho người mua trẻ'],
  };
}

describe('ScriptPackage Contracts', () => {
  it('validates a complete 5-video script package with Vietnamese diacritics', () => {
    const pkg: ScriptPackage = {
      schemaVersion: 1,
      seriesTitle: 'Series 5 Video: Bí Quyết Tối Ưu Năng Suất',
      targetAudienceSummary: 'Nhân viên văn phòng và người làm việc tự do tại Việt Nam',
      creativeDirectionSummary: 'Phong cách tối giản, chân thực, gần gũi và giàu năng lượng',
      videos: [
        makeValidVideo(1),
        makeValidVideo(2),
        makeValidVideo(3),
        makeValidVideo(4),
        makeValidVideo(5),
      ],
      evidenceReferences: [{ sourceKind: 'product_fact', sourceId: FACT_ID_1 }],
    };

    const validated = validateScriptPackage(pkg);
    expect(validated.schemaVersion).toBe(1);
    expect(validated.seriesTitle).toBe('Series 5 Video: Bí Quyết Tối Ưu Năng Suất');
    expect(validated.videos).toHaveLength(5);
    expect(validated.videos[0].videoNumber).toBe(1);
    expect(validated.videos[4].videoNumber).toBe(5);
    expect(validated.videos[0].hook.spokenHook).toContain('tiết kiệm 50%');
  });

  it('rejects a script package with fewer than 5 videos', () => {
    const invalidPkg = {
      schemaVersion: 1,
      seriesTitle: 'Short Series',
      targetAudienceSummary: 'Audience',
      creativeDirectionSummary: 'Direction',
      videos: [makeValidVideo(1), makeValidVideo(2), makeValidVideo(3)],
      evidenceReferences: [{ sourceKind: 'product_fact', sourceId: FACT_ID_1 }],
    };

    expect(() => validateScriptPackage(invalidPkg)).toThrow(DomainValidationError);
  });

  it('validates a single video script with correct expectedVideoNumber', () => {
    const video = makeValidVideo(3);
    const single = validateSingleVideoScript({ schemaVersion: 1, video }, 3);
    expect(single.video.videoNumber).toBe(3);

    expect(() => validateSingleVideoScript({ schemaVersion: 1, video }, 2)).toThrow(
      DomainValidationError,
    );
  });

  it('rejects invalid time ranges where start > end or negative', () => {
    const badVideo = {
      ...makeValidVideo(1),
      scenes: [
        {
          sceneNumber: 1,
          timeRangeSeconds: { start: 10, end: 5 },
          visualDescription: 'Visual',
          spokenText: 'Spoken',
        },
      ],
    };
    expect(() => validateScriptVideo(badVideo, 1)).toThrow(DomainValidationError);
  });

  it('computes deterministic canonical hash for content brief', () => {
    const briefA: ContentBrief = {
      schemaVersion: 1,
      workspaceId: '01931000-0000-7000-8000-0000000000aa' as WorkspaceId,
      productId: '01931000-0000-7000-8000-0000000000bb' as ProductId,
      workOrderId: '01931000-0000-7000-8000-0000000000cc' as WorkOrderId,
      briefVersion: 1,
      directiveText: 'Directive 1',
      brandVoice: 'Friendly',
      disclosureRequirement: 'Affiliate',
      productSummary: {
        productName: 'P1',
        merchantName: 'M1',
        category: 'Tech',
        description: 'Desc',
      },
      planningRevisions: {
        productCampaignPlanRevisionId: 'rev1',
        productCampaignPlanRevisionNumber: 1,
        audienceInsightBoardRevisionId: 'rev2',
        audienceInsightBoardRevisionNumber: 1,
        videoSeriesPlanRevisionId: 'rev3',
        videoSeriesPlanRevisionNumber: 1,
      },
      campaignPlan: {} as unknown as ProductCampaignPlan,
      audienceBoard: {} as unknown as AudienceInsightBoard,
      seriesPlan: {} as unknown as VideoSeriesPlan,
      eligibleFactIds: [FACT_ID_1, FACT_ID_2],
      eligibleAnalysisIds: [],
      createdAt: '2026-11-08T00:00:00.000Z',
    };

    const briefB = { ...briefA, eligibleFactIds: [FACT_ID_2, FACT_ID_1] };
    const hashA = computeContentBriefHash(briefA);
    const hashB = computeContentBriefHash(briefB);

    expect(Buffer.from(hashA).toString('hex')).toBe(Buffer.from(hashB).toString('hex'));

    const briefC = { ...briefA, directiveText: 'Different Directive' };
    const hashC = computeContentBriefHash(briefC);
    expect(Buffer.from(hashA).toString('hex')).not.toBe(Buffer.from(hashC).toString('hex'));
  });
});
