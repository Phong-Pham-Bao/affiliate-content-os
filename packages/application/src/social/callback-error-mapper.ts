export function buildRedirectWithResult(
  returnTo: string | null | undefined,
  resultKey: string,
): string {
  const base = returnTo && returnTo.length > 0 ? returnTo : '/';
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}connection_result=${encodeURIComponent(resultKey)}`;
}

export function mapProviderErrorCode(rawError: unknown): {
  safeCode: string;
  safeDescription: string;
} {
  const str = typeof rawError === 'string' ? rawError.toLowerCase().trim() : '';
  if (str === 'access_denied' || str.includes('denied') || str.includes('cancel')) {
    return {
      safeCode: 'access_denied',
      safeDescription: 'The authorization request was denied.',
    };
  }
  if (str === 'timeout' || str.includes('timeout')) {
    return {
      safeCode: 'provider_timeout',
      safeDescription: 'The social provider timed out during authorization.',
    };
  }
  if (str === 'account_mismatch') {
    return {
      safeCode: 'account_mismatch',
      safeDescription: 'The reconnected account does not match the original account.',
    };
  }
  if (str === 'outcome_unknown') {
    return {
      safeCode: 'outcome_unknown',
      safeDescription: 'Network timeout occurred before issuance could be confirmed.',
    };
  }
  return {
    safeCode: 'provider_error',
    safeDescription: 'An error occurred during authorization with the provider.',
  };
}
