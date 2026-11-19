import { describe, expect, it } from 'vitest';
import { deriveAccountLifecycle } from '../../src/social/account-lifecycle-policy.js';

describe('Social Account Lifecycle Policy', () => {
  const baseNow = new Date('2026-11-19T12:00:00Z');
  const futureExpiry = new Date('2027-01-19T12:00:00Z').toISOString();
  const pastExpiry = new Date('2026-11-18T12:00:00Z').toISOString();

  it('derives active status when verified, valid credentials, granted scopes, and review approved', () => {
    const result = deriveAccountLifecycle({
      platform: 'threads',
      exchangeStage: 'completed',
      hasValidCredential: true,
      tokenExpiresAt: futureExpiry,
      verifiedIdentity: { providerAccountId: 'th_123', displayName: 'Creator' },
      grantedScopes: ['threads_basic', 'threads_content_publish'],
      capabilitiesCheckedAt: baseNow.toISOString(),
      appReviewStatus: 'approved',
      killSwitches: {},
      now: baseNow,
    });

    expect(result.status).toBe('active');
    expect(result.statusReason).toBe('initial_exchange_complete');
    expect(result.capabilities.canPublishText).toBe(true);
    expect(result.capabilities.canPublishMedia).toBe(false); // Media gated until Task-019
    expect(result.allowedActions).toContain('refresh');
    expect(result.allowedActions).toContain('reconnect');
    expect(result.allowedActions).toContain('disconnect');
    expect(result.nextRefreshAt).not.toBeNull();
  });

  it('derives review_gated when appReviewStatus is development', () => {
    const result = deriveAccountLifecycle({
      platform: 'threads',
      exchangeStage: 'completed',
      hasValidCredential: true,
      tokenExpiresAt: futureExpiry,
      verifiedIdentity: { providerAccountId: 'th_123', displayName: 'Creator' },
      grantedScopes: ['threads_basic', 'threads_content_publish'],
      capabilitiesCheckedAt: baseNow.toISOString(),
      appReviewStatus: 'development',
      killSwitches: {},
      now: baseNow,
    });

    expect(result.status).toBe('review_gated');
    expect(result.statusReason).toBe('review_pending');
    expect(result.capabilities.canPublishText).toBe(false);
    expect(result.capabilities.canPublishMedia).toBe(false);
    expect(result.allowedActions).toContain('refresh');
    expect(result.allowedActions).toContain('reconnect');
    expect(result.allowedActions).toContain('disconnect');
  });

  it('derives reauth_required when token is expired', () => {
    const result = deriveAccountLifecycle({
      platform: 'threads',
      exchangeStage: 'completed',
      hasValidCredential: true,
      tokenExpiresAt: pastExpiry,
      verifiedIdentity: { providerAccountId: 'th_123', displayName: 'Creator' },
      grantedScopes: ['threads_basic', 'threads_content_publish'],
      capabilitiesCheckedAt: baseNow.toISOString(),
      appReviewStatus: 'approved',
      killSwitches: {},
      now: baseNow,
    });

    expect(result.status).toBe('reauth_required');
    expect(result.statusReason).toBe('token_expired');
    expect(result.capabilities.canPublishText).toBe(false);
    expect(result.allowedActions).toContain('reconnect');
    expect(result.allowedActions).not.toContain('refresh');
  });

  it('derives reauth_required when terminal auth error occurs (token_revoked / invalid_grant)', () => {
    const result = deriveAccountLifecycle({
      platform: 'threads',
      exchangeStage: 'completed',
      hasValidCredential: true,
      tokenExpiresAt: futureExpiry,
      verifiedIdentity: { providerAccountId: 'th_123', displayName: 'Creator' },
      grantedScopes: ['threads_basic', 'threads_content_publish'],
      capabilitiesCheckedAt: baseNow.toISOString(),
      lastInspectionErrorClass: 'token_revoked',
      appReviewStatus: 'approved',
      killSwitches: {},
      now: baseNow,
    });

    expect(result.status).toBe('reauth_required');
    expect(result.statusReason).toBe('grant_revoked');
    expect(result.capabilities.canPublishText).toBe(false);
  });

  it('derives degraded when exchange stage was partial (short_token_exchanged)', () => {
    const result = deriveAccountLifecycle({
      platform: 'threads',
      exchangeStage: 'short_token_exchanged',
      hasValidCredential: true,
      tokenExpiresAt: futureExpiry,
      verifiedIdentity: { providerAccountId: 'th_123', displayName: 'Creator' },
      grantedScopes: ['threads_basic'],
      capabilitiesCheckedAt: baseNow.toISOString(),
      appReviewStatus: 'approved',
      killSwitches: {},
      now: baseNow,
    });

    expect(result.status).toBe('degraded');
    expect(result.statusReason).toBe('transient_failure');
    expect(result.capabilities.canPublishText).toBe(false);
    expect(result.allowedActions).toContain('refresh');
  });

  it('derives degraded when transient inspection error occurs', () => {
    const result = deriveAccountLifecycle({
      platform: 'threads',
      exchangeStage: 'completed',
      hasValidCredential: true,
      tokenExpiresAt: futureExpiry,
      verifiedIdentity: { providerAccountId: 'th_123', displayName: 'Creator' },
      grantedScopes: ['threads_basic', 'threads_content_publish'],
      capabilitiesCheckedAt: baseNow.toISOString(),
      lastInspectionErrorClass: 'rate_limited',
      appReviewStatus: 'approved',
      killSwitches: {},
      now: baseNow,
    });

    expect(result.status).toBe('degraded');
    expect(result.statusReason).toBe('rate_limited');
    expect(result.capabilities.canPublishText).toBe(false);
    expect(result.allowedActions).toContain('refresh');
  });

  it('derives disconnected when disconnectedAt is present', () => {
    const result = deriveAccountLifecycle({
      platform: 'threads',
      exchangeStage: 'completed',
      hasValidCredential: true,
      tokenExpiresAt: futureExpiry,
      verifiedIdentity: { providerAccountId: 'th_123', displayName: 'Creator' },
      grantedScopes: ['threads_basic', 'threads_content_publish'],
      capabilitiesCheckedAt: baseNow.toISOString(),
      appReviewStatus: 'approved',
      killSwitches: {},
      disconnectedAt: '2026-11-19T10:00:00Z',
      now: baseNow,
    });

    expect(result.status).toBe('disconnected');
    expect(result.statusReason).toBe('disconnected_by_user');
    expect(result.capabilities.canPublishText).toBe(false);
    expect(result.allowedActions).toEqual(['reconnect']);
    expect(result.nextRefreshAt).toBeNull();
  });

  it('derives degraded with kill_switched reason when connection kill switch is active', () => {
    const result = deriveAccountLifecycle({
      platform: 'threads',
      exchangeStage: 'completed',
      hasValidCredential: true,
      tokenExpiresAt: futureExpiry,
      verifiedIdentity: { providerAccountId: 'th_123', displayName: 'Creator' },
      grantedScopes: ['threads_basic', 'threads_content_publish'],
      capabilitiesCheckedAt: baseNow.toISOString(),
      appReviewStatus: 'approved',
      killSwitches: { connectionKillSwitch: true },
      now: baseNow,
    });

    expect(result.status).toBe('degraded');
    expect(result.statusReason).toBe('kill_switched');
    expect(result.capabilities.canPublishText).toBe(false);
    expect(result.allowedActions).toContain('reconnect');
    expect(result.allowedActions).toContain('disconnect');
  });

  it('does not enable canPublishText if threads_content_publish scope is missing', () => {
    const result = deriveAccountLifecycle({
      platform: 'threads',
      exchangeStage: 'completed',
      hasValidCredential: true,
      tokenExpiresAt: futureExpiry,
      verifiedIdentity: { providerAccountId: 'th_123', displayName: 'Creator' },
      grantedScopes: ['threads_basic'], // Missing threads_content_publish!
      capabilitiesCheckedAt: baseNow.toISOString(),
      appReviewStatus: 'approved',
      killSwitches: {},
      now: baseNow,
    });

    expect(result.status).toBe('active');
    expect(result.capabilities.canPublishText).toBe(false);
  });
});
