import {
  dateToIsoTimestamp,
  DomainValidationError,
  normalizeAndValidateSlug,
  normalizeOptionalText,
  parseUserId,
  validateIanaTimezone,
  validateWorkspaceName,
  type UserId,
  type WorkspaceMembershipSnapshot,
  type WorkspaceSnapshot,
} from '@affiliate-content-os/domain';
import { InactiveUserError, UserNotFoundError, ValidationError } from './errors.js';
import type {
  ClockPort,
  CreateWorkspaceResult,
  IdGeneratorPort,
  UserDirectoryPort,
  WorkspacePersistencePort,
} from './ports.js';
import {
  buildWorkspaceAuditEvent,
  buildWorkspaceIdempotencyRecord,
  validateIdempotencyInput,
  type CreateWorkspaceAuditContext,
  type CreateWorkspaceIdempotencyInput,
} from './create-workspace-helpers.js';

export type { CreateWorkspaceAuditContext, CreateWorkspaceIdempotencyInput };

export interface CreateWorkspaceCommand {
  readonly userId: UserId;
  readonly name: string;
  readonly slug: string;
  readonly timezone: string;
  readonly brandVoice?: string | null | undefined;
  readonly defaultDisclosure?: string | null | undefined;
  readonly aiEnabled?: boolean | undefined;
  readonly idempotency: CreateWorkspaceIdempotencyInput;
  readonly auditContext?: CreateWorkspaceAuditContext | undefined;
}

export interface CreateWorkspaceDependencies {
  readonly userDirectory: UserDirectoryPort;
  readonly workspacePersistence: WorkspacePersistencePort;
  readonly clock: ClockPort;
  readonly idGenerator: IdGeneratorPort;
}

export async function createWorkspace(
  command: CreateWorkspaceCommand,
  deps: CreateWorkspaceDependencies,
): Promise<CreateWorkspaceResult> {
  let validUserId: UserId;
  let validName: string;
  let normalizedSlug: string;
  let validTimezone: string;
  let brandVoice: string | null;
  let defaultDisclosure: string | null;

  try {
    validUserId = parseUserId(command.userId);
    validName = validateWorkspaceName(command.name);
    normalizedSlug = normalizeAndValidateSlug(command.slug);
    validTimezone = validateIanaTimezone(command.timezone);
    brandVoice = normalizeOptionalText(command.brandVoice, 'brandVoice');
    defaultDisclosure = normalizeOptionalText(command.defaultDisclosure, 'defaultDisclosure');
  } catch (err) {
    if (err instanceof DomainValidationError) {
      throw new ValidationError(err.message, err.field);
    }
    throw err;
  }

  const idempotencyInput = validateIdempotencyInput(command.idempotency);

  let aiEnabled: boolean;
  if (command.aiEnabled === undefined) {
    aiEnabled = false;
  } else if (typeof command.aiEnabled === 'boolean') {
    aiEnabled = command.aiEnabled;
  } else {
    throw new ValidationError('Field "aiEnabled" must be a boolean or undefined', 'aiEnabled');
  }

  const initiatingUser = await deps.userDirectory.findUserById(validUserId);
  if (!initiatingUser) {
    throw new UserNotFoundError(validUserId);
  }
  if (initiatingUser.status !== 'active') {
    throw new InactiveUserError(validUserId, initiatingUser.status);
  }

  const clockDate = deps.clock.now();
  if (!(clockDate instanceof Date) || Number.isNaN(clockDate.getTime())) {
    throw new ValidationError('Clock returned an invalid Date', 'clock');
  }
  const now = dateToIsoTimestamp(clockDate);

  const workspaceId = deps.idGenerator.generateWorkspaceId();
  const membershipId = deps.idGenerator.generateMembershipId();

  const workspace: WorkspaceSnapshot = Object.freeze({
    id: workspaceId,
    name: validName,
    slug: normalizedSlug,
    timezone: validTimezone,
    brandVoice,
    defaultDisclosure,
    aiEnabled,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    version: 1,
  });

  const membership: WorkspaceMembershipSnapshot = Object.freeze({
    id: membershipId,
    workspaceId,
    userId: validUserId,
    role: 'owner',
    status: 'active',
    invitedByUserId: null,
    joinedAt: now,
    createdAt: now,
    updatedAt: now,
    version: 1,
  });

  const auditEvent = buildWorkspaceAuditEvent({
    workspace,
    userId: validUserId,
    now,
    idGenerator: deps.idGenerator,
    auditContext: command.auditContext,
  });

  const idempotencyRecord = buildWorkspaceIdempotencyRecord({
    workspace,
    userId: validUserId,
    now,
    clockDate,
    idGenerator: deps.idGenerator,
    idempotency: idempotencyInput,
  });

  const result = await deps.workspacePersistence.createWorkspaceWithOwner({
    workspace,
    membership,
    idempotencyRecord,
    auditEvent,
  });

  return Object.freeze({
    workspace: Object.freeze(result.workspace),
    membership: Object.freeze(result.membership),
    idempotencyRecord: Object.freeze(result.idempotencyRecord),
    auditEvent: result.auditEvent ? Object.freeze(result.auditEvent) : null,
    cached: result.cached ?? false,
  });
}
