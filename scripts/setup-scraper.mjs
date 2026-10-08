import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const python = process.env.SCRAPER_PYTHON || path.resolve('.venv/bin/python');
const env = { ...process.env, CLOAKBROWSER_VERSION: process.env.CLOAKBROWSER_VERSION || '146.0.7680.177.5', CLOAKBROWSER_AUTO_UPDATE: 'false' };
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', env });
  if (result.error || result.status !== 0) { console.error(result.error?.message || 'Scraper setup failed.'); process.exit(result.status || 1); }
}
if (!process.argv.includes('--check')) {
  if (!existsSync(python)) run(process.env.PYTHON_EXECUTABLE || 'python3', ['-m', 'venv', path.dirname(path.dirname(python))]);
  run(python, ['-c', 'import sys; assert sys.version_info[:2] == (3, 11), "Use Python 3.11 for the locked scraper dependencies"']);
  run(python, ['-m', 'ensurepip', '--upgrade']);
  run(python, ['-m', 'pip', 'install', '-r', 'scraper/requirements.txt']);
  run(python, ['-m', 'cloakbrowser', 'install']);
}
// Package installation alone cannot establish that headed Chromium can start.
const xvfb = env.SCRAPER_HEADLESS !== 'true' && !env.DISPLAY;
const check = spawnSync(xvfb ? 'xvfb-run' : python, xvfb ? ['-a', python, 'scraper/browser_scrape.py'] : ['scraper/browser_scrape.py'], {
  env, input: JSON.stringify({ mode: 'check' }), encoding: 'utf8', timeout: 120_000,
});
let result;
try { result = JSON.parse(check.stdout); } catch { /* A missing executable can produce no protocol response. */ }
if (check.error || check.status !== 0 || result?.success !== true) {
  console.error(check.error?.code === 'ENOENT' ? `${xvfb ? 'xvfb-run' : 'Python worker'} is missing from PATH or SCRAPER_PYTHON.`
    : `Scraper runtime check failed: ${result?.reason || result?.code || 'worker startup failed'}.`);
  console.error('Rebuild the development container or install the system dependencies in docs/browser-scraper.md, then rerun npm run setup:scraper.');
  process.exit(1);
}
console.log('Scraper runtime ready: CloakBrowser, Scrapling, and Markdown extraction checked.');
