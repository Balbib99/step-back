import { noteResponse } from './offline';

/** Anything with a zod-style `parse`; keeps zod out of the web package's own dependencies. */
export interface Parser<T> {
  parse(data: unknown): T;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    path: string,
    /** What the server said went wrong, in Spanish, when it said (translation errors do). */
    readonly detail?: string,
  ) {
    super(`API ${path} answered ${status}`);
    this.name = 'ApiError';
  }
}

/** The browser only talks to this server's /api; the response is validated against the shared schema. */
export async function fetchJson<T>(
  path: string,
  schema: Parser<T>,
  signal: AbortSignal,
): Promise<T> {
  const response = await fetch(path, { signal, headers: { accept: 'application/json' } });
  noteResponse(response.headers); // a copy kept by the service worker is not live: say so
  if (!response.ok) throw new ApiError(response.status, path);
  return schema.parse(await response.json());
}

/** An action the user asked for (a translation): a POST with no body, whose error message is kept. */
export async function postJson<T>(path: string, schema: Parser<T>): Promise<T> {
  const response = await fetch(path, { method: 'POST', headers: { accept: 'application/json' } });
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as
      { message?: unknown } | undefined;
    throw new ApiError(
      response.status,
      path,
      typeof body?.message === 'string' ? body.message : undefined,
    );
  }
  return schema.parse(await response.json());
}
