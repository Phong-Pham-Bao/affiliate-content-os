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

export const PROBLEM_SPECS: Record<string, ProblemSpec> = {
  AUTH_NOT_CONFIGURED: {
    status: 503,
    code: 'AUTH_NOT_CONFIGURED',
    type: 'https://affiliate-content-os.example/problems/auth-not-configured',
    title: 'Service Unavailable',
    detail: 'Authentication service is not configured or currently unavailable.',
  },
  AUTH_REQUEST_INVALID: {
    status: 400,
    code: 'AUTH_REQUEST_INVALID',
    type: 'https://affiliate-content-os.example/problems/auth-request-invalid',
    title: 'Bad Request',
    detail: 'The authentication request parameters are invalid or missing.',
  },
  OIDC_CALLBACK_INVALID: {
    status: 400,
    code: 'OIDC_CALLBACK_INVALID',
    type: 'https://affiliate-content-os.example/problems/oidc-callback-invalid',
    title: 'Bad Request',
    detail: 'The identity provider callback is invalid, expired, or was denied.',
  },
  OIDC_PROVIDER_UNAVAILABLE: {
    status: 503,
    code: 'OIDC_PROVIDER_UNAVAILABLE',
    type: 'https://affiliate-content-os.example/problems/oidc-provider-unavailable',
    title: 'Service Unavailable',
    detail: 'The identity provider is currently unreachable or returned an error.',
  },
  AUTHENTICATION_REQUIRED: {
    status: 401,
    code: 'AUTHENTICATION_REQUIRED',
    type: 'https://affiliate-content-os.example/problems/authentication-required',
    title: 'Unauthorized',
    detail: 'A valid active authentication session is required.',
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
  SLUG_CONFLICT: {
    status: 409,
    code: 'SLUG_CONFLICT',
    type: 'https://affiliate-content-os.example/problems/slug-conflict',
    title: 'Conflict',
    detail: 'Workspace slug is already in use.',
  },
  IDEMPOTENCY_KEY_REUSED: {
    status: 409,
    code: 'IDEMPOTENCY_KEY_REUSED',
    type: 'https://affiliate-content-os.example/problems/idempotency-key-reused',
    title: 'Conflict',
    detail: 'Idempotency key has already been used with a different request payload.',
  },
  IDEMPOTENCY_CONFLICT: {
    status: 409,
    code: 'IDEMPOTENCY_CONFLICT',
    type: 'https://affiliate-content-os.example/problems/idempotency-conflict',
    title: 'Conflict',
    detail: 'A concurrent request with the same idempotency key is in progress. Please retry.',
  },
  MALFORMED_IDEMPOTENCY_KEY: {
    status: 400,
    code: 'MALFORMED_IDEMPOTENCY_KEY',
    type: 'https://affiliate-content-os.example/problems/malformed-idempotency-key',
    title: 'Bad Request',
    detail: 'Idempotency-Key header must be a printable ASCII string between 1 and 128 characters.',
  },
  WORKSPACE_NOT_FOUND: {
    status: 404,
    code: 'WORKSPACE_NOT_FOUND',
    type: 'https://affiliate-content-os.example/problems/workspace-not-found',
    title: 'Not Found',
    detail: 'The requested workspace was not found or is not accessible.',
  },
  VALIDATION_ERROR: {
    status: 400,
    code: 'VALIDATION_ERROR',
    type: 'https://affiliate-content-os.example/problems/validation-error',
    title: 'Bad Request',
    detail: 'The request payload failed validation.',
  },
  INTERNAL_ERROR: {
    status: 500,
    code: 'INTERNAL_ERROR',
    type: 'https://affiliate-content-os.example/problems/internal-error',
    title: 'Internal Server Error',
    detail: 'An unexpected internal error occurred.',
  },
};
