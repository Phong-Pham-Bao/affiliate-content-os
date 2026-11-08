import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ScriptPackage, ScriptVideo } from '../src/types/script-studio.js';
import type { ContentArtifactRevisionDTO } from '../src/types/workforce.js';
import { ContentStudioVideoNav } from '../src/components/workforce/content-studio/content-studio-video-nav.js';
import { ContentStudioVideoReader } from '../src/components/workforce/content-studio/content-studio-video-reader.js';
import { ContentStudioProvenanceBar } from '../src/components/workforce/content-studio/content-studio-provenance-bar.js';
import { ContentStudioStatusBanner } from '../src/components/workforce/content-studio/content-studio-status-banner.js';
import { ContentStudioRevisionHistory } from '../src/components/workforce/content-studio/content-studio-revision-history.js';

export function createMockScriptVideo(videoNumber: 1 | 2 | 3 | 4 | 5): ScriptVideo {
  return {
    videoNumber,
    title: `Video ${videoNumber}: Đánh thức năng lượng làm việc`,
    objective: `Chuyển đổi khách hàng tiềm năng bằng dẫn chứng thực tế cho Video ${videoNumber}`,
    targetDurationSeconds: 45,
    hook: {
      spokenHook: `Bạn có đang ngồi làm việc sai tư thế mỗi ngày không? (Video ${videoNumber})`,
      visualHook: 'Cận cảnh nhân viên văn phòng ôm lưng nhăn mặt vì đau mỏi',
    },
    voiceOver: `Ngồi làm việc 8 tiếng một ngày không còn là nỗi ám ảnh. Ghế công thái học Ergoflow mang lại đệm đỡ thắt lưng linh hoạt độc quyền. Đã được kiểm chứng giúp giảm 40% áp lực cột sống.`,
    scenes: [
      {
        sceneNumber: 1,
        timeRangeSeconds: { start: 0, end: 5 },
        visualDescription: 'Nhân viên mệt mỏi bên bàn làm việc',
        spokenText: 'Bạn có đang ngồi làm việc sai tư thế mỗi ngày không?',
        audioCue: 'Tiếng thở dài nhẹ',
      },
      {
        sceneNumber: 2,
        timeRangeSeconds: { start: 5, end: 20 },
        visualDescription: 'Trải nghiệm tựa lưng công thái học ErgoFlow',
        spokenText: 'Đệm đỡ thắt lưng thông minh tự điều chỉnh theo từng cử động.',
        audioCue: 'Âm thanh êm ái khi ngả lưng',
      },
    ],
    onScreenOverlays: [
      {
        text: 'Giảm 40% áp lực thắt lưng',
        timeRangeSeconds: { start: 5, end: 12 },
        placement: 'lower_third',
      },
    ],
    callToAction: {
      text: 'Trải nghiệm ngay 30 ngày dùng thử miễn phí tại link bên dưới!',
      visualDirection: 'Hiển thị nút mua hàng và mũi tên chỉ xuống link affiliate',
    },
    disclosure: {
      placement: 'Góc trên bên phải toàn bộ video',
      text: '#quangcao Hợp tác tiếp thị liên kết cùng ErgoFlow Vietnam',
    },
    shotList: [
      {
        shotNumber: 1,
        durationSeconds: 5,
        description: 'Cận cảnh góc mặt mệt mỏi',
        cameraAngle: 'Góc ngang tầm mắt (Eye level)',
        framing: 'Cận cảnh (Close-up)',
        movement: 'Tĩnh (Static)',
        props: ['Laptop', 'Cốc cà phê'],
      },
      {
        shotNumber: 2,
        durationSeconds: 15,
        description: 'Toàn cảnh trải nghiệm ngả lưng ghế',
        cameraAngle: 'Góc 45 độ nghiêng',
        framing: 'Trung cảnh (Medium shot)',
        movement: 'Trượt ngang (Pan right)',
        props: ['Ghế ErgoFlow', 'Bàn nâng hạ'],
      },
    ],
    variants: [],
    evidenceReferences: [
      { sourceKind: 'product_fact', sourceId: '018f6c5b-21a4-789a-8def-000000000001' },
    ],
    creativeHypotheses: ['Tập trung vào nỗi đau đau mỏi vai gáy của dân văn phòng IT'],
  };
}

