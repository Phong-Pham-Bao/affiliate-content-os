import { DomainValidationError } from './errors.js';
import type { UserSnapshot } from './types.js';

export interface VerifiedIdentityClaims {
  readonly identityProvider: string;
  readonly identitySubject: string;
  readonly email?: string | null | undefined;
  readonly displayName?: string | null | undefined;
}

export interface AuthenticationSource {
  readonly kind: 'verified_oidc';
  readonly identityProvider: string;
}

export interface ApplicationPrincipal {
  readonly user: UserSnapshot;
  readonly authenticationSource: AuthenticationSource;
}

export function createAuthenticationSource(identityProvider: string): AuthenticationSource {
  return Object.freeze({
    kind: 'verified_oidc',
    identityProvider,
  });
}

export function createApplicationPrincipal(
  user: UserSnapshot,
  authenticationSource: AuthenticationSource,
): ApplicationPrincipal {
  return Object.freeze({
    user,
    authenticationSource,
  });
}

const ALLOWED_OWN_KEYS: ReadonlySet<string> = new Set([
  'identityProvider',
  'identitySubject',
  'email',
  'displayName',
]);

function inspectClaimsObject(claims: unknown): (string | symbol)[] {
  if (typeof claims !== 'object' || claims === null || Array.isArray(claims)) {
    throw new DomainValidationError('Claims must be a non-null plain object', 'claims');
  }

  let proto: object | null;
  try {
    proto = Object.getPrototypeOf(claims);
  } catch {
    throw new DomainValidationError('Claims prototype inspection failed', 'claims');
  }

  if (proto !== Object.prototype && proto !== null) {
    throw new DomainValidationError(
      'Claims object must have Object.prototype or null prototype',
      'claims',
    );
  }

  let ownKeys: (string | symbol)[];
  try {
    ownKeys = Reflect.ownKeys(claims);
  } catch {
    throw new DomainValidationError('Claims property inspection failed', 'claims');
  }

  return ownKeys;
}

function validateExactKeys(ownKeys: readonly (string | symbol)[]): void {
  for (const key of ownKeys) {
    if (typeof key !== 'string' || !ALLOWED_OWN_KEYS.has(key)) {
      throw new DomainValidationError('Claims object contains unexpected own keys', 'claims');
    }
  }

  if (!ownKeys.includes('identityProvider') || !ownKeys.includes('identitySubject')) {
    throw new DomainValidationError(
      'Claims object is missing required identityProvider or identitySubject',
      'claims',
    );
  }
}

function getDataDescriptor(
  obj: object,
  key: string,
  field: 'claims' | 'identityProvider' | 'identitySubject' | 'email' | 'displayName',
): PropertyDescriptor {
  let desc: PropertyDescriptor | undefined;
  try {
    desc = Object.getOwnPropertyDescriptor(obj, key);
  } catch {
    throw new DomainValidationError('Failed to inspect property descriptor', field);
  }

  if (!desc) {
    throw new DomainValidationError('Missing expected property descriptor', field);
  }

  if (desc.get !== undefined || desc.set !== undefined) {
    throw new DomainValidationError('Accessor properties are prohibited', field);
  }

  return desc;
}

function validateRequiredIdentityString(
  val: unknown,
  field: 'identityProvider' | 'identitySubject',
): string {
  if (typeof val !== 'string') {
    throw new DomainValidationError(`${field} must be a string`, field);
  }

  if (val.length === 0) {
    throw new DomainValidationError(`${field} cannot be empty`, field);
  }

  if (val.trim() !== val) {
    throw new DomainValidationError(
      `${field} must not contain leading or trailing whitespace`,
      field,
    );
  }

  return val;
}

function normalizeOptionalMetadata(val: unknown, field: 'email' | 'displayName'): string | null {
  if (val === undefined || val === null) {
    return null;
  }

  if (typeof val !== 'string') {
    throw new DomainValidationError(`${field} must be a string, null, or undefined`, field);
  }

  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function validateIdentityClaims(rawClaims: unknown): VerifiedIdentityClaims {
  const ownKeys = inspectClaimsObject(rawClaims);
  validateExactKeys(ownKeys);

  const claimsObj = rawClaims as Record<string, unknown>;

  const providerDesc = getDataDescriptor(claimsObj, 'identityProvider', 'identityProvider');
  const provider = validateRequiredIdentityString(providerDesc.value, 'identityProvider');

  const subjectDesc = getDataDescriptor(claimsObj, 'identitySubject', 'identitySubject');
  const subject = validateRequiredIdentityString(subjectDesc.value, 'identitySubject');

  let email: string | null = null;
  if (ownKeys.includes('email')) {
    const emailDesc = getDataDescriptor(claimsObj, 'email', 'email');
    email = normalizeOptionalMetadata(emailDesc.value, 'email');
  }

  let displayName: string | null = null;
  if (ownKeys.includes('displayName')) {
    const displayDesc = getDataDescriptor(claimsObj, 'displayName', 'displayName');
    displayName = normalizeOptionalMetadata(displayDesc.value, 'displayName');
  }

  return Object.freeze({
    identityProvider: provider,
    identitySubject: subject,
    email,
    displayName,
  });
}
