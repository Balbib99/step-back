import { pino, type Logger } from 'pino';
import type { Config } from './config.js';

export type { Logger };

export function createLogger(config: Pick<Config, 'logLevel' | 'env'>): Logger {
  return pino({
    level: config.env === 'test' ? 'silent' : config.logLevel,
    base: null,
    redact: ['*.deeplApiKey', '*.vapid', 'headers.authorization', 'req.headers.authorization'],
  });
}
