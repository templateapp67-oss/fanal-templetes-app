#!/usr/bin/env node
// ============================================================================
// One-command local preview: `node scripts/dev-preview.mjs`
//
// Restores the offline preview after the workspace has been reset (which
// deletes git-ignored files like .env and node_modules). It is the documented
// local-gateway mode from .env.example / ADMIN_MANAGEMENT_SETUP.md:
//
//   1. writes a .env with the local Supabase gateway config — ONLY if no .env
//      exists (a real project's .env is never touched);
//   2. installs dependencies if node_modules is missing;
//   3. starts `npm run dev`.
//
// The seeded Super Admin (admin@nexora.local / Admin#12345) is re-created by
// the gateway on boot, so sign-in at /admin works immediately.
//
// NOTE the VITE_SUPABASE_ANON_KEY line: Vite only inlines VITE_* values that
// come from .env FILES (vite.config's loadEnv does not read the shell
// environment). Without it the browser client falls into mock mode, the
// sign-in modal fabricates a mock-user-123 session instead of authenticating
// against the gateway, and /admin refuses with "not an admin member".
// ============================================================================
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(root, '.env');
const tsxBin = resolve(root, 'node_modules', '.bin', 'tsx');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const LOCAL_PREVIEW_ENV = `# Written by scripts/dev-preview.mjs — offline local preview only.
# Safe to delete; see .env.example for every supported variable.
VITE_LOCAL_SUPABASE=true
VITE_SUPABASE_ANON_KEY=local-dev-anon-key
`;

// 1. Environment: never overwrite an existing .env (it may hold a real
//    project's credentials).
if (!existsSync(envPath)) {
  writeFileSync(envPath, LOCAL_PREVIEW_ENV, { mode: 0o600 });
  console.log('[dev-preview] created .env for the local Supabase gateway (admin@nexora.local / Admin#12345)');
} else {
  console.log('[dev-preview] .env already exists — leaving it untouched');
}

// 2. Dependencies: a workspace reset removes node_modules; reinstall quietly.
if (!existsSync(tsxBin)) {
  console.log('[dev-preview] node_modules missing — installing (about 30s)…');
  const install = spawnSync(npmCommand, ['install', '--no-audit', '--no-fund'], {
    cwd: root,
    stdio: 'inherit',
  });
  if (install.status !== 0) {
    console.error('[dev-preview] npm install failed');
    process.exit(install.status ?? 1);
  }
}

// 3. Load the existing/created .env BEFORE the server's module graph starts.
// Some server imports reach supabaseClient before server/env executes. Without
// this preload, the browser connects but the API stays in mock mode until the
// next process restart. Import dotenv only after the dependency bootstrap, and
// preserve explicit process variables (dotenv's default override=false).
const { config } = await import('dotenv');
config({ path: envPath, quiet: true });

// 4. Start the full server (HTTP APIs + Vite), not standalone Vite.
console.log('[dev-preview] starting npm run dev …');
const child = spawn(npmCommand, ['run', 'dev'], { cwd: root, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
child.on('error', (error) => {
  console.error('[dev-preview] failed to start:', error);
  process.exit(1);
});
