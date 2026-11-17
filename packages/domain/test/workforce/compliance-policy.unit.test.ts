import { describe, expect, it } from 'vitest';
import {
  CURRENT_COMPLIANCE_POLICY_VERSION,
  computeCompliancePolicyHash,
  computeFindingFingerprint,
  evaluateDeterministicCompliance,
  type ScriptPackage,
} from '../../src/index.js';

function createValidPackage(factId = 'fact-1', analysisId = 'analysis-1'): ScriptPackage {
  const video = {
    videoNumber: 1 as const,
    title: 'Ghế công thái học giảm đau lưng',
    objective: 'Giới thiệu giải pháp giảm mỏi lưng cho dân văn phòng',
    targetDurationSeconds: 60,
    hook: {
      spokenHook: 'Bạn ngồi làm việc 8 tiếng mỗi ngày và bị đau lưng?',
      visualHook: 'Cảnh nhân viên văn phòng ôm lưng mỏi mệt',
    },
    voiceOver: 'Ghế công thái học với đệm đỡ thắt lưng đa điểm giúp bảo vệ cột sống hiệu quả.',
    scenes: [
      {
        sceneNumber: 1,
        timeRangeSeconds: { start: 0, end: 15 },
        visualDescription: 'Cảnh cận cơ chế đệm đỡ thắt lưng',
        spokenText: 'Thiết kế chuẩn công thái học nâng đỡ lưng tối đa.',
      },
      {
        sceneNumber: 2,
        timeRangeSeconds: { start: 15, end: 60 },
        visualDescription: 'Cảnh nhân viên ngồi làm việc thoải mái',
        spokenText: 'Giúp bạn tập trung làm việc cả ngày dài.',
      },
    ],
    onScreenOverlays: [
      {
        text: 'Đệm đỡ thắt lưng linh hoạt',
        timeRangeSeconds: { start: 2, end: 10 },
        placement: 'bottom' as const,
      },
    ],
    callToAction: {
      text: 'Xem chi tiết sản phẩm tại liên kết bên dưới',
      visualDirection: 'Mũi tên chỉ xuống phần mô tả video',
    },
    disclosure: {
      placement: 'overlay',
      text: 'Video có chứa liên kết tiếp thị liên kết (affiliate link)',
    },
    shotList: [
      {
        shotNumber: 1,
        durationSeconds: 15,
        description: 'Toàn cảnh văn phòng',
        cameraAngle: 'Ngang tầm mắt',
        framing: 'Medium shot',
        movement: 'Static',
        props: ['Ghế', 'Bàn làm việc'],
      },
    ],
    variants: [],
    evidenceReferences: [
      { sourceKind: 'product_fact' as const, sourceId: factId },
      { sourceKind: 'analysis' as const, sourceId: analysisId },
    ],
    creativeHypotheses: ['Dân văn phòng quan tâm sức khỏe lưng'],
  };

  const videos = [1, 2, 3, 4, 5].map((num) => ({
    ...video,
    videoNumber: num as 1 | 2 | 3 | 4 | 5,
    title: `Video số ${num}: Đỡ lưng chuẩn công thái học`,
  })) as unknown as [typeof video, typeof video, typeof video, typeof video, typeof video];

  return {
    schemaVersion: 1,
    seriesTitle: 'Series 5 video ghế công thái học',
    targetAudienceSummary: 'Nhân viên văn phòng 25-40 tuổi',
    creativeDirectionSummary: 'Chân thực, khoa học và hữu ích',
    videos,
    evidenceReferences: [
      { sourceKind: 'product_fact' as const, sourceId: factId },
      { sourceKind: 'analysis' as const, sourceId: analysisId },
    ],
  };
}

