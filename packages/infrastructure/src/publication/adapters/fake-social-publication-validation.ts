import type { PublishTextRequest } from '@affiliate-content-os/application';
import { FakePublicationInputValidationError } from './fake-social-publication-types.js';

const MAX_ID_LENGTH = 128;
const MAX_IDEMPOTENCY_KEY_LENGTH = 256;
const MAX_RENDERED_TEXT_LENGTH = 10_000;
const MAX_ACCESS_TOKEN_LENGTH = 4096;
const MAX_ATTEMPT_NUMBER = 100;

function validateStringField(
  value: unknown,
  fieldName: string,
  maxLength: number,
  minLength = 1,
): string {
  if (typeof value !== 'string') {
    throw new FakePublicationInputValidationError(`Field '${fieldName}' must be a string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length < minLength) {
    throw new FakePublicationInputValidationError(
      `Field '${fieldName}' must be at least ${minLength} characters.`,
    );
  }
  if (value.length > maxLength) {
    throw new FakePublicationInputValidationError(
      `Field '${fieldName}' exceeds maximum allowed length of ${maxLength}.`,
    );
  }
  return value;
}

export function validatePublishTextRequest(
  request: unknown,
): asserts request is PublishTextRequest {
  if (!request || typeof request !== 'object') {
    throw new FakePublicationInputValidationError('PublishTextRequest must be a non-null object.');
  }

  const req = request as Record<string, unknown>;

  validateStringField(req['workspaceId'], 'workspaceId', MAX_ID_LENGTH);
  validateStringField(req['publicationId'], 'publicationId', MAX_ID_LENGTH);
  validateStringField(req['attemptId'], 'attemptId', MAX_ID_LENGTH);
  validateStringField(
    req['attemptIdempotencyKey'],
    'attemptIdempotencyKey',
    MAX_IDEMPOTENCY_KEY_LENGTH,
  );
  validateStringField(req['socialAccountId'], 'socialAccountId', MAX_ID_LENGTH);
  validateStringField(req['providerAccountId'], 'providerAccountId', MAX_ID_LENGTH);
  validateStringField(req['correlationId'], 'correlationId', MAX_ID_LENGTH);
  validateStringField(req['renderedText'], 'renderedText', MAX_RENDERED_TEXT_LENGTH);

  const attemptNumber = req['attemptNumber'];
  if (
    typeof attemptNumber !== 'number' ||
    !Number.isInteger(attemptNumber) ||
    attemptNumber < 1 ||
    attemptNumber > MAX_ATTEMPT_NUMBER
  ) {
    throw new FakePublicationInputValidationError(
      `Field 'attemptNumber' must be an integer between 1 and ${MAX_ATTEMPT_NUMBER}.`,
    );
  }

  const platformSettings = req['platformSettings'];
  if (
    !platformSettings ||
    typeof platformSettings !== 'object' ||
    Array.isArray(platformSettings)
  ) {
    throw new FakePublicationInputValidationError(
      "Field 'platformSettings' must be a non-null object.",
    );
  }

  const accessToken = req['accessToken'];
  if (accessToken !== undefined) {
    if (typeof accessToken !== 'string' || accessToken.length > MAX_ACCESS_TOKEN_LENGTH) {
      throw new FakePublicationInputValidationError(
        `Field 'accessToken' must be a string with maximum length ${MAX_ACCESS_TOKEN_LENGTH}.`,
      );
    }
  }
}
