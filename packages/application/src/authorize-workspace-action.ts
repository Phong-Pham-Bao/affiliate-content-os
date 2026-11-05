import util from 'node:util';
import {
  canWorkspaceRole,
  isMembershipStatus,
  isWorkspaceCapability,
  isWorkspaceRole,
  isValidIsoTimestamp,
  isValidUuidV7,
  parseMembershipId,
  parseUserId,
  parseWorkspaceId,
  type MembershipId,
  type UserId,
  type WorkspaceCapability,
  type WorkspaceId,
  type WorkspaceRole,
} from '@affiliate-content-os/domain';
import {
  WorkspaceAccessDeniedError,
  WorkspaceAuthorizationInputError,
  WorkspaceAuthorizationPersistenceError,
} from './errors.js';
import type { WorkspaceAuthorizationPort } from './ports.js';

export interface AuthorizeWorkspaceActionInput {
  readonly workspaceId: string;
  readonly userId: string;
  readonly capability: WorkspaceCapability;
}

export interface WorkspaceAuthorizationContext {
  readonly workspaceId: WorkspaceId;
  readonly userId: UserId;
  readonly membershipId: MembershipId;
  readonly role: WorkspaceRole;
  readonly capability: WorkspaceCapability;
}

function isProxySafe(value: unknown): boolean {
  try {
    return util.types.isProxy(value);
  } catch {
    return true;
  }
}

const ALLOWED_INPUT_KEYS = ['workspaceId', 'userId', 'capability'] as const;
const REQUIRED_KEYS_HEAD = ['id', 'workspaceId', 'userId', 'role', 'status'] as const;
const REQUIRED_KEYS_TAIL = [
  'invitedByUserId',
  'joinedAt',
  'createdAt',
  'updatedAt',
  'version',
] as const;
const REQUIRED_MEMBERSHIP_KEYS = [...REQUIRED_KEYS_HEAD, ...REQUIRED_KEYS_TAIL] as const;
type MembershipKey = (typeof REQUIRED_MEMBERSHIP_KEYS)[number];

function validateInput(input: unknown) {
  if (typeof input !== 'object' || input === null || isProxySafe(input) || Array.isArray(input)) {
    throw new WorkspaceAuthorizationInputError();
  }
  const proto = Object.getPrototypeOf(input);
  if (proto !== Object.prototype && proto !== null) throw new WorkspaceAuthorizationInputError();
  if (Reflect.ownKeys(input).length !== ALLOWED_INPUT_KEYS.length) {
    throw new WorkspaceAuthorizationInputError();
  }
  for (const key of ALLOWED_INPUT_KEYS) {
    const desc = Object.getOwnPropertyDescriptor(input, key);
    if (!desc?.enumerable || desc.get !== undefined || desc.set !== undefined) {
      throw new WorkspaceAuthorizationInputError();
    }
  }
  const ws = Object.getOwnPropertyDescriptor(input, 'workspaceId')!.value;
  const user = Object.getOwnPropertyDescriptor(input, 'userId')!.value;
  const cap = Object.getOwnPropertyDescriptor(input, 'capability')!.value;

  if (typeof ws !== 'string' || !isValidUuidV7(ws)) throw new WorkspaceAuthorizationInputError();
  if (typeof user !== 'string' || !isValidUuidV7(user))
    throw new WorkspaceAuthorizationInputError();
  if (typeof cap !== 'string' || !isWorkspaceCapability(cap)) {
    throw new WorkspaceAuthorizationInputError();
  }
  return {
    workspaceId: parseWorkspaceId(ws),
    userId: parseUserId(user),
    capability: cap,
    rawWorkspaceId: ws,
    rawUserId: user,
  };
}

