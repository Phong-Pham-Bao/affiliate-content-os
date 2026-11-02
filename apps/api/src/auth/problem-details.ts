import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  AuthConfigurationUnavailableError,
  AuthRequestValidationError,
  OidcCallbackInvalidError,
  OidcProviderUnavailableError,
  AuthenticationRequiredError,
  AuthPersistenceError,
} from '@affiliate-content-os/application';
import { AuthOriginInvalidError } from './origin.js';

export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: string;
  readonly detail: string;
  readonly instance: string;
  readonly requestId: string;
  readonly retryAfterSeconds?: number;
}

export interface ProblemSpec {
  readonly status: number;
  readonly code: string;
  readonly type: string;
  readonly title: string;
  readonly detail: string;
}

const PROBLEM_SPECS: Record<string, ProblemSpec> = {
  AUTH_NOT_CONFIGURED: {
    status: 503,
    code: 'AUTH_NOT_CONFIGURED',
    type: 'https://affiliate-content-os.example/problems/auth-not-configured',
    title: 'Service Unavailable',
    detail: 'Authentication is not configured or unavailable.',
  },
  AUTH_REQUEST_INVALID: {
    status: 400,
    code: 'AUTH_REQUEST_INVALID',
    type: 'https://affiliate-content-os.example/problems/auth-request-invalid',
    title: 'Bad Request',
    detail: 'Invalid authentication request parameters.',
  },
  OIDC_CALLBACK_INVALID: {
    status: 400,
    code: 'OIDC_CALLBACK_INVALID',
    type: 'https://affiliate-content-os.example/problems/oidc-callback-invalid',
    title: 'Bad Request',
    detail: 'Invalid authentication callback.',
  },
  OIDC_PROVIDER_UNAVAILABLE: {
    status: 503,
    code: 'OIDC_PROVIDER_UNAVAILABLE',
    type: 'https://affiliate-content-os.example/problems/oidc-provider-unavailable',
    title: 'Service Unavailable',
    detail: 'Identity provider is currently unavailable.',
  },
  AUTHENTICATION_REQUIRED: {
    status: 401,
    code: 'AUTHENTICATION_REQUIRED',
    type: 'https://affiliate-content-os.example/problems/authentication-required',
    title: 'Unauthorized',
    detail: 'Authentication is required to access this resource.',
  },
  AUTH_ORIGIN_INVALID: {
    status: 403,
    code: 'AUTH_ORIGIN_INVALID',
    type: 'https://affiliate-content-os.example/problems/auth-origin-invalid',
    title: 'Forbidden',
    detail: 'Request origin is invalid or untrusted.',
  },
  RATE_LIMIT_EXCEEDED: {
    status: 429,
    code: 'RATE_LIMIT_EXCEEDED',
    type: 'https://affiliate-content-os.example/problems/rate-limit-exceeded',
    title: 'Too Many Requests',
    detail: 'Rate limit exceeded. Please try again later.',
  },
  INTERNAL_ERROR: {
    status: 500,
    code: 'INTERNAL_ERROR',
    type: 'https://affiliate-content-os.example/problems/internal-error',
    title: 'Internal Server Error',
    detail: 'An unexpected internal error occurred.',
  },
};

export function resolveProblemSpec(error: unknown): ProblemSpec {
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
  if (error instanceof AuthOriginInvalidError) {
    return PROBLEM_SPECS['AUTH_ORIGIN_INVALID']!;
  }
  if (error instanceof AuthPersistenceError) {
    return PROBLEM_SPECS['INTERNAL_ERROR']!;
  }

  const maybeCode = (error as { code?: string } | undefined)?.code;
  const maybeStatus = (error as { statusCode?: number } | undefined)?.statusCode;

  if (maybeStatus === 429 || maybeCode === 'FST_ERR_RATE_LIMIT') {
    return PROBLEM_SPECS['RATE_LIMIT_EXCEEDED']!;
  }
  if (maybeStatus === 400 || maybeCode === 'FST_ERR_VALIDATION') {
    return PROBLEM_SPECS['AUTH_REQUEST_INVALID']!;
  }

  return PROBLEM_SPECS['INTERNAL_ERROR']!;
}

export function buildProblemDetails(
  request: FastifyRequest,
  spec: ProblemSpec,
  retryAfterSeconds?: number,
): ProblemDetails {
  const instance = (request.raw?.url ?? request.url ?? '/').split('?')[0] || '/';
  const rawId = request.headers['x-request-id'];
  const requestId =
    typeof rawId === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(rawId)
      ? rawId
      : String(request.id ?? 'unknown');

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
  const spec = resolveProblemSpec(error);
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

  // Safe logging: requestId, code, method, url, status
  const instance = (request.raw?.url ?? request.url ?? '/').split('?')[0] || '/';
  const rawId = request.headers['x-request-id'];
  const requestId =
    typeof rawId === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(rawId)
      ? rawId
      : String(request.id ?? 'unknown');

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
