import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  AuthConfigurationUnavailableError,
  AuthPersistenceError,
  AuthRequestValidationError,
  AuthenticationRequiredError,
  IdempotencyConflictError,
  IdempotencyKeyReusedError,
  OidcCallbackInvalidError,
  OidcProviderUnavailableError,
  SlugConflictError,
  ValidationError,
  WorkspaceAccessDeniedError,
} from '@affiliate-content-os/application';
import { AuthOriginInvalidError } from './origin.js';
import { type ProblemDetails, type ProblemSpec, PROBLEM_SPECS } from './problem-details-specs.js';
import { hasProxyInPrototype } from './proxy-detector.js';

export type { ProblemDetails, ProblemSpec } from './problem-details-specs.js';
export { PROBLEM_SPECS } from './problem-details-specs.js';

export function resolveProblemSpec(error: unknown, request?: FastifyRequest): ProblemSpec {
  if (typeof error !== 'object' || error === null) {
    return PROBLEM_SPECS['INTERNAL_ERROR']!;
  }

  if (hasProxyInPrototype(error)) {
    return PROBLEM_SPECS['INTERNAL_ERROR']!;
  }

  try {
    if (error instanceof AuthConfigurationUnavailableError) {
      return PROBLEM_SPECS['AUTH_NOT_CONFIGURED']!;
    }
    if (error instanceof AuthRequestValidationError) {
      return PROBLEM_SPECS['AUTH_REQUEST_INVALID']!;
    }
    if (error instanceof OidcCallbackInvalidError) {
      return PROBLEM_SPECS['OIDC_CALLBACK_INVALID']!;
    }
    if (error instanceof OidcProviderUnavailableError) {
      return PROBLEM_SPECS['OIDC_PROVIDER_UNAVAILABLE']!;
    }
    if (error instanceof AuthenticationRequiredError) {
      return PROBLEM_SPECS['AUTHENTICATION_REQUIRED']!;
    }
    if (error instanceof SlugConflictError) {
      return PROBLEM_SPECS['SLUG_CONFLICT']!;
    }
    if (error instanceof IdempotencyKeyReusedError) {
      return PROBLEM_SPECS['IDEMPOTENCY_KEY_REUSED']!;
    }
    if (error instanceof IdempotencyConflictError) {
      return PROBLEM_SPECS['IDEMPOTENCY_CONFLICT']!;
    }
    if (error instanceof WorkspaceAccessDeniedError) {
      return PROBLEM_SPECS['WORKSPACE_NOT_FOUND']!;
    }
    if (error instanceof ValidationError) {
      return PROBLEM_SPECS['VALIDATION_ERROR']!;
    }
    if (error instanceof AuthOriginInvalidError) {
      return PROBLEM_SPECS['AUTH_ORIGIN_INVALID']!;
    }
    if (error instanceof AuthPersistenceError) {
      return PROBLEM_SPECS['INTERNAL_ERROR']!;
    }

    let maybeCode: string | undefined;
    let maybeStatus: number | undefined;

    const codeDesc = Object.getOwnPropertyDescriptor(error, 'code');
    if (
      codeDesc &&
      codeDesc.get === undefined &&
      codeDesc.set === undefined &&
      typeof codeDesc.value === 'string'
    ) {
      maybeCode = codeDesc.value;
    }

    const statusDesc = Object.getOwnPropertyDescriptor(error, 'statusCode');
    if (
      statusDesc &&
      statusDesc.get === undefined &&
      statusDesc.set === undefined &&
      typeof statusDesc.value === 'number'
    ) {
      maybeStatus = statusDesc.value;
    }

    if (maybeStatus === 429 || maybeCode === 'FST_ERR_RATE_LIMIT') {
      return PROBLEM_SPECS['RATE_LIMIT_EXCEEDED']!;
    }
    if (maybeStatus === 400 || maybeCode === 'FST_ERR_VALIDATION') {
      const url = request?.raw?.url ?? request?.url ?? '';
      const isAuth =
        url === '' || url.startsWith('/auth/') || url === '/api/v1/logout' || url === '/api/v1/me';
      return isAuth ? PROBLEM_SPECS['AUTH_REQUEST_INVALID']! : PROBLEM_SPECS['VALIDATION_ERROR']!;
    }
  } catch {
    return PROBLEM_SPECS['INTERNAL_ERROR']!;
  }

  return PROBLEM_SPECS['INTERNAL_ERROR']!;
}

function extractRequestMeta(request: FastifyRequest): {
  instance: string;
  requestId: string;
} {
  const instance = (request.raw?.url ?? request.url ?? '/').split('?')[0] || '/';
  const rawId = request.headers['x-request-id'];
  const requestId =
    typeof rawId === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(rawId)
      ? rawId
      : String(request.id ?? 'unknown');
  return { instance, requestId };
}

export function buildProblemDetails(
  request: FastifyRequest,
  spec: ProblemSpec,
  retryAfterSeconds?: number,
): ProblemDetails {
  const { instance, requestId } = extractRequestMeta(request);

  const result: ProblemDetails = {
    type: spec.type,
    title: spec.title,
    status: spec.status,
    code: spec.code,
    detail: spec.detail,
    instance,
    requestId,
    ...(spec.status === 429 && retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
  };

  return Object.freeze(result);
}

export function sendProblemResponse(
  reply: FastifyReply,
  request: FastifyRequest,
  error: unknown,
): void {
  const spec = resolveProblemSpec(error, request);
  let retryAfterSeconds: number | undefined;

  if (spec.status === 429) {
    const retryHeader = reply.getHeader('retry-after');
    if (retryHeader) {
      const parsed = parseInt(String(retryHeader), 10);
      if (!Number.isNaN(parsed) && parsed >= 0) {
        retryAfterSeconds = parsed;
      }
    }
    if (retryAfterSeconds === undefined) {
      retryAfterSeconds = 60;
    }
  }

  const { instance, requestId } = extractRequestMeta(request);

  if (spec.status === 500) {
    console.error(
      JSON.stringify({
        requestId,
        code: spec.code,
        method: request.method,
        url: instance,
        status: spec.status,
      }),
    );
  }

  const problem = buildProblemDetails(request, spec, retryAfterSeconds);
  void reply.status(spec.status).type('application/problem+json; charset=utf-8').send(problem);
}
