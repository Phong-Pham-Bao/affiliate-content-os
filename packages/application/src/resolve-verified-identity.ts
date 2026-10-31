import {
  createApplicationPrincipal,
  createAuthenticationSource,
  dateToIsoTimestamp,
  DomainValidationError,
  isUserStatus,
  isValidIsoTimestamp,
  parseUserId,
  validateIdentityClaims,
  type ApplicationPrincipal,
  type UserSnapshot,
  type VerifiedIdentityClaims,
} from '@affiliate-content-os/domain';
import {
  IdentityClaimsValidationError,
  IdentityPersistenceError,
  IdentityProvisioningRaceError,
  IdentityUnavailableError,
  ValidationError,
  type IdentityClaimField,
} from './errors.js';
import type { ClockPort, IdGeneratorPort, UserIdentityDirectoryPort } from './ports.js';

export interface ResolveVerifiedIdentityCommand {
  readonly claims: unknown;
}

export interface ResolveVerifiedIdentityDependencies {
  readonly identityDirectory: UserIdentityDirectoryPort;
  readonly clock: ClockPort;
  readonly idGenerator: IdGeneratorPort;
}

function isIdentityClaimField(field: unknown): field is IdentityClaimField {
  return (
    field === 'claims' ||
    field === 'identityProvider' ||
    field === 'identitySubject' ||
    field === 'email' ||
    field === 'displayName'
  );
}

function validateClaimsSafe(claims: unknown): VerifiedIdentityClaims {
  try {
    return validateIdentityClaims(claims);
  } catch (err) {
    if (err instanceof DomainValidationError && isIdentityClaimField(err.field)) {
      throw new IdentityClaimsValidationError(err.field, 'Invalid identity claims');
    }
    throw new IdentityClaimsValidationError('claims', 'Invalid identity claims');
  }
}

function isValidUserSnapshot(user: unknown): user is UserSnapshot {
  if (typeof user !== 'object' || user === null || !Object.isFrozen(user)) {
    return false;
  }
  const u = user as Record<string, unknown>;
  return (
    typeof u.id === 'string' &&
    typeof u.identityProvider === 'string' &&
    typeof u.identitySubject === 'string' &&
    (u.email === null || typeof u.email === 'string') &&
    (u.displayName === null || typeof u.displayName === 'string') &&
    isUserStatus(u.status) &&
    isValidIsoTimestamp(u.createdAt) &&
    isValidIsoTimestamp(u.updatedAt) &&
    typeof u.version === 'number' &&
    Number.isInteger(u.version) &&
    u.version > 0
  );
}

function validateInsertedSnapshot(
  inserted: UserSnapshot | null,
  expected: UserSnapshot,
): UserSnapshot {
  if (
    inserted === null ||
    !isValidUserSnapshot(inserted) ||
    inserted.id !== expected.id ||
    inserted.identityProvider !== expected.identityProvider ||
    inserted.identitySubject !== expected.identitySubject ||
    inserted.email !== expected.email ||
    inserted.displayName !== expected.displayName ||
    inserted.status !== 'active' ||
    inserted.version !== 1 ||
    inserted.createdAt !== expected.createdAt ||
    inserted.updatedAt !== expected.updatedAt
  ) {
    throw new IdentityPersistenceError('insert', 'Invalid inserted user snapshot');
  }
  return inserted;
}

function handleSingleUserSnapshot(
  user: UserSnapshot,
  provider: string,
  subject: string,
  op: 'lookup' | 'recovery',
): ApplicationPrincipal {
  if (
    !isValidUserSnapshot(user) ||
    user.identityProvider !== provider ||
    user.identitySubject !== subject
  ) {
    throw new IdentityPersistenceError(op, `Invalid user snapshot in ${op}`);
  }

  if (user.status === 'active') {
    return createApplicationPrincipal(user, createAuthenticationSource(provider));
  }

  if (user.status === 'disabled' || user.status === 'deletion_pending') {
    throw new IdentityUnavailableError('Identity is unavailable');
  }

  throw new IdentityPersistenceError(op, `Invalid user status in ${op}`);
}

export async function resolveVerifiedIdentity(
  command: ResolveVerifiedIdentityCommand,
  deps: ResolveVerifiedIdentityDependencies,
): Promise<ApplicationPrincipal> {
  const claims = validateClaimsSafe(command.claims);
  const { identityProvider, identitySubject } = claims;

  const users = await deps.identityDirectory.findUsersByIdentity({
    identityProvider,
    identitySubject,
  });

  if (!Array.isArray(users)) {
    throw new IdentityPersistenceError('lookup', 'Lookup must return an array');
  }

  if (users.length === 1) {
    return handleSingleUserSnapshot(users[0]!, identityProvider, identitySubject, 'lookup');
  }

  if (users.length > 1) {
    throw new IdentityPersistenceError('lookup', 'Multiple users found for identity');
  }

  // Provisioning path (0 users found)
  const now = deps.clock.now();
  if (!(now instanceof Date) || isNaN(now.getTime())) {
    throw new ValidationError('Invalid clock value', 'clock');
  }
  const nowIso = dateToIsoTimestamp(now);

  const generatedUserId = deps.idGenerator.generateUserId();
  const userId = parseUserId(generatedUserId);

  const newUser: UserSnapshot = Object.freeze({
    id: userId,
    identityProvider,
    identitySubject,
    email: claims.email ?? null,
    displayName: claims.displayName ?? null,
    status: 'active',
    createdAt: nowIso,
    updatedAt: nowIso,
    version: 1,
  });

  const inserted = await deps.identityDirectory.insertUserIfAbsent({ user: newUser });

  if (inserted !== null) {
    const verified = validateInsertedSnapshot(inserted, newUser);
    return createApplicationPrincipal(verified, createAuthenticationSource(identityProvider));
  }

  // Losing-race recovery
  const recoveryUsers = await deps.identityDirectory.findUsersByIdentity({
    identityProvider,
    identitySubject,
  });

  if (!Array.isArray(recoveryUsers)) {
    throw new IdentityPersistenceError('recovery', 'Recovery must return an array');
  }

  if (recoveryUsers.length === 0) {
    throw new IdentityProvisioningRaceError('Concurrent identity provisioning race detected');
  }

  if (recoveryUsers.length === 1) {
    return handleSingleUserSnapshot(
      recoveryUsers[0]!,
      identityProvider,
      identitySubject,
      'recovery',
    );
  }

  throw new IdentityPersistenceError('recovery', 'Multiple users found in recovery');
}
