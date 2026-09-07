// ============================================================================
// Environment loading — one place, one precedence order, used by BOTH Express
// entrypoints (server.ts and api/index.ts).
//
//   1. real process environment  (Vercel / Cloud Run / shell exports)  ← wins
//   2. .env                      (git-ignored, your machine's real secrets)
//   3. .env.development          (committed TEST-mode fallback so previews,
//                                 sandboxes and CI always have working keys)
//
// `dotenv` never overwrites a variable that already exists, so loading the
// files in this order gives exactly that precedence. Missing files are simply
// ignored — nothing throws.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

let loaded = false;

export function loadEnv(): void {
  if (loaded) return;
  loaded = true;

  const cwd = process.cwd();
  // Also look one level up so `api/index.ts` works when the serverless runtime
  // resolves the function's own directory as cwd.
  const candidates = ['.env', '.env.development'].flatMap((file) => [
    path.join(cwd, file),
    path.join(cwd, '..', file),
  ]);

  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) dotenv.config({ path: file });
    } catch {
      // A missing/unreadable env file must never crash the server.
    }
  }
}

loadEnv();
