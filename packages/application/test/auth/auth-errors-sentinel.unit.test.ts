import { describe, expect, it } from 'vitest';
import {
  AuthConfigurationUnavailableError,
  AuthPersistenceError,
  AuthRequestValidationError,
  AuthenticationRequiredError,
  OidcCallbackInvalidError,
  OidcProviderUnavailableError,
} from '../../src/auth/errors.js';

describe('packages/application - auth error constructors and non-disclosure', () => {
  const sentinel = 'SECRET_TOKEN_DO_NOT_LEAK_12345';

  it('enforces fixed messages on all public auth error classes', () => {
    const configErr = new AuthConfigurationUnavailableError();
    expect(configErr.message).toBe('Authentication is not configured');
    expect(configErr.code).toBe('AUTH_NOT_CONFIGURED');

    const reqErr = new AuthRequestValidationError('returnTo');
    expect(reqErr.message).toBe('Invalid authentication request');
    expect(reqErr.code).toBe('AUTH_REQUEST_INVALID');
    expect(reqErr.field).toBe('returnTo');

    const callbackErr = new OidcCallbackInvalidError();
    expect(callbackErr.message).toBe('Invalid OIDC callback');
    expect(callbackErr.code).toBe('OIDC_CALLBACK_INVALID');

    const providerErr = new OidcProviderUnavailableError();
    expect(providerErr.message).toBe('OIDC provider is unavailable');
    expect(providerErr.code).toBe('OIDC_PROVIDER_UNAVAILABLE');

    const authReqErr = new AuthenticationRequiredError();
    expect(authReqErr.message).toBe('Authentication required');
    expect(authReqErr.code).toBe('AUTHENTICATION_REQUIRED');

    const persistErr = new AuthPersistenceError('session');
    expect(persistErr.message).toBe('Authentication persistence failure');
    expect(persistErr.code).toBe('AUTH_PERSISTENCE_INVALID');
    expect(persistErr.operation).toBe('session');
  });

  it('never leaks sentinels through JSON, String, or inspection', () => {
    const errors = [
      new AuthConfigurationUnavailableError(),
      new AuthRequestValidationError('session'),
      new OidcCallbackInvalidError(),
      new OidcProviderUnavailableError(),
      new AuthenticationRequiredError(),
      new AuthPersistenceError('transaction'),
    ];

    for (const err of errors) {
      const str = String(err);
      const json = JSON.stringify(err);
      expect(str).not.toContain(sentinel);
      expect(json).not.toContain(sentinel);
      expect(err.cause).toBeUndefined();
    }
  });
});
