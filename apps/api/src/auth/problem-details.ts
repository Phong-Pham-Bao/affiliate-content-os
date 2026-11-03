import util from 'node:util';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  AuthConfigurationUnavailableError,
  AuthPersistenceError,
  AuthRequestValidationError,
  AuthenticationRequiredError,
  OidcCallbackInvalidError,
  OidcProviderUnavailableError,
} from '@affiliate-content-os/application';
import { AuthOriginInvalidError } from './origin.js';
import { type ProblemDetails, type ProblemSpec, PROBLEM_SPECS } from './problem-details-specs.js';

export type { ProblemDetails, ProblemSpec } from './problem-details-specs.js';
export { PROBLEM_SPECS } from './problem-details-specs.js';

function isProxySafe(value: unknown): boolean {
  try {
    return util.types.isProxy(value);
  } catch {
    return true;
  }
}

function hasProxyInPrototype(obj: object): boolean {
  if (isProxySafe(obj)) return true;
  let current: object | null = obj;
  let depth = 0;
  while (current !== null && depth < 10) {
    if (isProxySafe(current)) return true;
    try {
      current = Object.getPrototypeOf(current);
    } catch {
      return true;
    }
    depth++;
  }
  return false;
}

export function resolveProblemSpec(error: unknown): ProblemSpec {
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
      return PROBLEM_SPECS['AUTH_REQUEST_INVALID']!;
    }
  } catch {
    return PROBLEM_SPECS['INTERNAL_ERROR']!;
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
