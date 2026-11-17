import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type {
  ComplianceEvaluationDTO,
  ContentApprovalSnapshotDTO,
  ContentReviewDecisionDTO,
} from '../src/types/compliance.js';
import { ContentStudioCompliancePanel } from '../src/components/workforce/content-studio/content-studio-compliance-panel.js';
import { ContentStudioAcceptDialog } from '../src/components/workforce/content-studio/content-studio-accept-dialog.js';
import { ContentStudioRejectDialog } from '../src/components/workforce/content-studio/content-studio-reject-dialog.js';
import { ContentStudioDecisionsHistory } from '../src/components/workforce/content-studio/content-studio-decisions-history.js';

describe('Content Studio Compliance & Human Approval Components (Checkpoint D)', () => {
  const mockEvaluation: ComplianceEvaluationDTO = {
    id: 'eval-1',
    workspaceId: 'ws-1',
    artifactId: 'art-1',
    revisionNumber: 2,
    contentHashHex: 'a'.repeat(64),
    policyVersion: '2026-03-01.1',
    policyHashHex: 'b'.repeat(64),
    status: 'completed',
    blockingCount: 1,
    warningCount: 1,
    infoCount: 1,
    evaluatedAt: '2026-11-08T12:00:00.000Z',
    evaluatedByActorType: 'system',
    evaluatedByActorId: 'actor-1',
    operationId: 'op-1',
    failureReason: null,
    findings: [
      {
        id: 'find-1',
        workspaceId: 'ws-1',
        evaluationId: 'eval-1',
        ruleId: 'COMPL_PROHIBITED_CLAIM',
        severity: 'blocking',
        source: 'deterministic_rule',
        fingerprintHex: 'fp1',
        videoNumber: 1,
        fieldPath: 'videos[0].hook.spokenHook',
        flaggedText: 'cam kết 100% trị dứt điểm',
        message: 'Tuyên bố cam kết tuyệt đối bị cấm theo chính sách quảng cáo.',
        suggestedFix: 'Dùng từ ngữ mô tả trải nghiệm thay vì cam kết chữa khỏi hoàn toàn.',
        evidenceReferences: [
          {
            sourceKind: 'product_fact',
            sourceId: 'fact-12345678',
          },
        ],
        createdAt: '2026-11-08T12:00:00.000Z',
      },
      {
        id: 'find-2',
        workspaceId: 'ws-1',
        evaluationId: 'eval-1',
        ruleId: 'COMPL_ADVISORY_DELIVERY',
        severity: 'warning',
        source: 'ai_advisory',
        fingerprintHex: 'fp2',
        videoNumber: 2,
        fieldPath: 'videos[1].voiceOver',
        flaggedText: 'Giao hàng siêu tốc trong ngày',
        message: 'Nên ghi rõ khu vực áp dụng giao hàng trong ngày theo thông tin người bán.',
        suggestedFix: null,
        evidenceReferences: [],
        createdAt: '2026-11-08T12:00:00.000Z',
      },
    ],
  };

  const mockDecisions: ContentReviewDecisionDTO[] = [
    {
      id: 'dec-1',
      workspaceId: 'ws-1',
      artifactId: 'art-1',
      revisionNumber: 1,
      contentHashHex: 'hash-rev-1',
      actorUserId: 'user-11112222',
      decision: 'rejected',
      reason: 'Thiếu thông báo affiliate bắt buộc',
      note: null,
      complianceEvaluationId: null,
      createdAt: '2026-11-08T09:00:00.000Z',
    },
    {
      id: 'dec-2',
      workspaceId: 'ws-1',
      artifactId: 'art-1',
      revisionNumber: 2,
      contentHashHex: 'hash-rev-2',
      actorUserId: 'user-33334444',
      decision: 'accepted',
      reason: null,
      note: 'Đã hoàn thiện và sẵn sàng chuyển tiếp',
      complianceEvaluationId: 'eval-1',
      createdAt: '2026-11-08T14:00:00.000Z',
    },
  ];

  const mockApprovalSnapshot: ContentApprovalSnapshotDTO = {
    id: 'snap-1',
    workspaceId: 'ws-1',
    artifactId: 'art-1',
    revisionNumber: 2,
    contentHashHex: 'hash-rev-2',
    approvedByUserId: 'user-33334444',
    complianceEvaluationId: 'eval-1',
    policyVersion: '2026-03-01.1',
    policyHashHex: 'policy-hash-hex',
    snapshotContentJson: {},
    evidenceReferencesJson: [],
    affiliateDisclosureText: '#quangcao Hợp tác tiếp thị liên kết cùng thương hiệu',
    createdAt: '2026-11-08T14:00:00.000Z',
  };

  describe('ContentStudioCompliancePanel', () => {
    it('renders loading state when isLoading is true', () => {
      const html = renderToStaticMarkup(
        <ContentStudioCompliancePanel evaluation={null} isLoading={true} />,
      );
      expect(html).toContain('aria-busy="true"');
      expect(html).toContain('Đang tải báo cáo đánh giá tuân thủ...');
    });

    it('renders error state with retry button', () => {
      const html = renderToStaticMarkup(
        <ContentStudioCompliancePanel
          evaluation={null}
          error="Mất kết nối mạng"
          onRetry={() => {}}
        />,
      );
      expect(html).toContain('Chưa tải được báo cáo tuân thủ:');
      expect(html).toContain('Mất kết nối mạng');
      expect(html).toContain('Thử lại');
    });

    it('renders empty message when evaluation is null', () => {
      const html = renderToStaticMarkup(<ContentStudioCompliancePanel evaluation={null} />);
      expect(html).toContain('Chưa có báo cáo tuân thủ');
    });

    it('renders evaluation details, blocking alert, and grouped findings', () => {
      const html = renderToStaticMarkup(
        <ContentStudioCompliancePanel evaluation={mockEvaluation} />,
      );

      expect(html).toContain('Đánh giá tuân thủ &amp; An toàn thương mại');
      expect(html).toContain('Chính sách: 2026-03-01.1');
      expect(html).toContain('Phiên bản #2');
      expect(html).toContain('Vi phạm chặn xuất bản');
      expect(html).toContain('Ngăn chặn (1)');
      expect(html).toContain('Cảnh báo (1)');
      expect(html).toContain('Thông tin (1)');

      // Blocking alert
      expect(html).toContain('Lưu ý bắt buộc:');
      expect(html).toContain('Có 1 vi phạm ngăn chặn xuất bản');

      // Findings detail
      expect(html).toContain('Video 1');
      expect(html).toContain('Luật tất định');
      expect(html).toContain('[COMPL_PROHIBITED_CLAIM]');
      expect(html).toContain('videos[0].hook.spokenHook');
      expect(html).toContain('cam kết 100% trị dứt điểm');
      expect(html).toContain('Dùng từ ngữ mô tả trải nghiệm');
      expect(html).toContain('Dữ liệu sản phẩm');

      // Video 2 finding
      expect(html).toContain('Video 2');
      expect(html).toContain('Tư vấn AI');
      expect(html).toContain('[COMPL_ADVISORY_DELIVERY]');
      expect(html).toContain('Giao hàng siêu tốc trong ngày');
    });
  });

  describe('ContentStudioAcceptDialog', () => {
    it('returns null when isOpen is false', () => {
      const html = renderToStaticMarkup(
        <ContentStudioAcceptDialog
          isOpen={false}
          revisionNumber={2}
          contentHashHex="abcdef1234567890abcdef"
          warnings={[]}
          isSubmitting={false}
          error={null}
          onConfirm={async () => {}}
          onClose={() => {}}
        />,
      );
      expect(html).toBe('');
    });

    it('renders accessible confirmation dialog with revision, hash, warnings, and note input', () => {
      const warnings = mockEvaluation.findings.filter((f) => f.severity === 'warning');
      const html = renderToStaticMarkup(
        <ContentStudioAcceptDialog
          isOpen={true}
          revisionNumber={2}
          contentHashHex="abcdef1234567890abcdef1234567890"
          warnings={warnings}
          isSubmitting={false}
          error={null}
          onConfirm={async () => {}}
          onClose={() => {}}
        />,
      );

      expect(html).toContain('role="dialog"');
      expect(html).toContain('aria-modal="true"');
      expect(html).toContain('Xác nhận chấp thuận kịch bản (Human Approval)');
      expect(html).toContain('Phiên bản phê duyệt:</strong> #2');
      expect(html).toContain('Mã băm nội dung:</strong> <code>abcdef1234567890...</code>');
      expect(html).toContain('Cảnh báo tư vấn AI (1):');
      expect(html).toContain('[COMPL_ADVISORY_DELIVERY]');
      expect(html).toContain('Ghi chú phê duyệt');
      expect(html).toContain('Xác nhận chấp thuận');
    });
  });

  describe('ContentStudioRejectDialog', () => {
    it('returns null when isOpen is false', () => {
      const html = renderToStaticMarkup(
        <ContentStudioRejectDialog
          isOpen={false}
          revisionNumber={2}
          contentHashHex="abcdef1234567890abcdef"
          isSubmitting={false}
          error={null}
          onConfirm={async () => {}}
          onClose={() => {}}
        />,
      );
      expect(html).toBe('');
    });

    it('renders accessible rejection dialog with revision, hash, and required reason field', () => {
      const html = renderToStaticMarkup(
        <ContentStudioRejectDialog
          isOpen={true}
          revisionNumber={2}
          contentHashHex="abcdef1234567890abcdef1234567890"
          isSubmitting={false}
          error={null}
          onConfirm={async () => {}}
          onClose={() => {}}
        />,
      );

      expect(html).toContain('role="dialog"');
      expect(html).toContain('aria-modal="true"');
      expect(html).toContain('Từ chối kịch bản (Human Rejection)');
      expect(html).toContain('Phiên bản từ chối:</strong> #2');
      expect(html).toContain('Mã băm nội dung:</strong> <code>abcdef1234567890...</code>');
      expect(html).toContain('Lý do từ chối');
      expect(html).toContain('Xác nhận từ chối');
    });
  });

  describe('ContentStudioDecisionsHistory', () => {
    it('renders decision history table and approval snapshot card', () => {
      const html = renderToStaticMarkup(
        <ContentStudioDecisionsHistory
          decisions={mockDecisions}
          approvalSnapshot={mockApprovalSnapshot}
          isLoading={false}
          onClose={() => {}}
        />,
      );

      expect(html).toContain('Lịch sử quyết định kiểm duyệt (Human Decisions History)');
      expect(html).toContain('Snapshot Chấp thuận Hoàn tất');
      expect(html).toContain('user-33334444');
      expect(html).toContain('Thông báo tiếp thị liên kết bắt buộc:');
      expect(html).toContain('#quangcao Hợp tác tiếp thị liên kết cùng thương hiệu');

      // Table rows
      expect(html).toContain('#1');
      expect(html).toContain('Từ chối');
      expect(html).toContain('Thiếu thông báo affiliate bắt buộc');

      expect(html).toContain('#2');
      expect(html).toContain('Chấp thuận');
      expect(html).toContain('Đã hoàn thiện và sẵn sàng chuyển tiếp');
    });
  });
});