describe('Compliance Policy & Deterministic Validator', () => {
  it('computes stable canonical policy hash for current policy version', () => {
    const hash1 = computeCompliancePolicyHash();
    const hash2 = computeCompliancePolicyHash(CURRENT_COMPLIANCE_POLICY_VERSION);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });

  it('computes stable finding fingerprint', () => {
    const fp1 = computeFindingFingerprint({
      code: 'DISCLOSURE_MISSING',
      severity: 'blocking',
      videoNumber: 1,
      fieldPath: 'videos[0].disclosure',
      message: 'Missing disclosure',
    });
    const fp2 = computeFindingFingerprint({
      code: 'DISCLOSURE_MISSING',
      severity: 'blocking',
      videoNumber: 1,
      fieldPath: 'videos[0].disclosure',
      message: 'Missing disclosure',
    });
    expect(fp1).toBe(fp2);
    expect(fp1).toHaveLength(64);
  });

  it('passes a fully compliant five-video package', () => {
    const pkg = createValidPackage('fact-1', 'analysis-1');
    const result = evaluateDeterministicCompliance({
      scriptPackage: pkg,
      allowedFactIds: ['fact-1'],
      allowedAnalysisIds: ['analysis-1'],
    });

    expect(result.passed).toBe(true);
    expect(result.result).toBe('passed');
    expect(result.blockingCount).toBe(0);
    expect(result.warningCount).toBe(0);
    expect(result.findings).toHaveLength(0);
  });

  it('blocks on missing affiliate disclosure in any video', () => {
    const pkg = createValidPackage();
    // @ts-expect-error test invalid disclosure
    pkg.videos[0].disclosure = null;

    const result = evaluateDeterministicCompliance({
      scriptPackage: pkg,
      allowedFactIds: ['fact-1'],
      allowedAnalysisIds: ['analysis-1'],
    });

    expect(result.passed).toBe(false);
    expect(result.result).toBe('blocked');
    expect(result.blockingCount).toBeGreaterThan(0);
    const finding = result.findings.find((f) => f.code === 'DISCLOSURE_MISSING');
    expect(finding).toBeDefined();
    expect(finding?.videoNumber).toBe(1);
  });

  it('blocks on prohibited absolute guarantee claim in Vietnamese', () => {
    const pkg = createValidPackage();
    // Insert prohibited claim in video 2 voiceOver
    // @ts-expect-error mutable for test
    pkg.videos[1].voiceOver = 'Sản phẩm cam kết 100% giúp bạn không bao giờ đau lưng lại!';

    const result = evaluateDeterministicCompliance({
      scriptPackage: pkg,
      allowedFactIds: ['fact-1'],
      allowedAnalysisIds: ['analysis-1'],
    });

    expect(result.passed).toBe(false);
    expect(result.result).toBe('blocked');
    const finding = result.findings.find((f) => f.code === 'PROHIBITED_ABSOLUTE_GUARANTEE');
    expect(finding).toBeDefined();
    expect(finding?.videoNumber).toBe(2);
  });

  it('blocks on prohibited risk-free claim in English', () => {
    const pkg = createValidPackage();
    // @ts-expect-error mutable for test
    pkg.videos[2].title = 'Completely risk-free ergonomic chair trial';

    const result = evaluateDeterministicCompliance({
      scriptPackage: pkg,
      allowedFactIds: ['fact-1'],
      allowedAnalysisIds: ['analysis-1'],
    });

    expect(result.passed).toBe(false);
    expect(result.result).toBe('blocked');
    const finding = result.findings.find((f) => f.code === 'PROHIBITED_RISK_FREE_CLAIM');
    expect(finding).toBeDefined();
    expect(finding?.videoNumber).toBe(3);
  });

  it('blocks on medical miracle cure claim', () => {
    const pkg = createValidPackage();
    // @ts-expect-error mutable for test
    pkg.videos[0].hook.spokenHook = 'Ghế này như thần dược chữa dứt điểm thoát vị đĩa đệm';

    const result = evaluateDeterministicCompliance({
      scriptPackage: pkg,
      allowedFactIds: ['fact-1'],
      allowedAnalysisIds: ['analysis-1'],
    });

    expect(result.passed).toBe(false);
    expect(result.result).toBe('blocked');
    const finding = result.findings.find((f) => f.code === 'PROHIBITED_MEDICAL_CURE_CLAIM');
    expect(finding).toBeDefined();
  });

  it('blocks when evidence is not confirmed in authoritative context', () => {
    const pkg = createValidPackage('unconfirmed-fact', 'analysis-1');
    const result = evaluateDeterministicCompliance({
      scriptPackage: pkg,
      allowedFactIds: ['confirmed-fact-other'],
      allowedAnalysisIds: ['analysis-1'],
    });

    expect(result.passed).toBe(false);
    expect(result.result).toBe('blocked');
    const finding = result.findings.find((f) => f.code === 'CLAIM_UNSUPPORTED');
    expect(finding).toBeDefined();
  });

  it('blocks when video references evidence not in package evidenceReferences', () => {
    const pkg = createValidPackage('fact-1', 'analysis-1');
    // @ts-expect-error mutable for test
    pkg.videos[0].evidenceReferences = [{ sourceKind: 'product_fact', sourceId: 'rogue-fact' }];

    const result = evaluateDeterministicCompliance({
      scriptPackage: pkg,
      allowedFactIds: ['fact-1', 'rogue-fact'],
      allowedAnalysisIds: ['analysis-1'],
    });

    expect(result.passed).toBe(false);
    expect(result.result).toBe('blocked');
    const finding = result.findings.find((f) => f.code === 'EVIDENCE_NOT_IN_PACKAGE');
    expect(finding).toBeDefined();
  });

  it('blocks when evidence is superseded/revoked', () => {
    const pkg = createValidPackage('revoked-fact', 'analysis-1');
    const result = evaluateDeterministicCompliance({
      scriptPackage: pkg,
      allowedFactIds: ['revoked-fact'],
      allowedAnalysisIds: ['analysis-1'],
      revokedEvidenceIds: ['revoked-fact'],
    });

    expect(result.passed).toBe(false);
    expect(result.result).toBe('blocked');
    const finding = result.findings.find((f) => f.code === 'EVIDENCE_SUPERSEDED');
    expect(finding).toBeDefined();
  });

  it('blocks on unsafe control characters', () => {
    const pkg = createValidPackage();
    // @ts-expect-error mutable for test
    pkg.videos[0].title = 'Ghế công thái học\x00xấu';

    const result = evaluateDeterministicCompliance({
      scriptPackage: pkg,
      allowedFactIds: ['fact-1'],
      allowedAnalysisIds: ['analysis-1'],
    });

    expect(result.passed).toBe(false);
    expect(result.result).toBe('blocked');
    const finding = result.findings.find((f) => f.code === 'UNSAFE_CONTROL_CHARACTERS');
    expect(finding).toBeDefined();
  });

  it('emits warning on content brief drift', () => {
    const pkg = createValidPackage('fact-1', 'analysis-1');
    const result = evaluateDeterministicCompliance({
      scriptPackage: pkg,
      allowedFactIds: ['fact-1'],
      allowedAnalysisIds: ['analysis-1'],
      expectedBriefHashHex: 'aabbcc',
      actualBriefHashHex: 'ddeeff',
    });

    expect(result.passed).toBe(true); // Non-blocking!
    expect(result.result).toBe('warning');
    expect(result.warningCount).toBe(1);
    const finding = result.findings.find((f) => f.code === 'BRIEF_HASH_DRIFT');
    expect(finding?.severity).toBe('warning');
  });

  it('fails closed when allowedFactIds is empty and an evidence fact is referenced', () => {
    const pkg = createValidPackage('fact-1', 'analysis-1');
    const result = evaluateDeterministicCompliance({
      scriptPackage: pkg,
      allowedFactIds: [], // Empty allowed facts set!
      allowedAnalysisIds: ['analysis-1'],
    });

    expect(result.passed).toBe(false);
    expect(result.result).toBe('blocked');
    const finding = result.findings.find((f) => f.code === 'CLAIM_UNSUPPORTED');
    expect(finding).toBeDefined();
    expect(finding?.message).toContain('Referenced product fact fact-1');
  });

  it('fails closed when allowedAnalysisIds is empty and an analysis is referenced', () => {
    const pkg = createValidPackage('fact-1', 'analysis-1');
    const result = evaluateDeterministicCompliance({
      scriptPackage: pkg,
      allowedFactIds: ['fact-1'],
      allowedAnalysisIds: [], // Empty allowed analyses set!
    });

    expect(result.passed).toBe(false);
    expect(result.result).toBe('blocked');
    const finding = result.findings.find((f) => f.code === 'CLAIM_UNSUPPORTED');
    expect(finding).toBeDefined();
    expect(finding?.message).toContain('Referenced analysis analysis-1');
  });

  it('fails closed when an unknown evidence source kind is referenced', () => {
    const pkg = createValidPackage('fact-1', 'analysis-1');
    // @ts-expect-error test unknown source kind
    pkg.evidenceReferences.push({ sourceKind: 'unsupported_kind', sourceId: 'unknown-1' });

    const result = evaluateDeterministicCompliance({
      scriptPackage: pkg,
      allowedFactIds: ['fact-1'],
      allowedAnalysisIds: ['analysis-1'],
    });

    expect(result.passed).toBe(false);
    expect(result.result).toBe('blocked');
    const finding = result.findings.find((f) => f.code === 'EVIDENCE_SOURCE_INVALID');
    expect(finding).toBeDefined();
  });

  it('fails closed when expected and actual content hashes differ', () => {
    const pkg = createValidPackage('fact-1', 'analysis-1');
    const result = evaluateDeterministicCompliance({
      scriptPackage: pkg,
      expectedContentHashHex: '11'.repeat(32),
      actualContentHashHex: '22'.repeat(32),
      allowedFactIds: ['fact-1'],
      allowedAnalysisIds: ['analysis-1'],
    });

    expect(result.passed).toBe(false);
    expect(result.result).toBe('blocked');
    const finding = result.findings.find((f) => f.code === 'HASH_MISMATCH');
    expect(finding).toBeDefined();
  });
});
