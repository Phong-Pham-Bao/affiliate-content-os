import { describe, expect, it } from 'vitest';
import {
  calculatePublicationBackoff,
  canCancelPublication,
  canReschedulePublication,
  canTransitionPublicationStatus,
  canonicalJsonStringify,
  computeCanonicalHashHex,
  computeCapabilityFingerprintHex,
  computePreviewHashHex,
  formatUtcToLocalTime,
  isPublicationApprovalSnapshotId,
  isPublicationAttemptId,
  isPublicationId,
  isPublicationStatus,
  isTerminalPublication,
  isTerminalPublicationStatus,
  parsePublicationApprovalSnapshotId,
  parsePublicationAttemptId,
  parsePublicationId,
  renderPublicationText,
  validateScheduleTriple,
  PublicationScheduleInvalidError,
  DomainValidationError,
} from '../../src/index.js';

describe('Publication Domain Tests', () => {
  describe('Identifiers', () => {
    const validUuid = '018f0000-0000-7000-8000-000000000001';
    const invalidUuid = 'not-a-uuid';

    it('validates and parses PublicationApprovalSnapshotId', () => {
      expect(isPublicationApprovalSnapshotId(validUuid)).toBe(true);
      expect(isPublicationApprovalSnapshotId(invalidUuid)).toBe(false);
      expect(parsePublicationApprovalSnapshotId(validUuid)).toBe(validUuid);
      expect(() => parsePublicationApprovalSnapshotId(invalidUuid)).toThrow(DomainValidationError);
    });

    it('validates and parses PublicationId', () => {
      expect(isPublicationId(validUuid)).toBe(true);
      expect(isPublicationId(invalidUuid)).toBe(false);
      expect(parsePublicationId(validUuid)).toBe(validUuid);
      expect(() => parsePublicationId(invalidUuid)).toThrow(DomainValidationError);
    });

    it('validates and parses PublicationAttemptId', () => {
      expect(isPublicationAttemptId(validUuid)).toBe(true);
      expect(isPublicationAttemptId(invalidUuid)).toBe(false);
      expect(parsePublicationAttemptId(validUuid)).toBe(validUuid);
      expect(() => parsePublicationAttemptId(invalidUuid)).toThrow(DomainValidationError);
    });
  });

  describe('State Machine & Transitions', () => {
    it('validates publication status strings', () => {
      expect(isPublicationStatus('scheduled')).toBe(true);
      expect(isPublicationStatus('published')).toBe(true);
      expect(isPublicationStatus('outcome_unknown')).toBe(true);
      expect(isPublicationStatus('nonexistent')).toBe(false);
    });

    it('identifies terminal publication statuses', () => {
      expect(isTerminalPublication('published')).toBe(true);
      expect(isTerminalPublication('failed')).toBe(true);
      expect(isTerminalPublication('rejected')).toBe(true);
      expect(isTerminalPublication('canceled')).toBe(true);
      expect(isTerminalPublication('scheduled')).toBe(false);
      expect(isTerminalPublication('queued')).toBe(false);
      expect(isTerminalPublication('outcome_unknown')).toBe(false);

      expect(isTerminalPublicationStatus('published')).toBe(true);
      expect(isTerminalPublicationStatus('scheduled')).toBe(false);
    });

    it('governs valid forward transitions', () => {
      expect(canTransitionPublicationStatus('scheduled', 'queued')).toBe(true);
      expect(canTransitionPublicationStatus('scheduled', 'scheduled')).toBe(true); // reschedule
      expect(canTransitionPublicationStatus('scheduled', 'canceled')).toBe(true);
      expect(canTransitionPublicationStatus('scheduled', 'published')).toBe(false); // never direct publish

      expect(canTransitionPublicationStatus('queued', 'publishing')).toBe(true);
      expect(canTransitionPublicationStatus('queued', 'rejected')).toBe(true);
      expect(canTransitionPublicationStatus('queued', 'failed')).toBe(true);
      expect(canTransitionPublicationStatus('queued', 'published')).toBe(false);

      expect(canTransitionPublicationStatus('publishing', 'published')).toBe(true);
      expect(canTransitionPublicationStatus('publishing', 'retry_wait')).toBe(true);
      expect(canTransitionPublicationStatus('publishing', 'failed')).toBe(true);
      expect(canTransitionPublicationStatus('publishing', 'outcome_unknown')).toBe(true);

      expect(canTransitionPublicationStatus('published', 'retry_wait')).toBe(false);
      expect(canTransitionPublicationStatus('failed', 'publishing')).toBe(false);
      expect(canTransitionPublicationStatus('rejected', 'queued')).toBe(false);
      expect(canTransitionPublicationStatus('canceled', 'scheduled')).toBe(false);
      expect(canTransitionPublicationStatus('outcome_unknown', 'publishing')).toBe(false); // no blind retry
    });

    it('allows reschedule only from scheduled status with no lease', () => {
      expect(canReschedulePublication('scheduled', false)).toBe(true);
      expect(canReschedulePublication('scheduled', true)).toBe(false);
      expect(canReschedulePublication('queued', false)).toBe(false);
      expect(canReschedulePublication('publishing', false)).toBe(false);
      expect(canReschedulePublication('published', false)).toBe(false);
      expect(canReschedulePublication('retry_wait', false)).toBe(false);
    });

    it('allows cancel only before provider attempt starts', () => {
      expect(canCancelPublication('scheduled')).toBe(true);
      expect(canCancelPublication('queued', 'prepared')).toBe(true);
      expect(canCancelPublication('queued', 'provider_attempt_started')).toBe(false);
      expect(canCancelPublication('publishing', 'provider_attempt_started')).toBe(false);
      expect(canCancelPublication('published')).toBe(false);
      expect(canCancelPublication('retry_wait')).toBe(false);
      expect(canCancelPublication('canceled')).toBe(true); // idempotent
    });

    it('calculates bounded exponential backoff', () => {
      const b1 = calculatePublicationBackoff(1);
      const b2 = calculatePublicationBackoff(2);
      const b3 = calculatePublicationBackoff(3);
      expect(b1).toBe(60_000);
      expect(b2).toBe(120_000);
      expect(b3).toBe(240_000);

      // respect explicit retryAfterMs if supplied
      expect(calculatePublicationBackoff(1, 45_000)).toBe(45_000);
      // cap at maxHorizonMs
      expect(calculatePublicationBackoff(1, 10_000_000, 3_600_000)).toBe(3_600_000);
    });
  });

  describe('Schedule Policy & Timezone Round-Trip', () => {
    const fixedNow = new Date('2026-11-21T00:00:00.000Z');

    it('accepts and round-trips a valid schedule triple in America/New_York (UTC-5 in winter)', () => {
      // 2026-11-25 09:30:00 in New York is 14:30:00 UTC
      const result = validateScheduleTriple(
        {
          scheduledAtUtc: '2026-11-25T14:30:00.000Z',
          originalLocalTime: '2026-11-25T09:30:00',
          timezone: 'America/New_York',
        },
        { now: fixedNow },
      );
      expect(result.timezone).toBe('America/New_York');
      expect(result.originalLocalTime).toBe('2026-11-25T09:30:00');
      expect(result.scheduledAtUtc).toBe('2026-11-25T14:30:00.000Z');
    });

    it('accepts and round-trips in Asia/Ho_Chi_Minh (UTC+7)', () => {
      // 2026-11-25 15:00:00 in HCM is 08:00:00 UTC
      const result = validateScheduleTriple(
        {
          scheduledAtUtc: '2026-11-25T08:00:00.000Z',
          originalLocalTime: '2026-11-25T15:00:00',
          timezone: 'Asia/Ho_Chi_Minh',
        },
        { now: fixedNow },
      );
      expect(result.timezone).toBe('Asia/Ho_Chi_Minh');
      expect(result.scheduledAtUtc).toBe('2026-11-25T08:00:00.000Z');
    });

    it('rejects schedule triple mismatch where local does not match UTC instant in timezone', () => {
      expect(() =>
        validateScheduleTriple(
          {
            scheduledAtUtc: '2026-11-25T14:30:00.000Z',
            originalLocalTime: '2026-11-25T11:30:00', // incorrect offset!
            timezone: 'America/New_York',
          },
          { now: fixedNow },
        ),
      ).toThrow(PublicationScheduleInvalidError);
    });

    it('rejects invalid IANA timezone', () => {
      expect(() =>
        validateScheduleTriple(
          {
            scheduledAtUtc: '2026-11-25T14:30:00.000Z',
            originalLocalTime: '2026-11-25T09:30:00',
            timezone: 'Mars/Phobos',
          },
          { now: fixedNow },
        ),
      ).toThrow(PublicationScheduleInvalidError);
    });

    it('rejects past schedule instant', () => {
      expect(() =>
        validateScheduleTriple(
          {
            scheduledAtUtc: '2026-11-20T14:30:00.000Z',
            originalLocalTime: '2026-11-20T09:30:00',
            timezone: 'America/New_York',
          },
          { now: fixedNow },
        ),
      ).toThrow(/in the past/);
    });

    it('rejects too-soon schedule instant violating minimum lead time', () => {
      // 30 seconds from now, when minimum is 60 seconds
      expect(() =>
        validateScheduleTriple(
          {
            scheduledAtUtc: '2026-11-21T00:00:30.000Z',
            originalLocalTime: '2026-11-20T19:00:30',
            timezone: 'America/New_York',
          },
          { now: fixedNow, minLeadTimeSeconds: 60 },
        ),
      ).toThrow(/too soon/);
    });

    it('rejects schedule instant exceeding maximum horizon', () => {
      // 100 days from now, when maximum is 90 days
      expect(() =>
        validateScheduleTriple(
          {
            scheduledAtUtc: '2027-03-01T14:30:00.000Z',
            originalLocalTime: '2027-03-01T09:30:00',
            timezone: 'America/New_York',
          },
          { now: fixedNow, maxHorizonDays: 90 },
        ),
      ).toThrow(/maximum schedule horizon/);
    });

    it('rejects nonexistent local time during spring forward transition (DST gap)', () => {
      // In America/New_York on 2027-03-14, 02:00 skips to 03:00. 02:30 does not exist!
      // If someone claims 07:30 UTC maps to 02:30:
      // At 07:30 UTC on 2027-03-14, New York is UTC-4 (EDT), so local time is 03:30 EDT!
      expect(() =>
        validateScheduleTriple(
          {
            scheduledAtUtc: '2027-03-14T07:30:00.000Z',
            originalLocalTime: '2027-03-14T02:30:00',
            timezone: 'America/New_York',
          },
          { now: fixedNow, maxHorizonDays: 180 },
        ),
      ).toThrow(PublicationScheduleInvalidError);
    });

    it('unambiguously verifies autumn fall-back local time with exact instant', () => {
      // In America/New_York on 2026-11-01, 01:30 occurs twice (01:30 EDT and 01:30 EST).
      // Instant 05:30:00Z is 01:30:00 EDT (UTC-4)
      const res1 = formatUtcToLocalTime(new Date('2026-11-01T05:30:00.000Z'), 'America/New_York');
      expect(res1).toBe('2026-11-01T01:30:00');

      // Instant 06:30:00Z is 01:30:00 EST (UTC-5)
      const res2 = formatUtcToLocalTime(new Date('2026-11-01T06:30:00.000Z'), 'America/New_York');
      expect(res2).toBe('2026-11-01T01:30:00');
    });
  });

  describe('Preview & Hashing', () => {
    it('renders publication text from video components', () => {
      const text = renderPublicationText({
        hook: { spokenHook: 'Stop wasting time on manual content.' },
        callToAction: { text: 'Check out the link in bio!' },
        disclosure: { text: '#ad #affiliate' },
      });
      expect(text).toBe(
        'Stop wasting time on manual content.\n\nCheck out the link in bio!\n\n#ad #affiliate',
      );
    });

    it('allows overriding explicit disclosure text', () => {
      const text = renderPublicationText(
        {
          hook: { spokenHook: 'Stop wasting time.' },
          callToAction: { text: 'Link in bio!' },
          disclosure: { text: '#old_ad' },
        },
        { explicitDisclosure: '#sponsored' },
      );
      expect(text).toBe('Stop wasting time.\n\nLink in bio!\n\n#sponsored');
    });

    it('falls back to voiceOver or title if hook/cta missing', () => {
      const text = renderPublicationText({
        voiceOver: 'Full script voiceover content here.',
      });
      expect(text).toBe('Full script voiceover content here.');

      const text2 = renderPublicationText({
        title: 'Video Title Fallback',
      });
      expect(text2).toBe('Video Title Fallback');
    });

    it('throws DomainValidationError if rendered text exceeds maximum allowed length', () => {
      const longHook = 'a'.repeat(501);
      expect(() =>
        renderPublicationText({
          hook: { spokenHook: longHook },
        }),
      ).toThrow(/exceeds maximum allowed of 500 characters/);
    });

    it('computes deterministic preview hash', () => {
      const text = 'Hello Threads!';
      const hash1 = computePreviewHashHex(text);
      const hash2 = computePreviewHashHex(text);
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
    });

    it('computes canonical JSON string and hash deterministically', () => {
      const obj1 = { b: 2, a: 1, c: { y: 'test', x: 10 } };
      const obj2 = { a: 1, c: { x: 10, y: 'test' }, b: 2 };
      expect(canonicalJsonStringify(obj1)).toBe(canonicalJsonStringify(obj2));
      expect(computeCanonicalHashHex(obj1)).toBe(computeCanonicalHashHex(obj2));
    });

    it('computes capability fingerprint hex', () => {
      const caps = { canPublishText: true, canPublishMedia: false };
      const fp = computeCapabilityFingerprintHex(caps);
      expect(fp).toHaveLength(64);
    });
  });
});
