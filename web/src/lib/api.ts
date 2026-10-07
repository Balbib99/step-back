/** Anything with a zod-style `parse`; keeps zod out of the web package's own dependencies. */
export interface Parser<T> {
  parse(data: unknown): T;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    path: string,
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
  if (!response.ok) throw new ApiError(response.status, path);
  return schema.parse(await response.json());
}
