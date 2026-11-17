import crypto from 'node:crypto';
import type {
  ComplianceFinding,
  ComplianceSeverity,
  ComplianceEvaluationResult,
} from './compliance-types.js';
import type { ScriptPackage, ScriptVideo } from './script-package-types.js';

export const CURRENT_COMPLIANCE_POLICY_VERSION = '2026-11-17';

export interface ProhibitedPatternRule {
  readonly code: string;
  readonly pattern: RegExp;
  readonly description: string;
}

export const PROHIBITED_CLAIM_PATTERNS: readonly ProhibitedPatternRule[] = Object.freeze([
  {
    code: 'PROHIBITED_ABSOLUTE_GUARANTEE',
    pattern:
      /(?:^|[^\p{L}\p{N}])(cam\s+kết\s+100%|100%\s+cam\s+kết|chắc\s+chắn\s+100%|100%\s+guaranteed|guaranteed\s+100%)(?:$|[^\p{L}\p{N}])/iu,
    description: 'Prohibited absolute guarantee claim',
  },
  {
    code: 'PROHIBITED_RISK_FREE_CLAIM',
    pattern:
      /(?:^|[^\p{L}\p{N}])(tuyệt\s+đối\s+an\s+toàn|an\s+toàn\s+tuyệt\s+đối|hoàn\s+toàn\s+không\s+rủi\s+ro|không\s+rủi\s+ro|zero\s+risk|completely\s+risk[- ]?free|100%\s+risk[- ]?free)(?:$|[^\p{L}\p{N}])/iu,
    description: 'Prohibited risk-free or absolute safety claim',
  },
  {
    code: 'PROHIBITED_MEDICAL_CURE_CLAIM',
    pattern:
      /(?:^|[^\p{L}\p{N}])(chữa\s+dứt\s+điểm|trị\s+dứt\s+điểm|khỏi\s+hẳn\s+100%|thần\s+dược|thuốc\s+tiên|miracle\s+cure|cure[- ]?all|permanent\s+cure)(?:$|[^\p{L}\p{N}])/iu,
    description: 'Prohibited absolute medical cure claim',
  },
  {
    code: 'PROHIBITED_FINANCIAL_PROMISE',
    pattern:
      /(?:^|[^\p{L}\p{N}])(cam\s+kết\s+lợi\s+nhuận|chắc\s+chắn\s+kiếm\s+được|làm\s+giàu\s+không\s+khó|guaranteed\s+profit|get\s+rich\s+quick)(?:$|[^\p{L}\p{N}])/iu,
    description: 'Prohibited guaranteed profit or financial promise',
  },
]);

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

