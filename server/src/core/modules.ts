import type { FastifyInstance } from 'fastify';
import type { KvCache } from './cache.js';
import type { Config } from './config.js';
import type { Db } from './db.js';
import type { HttpClient } from './http.js';
import type { JobRuns } from './job-runs.js';
import type { Logger } from './logger.js';
import type { Migration } from './migrations.js';
import type { JobDefinition } from './scheduler.js';

/** Everything a module may use. Modules receive it instead of reaching for globals. */
export interface ModuleContext {
  config: Config;
  logger: Logger;
  db: Db;
  cache: KvCache;
  jobRuns: JobRuns;
  http: HttpClient;
}

/**
 * A feature module (games, news, ...). Routes are mounted under `/api`, so a module declares
 * its own paths (e.g. `/games`, `/teams`). Migration ids are global across modules.
 */
export interface AppModule {
  id: string;
  migrations?: Migration[];
  routes?: (app: FastifyInstance, context: ModuleContext) => void | Promise<void>;
  jobs?: (context: ModuleContext) => JobDefinition[];
}
