export class HttpError extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly status?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'HttpError';
  }
}

/** A request the caller's policy refused: the first address, or a redirect to somewhere else. */
export class UrlRefusedError extends HttpError {
  constructor(url: string) {
    super(`Refused by the address policy: ${url}`, url);
    this.name = 'UrlRefusedError';
  }
}

export interface HttpResponse<Body = string> {
  status: number;
  headers: Headers;
  body: Body;
}

export interface RequestOptions {
  /** `GET` unless a body is sent with `postJson`. */
  method?: 'GET' | 'POST';
  body?: string;
  params?: Record<string, string | number | undefined>;
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
  /**
   * For addresses written by third parties. It is asked about the first address and about every
   * redirect target before anything is requested from them; redirects are followed by hand, at
   * most three, and a refusal fails the request without retrying.
   */
  allowUrl?: (url: string) => boolean | Promise<boolean>;
}

export interface HttpClient {
  /** Resolves for 2xx and 304; throws HttpError for anything else once retries are exhausted. */
  get(url: string, options?: RequestOptions): Promise<HttpResponse>;
  /** Like `get`, for binary content such as images. */
  getBytes(url: string, options?: RequestOptions): Promise<HttpResponse<Uint8Array>>;
  getJson<T = unknown>(url: string, options?: RequestOptions): Promise<T>;
  /** Sends `body` as JSON and reads the JSON answer. Retries 429 and 5xx like `get`. */
  postJson<T = unknown>(url: string, body: unknown, options?: RequestOptions): Promise<T>;
}

export interface HttpClientOptions {
  userAgent: string;
  timeoutMs?: number;
  /** Extra attempts after the first one. */
  retries?: number;
  backoffBaseMs?: number;
  /** Minimum gap between two requests to the same host. */
  minIntervalMs?: number;
  /** Overrides `minIntervalMs` for specific hosts. */
  hostIntervalsMs?: Record<string, number>;
  /** Injectable for tests. */
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const MAX_RETRY_AFTER_MS = 30_000;
const MAX_REDIRECTS = 3;
const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const isRetryableStatus = (status: number) => status === 408 || status === 429 || status >= 500;

function retryAfterMs(headers: Headers, now: number): number | undefined {
  const value = headers.get('retry-after');
  if (!value) return undefined;
  const seconds = Number(value);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(ms) && ms >= 0 ? Math.min(ms, MAX_RETRY_AFTER_MS) : undefined;
}

function buildUrl(url: string, params: RequestOptions['params']): string {
  if (!params) return url;
  const built = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) built.searchParams.set(key, String(value));
  }
  return built.toString();
}

export function createHttpClient(options: HttpClientOptions): HttpClient {
  const {
    userAgent,
    timeoutMs: defaultTimeoutMs = 10_000,
    retries: defaultRetries = 2,
    backoffBaseMs = 500,
    minIntervalMs = 250,
    hostIntervalsMs = {},
    fetch: fetchImpl = globalThis.fetch,
    sleep = defaultSleep,
    now = Date.now,
  } = options;

  const nextSlotByHost = new Map<string, number>();

  // Reserve the next free slot synchronously so concurrent callers queue up in order.
  async function waitForSlot(host: string): Promise<void> {
    const interval = hostIntervalsMs[host] ?? minIntervalMs;
    const slot = Math.max(now(), nextSlotByHost.get(host) ?? 0);
    nextSlotByHost.set(host, slot + interval);
    const delay = slot - now();
    if (delay > 0) await sleep(delay);
  }

  // Redirects are followed by hand so that the policy sees every address the request goes to.
  async function fetchChecked(
    first: string,
    init: RequestInit,
    allowUrl: NonNullable<RequestOptions['allowUrl']>,
  ): Promise<Response> {
    let current = first;
    for (let hop = 0; ; hop++) {
      if (!(await allowUrl(current))) throw new UrlRefusedError(current);
      const response = await fetchImpl(current, { ...init, redirect: 'manual' });
      const location = response.headers.get('location');
      const redirected = response.status >= 300 && response.status < 400 && response.status !== 304;
      if (!redirected || !location) return response;
      await response.body?.cancel();
      if (hop >= MAX_REDIRECTS) throw new UrlRefusedError(current);
      try {
        current = new URL(location, current).toString();
      } catch {
        throw new UrlRefusedError(location);
      }
    }
  }

  async function send<Body>(
    rawUrl: string,
    request: RequestOptions,
    read: (response: Response) => Promise<Body>,
  ): Promise<HttpResponse<Body>> {
    const url = buildUrl(rawUrl, request.params);
    const host = new URL(url).host;
    const timeoutMs = request.timeoutMs ?? defaultTimeoutMs;
    const maxAttempts = (request.retries ?? defaultRetries) + 1;
    let lastError: HttpError | undefined;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await waitForSlot(host);
      let serverDelay: number | undefined;
      try {
        const init: RequestInit = {
          method: request.method ?? 'GET',
          ...(request.body !== undefined && { body: request.body }),
          headers: { 'user-agent': userAgent, accept: '*/*', ...request.headers },
          signal: AbortSignal.timeout(timeoutMs),
        };
        const response = request.allowUrl
          ? await fetchChecked(url, init, request.allowUrl)
          : await fetchImpl(url, init);
        const body = await read(response);
        if ((response.status >= 200 && response.status < 300) || response.status === 304) {
          return { status: response.status, headers: response.headers, body };
        }
        lastError = new HttpError(`HTTP ${response.status} for ${url}`, url, response.status);
        if (!isRetryableStatus(response.status)) throw lastError;
        serverDelay = retryAfterMs(response.headers, now());
      } catch (error) {
        if (error === lastError || error instanceof UrlRefusedError) throw error; // not retryable
        const timedOut = error instanceof Error && error.name === 'TimeoutError';
        lastError = new HttpError(
          timedOut ? `Timed out after ${timeoutMs} ms: ${url}` : `Request failed: ${url}`,
          url,
          undefined,
          { cause: error },
        );
      }
      if (attempt < maxAttempts - 1) {
        await sleep(serverDelay ?? backoffBaseMs * 2 ** attempt);
      }
    }
    throw lastError ?? new HttpError(`Request failed: ${url}`, url);
  }

  const get = (rawUrl: string, request: RequestOptions = {}) =>
    send(rawUrl, request, (response) => response.text());

  return {
    get,
    async postJson<T>(url: string, body: unknown, request?: RequestOptions) {
      const response = await send(
        url,
        {
          ...request,
          method: 'POST',
          body: JSON.stringify(body),
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            ...request?.headers,
          },
        },
        (reply) => reply.text(),
      );
      try {
        return JSON.parse(response.body) as T;
      } catch (error) {
        throw new HttpError(`Invalid JSON from ${url}`, url, response.status, { cause: error });
      }
    },
    getBytes: (rawUrl, request = {}) =>
      send(rawUrl, request, async (response) => new Uint8Array(await response.arrayBuffer())),
    async getJson<T>(url: string, request?: RequestOptions) {
      const response = await get(url, {
        ...request,
        headers: { accept: 'application/json', ...request?.headers },
      });
      try {
        return JSON.parse(response.body) as T;
      } catch (error) {
        throw new HttpError(`Invalid JSON from ${url}`, url, response.status, { cause: error });
      }
    },
  };
}
