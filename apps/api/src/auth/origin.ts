export class AuthOriginInvalidError extends Error {
  readonly code = 'AUTH_ORIGIN_INVALID' as const;

  constructor() {
    super('Request origin is invalid or untrusted');
    this.name = 'AuthOriginInvalidError';
  }
}

export function validateOrigin(
  originHeader: string | string[] | undefined,
  appBaseUrl: string,
  redirectUri: string,
): void {
  if (originHeader === undefined) {
    return;
  }

  if (typeof originHeader !== 'string' || originHeader === 'null' || originHeader.trim() === '') {
    throw new AuthOriginInvalidError();
  }

  let parsed: URL;
  try {
    parsed = new URL(originHeader);
  } catch {
    throw new AuthOriginInvalidError();
  }

  if (parsed.origin !== originHeader) {
    throw new AuthOriginInvalidError();
  }

  const appOrigin = new URL(appBaseUrl).origin;
  const callbackOrigin = new URL(redirectUri).origin;

  if (parsed.origin !== appOrigin && parsed.origin !== callbackOrigin) {
    throw new AuthOriginInvalidError();
  }
}
