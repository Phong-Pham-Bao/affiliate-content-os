import { describe, expect, it } from 'vitest';
import {
  isCallbackResultId,
  isOAuthCallbackResultStatus,
  isOAuthTransactionId,
  isOAuthTransactionStatus,
  isSocialAccountEnvironment,
  isSocialAccountId,
  isSocialAccountStatus,
  isSocialPlatform,
  parseCallbackResultId,
  parseOAuthTransactionId,
  parseSocialAccountId,
  validateOAuthRedirectUri,
  validateOAuthReturnTo,
  validateOAuthState,
  validateProviderAccountId,
  validateSocialCapabilities,
  validateSocialDisplayName,
  validateSocialHandle,
  validateSocialScopes,
  DomainValidationError,
} from '../src/index.js';

describe('Social domain types and guards', () => {
  it('validates social platforms', () => {
    expect(isSocialPlatform('threads')).toBe(true);
    expect(isSocialPlatform('tiktok')).toBe(true);
    expect(isSocialPlatform('twitter')).toBe(false);
    expect(isSocialPlatform('')).toBe(false);
    expect(isSocialPlatform(null)).toBe(false);
  });

  it('validates social account statuses', () => {
    expect(isSocialAccountStatus('connecting')).toBe(true);
    expect(isSocialAccountStatus('active')).toBe(true);
    expect(isSocialAccountStatus('degraded')).toBe(true);
    expect(isSocialAccountStatus('reauth_required')).toBe(true);
    expect(isSocialAccountStatus('review_gated')).toBe(true);
    expect(isSocialAccountStatus('disconnected')).toBe(true);
    expect(isSocialAccountStatus('deleted')).toBe(false);
  });

  it('validates environments', () => {
    expect(isSocialAccountEnvironment('production')).toBe(true);
    expect(isSocialAccountEnvironment('test')).toBe(true);
    expect(isSocialAccountEnvironment('local')).toBe(true);
    expect(isSocialAccountEnvironment('staging')).toBe(false);
  });

  it('validates OAuth transaction statuses', () => {
    expect(isOAuthTransactionStatus('pending')).toBe(true);
    expect(isOAuthTransactionStatus('consumed')).toBe(true);
    expect(isOAuthTransactionStatus('expired')).toBe(true);
    expect(isOAuthTransactionStatus('failed')).toBe(true);
    expect(isOAuthTransactionStatus('unknown')).toBe(false);
  });

  it('validates OAuth callback result statuses', () => {
    expect(isOAuthCallbackResultStatus('success')).toBe(true);
    expect(isOAuthCallbackResultStatus('failed')).toBe(true);
    expect(isOAuthCallbackResultStatus('pending')).toBe(false);
  });
});

describe('Social ID parsers', () => {
  const validUuid = '018f3a2c-4e5b-7c8d-9e0f-1a2b3c4d5e6f';

  it('parses valid social account id', () => {
    expect(isSocialAccountId(validUuid)).toBe(true);
    expect(parseSocialAccountId(validUuid)).toBe(validUuid);
    expect(() => parseSocialAccountId('invalid')).toThrow(DomainValidationError);
  });

  it('parses valid oauth transaction id', () => {
    expect(isOAuthTransactionId(validUuid)).toBe(true);
    expect(parseOAuthTransactionId(validUuid)).toBe(validUuid);
    expect(() => parseOAuthTransactionId('invalid')).toThrow(DomainValidationError);
  });

  it('parses valid callback result id', () => {
    expect(isCallbackResultId(validUuid)).toBe(true);
    expect(parseCallbackResultId(validUuid)).toBe(validUuid);
    expect(() => parseCallbackResultId('invalid')).toThrow(DomainValidationError);
  });
});

describe('Social validation functions', () => {
  it('validates provider account ID', () => {
    expect(validateProviderAccountId('1234567890')).toBe('1234567890');
    expect(() => validateProviderAccountId('')).toThrow(DomainValidationError);
    expect(() => validateProviderAccountId(' leading')).toThrow(DomainValidationError);
    expect(() => validateProviderAccountId('trailing ')).toThrow(DomainValidationError);
    expect(() => validateProviderAccountId('with\nnewline')).toThrow(DomainValidationError);
    expect(() => validateProviderAccountId('a'.repeat(256))).toThrow(DomainValidationError);
  });

  it('validates display name', () => {
    expect(validateSocialDisplayName('Creator Channel')).toBe('Creator Channel');
    expect(() => validateSocialDisplayName('')).toThrow(DomainValidationError);
    expect(() => validateSocialDisplayName('   ')).toThrow(DomainValidationError);
    expect(() => validateSocialDisplayName('name\x00')).toThrow(DomainValidationError);
  });

  it('validates handle', () => {
    expect(validateSocialHandle(null)).toBeNull();
    expect(validateSocialHandle(undefined)).toBeNull();
    expect(validateSocialHandle('@creator')).toBe('@creator');
    expect(() => validateSocialHandle('')).toThrow(DomainValidationError);
    expect(() => validateSocialHandle(' @creator')).toThrow(DomainValidationError);
  });

  it('validates scopes', () => {
    expect(validateSocialScopes(['threads_basic', 'threads_content_publish'])).toEqual([
      'threads_basic',
      'threads_content_publish',
    ]);
    expect(() => validateSocialScopes('not-array')).toThrow(DomainValidationError);
    expect(() => validateSocialScopes([''])).toThrow(DomainValidationError);
    expect(() => validateSocialScopes([' scope '])).toThrow(DomainValidationError);
  });

  it('validates capabilities', () => {
    expect(validateSocialCapabilities({ canPublishText: true, canPublishMedia: false })).toEqual({
      canPublishText: true,
      canPublishMedia: false,
    });
    expect(() => validateSocialCapabilities(null)).toThrow(DomainValidationError);
    expect(() => validateSocialCapabilities({ key: 'not-boolean' as unknown as boolean })).toThrow(
      DomainValidationError,
    );
  });

  it('validates redirect URI', () => {
    expect(validateOAuthRedirectUri('http://127.0.0.1:3001/api/v1/callback')).toBe(
      'http://127.0.0.1:3001/api/v1/callback',
    );
    expect(validateOAuthRedirectUri('https://example.com/callback')).toBe(
      'https://example.com/callback',
    );
    expect(() => validateOAuthRedirectUri('ftp://example.com')).toThrow(DomainValidationError);
    expect(() => validateOAuthRedirectUri('not-a-url')).toThrow(DomainValidationError);
    expect(() => validateOAuthRedirectUri('')).toThrow(DomainValidationError);
  });

  it('validates returnTo', () => {
    expect(validateOAuthReturnTo('/')).toBe('/');
    expect(validateOAuthReturnTo('/workspaces/123')).toBe('/workspaces/123');
    expect(() => validateOAuthReturnTo('//evil.com')).toThrow(DomainValidationError);
    expect(() => validateOAuthReturnTo('https://evil.com')).toThrow(DomainValidationError);
    expect(() => validateOAuthReturnTo('')).toThrow(DomainValidationError);
    expect(() => validateOAuthReturnTo('/with\x00null')).toThrow(DomainValidationError);
  });

  it('validates state', () => {
    const validState = 'abcdefghijklmnopqrstuvwxyz0123456789_-';
    expect(validateOAuthState(validState)).toBe(validState);
    expect(() => validateOAuthState('too-short')).toThrow(DomainValidationError);
    expect(() => validateOAuthState('with spaces inside!!')).toThrow(DomainValidationError);
    expect(() => validateOAuthState('invalid+characters=')).toThrow(DomainValidationError);
  });
});
