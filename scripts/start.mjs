import 'dotenv/config';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
if (!existsSync('.next/standalone/server.js')) {
  console.error('Production build missing. Run npm run build first.');
  process.exit(1);
}
mkdirSync('.next/standalone/.next', { recursive: true });
cpSync('.next/static', '.next/standalone/.next/static', { recursive: true });
cpSync('public', '.next/standalone/public', { recursive: true });
const child = spawn(process.execPath, ['.next/standalone/server.js'], { stdio: 'inherit', env: { ...process.env, HOSTNAME: '0.0.0.0', PORT: process.env.PORT || '3000' } });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => { process.exitCode = code || 0; });
child.on('error', () => { console.error('Could not start server'); process.exitCode = 1; });
