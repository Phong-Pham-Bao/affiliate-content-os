export interface HttpRequest {
  readonly method: 'GET' | 'POST' | 'DELETE';
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>> | undefined;
  readonly body?: string | URLSearchParams | undefined;
  readonly timeoutMs?: number | undefined;
}

export interface HttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface HttpTransport {
  fetch(req: HttpRequest): Promise<HttpResponse>;
}

const MAX_RESPONSE_BYTES = 65536; // 64KB safe bound for JSON responses

export function redactProviderUrlSecrets(text: string): string {
  return text
    .replace(
      /([?&](?:access_token|input_token|client_secret|code|state)=)[^&\s"']+/gi,
      '$1[REDACTED]',
    )
    .replace(/(Authorization:\s*(?:Bearer\s+)?)[^\s,"']+/gi, '$1[REDACTED]');
}

export class DefaultHttpTransport implements HttpTransport {
  constructor(private readonly defaultTimeoutMs = 10000) {}

  public async fetch(req: HttpRequest): Promise<HttpResponse> {
    const timeoutMs = req.timeoutMs ?? this.defaultTimeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const headers: Record<string, string> = { ...(req.headers ?? {}) };
      let bodyData: string | URLSearchParams | undefined;

      if (req.body instanceof URLSearchParams) {
        bodyData = req.body;
      } else if (typeof req.body === 'string') {
        bodyData = req.body;
      }

      const fetchOptions: RequestInit = {
        method: req.method,
        headers,
        signal: controller.signal,
        redirect: 'error',
      };
      if (bodyData !== undefined) {
        fetchOptions.body = bodyData;
      }

      const res = await globalThis.fetch(req.url, fetchOptions);

      const responseHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        responseHeaders[k.toLowerCase()] = v;
      });

      const contentType = responseHeaders['content-type'] ?? '';
      if (!contentType.includes('application/json') && !contentType.includes('text/javascript')) {
        throw new Error(`Provider returned invalid content type: ${contentType || 'none'}`);
      }

      const cl = responseHeaders['content-length'];
      if (cl) {
        const bytes = Number(cl);
        if (Number.isFinite(bytes) && bytes > MAX_RESPONSE_BYTES) {
          throw new Error('Provider response exceeded maximum allowed payload size');
        }
      }

      let text: string;
      if (res.body && typeof res.body.getReader === 'function') {
        const reader = res.body.getReader();
        const chunks: Uint8Array[] = [];
        let totalBytes = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              totalBytes += value.byteLength;
              if (totalBytes > MAX_RESPONSE_BYTES) {
                await reader.cancel();
                throw new Error('Provider response exceeded maximum allowed payload size');
              }
              chunks.push(value);
            }
          }
        } finally {
          reader.releaseLock();
        }
        text = Buffer.concat(chunks).toString('utf8');
      } else {
        text = await res.text();
        if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
          throw new Error('Provider response exceeded maximum allowed payload size');
        }
      }

      return {
        status: res.status,
        headers: Object.freeze(responseHeaders),
        body: text,
      };
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        (err.name === 'AbortError' ||
          err.message.includes('timeout') ||
          err.message.includes('timed out'))
      ) {
        // eslint-disable-next-line preserve-caught-error -- provider error cause must not leak secret URLs
        throw new Error('HTTP request to provider timed out');
      }
      const rawMsg = err instanceof Error ? err.message : 'Network error';
      const safeMsg = redactProviderUrlSecrets(rawMsg);
      // eslint-disable-next-line preserve-caught-error -- provider error cause must not leak secret URLs
      throw new Error(safeMsg);
    } finally {
      clearTimeout(timer);
    }
  }
}
