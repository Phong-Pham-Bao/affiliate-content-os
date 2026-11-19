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

      const text = await res.text();
      if (text.length > MAX_RESPONSE_BYTES) {
        throw new Error('Provider response exceeded maximum allowed payload size');
      }

      return {
        status: res.status,
        headers: Object.freeze(responseHeaders),
        body: text,
      };
    } catch (err: unknown) {
      if (err instanceof Error && (err.name === 'AbortError' || err.message.includes('timeout'))) {
        throw new Error('HTTP request to provider timed out', { cause: err });
      }
      const safeMsg =
        err instanceof Error
          ? err.message.replace(/([?&]access_token=)[^&]+/g, '$1[REDACTED]')
          : 'Network error';
      throw new Error(safeMsg, { cause: err });
    } finally {
      clearTimeout(timer);
    }
  }
}