export function createMockScriptPackage(): ScriptPackage {
  return {
    schemaVersion: 1,
    seriesTitle: 'Chiến dịch Khởi động Bàn làm việc Công thái học',
    targetAudienceSummary: 'Nhân viên văn phòng và freelancer làm việc tại nhà từ 25-40 tuổi',
    creativeDirectionSummary: 'Hiện đại, chân thực, tập trung vào giải pháp khoa học',
    videos: [
      createMockScriptVideo(1),
      createMockScriptVideo(2),
      createMockScriptVideo(3),
      createMockScriptVideo(4),
      createMockScriptVideo(5),
    ],
    evidenceReferences: [
      { sourceKind: 'product_fact', sourceId: '018f6c5b-21a4-789a-8def-000000000001' },
    ],
  };
}

describe('Content Studio - Core Visual Components', () => {
  const mockPkg = createMockScriptPackage();

  it('renders 5-video navigation rail with accessible tabs and durations', () => {
    const html = renderToStaticMarkup(
      <ContentStudioVideoNav videos={mockPkg.videos} selectedIndex={0} onSelectVideo={() => {}} />,
    );

    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Điều hướng 5 video"');
    expect(html).toContain('Video 1');
    expect(html).toContain('Video 5');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('45s');
  });

  it('renders accessible Vietnamese-first video reader with all script sections', () => {
    const html = renderToStaticMarkup(<ContentStudioVideoReader video={mockPkg.videos[0]} />);

    expect(html).toContain('role="tabpanel"');
    expect(html).toContain('Video 1: Đánh thức năng lượng làm việc');
    expect(html).toContain('Hook &amp; Mở đầu gây chú ý');
    expect(html).toContain('Bạn có đang ngồi làm việc sai tư thế mỗi ngày không?');
    expect(html).toContain('Kịch bản Lời thoại (Voice-over)');
    expect(html).toContain(
      'Ghế công thái học Ergoflow mang lại đệm đỡ thắt lưng linh hoạt độc quyền',
    );
    expect(html).toContain('Phân cảnh (2 cảnh)');
    expect(html).toContain('Lớp phủ màn hình (Overlays)');
    expect(html).toContain('Giảm 40% áp lực thắt lưng');
    expect(html).toContain('Kêu gọi hành động &amp; Minh bạch');
    expect(html).toContain('Trải nghiệm ngay 30 ngày dùng thử miễn phí');
    expect(html).toContain('#quangcao Hợp tác tiếp thị liên kết');
    expect(html).toContain('Danh sách cảnh quay sản xuất');
    expect(html).toContain('Bằng chứng liên kết (1)');
    expect(html).toContain('Giả thuyết sáng tạo:');
  });

  it('renders provenance bar with honest cost, model, tokens, and brief hash', () => {
    const mockRev: ContentArtifactRevisionDTO = {
      id: 'rev-1',
      workspaceId: 'ws-1',
      artifactId: 'art-1',
      revisionNumber: 1,
      contentJson: mockPkg as unknown as Record<string, unknown>,
      contentHashHex: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      schemaVersion: 1,
      promptTemplate: 'scriptwriting_v1',
      promptVersion: '1.0.0',
      provider: 'google',
      model: 'gemini-3.8-flash',
      tokenInput: 1200,
      tokenOutput: 950,
      costMicrounits: 50000,
      costCurrency: 'USD',
      latencyMs: 1450,
      authorRoleKey: 'scriptwriter',
      createdAt: '2026-11-08T12:00:00.000Z',
    };

    const html = renderToStaticMarkup(
      <ContentStudioProvenanceBar
        revision={mockRev}
        lifecycleStatus="review_required"
        lineage={{
          id: 'lin-1',
          artifactId: 'art-1',
          revisionNumber: 1,
          parentRevisionNumber: null,
          lineageType: 'ai_generated',
          changeRequestId: null,
          contentBriefHashHex: '1234567890abcdef1234567890abcdef',
          contentBriefVersion: 1,
          planningRevisionIds: {},
          sourceScriptUnitIds: ['u1', 'u2', 'u3', 'u4', 'u5'],
          metadata: {},
          createdAt: '2026-11-08T12:00:00.000Z',
        }}
      />,
    );

    expect(html).toContain('Phiên bản #1');
    expect(html).toContain('AI tạo tự động');
    expect(html).toContain('google / gemini-3.8-flash');
    expect(html).toContain('$0.0500');
    expect(html).toContain('1450ms');
    expect(html).toContain('12345678...');
  });

  it('renders honest status banners for all lifecycle and error states', () => {
    const htmlRunning = renderToStaticMarkup(<ContentStudioStatusBanner status="running" />);
    expect(htmlRunning).toContain('Đang thực thi:');
    expect(htmlRunning).toContain('tối đa 3 cuộc gọi đồng thời');

    const htmlPartial = renderToStaticMarkup(
      <ContentStudioStatusBanner status="partial_success" onRetry={() => {}} />,
    );
    expect(htmlPartial).toContain('Hoàn thành một phần:');
    expect(htmlPartial).toContain('Thử lại tác vụ');

    const htmlConflict = renderToStaticMarkup(
      <ContentStudioStatusBanner status="stale_conflict" message="Xung đột tiền điều kiện" />,
    );
    expect(htmlConflict).toContain('Xung đột phiên bản:');
    expect(htmlConflict).toContain('Xung đột tiền điều kiện');

    const htmlBudget = renderToStaticMarkup(
      <ContentStudioStatusBanner status="insufficient_budget" />,
    );
    expect(htmlBudget).toContain('Ngân sách không đủ:');

    const htmlDeadline = renderToStaticMarkup(
      <ContentStudioStatusBanner
        status="polling_deadline"
        message="Quá thời gian theo dõi tự động"
        onResume={() => {}}
      />,
    );
    expect(htmlDeadline).toContain('Chờ phản hồi quá thời gian:');
    expect(htmlDeadline).toContain('Quá thời gian theo dõi tự động');
    expect(htmlDeadline).toContain('Tiếp tục kiểm tra');
  });

  it('renders immutable revision history with proper selection and compare actions', () => {
    const mockRevs: ContentArtifactRevisionDTO[] = [
      {
        id: 'rev-1',
        workspaceId: 'ws-1',
        artifactId: 'art-1',
        revisionNumber: 1,
        contentJson: {},
        contentHashHex: 'hash111111111111111111111111111111111111111111111111111111111111',
        schemaVersion: 1,
        promptTemplate: 't',
        promptVersion: 'v',
        provider: 'google',
        model: 'gemini-3.8-flash',
        tokenInput: null,
        tokenOutput: null,
        costMicrounits: null,
        costCurrency: null,
        latencyMs: null,
        authorRoleKey: 'scriptwriter',
        createdAt: '2026-11-08T10:00:00.000Z',
      },
      {
        id: 'rev-2',
        workspaceId: 'ws-1',
        artifactId: 'art-1',
        revisionNumber: 2,
        contentJson: {},
        contentHashHex: 'hash222222222222222222222222222222222222222222222222222222222222',
        schemaVersion: 1,
        promptTemplate: 'manual',
        promptVersion: 'manual',
        provider: 'human',
        model: 'manual_editor',
        tokenInput: null,
        tokenOutput: null,
        costMicrounits: null,
        costCurrency: null,
        latencyMs: null,
        authorRoleKey: 'scriptwriter',
        createdAt: '2026-11-08T11:00:00.000Z',
      },
    ];

    const html = renderToStaticMarkup(
      <ContentStudioRevisionHistory
        revisions={mockRevs}
        currentRevisionNumber={2}
        activeRevisionNumber={2}
        onSelectRevision={() => {}}
        onCompareRevision={() => {}}
        onClose={() => {}}
      />,
    );

    expect(html).toContain('Lịch sử phiên bản bất biến (2)');
    expect(html).toContain('#1');
    expect(html).toContain('#2');
    expect(html).toContain('Mới nhất');
    expect(html).toContain('Đang xem');
    expect(html).toContain('So sánh');
  });
});
