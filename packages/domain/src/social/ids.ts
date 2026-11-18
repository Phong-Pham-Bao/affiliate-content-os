import { isValidUuidV7 } from '../ids.js';
import { DomainValidationError } from '../errors.js';

declare const SocialAccountIdBrand: unique symbol;
export type SocialAccountId = string & {
  readonly [SocialAccountIdBrand]: typeof SocialAccountIdBrand;
};

declare const OAuthTransactionIdBrand: unique symbol;
export type OAuthTransactionId = string & {
  readonly [OAuthTransactionIdBrand]: typeof OAuthTransactionIdBrand;
};

declare const CallbackResultIdBrand: unique symbol;
export type CallbackResultId = string & {
  readonly [CallbackResultIdBrand]: typeof CallbackResultIdBrand;
};

export function isSocialAccountId(value: unknown): value is SocialAccountId {
  return typeof value === 'string' && isValidUuidV7(value);
}

export function parseSocialAccountId(value: unknown): SocialAccountId {
  if (!isSocialAccountId(value)) {
    throw new DomainValidationError('Invalid socialAccountId: must be a valid UUIDv7 string');
  }
  return value;
}

export function isOAuthTransactionId(value: unknown): value is OAuthTransactionId {
  return typeof value === 'string' && isValidUuidV7(value);
}

export function parseOAuthTransactionId(value: unknown): OAuthTransactionId {
  if (!isOAuthTransactionId(value)) {
    throw new DomainValidationError('Invalid transactionId: must be a valid UUIDv7 string');
  }
  return value;
}

export function isCallbackResultId(value: unknown): value is CallbackResultId {
  return typeof value === 'string' && isValidUuidV7(value);
}

export function parseCallbackResultId(value: unknown): CallbackResultId {
  if (!isCallbackResultId(value)) {
    throw new DomainValidationError('Invalid callbackResultId: must be a valid UUIDv7 string');
  }
  return value;
}
