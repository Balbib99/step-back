// Runs the server and the web dev servers together, prefixing each line of output.
// Ctrl+C stops both.
import { spawn } from 'node:child_process';

const apps = [
  { name: 'server', workspace: '@step-back/server' },
  { name: 'web', workspace: '@step-back/web' },
];

// The web dev server proxies /api to this port (web/vite.config.ts), so the API must always
// listen here, even when the environment already defines PORT for something else.
const API_PORT = '3000';

const children = apps.map(({ name, workspace }) => {
  const child = spawn(`npm run dev -w ${workspace}`, {
    shell: true,
    stdio: 'pipe',
    env: name === 'server' ? { ...process.env, PORT: API_PORT } : process.env,
  });
  const prefix = (stream, target) =>
    stream.on('data', (chunk) => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        if (line.trim()) target.write(`[${name}] ${line}\n`);
      }
    });
  prefix(child.stdout, process.stdout);
  prefix(child.stderr, process.stderr);
  child.on('exit', (code) => {
    if (!stopping) {
      console.error(`[${name}] exited with code ${code}; stopping the rest`);
      stop(code ?? 1);
    }
  });
  return child;
});

let stopping = false;
function stop(code = 0) {
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null) {
      // On Windows a shell-spawned child needs taskkill /T to take its process tree with it.
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']);
      else child.kill('SIGTERM');
    }
  }
  setTimeout(() => process.exit(code), 500);
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
