import { describe, expect, it } from 'vitest';
import { OidcCallbackInvalidError } from '@affiliate-content-os/application';
import { parseAndValidateRawCallback } from '../src/auth/callback-url-parser.js';

describe('callback-url-parser - parseAndValidateRawCallback (RFC 6749 compliance)', () => {
  it('parses Google-shaped callback, safely ignores scope, authuser, prompt, hd and returns code, state, and iss in a null-prototype object', () => {
    const rawUrl =
      '/auth/callback?code=4%2F0AY0e-g7_google_auth_code&state=valid-state-12345&scope=email%20profile%20openid%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fuserinfo.profile&authuser=0&prompt=consent&hd=example.com&iss=https%3A%2F%2Faccounts.google.com';

    const result = parseAndValidateRawCallback(rawUrl);

    expect(result).toEqual({
      code: '4/0AY0e-g7_google_auth_code',
      state: 'valid-state-12345',
      iss: 'https://accounts.google.com',
    });
    expect(Reflect.ownKeys(result)).toEqual(['iss', 'code', 'state']);
    expect(Object.getPrototypeOf(result)).toBeNull();
  });

  it('safely ignores arbitrary bounded unrecognized parameters per RFC 6749', () => {
    const rawUrl =
      '/auth/callback?code=my-code&state=my-state&session_state=sess-123&custom_provider_key=custom_val';

    const result = parseAndValidateRawCallback(rawUrl);

    expect(result).toEqual({
      code: 'my-code',
      state: 'my-state',
    });
    expect(Reflect.ownKeys(result)).toEqual(['code', 'state']);
  });

  it('parses denial callback with error, state, and optional error_description and error_uri while ignoring unrecognized params', () => {
    const rawUrl =
      '/auth/callback?error=access_denied&error_description=User%20denied&error_uri=https%3A%2F%2Faccounts.google.com%2Ferror&state=state-456&authuser=0&prompt=none';

    const result = parseAndValidateRawCallback(rawUrl);

    expect(result).toEqual({
      error: 'access_denied',
      state: 'state-456',
      error_description: 'User denied',
      error_uri: 'https://accounts.google.com/error',
    });
    expect(Reflect.ownKeys(result)).toEqual(['error', 'state', 'error_description', 'error_uri']);
  });

  it('rejects fragment in URL or non-string input', () => {
    expect(() => parseAndValidateRawCallback(null as never)).toThrow(OidcCallbackInvalidError);
    expect(() => parseAndValidateRawCallback(123 as never)).toThrow(OidcCallbackInvalidError);
    expect(() => parseAndValidateRawCallback('/auth/callback?code=c&state=s#fragment')).toThrow(
      OidcCallbackInvalidError,
    );
  });

  it('rejects missing or malformed query string structure', () => {
    expect(() => parseAndValidateRawCallback('/auth/callback')).toThrow(OidcCallbackInvalidError);
    expect(() => parseAndValidateRawCallback('/auth/callback?')).toThrow(OidcCallbackInvalidError);
    expect(() => parseAndValidateRawCallback('/auth/callback?code=c&state=s?extra')).toThrow(
      OidcCallbackInvalidError,
    );
    expect(() => parseAndValidateRawCallback('/auth/callback?&code=c&state=s')).toThrow(
      OidcCallbackInvalidError,
    );
    expect(() => parseAndValidateRawCallback('/auth/callback?code=c&state=s&')).toThrow(
      OidcCallbackInvalidError,
    );
    expect(() => parseAndValidateRawCallback('/auth/callback?code=c&&state=s')).toThrow(
      OidcCallbackInvalidError,
    );
    expect(() => parseAndValidateRawCallback('/auth/callback?code=c;state=s')).toThrow(
      OidcCallbackInvalidError,
    );
  });

  it('rejects malformed percent encoding', () => {
    expect(() => parseAndValidateRawCallback('/auth/callback?code=%&state=s')).toThrow(
      OidcCallbackInvalidError,
    );
    expect(() => parseAndValidateRawCallback('/auth/callback?code=%2&state=s')).toThrow(
      OidcCallbackInvalidError,
    );
    expect(() => parseAndValidateRawCallback('/auth/callback?code=%2g&state=s')).toThrow(
      OidcCallbackInvalidError,
    );
    expect(() => parseAndValidateRawCallback('/auth/callback?code=c&state=%C3')).toThrow(
      OidcCallbackInvalidError,
    );
    expect(() => parseAndValidateRawCallback('/auth/callback?code=c&state=s&scope=%2g')).toThrow(
      OidcCallbackInvalidError,
    );
  });

  it('rejects duplicate keys across core and unrecognized parameters', () => {
    expect(() => parseAndValidateRawCallback('/auth/callback?code=c1&code=c2&state=s')).toThrow(
      OidcCallbackInvalidError,
    );
    expect(() => parseAndValidateRawCallback('/auth/callback?code=c&state=s1&state=s2')).toThrow(
      OidcCallbackInvalidError,
    );
    expect(() =>
      parseAndValidateRawCallback('/auth/callback?code=c&state=s&scope=s1&scope=s2'),
    ).toThrow(OidcCallbackInvalidError);
    expect(() =>
      parseAndValidateRawCallback('/auth/callback?code=c&state=s&%73cope=s1&scope=s2'),
    ).toThrow(OidcCallbackInvalidError);
  });

  it('rejects control characters in keys or values', () => {
    expect(() => parseAndValidateRawCallback('/auth/callback?code=c%0A&state=s')).toThrow(
      OidcCallbackInvalidError,
    );
    expect(() => parseAndValidateRawCallback('/auth/callback?code=c&state=s%00')).toThrow(
      OidcCallbackInvalidError,
    );
    expect(() => parseAndValidateRawCallback('/auth/callback?code=c&state=s&scope=a%0Db')).toThrow(
      OidcCallbackInvalidError,
    );
    expect(() => parseAndValidateRawCallback('/auth/callback?code=c&state=s&scope%0A=val')).toThrow(
      OidcCallbackInvalidError,
    );
    expect(() => parseAndValidateRawCallback('/auth/callback?code=c&state=s&scope=val%7F')).toThrow(
      OidcCallbackInvalidError,
    );
  });

  it('rejects hostile prototype pollution keys', () => {
    expect(() =>
      parseAndValidateRawCallback('/auth/callback?code=c&state=s&__proto__=polluted'),
    ).toThrow(OidcCallbackInvalidError);
    expect(() =>
      parseAndValidateRawCallback('/auth/callback?code=c&state=s&constructor=bad'),
    ).toThrow(OidcCallbackInvalidError);
    expect(() =>
      parseAndValidateRawCallback('/auth/callback?code=c&state=s&prototype=bad'),
    ).toThrow(OidcCallbackInvalidError);
  });

  it('rejects empty keys, oversized keys, oversized values, or excessive parameter count', () => {
    expect(() => parseAndValidateRawCallback('/auth/callback?code=c&state=s&=val')).toThrow(
      OidcCallbackInvalidError,
    );
    const longKey = 'k'.repeat(257);
    expect(() =>
      parseAndValidateRawCallback(`/auth/callback?code=c&state=s&${longKey}=val`),
    ).toThrow(OidcCallbackInvalidError);

    const longVal = 'v'.repeat(4097);
    expect(() =>
      parseAndValidateRawCallback(`/auth/callback?code=c&state=s&scope=${longVal}`),
    ).toThrow(OidcCallbackInvalidError);

    const manyParams = Array.from({ length: 32 }, (_, i) => `p${i}=${i}`).join('&');
    expect(() =>
      parseAndValidateRawCallback(`/auth/callback?code=c&state=s&${manyParams}`),
    ).toThrow(OidcCallbackInvalidError);
  });

  it('rejects code/error mutual exclusivity violations', () => {
    // Both code and error
    expect(() =>
      parseAndValidateRawCallback('/auth/callback?code=c&error=access_denied&state=s'),
    ).toThrow(OidcCallbackInvalidError);
    // Code with error_description
    expect(() =>
      parseAndValidateRawCallback('/auth/callback?code=c&state=s&error_description=denied'),
    ).toThrow(OidcCallbackInvalidError);
    // Code with error_uri
    expect(() =>
      parseAndValidateRawCallback(
        '/auth/callback?code=c&state=s&error_uri=https%3A%2F%2Fexample.com',
      ),
    ).toThrow(OidcCallbackInvalidError);
    // Neither code nor error
    expect(() => parseAndValidateRawCallback('/auth/callback?state=s')).toThrow(
      OidcCallbackInvalidError,
    );
  });

  it('rejects missing or empty state', () => {
    expect(() => parseAndValidateRawCallback('/auth/callback?code=c')).toThrow(
      OidcCallbackInvalidError,
    );
    expect(() => parseAndValidateRawCallback('/auth/callback?error=e')).toThrow(
      OidcCallbackInvalidError,
    );
    expect(() => parseAndValidateRawCallback('/auth/callback?code=c&state=')).toThrow(
      OidcCallbackInvalidError,
    );
  });

  it('preserves valid iss on code and denial responses', () => {
    const codeResult = parseAndValidateRawCallback(
      '/auth/callback?code=c&state=s&iss=https%3A%2F%2Faccounts.google.com',
    );
    expect(codeResult.iss).toBe('https://accounts.google.com');

    const errorResult = parseAndValidateRawCallback(
      '/auth/callback?error=access_denied&state=s&iss=https%3A%2F%2Faccounts.google.com',
    );
    expect(errorResult.iss).toBe('https://accounts.google.com');
  });

  it('rejects duplicate iss and raw-percent-encoded duplicate iss', () => {
    expect(() =>
      parseAndValidateRawCallback(
        '/auth/callback?code=c&state=s&iss=https%3A%2F%2Faccounts.google.com&iss=https%3A%2F%2Faccounts.google.com',
      ),
    ).toThrow(OidcCallbackInvalidError);

    expect(() =>
      parseAndValidateRawCallback(
        '/auth/callback?code=c&state=s&%69ss=https%3A%2F%2Faccounts.google.com&iss=https%3A%2F%2Faccounts.google.com',
      ),
    ).toThrow(OidcCallbackInvalidError);
  });

  it('rejects iss with control characters, empty iss, or oversized iss (> 2048)', () => {
    expect(() =>
      parseAndValidateRawCallback(
        '/auth/callback?code=c&state=s&iss=https%3A%2F%2Faccounts.google.com%0A',
      ),
    ).toThrow(OidcCallbackInvalidError);

    expect(() => parseAndValidateRawCallback('/auth/callback?code=c&state=s&iss=')).toThrow(
      OidcCallbackInvalidError,
    );

    const oversizedIss = `https://accounts.google.com/${'x'.repeat(2048)}`;
    expect(() =>
      parseAndValidateRawCallback(
        `/auth/callback?code=c&state=s&iss=${encodeURIComponent(oversizedIss)}`,
      ),
    ).toThrow(OidcCallbackInvalidError);
  });
});