function validateAndAuthorizeMembership(
  rawMembership: unknown,
  rawWorkspaceId: string,
  rawUserId: string,
  capability: WorkspaceCapability,
): WorkspaceAuthorizationContext {
  if (rawMembership === null) throw new WorkspaceAccessDeniedError();
  if (
    typeof rawMembership !== 'object' ||
    isProxySafe(rawMembership) ||
    Array.isArray(rawMembership)
  ) {
    throw new WorkspaceAuthorizationPersistenceError();
  }
  const proto = Object.getPrototypeOf(rawMembership);
  if (proto !== Object.prototype && proto !== null)
    throw new WorkspaceAuthorizationPersistenceError();
  if (Reflect.ownKeys(rawMembership).length !== REQUIRED_MEMBERSHIP_KEYS.length) {
    throw new WorkspaceAuthorizationPersistenceError();
  }

  const v: Partial<Record<MembershipKey, unknown>> = {};
  for (const key of REQUIRED_MEMBERSHIP_KEYS) {
    const desc = Object.getOwnPropertyDescriptor(rawMembership, key);
    if (!desc?.enumerable || desc.get !== undefined || desc.set !== undefined) {
      throw new WorkspaceAuthorizationPersistenceError();
    }
    v[key] = desc.value;
  }
  const m = v as Record<MembershipKey, unknown>;
  if (typeof m.id !== 'string' || !isValidUuidV7(m.id)) {
    throw new WorkspaceAuthorizationPersistenceError();
  }
  const inv = m.invitedByUserId;
  if (inv !== null && (typeof inv !== 'string' || !isValidUuidV7(inv))) {
    throw new WorkspaceAuthorizationPersistenceError();
  }
  if (!isWorkspaceRole(m.role) || !isMembershipStatus(m.status)) {
    throw new WorkspaceAuthorizationPersistenceError();
  }
  if (m.status !== 'active') throw new WorkspaceAccessDeniedError();

  if (!isValidIsoTimestamp(m.createdAt) || !isValidIsoTimestamp(m.updatedAt)) {
    throw new WorkspaceAuthorizationPersistenceError();
  }
  const createdMs = Date.parse(m.createdAt);
  const updatedMs = Date.parse(m.updatedAt);
  if (createdMs > updatedMs) throw new WorkspaceAuthorizationPersistenceError();

  if (m.joinedAt !== null) {
    if (!isValidIsoTimestamp(m.joinedAt)) throw new WorkspaceAuthorizationPersistenceError();
    const joinedMs = Date.parse(m.joinedAt);
    if (joinedMs < createdMs || joinedMs > updatedMs)
      throw new WorkspaceAuthorizationPersistenceError();
  }

  if (typeof m.version !== 'number' || !Number.isSafeInteger(m.version) || m.version < 1) {
    throw new WorkspaceAuthorizationPersistenceError();
  }
  const wsValid = typeof m.workspaceId === 'string' && isValidUuidV7(m.workspaceId);
  const userValid = typeof m.userId === 'string' && isValidUuidV7(m.userId);
  if (!wsValid || !userValid) throw new WorkspaceAuthorizationPersistenceError();
  if (m.workspaceId !== rawWorkspaceId || m.userId !== rawUserId) {
    throw new WorkspaceAccessDeniedError();
  }
  if (!canWorkspaceRole(m.role, capability)) throw new WorkspaceAccessDeniedError();

  return Object.freeze({
    workspaceId: parseWorkspaceId(m.workspaceId),
    userId: parseUserId(m.userId),
    membershipId: parseMembershipId(m.id),
    role: m.role,
    capability,
  });
}

export async function authorizeWorkspaceAction(
  input: AuthorizeWorkspaceActionInput,
  deps: { readonly authorization: WorkspaceAuthorizationPort },
): Promise<WorkspaceAuthorizationContext> {
  const validated = validateInput(input);
  let rawMembership: unknown;
  try {
    rawMembership = await deps.authorization.findMembership({
      workspaceId: validated.workspaceId,
      userId: validated.userId,
    });
  } catch {
    throw new WorkspaceAuthorizationPersistenceError();
  }

  try {
    return validateAndAuthorizeMembership(
      rawMembership,
      validated.rawWorkspaceId,
      validated.rawUserId,
      validated.capability,
    );
  } catch (err) {
    const isExpected =
      err instanceof WorkspaceAccessDeniedError ||
      err instanceof WorkspaceAuthorizationPersistenceError;
    throw isExpected ? err : new WorkspaceAuthorizationPersistenceError();
  }
}
