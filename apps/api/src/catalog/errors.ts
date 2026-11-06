export class PreconditionRequiredError extends Error {
  readonly code = 'PRECONDITION_REQUIRED';
  readonly statusCode = 428;

  constructor(message = 'Missing or invalid If-Match header.') {
    super(message);
    this.name = 'PreconditionRequiredError';
  }
}

export class MalformedIdempotencyKeyError extends Error {
  readonly code = 'MALFORMED_IDEMPOTENCY_KEY';
  readonly statusCode = 400;

  constructor(
    message = 'Idempotency-Key header must be a printable ASCII string between 1 and 128 characters.',
  ) {
    super(message);
    this.name = 'MalformedIdempotencyKeyError';
  }
}
