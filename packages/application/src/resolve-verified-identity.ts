import util from 'node:util';
import {
  createApplicationPrincipal,
  createAuthenticationSource,
  DomainValidationError,
  isUserStatus,
  isValidIsoTimestamp,
  isValidUuidV7,
  parseUserId,
  validateIdentityClaims,
  type ApplicationPrincipal,
  type IsoTimestamp,
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

function isProxySafe(value: unknown): boolean {
  try {
    return util.types.isProxy(value);
  } catch {
    return true;
  }
}

interface ValidatedArray {
  readonly length: number;
  readonly getSnapshot: (index: number) => unknown;
}

function validatePersistenceArray(result: unknown, op: 'lookup' | 'recovery'): ValidatedArray {
  try {
    if (typeof result !== 'object' || result === null || isProxySafe(result)) {
      throw new IdentityPersistenceError(op);
    }

    if (Object.getPrototypeOf(result) !== Array.prototype) {
      throw new IdentityPersistenceError(op);
    }

    const lengthDesc = Object.getOwnPropertyDescriptor(result, 'length');
    if (
      !lengthDesc ||
      lengthDesc.get !== undefined ||
      lengthDesc.set !== undefined ||
      typeof lengthDesc.value !== 'number' ||
      !Number.isSafeInteger(lengthDesc.value) ||
      lengthDesc.value < 0
    ) {
      throw new IdentityPersistenceError(op);
    }

    const len = lengthDesc.value;
    const ownKeys = Reflect.ownKeys(result);
    if (ownKeys.length !== len + 1) {
      throw new IdentityPersistenceError(op);
    }

    if (len > 1) {
      throw new IdentityPersistenceError(op);
    }

    const capturedItems: unknown[] = [];
    for (let i = 0; i < len; i++) {
      const desc = Object.getOwnPropertyDescriptor(result, String(i));
      if (!desc || desc.get !== undefined || desc.set !== undefined) {
        throw new IdentityPersistenceError(op);
      }
      capturedItems.push(desc.value);
    }

    return {
      length: len,
      getSnapshot: (index: number) => capturedItems[index],
    };
  } catch {
    throw new IdentityPersistenceError(op);
  }
}

const REQUIRED_SNAPSHOT_KEYS = [
  'id',
  'identityProvider',
  'identitySubject',
  'email',
  'displayName',
  'status',
  'createdAt',
  'updatedAt',
  'version',
] as const;

function validateAndCreateCanonicalSnapshot(
  snapshot: unknown,
  op: 'lookup' | 'insert' | 'recovery',
  expected: {
    readonly provider: string;
    readonly subject: string;
    readonly insertUser?: UserSnapshot;
  },
): UserSnapshot {
  try {
    if (typeof snapshot !== 'object' || snapshot === null || isProxySafe(snapshot)) {
      throw new IdentityPersistenceError(op);
    }

    const proto = Object.getPrototypeOf(snapshot);
    if (proto !== Object.prototype && proto !== null) {
      throw new IdentityPersistenceError(op);
    }

    if (!Object.isFrozen(snapshot)) {
      throw new IdentityPersistenceError(op);
    }

    const ownKeys = Reflect.ownKeys(snapshot);
    if (ownKeys.length !== REQUIRED_SNAPSHOT_KEYS.length) {
      throw new IdentityPersistenceError(op);
    }

    let idVal: unknown;
    let provVal: unknown;
    let subVal: unknown;
    let emailVal: unknown;
    let displayNameVal: unknown;
    let statusVal: unknown;
    let createdAtVal: unknown;
    let updatedAtVal: unknown;
    let versionVal: unknown;

    for (const key of REQUIRED_SNAPSHOT_KEYS) {
      const desc = Object.getOwnPropertyDescriptor(snapshot, key);
      if (!desc || desc.get !== undefined || desc.set !== undefined) {
        throw new IdentityPersistenceError(op);
      }
      switch (key) {
        case 'id':
          idVal = desc.value;
          break;
        case 'identityProvider':
          provVal = desc.value;
          break;
        case 'identitySubject':
          subVal = desc.value;
          break;
        case 'email':
          emailVal = desc.value;
          break;
        case 'displayName':
          displayNameVal = desc.value;
          break;
        case 'status':
          statusVal = desc.value;
          break;
        case 'createdAt':
          createdAtVal = desc.value;
          break;
        case 'updatedAt':
          updatedAtVal = desc.value;
          break;
        case 'version':
          versionVal = desc.value;
          break;
      }
    }

    if (typeof idVal !== 'string' || !isValidUuidV7(idVal)) {
      throw new IdentityPersistenceError(op);
    }
    const id = parseUserId(idVal);

    if (
      typeof provVal !== 'string' ||
      provVal.length === 0 ||
      provVal.trim() !== provVal ||
      provVal !== expected.provider
    ) {
      throw new IdentityPersistenceError(op);
    }

    if (
      typeof subVal !== 'string' ||
      subVal.length === 0 ||
      subVal.trim() !== subVal ||
      subVal !== expected.subject
    ) {
      throw new IdentityPersistenceError(op);
    }

    if (emailVal !== null && typeof emailVal !== 'string') {
      throw new IdentityPersistenceError(op);
    }

    if (displayNameVal !== null && typeof displayNameVal !== 'string') {
      throw new IdentityPersistenceError(op);
    }

    if (typeof statusVal !== 'string' || !isUserStatus(statusVal)) {
      throw new IdentityPersistenceError(op);
    }

    if (typeof createdAtVal !== 'string' || !isValidIsoTimestamp(createdAtVal)) {
      throw new IdentityPersistenceError(op);
    }

    if (typeof updatedAtVal !== 'string' || !isValidIsoTimestamp(updatedAtVal)) {
      throw new IdentityPersistenceError(op);
    }

    if (typeof versionVal !== 'number' || !Number.isSafeInteger(versionVal) || versionVal < 1) {
      throw new IdentityPersistenceError(op);
    }

    if (op === 'insert') {
      const exp = expected.insertUser;
      if (!exp) {
        throw new IdentityPersistenceError('insert');
      }
      if (
        id !== exp.id ||
        provVal !== exp.identityProvider ||
        subVal !== exp.identitySubject ||
        emailVal !== exp.email ||
        displayNameVal !== exp.displayName ||
        statusVal !== 'active' ||
        versionVal !== 1 ||
        createdAtVal !== exp.createdAt ||
        updatedAtVal !== exp.updatedAt
      ) {
        throw new IdentityPersistenceError('insert');
      }
    }

    return Object.freeze({
      id,
      identityProvider: provVal,
      identitySubject: subVal,
      email: emailVal,
      displayName: displayNameVal,
      status: statusVal,
      createdAt: createdAtVal,
      updatedAt: updatedAtVal,
      version: versionVal,
    });
  } catch {
    throw new IdentityPersistenceError(op);
  }
}

function getSafeClockTimestamp(clock: ClockPort): IsoTimestamp {
  try {
    const raw: unknown = clock.now();
    if (typeof raw !== 'object' || raw === null || isProxySafe(raw)) {
      throw new ValidationError('Invalid clock value', 'clock');
    }
    if (Object.getPrototypeOf(raw) !== Date.prototype) {
      throw new ValidationError('Invalid clock value', 'clock');
    }
    if (Reflect.ownKeys(raw).length !== 0) {
      throw new ValidationError('Invalid clock value', 'clock');
    }
    const epoch = Date.prototype.getTime.call(raw);
    if (typeof epoch !== 'number' || !Number.isFinite(epoch)) {
      throw new ValidationError('Invalid clock value', 'clock');
    }
    const freshDate = new Date(epoch);
    const isoString = Date.prototype.toISOString.call(freshDate);
    if (!isValidIsoTimestamp(isoString)) {
      throw new ValidationError('Invalid clock value', 'clock');
    }
    return isoString;
  } catch {
    throw new ValidationError('Invalid clock value', 'clock');
  }
}

function handleSingleUserSnapshot(
  snapshot: UserSnapshot,
  provider: string,
  op: 'lookup' | 'recovery',
): ApplicationPrincipal {
  if (snapshot.status === 'active') {
    return createApplicationPrincipal(snapshot, createAuthenticationSource(provider));
  }

  if (snapshot.status === 'disabled' || snapshot.status === 'deletion_pending') {
    throw new IdentityUnavailableError();
  }

  throw new IdentityPersistenceError(op);
}

export async function resolveVerifiedIdentity(
  command: ResolveVerifiedIdentityCommand,
  deps: ResolveVerifiedIdentityDependencies,
): Promise<ApplicationPrincipal> {
  const claims = validateClaimsSafe(command.claims);
  const { identityProvider, identitySubject } = claims;

  const usersResult = await deps.identityDirectory.findUsersByIdentity({
    identityProvider,
    identitySubject,
  });

  const lookupArray = validatePersistenceArray(usersResult, 'lookup');

  if (lookupArray.length === 1) {
    const canonicalSnapshot = validateAndCreateCanonicalSnapshot(
      lookupArray.getSnapshot(0),
      'lookup',
      {
        provider: identityProvider,
        subject: identitySubject,
      },
    );
    return handleSingleUserSnapshot(canonicalSnapshot, identityProvider, 'lookup');
  }

  // Provisioning path (0 users found)
  const nowIso = getSafeClockTimestamp(deps.clock);

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
    const canonicalInserted = validateAndCreateCanonicalSnapshot(inserted, 'insert', {
      provider: identityProvider,
      subject: identitySubject,
      insertUser: newUser,
    });
    return createApplicationPrincipal(
      canonicalInserted,
      createAuthenticationSource(identityProvider),
    );
  }

  // Losing-race recovery
  const recoveryResult = await deps.identityDirectory.findUsersByIdentity({
    identityProvider,
    identitySubject,
  });

  const recoveryArray = validatePersistenceArray(recoveryResult, 'recovery');
  if (recoveryArray.length === 0) {
    throw new IdentityProvisioningRaceError();
  }

  const canonicalRecovered = validateAndCreateCanonicalSnapshot(
    recoveryArray.getSnapshot(0),
    'recovery',
    {
      provider: identityProvider,
      subject: identitySubject,
    },
  );

  return handleSingleUserSnapshot(canonicalRecovered, identityProvider, 'recovery');
}
