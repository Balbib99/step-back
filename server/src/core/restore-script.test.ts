import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// deploy/restore.sh against a fake `docker`: no containers, the data volume is a folder. What matters
// is what the script does when a step fails: the database that was live must not be lost, and
// the app must start again.

const SCRIPT = resolve(import.meta.dirname, '../../../deploy/restore.sh')
  .split('\\')
  .join('/');
const hasShell = spawnSync('sh', ['-c', 'true']).status === 0;

const FAKE_DOCKER = `#!/bin/sh
case "$1" in
  volume) exit 0 ;;
  compose) echo "$*" >> "$FAKE_LOG"; exit 0 ;;
  run)
    for last; do :; done
    script=$(printf '%s' "$last" | sed "s#/data#$FAKE_DATA#g; s#chown node:node [^ ]*#true#g")
    if [ -n "\${FAKE_BREAK_WRITE:-}" ]; then script=$(printf '%s' "$script" | sed 's#cat >#head -c 20 >#'); fi
    exec sh -c "$script" ;;
esac
`;

// A gunzip that dies halfway, after the first bytes: what a disk or memory failure would do.
const FAKE_GUNZIP = `#!/bin/sh
printf 'SQLite format 3\\000partial'
exit 1
`;

const header = 'SQLite format 3\u0000';
const database = (body: string) => Buffer.from(header + body, 'latin1');

describe.skipIf(!hasShell)('deploy/restore.sh', () => {
  let dir: string;
  let data: string;
  let bin: string;
  let log: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'step-back-restore-'));
    data = join(dir, 'data').split('\\').join('/');
    bin = join(dir, 'bin');
    log = join(dir, 'docker.log').split('\\').join('/');
    mkdirSync(data);
    mkdirSync(bin);
    writeFileSync(join(bin, 'docker'), FAKE_DOCKER, { mode: 0o755 });
    writeFileSync(log, '');
    writeFileSync(join(data, 'step-back.db'), database('the live database'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function run(backup: Buffer, env: Record<string, string> = {}, fakeGunzip = false) {
    const file = join(dir, 'backup.db.gz');
    writeFileSync(file, backup);
    if (fakeGunzip) writeFileSync(join(bin, 'gunzip'), FAKE_GUNZIP, { mode: 0o755 });
    return spawnSync('sh', [SCRIPT, file.split('\\').join('/')], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
        ASSUME_YES: '1',
        STEP_BACK_VOLUME: 'fake',
        FAKE_DATA: data,
        FAKE_LOG: log,
        ...env,
      },
    });
  }
  const live = () => readFileSync(join(data, 'step-back.db'), 'latin1');
  const commands = () => readFileSync(log, 'utf8');

  it('puts the backup in place, keeps the old database next to it and starts the app', () => {
    const result = run(gzipSync(database('the backup')));
    expect(result.status).toBe(0);
    expect(live()).toBe(`${header}the backup`);
    expect(readFileSync(join(data, 'step-back.db.before-restore'), 'latin1')).toBe(
      `${header}the live database`,
    );
    expect(commands()).toMatch(/stop step-back/);
    expect(commands()).toMatch(/start step-back/);
  });

  it('touches nothing when the decompression dies halfway, instead of taking it for a success', () => {
    const result = run(gzipSync(database('the backup')), {}, true);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/could not decompress/);
    expect(live()).toBe(`${header}the live database`);
    expect(existsSync(join(data, 'step-back.db.before-restore'))).toBe(false);
    expect(commands()).not.toMatch(/stop step-back/);
  });

  it('refuses a file that is not a SQLite database, before stopping the app', () => {
    const result = run(gzipSync(Buffer.from('<html>not a database</html>')));
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/not a SQLite database/);
    expect(live()).toBe(`${header}the live database`);
    expect(commands()).not.toMatch(/stop step-back/);
  });

  it('puts the previous database back, and starts the app, when the write is cut short', () => {
    const result = run(gzipSync(database('a backup that is longer than twenty bytes')), {
      FAKE_BREAK_WRITE: '1',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/putting the previous database back/);
    expect(live()).toBe(`${header}the live database`);
    expect(commands()).toMatch(/start step-back/);
  });
});
