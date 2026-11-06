import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  DomainValidationError,
  isValidUuidV7,
  normalizeAndValidateSlug,
  normalizeOptionalText,
  validateIanaTimezone,
  validateIdempotencyKey,
  validateWorkspaceName,
} from '@affiliate-content-os/domain';
import {
  createWorkspace,
  DefaultIdGenerator,
  SystemClock,
  ValidationError,
} from '@affiliate-content-os/application';
import { AuthOriginInvalidError, validateOrigin } from '../auth/origin.js';
import { requireAuthenticatedSession } from '../auth/session-auth.js';
import type { WorkspaceRouteDependencies } from './types.js';

interface RawCreateWorkspaceBody {
  readonly name?: unknown;
  readonly slug?: unknown;
  readonly timezone?: unknown;
  readonly brandVoice?: unknown;
  readonly defaultDisclosure?: unknown;
  readonly aiEnabled?: unknown;
}

interface NormalizedCreateWorkspaceCommand {
  readonly name: string;
  readonly slug: string;
  readonly timezone: string;
  readonly brandVoice: string | null;
  readonly defaultDisclosure: string | null;
  readonly aiEnabled: boolean;
}

function normalizeCreateWorkspaceInput(raw: unknown): NormalizedCreateWorkspaceCommand {
  if (typeof raw !== 'object' || raw === null) {
    throw new ValidationError('Request body must be an object');
  }

  const rawBody = raw as RawCreateWorkspaceBody;

  let name: string;
  let slug: string;
  let timezone: string;
  let brandVoice: string | null;
  let defaultDisclosure: string | null;

  try {
    name = validateWorkspaceName(rawBody.name);
    slug = normalizeAndValidateSlug(rawBody.slug);
    timezone = validateIanaTimezone(rawBody.timezone);
    brandVoice = normalizeOptionalText(rawBody.brandVoice, 'brandVoice');
    defaultDisclosure = normalizeOptionalText(rawBody.defaultDisclosure, 'defaultDisclosure');
  } catch (err) {
    if (err instanceof DomainValidationError) {
      throw new ValidationError(err.message, err.field);
    }
    throw err;
  }

  let aiEnabled: boolean;
  if (rawBody.aiEnabled === undefined || rawBody.aiEnabled === null) {
    aiEnabled = false;
  } else if (typeof rawBody.aiEnabled === 'boolean') {
    aiEnabled = rawBody.aiEnabled;
  } else {
    throw new ValidationError('Field "aiEnabled" must be a boolean or undefined', 'aiEnabled');
  }

  return {
    name,
    slug,
    timezone,
    brandVoice,
    defaultDisclosure,
    aiEnabled,
  };
}

function computeCanonicalRequestHash(cmd: NormalizedCreateWorkspaceCommand): Uint8Array {
  const canonicalObject = {
    aiEnabled: cmd.aiEnabled,
    brandVoice: cmd.brandVoice,
    defaultDisclosure: cmd.defaultDisclosure,
    name: cmd.name,
    slug: cmd.slug,
    timezone: cmd.timezone,
  };
  const canonicalJson = JSON.stringify(canonicalObject);
  return crypto.createHash('sha256').update(canonicalJson).digest();
}

export async function handleCreateWorkspace(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: WorkspaceRouteDependencies,
): Promise<void> {
  const authContext = await requireAuthenticatedSession(request, reply, deps.auth);

  const originHeader = request.headers['origin'];
  if (typeof originHeader !== 'string' || originHeader === 'null' || originHeader.trim() === '') {
    throw new AuthOriginInvalidError();
  }
  const appBaseUrl = deps.auth.appBaseUrl ?? 'http://127.0.0.1:3000';
  const redirectUri = deps.auth.config.redirectUri ?? appBaseUrl;
  validateOrigin(originHeader, appBaseUrl, redirectUri);

  const rawKey = request.headers['idempotency-key'];
  let keyHash: Uint8Array;
  try {
    const validKey = validateIdempotencyKey(rawKey);
    keyHash = crypto.createHash('sha256').update(validKey).digest();
  } catch (err) {
    if (err instanceof DomainValidationError) {
      throw new ValidationError(err.message, 'idempotencyKey');
    }
    throw err;
  }

  const cmd = normalizeCreateWorkspaceInput(request.body);
  const requestHash = computeCanonicalRequestHash(cmd);

  const rawReqId = request.headers['x-request-id'];
  const correlationId = typeof rawReqId === 'string' && isValidUuidV7(rawReqId) ? rawReqId : null;
  const rawUserAgent =
    typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null;

  const result = await createWorkspace(
    {
      userId: authContext.user.id,
      name: cmd.name,
      slug: cmd.slug,
      timezone: cmd.timezone,
      brandVoice: cmd.brandVoice,
      defaultDisclosure: cmd.defaultDisclosure,
      aiEnabled: cmd.aiEnabled,
      idempotency: { keyHash, requestHash },
      auditContext: {
        ipHash: null,
        userAgentSummary: rawUserAgent,
        correlationId,
      },
    },
    {
      userDirectory: deps.userDirectory,
      workspacePersistence: deps.workspacePersistence,
      clock: deps.clock ?? new SystemClock(),
      idGenerator: deps.idGenerator ?? new DefaultIdGenerator(),
    },
  );

  const responseBody = {
    id: result.workspace.id,
    name: result.workspace.name,
    slug: result.workspace.slug,
    timezone: result.workspace.timezone,
    brandVoice: result.workspace.brandVoice,
    defaultDisclosure: result.workspace.defaultDisclosure,
    aiEnabled: result.workspace.aiEnabled,
    status: result.workspace.status,
    role: result.membership.role,
    createdAt: result.workspace.createdAt,
    updatedAt: result.workspace.updatedAt,
    version: result.workspace.version,
  };

  return reply
    .status(201)
    .header('Location', `/api/v1/workspaces/${result.workspace.id}`)
    .type('application/json; charset=utf-8')
    .send(responseBody);
}
