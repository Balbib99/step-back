import type { ZodType } from 'zod';

/** ESPN answered with something the adapter does not understand: the format changed. */
export class EspnFormatError extends Error {
  constructor(what: string, detail: string) {
    super(`ESPN ${what} format changed: ${detail}`);
    this.name = 'EspnFormatError';
  }
}

/** Validates a payload from ESPN, failing with a message that says where it stopped matching. */
export function parseWith<T>(schema: ZodType<T>, data: unknown, what: string): T {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const issues = result.error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
  throw new EspnFormatError(what, issues);
}
