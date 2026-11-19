import { OAuthCallbackInvalidError } from './errors.js';

export interface ValidatedCallbackQuery {
  readonly rawState: string;
  readonly code?: string | undefined;
  readonly error?: string | undefined;
}

export function validateCallbackQuery(command: {
  readonly state: unknown;
  readonly code?: unknown;
  readonly error?: unknown;
}): ValidatedCallbackQuery {
  if (
    typeof command.state !== 'string' ||
    command.state.length < 16 ||
    command.state.length > 256 ||
    Array.isArray(command.state)
  ) {
    throw new OAuthCallbackInvalidError('Missing, oversized, or duplicate state parameter.');
  }

  const hasCode = typeof command.code === 'string' && command.code.length > 0;
  const hasError = typeof command.error === 'string' && command.error.length > 0;
  if ((hasCode && hasError) || (!hasCode && !hasError)) {
    throw new OAuthCallbackInvalidError(
      'Callback query must contain either code or error, not both or neither.',
    );
  }

  return {
    rawState: command.state,
    code: hasCode ? (command.code as string) : undefined,
    error: hasError ? (command.error as string) : undefined,
  };
}
