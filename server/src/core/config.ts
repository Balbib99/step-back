import { dirname, join } from 'node:path';
import { z } from 'zod';

const VAPID_KEYS = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'] as const;

const timeZone = z.string().refine(
  (value) => {
    try {
      new Intl.DateTimeFormat('es-ES', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  },
  { message: 'is not a valid IANA time zone (e.g. Europe/Madrid)' },
);

const teamList = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((team) => team.trim().toUpperCase())
      .filter(Boolean),
  )
  .refine((teams) => teams.length > 0 && teams.every((team) => /^[A-Z]{2,4}$/.test(team)), {
    message: 'must be a comma-separated list of team abbreviations (e.g. MIN,LAL,PHI)',
  });

const optionalText = z
  .string()
  .trim()
  .transform((value) => (value === '' ? undefined : value))
  .optional();

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    // Loopback by default so a dev server is never exposed by accident; Docker sets 0.0.0.0.
    HOST: z.string().min(1).default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    DB_PATH: z.string().min(1).default('./data/step-back.db'),
    // Where downloaded team crests are kept. Defaults to a `crests` folder next to the database.
    CRESTS_DIR: z.string().min(1).optional(),
    // Folder with the built web app (web/dist). When set, the server also serves the app, so one
    // container is the whole product. In development the Vite server does that instead.
    WEB_DIR: z.string().min(1).optional(),
    TZ_DISPLAY: timeZone.default('Europe/Madrid'),
    FAVORITE_TEAMS: teamList.default('MIN,LAL,PHI'),
    DEEPL_API_KEY: optionalText,
    VAPID_PUBLIC_KEY: optionalText,
    VAPID_PRIVATE_KEY: optionalText,
    VAPID_SUBJECT: optionalText,
  })
  .superRefine((env, ctx) => {
    // Push is all-or-nothing: a partial VAPID setup is a mistake, not a feature switch.
    const present = VAPID_KEYS.filter((key) => env[key] !== undefined);
    if (present.length === 0 || present.length === VAPID_KEYS.length) return;
    for (const key of VAPID_KEYS) {
      if (env[key] === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: 'is required when any other VAPID_* variable is set',
        });
      }
    }
  });

export interface Config {
  env: 'development' | 'production' | 'test';
  host: string;
  port: number;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  dbPath: string;
  crestsDir: string;
  webDir: string | undefined;
  timeZone: string;
  favoriteTeams: string[];
  deeplApiKey: string | undefined;
  vapid: { publicKey: string; privateKey: string; subject: string } | undefined;
}

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid configuration:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`),
    );
  }
  const data = parsed.data;
  const {
    VAPID_PUBLIC_KEY: publicKey,
    VAPID_PRIVATE_KEY: privateKey,
    VAPID_SUBJECT: subject,
  } = data;
  return {
    env: data.NODE_ENV,
    host: data.HOST,
    port: data.PORT,
    logLevel: data.LOG_LEVEL,
    dbPath: data.DB_PATH,
    crestsDir:
      data.CRESTS_DIR ??
      join(data.DB_PATH === ':memory:' ? './data' : dirname(data.DB_PATH), 'crests'),
    webDir: data.WEB_DIR,
    timeZone: data.TZ_DISPLAY,
    favoriteTeams: data.FAVORITE_TEAMS,
    deeplApiKey: data.DEEPL_API_KEY,
    vapid: publicKey && privateKey && subject ? { publicKey, privateKey, subject } : undefined,
  };
}
