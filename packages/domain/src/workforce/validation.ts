import { DomainValidationError } from '../errors.js';

// Prohibits ASCII control characters except \t (0x09) and \n (0x0A) and \r (0x0D)
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

export function validateDirectiveText(value: unknown): string {
  if (typeof value !== 'string') {
    throw new DomainValidationError('Directive text must be a string', 'directiveText');
  }

  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 4000) {
    throw new DomainValidationError(
      'Directive text must be between 1 and 4000 characters',
      'directiveText',
    );
  }

  if (value !== trimmed) {
    throw new DomainValidationError(
      'Directive text must not contain leading or trailing whitespace',
      'directiveText',
    );
  }

  if (FORBIDDEN_CONTROL_CHARS.test(value)) {
    throw new DomainValidationError(
      'Directive text contains prohibited control characters',
      'directiveText',
    );
  }

  return trimmed;
}

export function validateWorkOrderPriority(value: unknown): number {
  if (value === undefined || value === null) {
    return 50;
  }

  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new DomainValidationError('Work order priority must be an integer', 'priority');
  }

  if (value < 1 || value > 100) {
    throw new DomainValidationError('Work order priority must be between 1 and 100', 'priority');
  }

  return value;
}