export function computeCompliancePolicyHash(
  version: string = CURRENT_COMPLIANCE_POLICY_VERSION,
): string {
  const payload = {
    version,
    patterns: PROHIBITED_CLAIM_PATTERNS.map((p) => ({ code: p.code, pattern: p.pattern.source })),
    rules: [
      'SCHEMA_STRUCTURE_VALIDATION',
      'LINKAGE_INTEGRITY',
      'EVIDENCE_COHERENCE',
      'AFFILIATE_DISCLOSURE_REQUIREMENT',
      'PROHIBITED_CLAIMS',
      'UNSAFE_CONTROL_CHARACTERS',
      'BRIEF_ALIGNMENT',
    ],
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex');
}

export function computeFindingFingerprint(finding: {
  readonly code: string;
  readonly severity: ComplianceSeverity;
  readonly videoNumber: number | null;
  readonly fieldPath: string;
  readonly message: string;
}): string {
  const raw = `${finding.code}:${finding.severity}:${finding.videoNumber ?? ''}:${finding.fieldPath}:${finding.message}`;
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

export interface DeterministicComplianceInput {
  readonly scriptPackage: ScriptPackage;
  readonly expectedArtifactId?: string | undefined;
  readonly expectedRevisionNumber?: number | undefined;
  readonly expectedContentHashHex?: string | undefined;
  readonly actualContentHashHex?: string | undefined;
  readonly allowedFactIds?: ReadonlySet<string> | readonly string[] | undefined;
  readonly allowedAnalysisIds?: ReadonlySet<string> | readonly string[] | undefined;
  readonly revokedEvidenceIds?: ReadonlySet<string> | readonly string[] | undefined;
  readonly expectedBriefHashHex?: string | undefined;
  readonly actualBriefHashHex?: string | undefined;
}

export interface DeterministicComplianceResult {
  readonly policyVersion: string;
  readonly policyHash: string;
  readonly passed: boolean;
  readonly result: ComplianceEvaluationResult;
  readonly findings: readonly ComplianceFinding[];
  readonly blockingCount: number;
  readonly warningCount: number;
  readonly infoCount: number;
}

export function evaluateDeterministicCompliance(
  input: DeterministicComplianceInput,
): DeterministicComplianceResult {
  const policyVersion = CURRENT_COMPLIANCE_POLICY_VERSION;
  const policyHash = computeCompliancePolicyHash(policyVersion);
  const findings: ComplianceFinding[] = [];

  const addFinding = (
    code: string,
    severity: ComplianceSeverity,
    videoNumber: number | null,
    fieldPath: string,
    message: string,
    evidenceIds: readonly string[] = [],
  ): void => {
    const fingerprint = computeFindingFingerprint({
      code,
      severity,
      videoNumber,
      fieldPath,
      message,
    });
    findings.push({
      fingerprint,
      code,
      severity,
      source: 'deterministic',
      videoNumber,
      fieldPath,
      message,
      evidenceIds: Object.freeze([...evidenceIds]),
    });
  };

  const {
    scriptPackage,
    expectedContentHashHex,
    actualContentHashHex,
    allowedFactIds,
    allowedAnalysisIds,
    revokedEvidenceIds,
    expectedBriefHashHex,
    actualBriefHashHex,
  } = input;

  const allowedFacts = new Set(allowedFactIds ?? []);
  const allowedAnalyses = new Set(allowedAnalysisIds ?? []);
  const revokedIds = new Set(revokedEvidenceIds ?? []);

  // 1. Linkage verification
  if (
    expectedContentHashHex &&
    actualContentHashHex &&
    expectedContentHashHex !== actualContentHashHex
  ) {
    addFinding(
      'HASH_MISMATCH',
      'blocking',
      null,
      'contentHash',
      `Content hash mismatch: expected ${expectedContentHashHex}, actual ${actualContentHashHex}`,
    );
  }

  // 2. Schema and structure verification
  if (!scriptPackage || typeof scriptPackage !== 'object') {
    addFinding(
      'SCHEMA_INVALID',
      'blocking',
      null,
      'package',
      'Script package must be a non-null object',
    );
    return buildResult(policyVersion, policyHash, findings);
  }

  if (scriptPackage.schemaVersion !== 1) {
    addFinding(
      'SCHEMA_VERSION_UNSUPPORTED',
      'blocking',
      null,
      'schemaVersion',
      `Unsupported schema version: ${scriptPackage.schemaVersion}`,
    );
  }

  if (
    !scriptPackage.seriesTitle ||
    typeof scriptPackage.seriesTitle !== 'string' ||
    scriptPackage.seriesTitle.trim().length === 0
  ) {
    addFinding(
      'EMPTY_SERIES_TITLE',
      'blocking',
      null,
      'seriesTitle',
      'Series title must not be empty',
    );
  } else if (CONTROL_CHARS_REGEX.test(scriptPackage.seriesTitle)) {
    addFinding(
      'UNSAFE_CONTROL_CHARACTERS',
      'blocking',
      null,
      'seriesTitle',
      'Series title contains unsafe control characters',
    );
  }

  if (
    !scriptPackage.videos ||
    !Array.isArray(scriptPackage.videos) ||
    scriptPackage.videos.length !== 5
  ) {
    addFinding(
      'FIVE_VIDEO_STRUCTURE_INVALID',
      'blocking',
      null,
      'videos',
      `Script package must contain exactly 5 videos, received ${scriptPackage.videos?.length ?? 0}`,
    );
  }

  // 3. Evidence coherence at package level
  const packageEvidenceMap = new Map<string, { sourceKind: string; sourceId: string }>();
  for (const ev of scriptPackage.evidenceReferences ?? []) {
    const key = `${ev.sourceKind}:${ev.sourceId}`;
    packageEvidenceMap.set(key, ev);

    if (revokedIds.has(ev.sourceId)) {
      addFinding(
        'EVIDENCE_SUPERSEDED',
        'blocking',
        null,
        'evidenceReferences',
        `Evidence ${ev.sourceId} has been revoked or superseded`,
        [ev.sourceId],
      );
    } else if (
      ev.sourceKind === 'product_fact' &&
      allowedFacts.size > 0 &&
      !allowedFacts.has(ev.sourceId)
    ) {
      addFinding(
        'CLAIM_UNSUPPORTED',
        'blocking',
        null,
        'evidenceReferences',
        `Referenced product fact ${ev.sourceId} is not confirmed or not allowed in authoritative context`,
        [ev.sourceId],
      );
    } else if (
      ev.sourceKind === 'analysis' &&
      allowedAnalyses.size > 0 &&
      !allowedAnalyses.has(ev.sourceId)
    ) {
      addFinding(
        'CLAIM_UNSUPPORTED',
        'blocking',
        null,
        'evidenceReferences',
        `Referenced analysis ${ev.sourceId} is not accepted or not in authoritative context`,
        [ev.sourceId],
      );
    }
  }

  // Check brief drift
  if (expectedBriefHashHex && actualBriefHashHex && expectedBriefHashHex !== actualBriefHashHex) {
    addFinding(
      'BRIEF_HASH_DRIFT',
      'warning',
      null,
      'contentBriefHash',
      `Content brief hash ${actualBriefHashHex} has drifted from expected ${expectedBriefHashHex}`,
    );
  }

  // 4. Per-video validations
  const videos = Array.isArray(scriptPackage.videos) ? scriptPackage.videos : [];
  videos.forEach((video: ScriptVideo, idx: number) => {
    const videoNum = video.videoNumber ?? idx + 1;
    const videoPrefix = `videos[${idx}]`;

    if (video.videoNumber !== idx + 1) {
      addFinding(
        'VIDEO_NUMBER_MISMATCH',
        'blocking',
        videoNum,
        `${videoPrefix}.videoNumber`,
        `Video at index ${idx} must have videoNumber ${idx + 1}, found ${video.videoNumber}`,
      );
    }

    // Title & Objective
    if (!video.title || typeof video.title !== 'string' || video.title.trim().length === 0) {
      addFinding(
        'EMPTY_VIDEO_TITLE',
        'blocking',
        videoNum,
        `${videoPrefix}.title`,
        'Video title must not be empty',
      );
    }
    if (
      !video.objective ||
      typeof video.objective !== 'string' ||
      video.objective.trim().length === 0
    ) {
      addFinding(
        'EMPTY_VIDEO_OBJECTIVE',
        'blocking',
        videoNum,
        `${videoPrefix}.objective`,
        'Video objective must not be empty',
      );
    }

    // Duration bounds
    if (
      typeof video.targetDurationSeconds !== 'number' ||
      video.targetDurationSeconds < 15 ||
      video.targetDurationSeconds > 180
    ) {
      addFinding(
        'DURATION_OUT_OF_BOUNDS',
        'blocking',
        videoNum,
        `${videoPrefix}.targetDurationSeconds`,
        `Video target duration must be between 15 and 180 seconds, found ${video.targetDurationSeconds}`,
      );
    }

    // Hook
    if (!video.hook || typeof video.hook !== 'object') {
      addFinding(
        'HOOK_MISSING',
        'blocking',
        videoNum,
        `${videoPrefix}.hook`,
        'Video hook must be defined',
      );
    } else {
      if (!video.hook.spokenHook || video.hook.spokenHook.trim().length === 0) {
        addFinding(
          'HOOK_EMPTY',
          'blocking',
          videoNum,
          `${videoPrefix}.hook.spokenHook`,
          'Spoken hook must not be empty',
        );
      }
      if (!video.hook.visualHook || video.hook.visualHook.trim().length === 0) {
        addFinding(
          'HOOK_EMPTY',
          'blocking',
          videoNum,
          `${videoPrefix}.hook.visualHook`,
          'Visual hook must not be empty',
        );
      }
    }

    // Call To Action
    if (!video.callToAction || typeof video.callToAction !== 'object') {
      addFinding(
        'CTA_MISSING',
        'blocking',
        videoNum,
        `${videoPrefix}.callToAction`,
        'Call to action must be defined',
      );
    } else {
      if (!video.callToAction.text || video.callToAction.text.trim().length === 0) {
        addFinding(
          'CTA_EMPTY',
          'blocking',
          videoNum,
          `${videoPrefix}.callToAction.text`,
          'Call to action text must not be empty',
        );
      }
      if (
        !video.callToAction.visualDirection ||
        video.callToAction.visualDirection.trim().length === 0
      ) {
        addFinding(
          'CTA_EMPTY',
          'blocking',
          videoNum,
          `${videoPrefix}.callToAction.visualDirection`,
          'Call to action visual direction must not be empty',
        );
      }
    }

    // Required Affiliate Disclosure
    if (!video.disclosure || typeof video.disclosure !== 'object') {
      addFinding(
        'DISCLOSURE_MISSING',
        'blocking',
        videoNum,
        `${videoPrefix}.disclosure`,
        'Every short video must declare an affiliate disclosure',
      );
    } else {
      if (!video.disclosure.text || video.disclosure.text.trim().length < 5) {
        addFinding(
          'DISCLOSURE_TEXT_INSUFFICIENT',
          'blocking',
          videoNum,
          `${videoPrefix}.disclosure.text`,
          'Affiliate disclosure text is missing or too short',
        );
      }
      if (!video.disclosure.placement || video.disclosure.placement.trim().length === 0) {
        addFinding(
          'DISCLOSURE_PLACEMENT_MISSING',
          'blocking',
          videoNum,
          `${videoPrefix}.disclosure.placement`,
          'Affiliate disclosure placement must be specified',
        );
      }
    }

    // Scenes & Shots
    if (!video.scenes || !Array.isArray(video.scenes) || video.scenes.length === 0) {
      addFinding(
        'SCENES_MISSING',
        'blocking',
        videoNum,
        `${videoPrefix}.scenes`,
        'Video must contain at least one scene',
      );
    } else {
      video.scenes.forEach((sc, sIdx) => {
        if (!sc.spokenText || sc.spokenText.trim().length === 0) {
          addFinding(
            'SCENE_SPOKEN_TEXT_EMPTY',
            'blocking',
            videoNum,
            `${videoPrefix}.scenes[${sIdx}].spokenText`,
            `Scene ${sc.sceneNumber ?? sIdx + 1} spokenText is empty`,
          );
        }
        if (!sc.visualDescription || sc.visualDescription.trim().length === 0) {
          addFinding(
            'SCENE_VISUAL_EMPTY',
            'blocking',
            videoNum,
            `${videoPrefix}.scenes[${sIdx}].visualDescription`,
            `Scene ${sc.sceneNumber ?? sIdx + 1} visualDescription is empty`,
          );
        }
        if (
          !sc.timeRangeSeconds ||
          typeof sc.timeRangeSeconds.start !== 'number' ||
          typeof sc.timeRangeSeconds.end !== 'number' ||
          sc.timeRangeSeconds.end <= sc.timeRangeSeconds.start
        ) {
          addFinding(
            'SCENE_TIMERANGE_INVALID',
            'blocking',
            videoNum,
            `${videoPrefix}.scenes[${sIdx}].timeRangeSeconds`,
            `Scene ${sc.sceneNumber ?? sIdx + 1} has invalid time range`,
          );
        }
      });
    }

    if (!video.shotList || !Array.isArray(video.shotList) || video.shotList.length === 0) {
      addFinding(
        'SHOT_LIST_MISSING',
        'blocking',
        videoNum,
        `${videoPrefix}.shotList`,
        'Video must contain at least one shot in shotList',
      );
    } else {
      video.shotList.forEach((sh, shIdx) => {
        if (typeof sh.durationSeconds !== 'number' || sh.durationSeconds <= 0) {
          addFinding(
            'SHOT_DURATION_INVALID',
            'blocking',
            videoNum,
            `${videoPrefix}.shotList[${shIdx}].durationSeconds`,
            `Shot ${sh.shotNumber ?? shIdx + 1} duration must be positive`,
          );
        }
        if (!sh.description || sh.description.trim().length === 0) {
          addFinding(
            'SHOT_DESCRIPTION_EMPTY',
            'blocking',
            videoNum,
            `${videoPrefix}.shotList[${shIdx}].description`,
            `Shot ${sh.shotNumber ?? shIdx + 1} description is empty`,
          );
        }
      });
    }

    // Check evidence coherence for video: every video evidence ref must be in package evidenceReferences
    for (const ev of video.evidenceReferences ?? []) {
      const key = `${ev.sourceKind}:${ev.sourceId}`;
      if (!packageEvidenceMap.has(key)) {
        addFinding(
          'EVIDENCE_NOT_IN_PACKAGE',
          'blocking',
          videoNum,
          `${videoPrefix}.evidenceReferences`,
          `Video ${videoNum} references evidence ${key} not declared in package evidenceReferences`,
          [ev.sourceId],
        );
      }
    }

    // Prohibited Claim Patterns & Control Characters in video texts
    const textFieldsToCheck: Array<{ field: string; text: string | undefined }> = [
      { field: 'title', text: video.title },
      { field: 'objective', text: video.objective },
      { field: 'voiceOver', text: video.voiceOver },
      { field: 'hook.spokenHook', text: video.hook?.spokenHook },
      { field: 'hook.visualHook', text: video.hook?.visualHook },
      { field: 'callToAction.text', text: video.callToAction?.text },
    ];

    (video.scenes ?? []).forEach((sc, sIdx) => {
      textFieldsToCheck.push({ field: `scenes[${sIdx}].spokenText`, text: sc.spokenText });
      textFieldsToCheck.push({
        field: `scenes[${sIdx}].visualDescription`,
        text: sc.visualDescription,
      });
    });

    (video.onScreenOverlays ?? []).forEach((ov, ovIdx) => {
      textFieldsToCheck.push({ field: `onScreenOverlays[${ovIdx}].text`, text: ov.text });
    });

    for (const { field, text } of textFieldsToCheck) {
      if (!text) continue;
      if (CONTROL_CHARS_REGEX.test(text)) {
        addFinding(
          'UNSAFE_CONTROL_CHARACTERS',
          'blocking',
          videoNum,
          `${videoPrefix}.${field}`,
          `Text in ${field} contains unsafe control characters`,
        );
      }

      for (const rule of PROHIBITED_CLAIM_PATTERNS) {
        if (rule.pattern.test(text)) {
          addFinding(
            rule.code,
            'blocking',
            videoNum,
            `${videoPrefix}.${field}`,
            `${rule.description} detected in ${field}: "${text.substring(0, 100)}"`,
          );
        }
      }
    }
  });

  return buildResult(policyVersion, policyHash, findings);
}

function buildResult(
  policyVersion: string,
  policyHash: string,
  findings: readonly ComplianceFinding[],
): DeterministicComplianceResult {
  const blockingCount = findings.filter((f) => f.severity === 'blocking').length;
  const warningCount = findings.filter((f) => f.severity === 'warning').length;
  const infoCount = findings.filter((f) => f.severity === 'info').length;
  const passed = blockingCount === 0;

  let result: ComplianceEvaluationResult;
  if (blockingCount > 0) {
    result = 'blocked';
  } else if (warningCount > 0) {
    result = 'warning';
  } else {
    result = 'passed';
  }

  return Object.freeze({
    policyVersion,
    policyHash,
    passed,
    result,
    findings: Object.freeze([...findings]),
    blockingCount,
    warningCount,
    infoCount,
  });
}
