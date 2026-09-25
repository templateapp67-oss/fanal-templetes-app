import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  // Vite loads .env files after evaluating this config. Load them explicitly
  // before computing replacements, or an empty define masks configured keys.
  const env = loadEnv(mode, process.cwd(), '');
  // Catch accidentally pasted privileged keys before Vite puts them in a bundle.
  for (const [name, value] of Object.entries(env)) {
    if (!/^(?:VITE_|NEXT_PUBLIC_).*SUPABASE.*KEY$/.test(name) &&
        !['SUPABASE_ANON_KEY', 'SUPABASE_KEY', 'SUPABASE_PUBLISHABLE_KEY'].includes(name)) continue;
    let role = '';
    try { role = JSON.parse(Buffer.from(value.split('.')[1] || '', 'base64url').toString()).role; } catch {}
    if (value.trim().startsWith('sb_secret_') || role === 'service_role') {
      throw new Error(`${name} contains a server-only Supabase key. Use an anon or publishable key for the browser.`);
    }
  }
  const publicSupabaseUrl =
    env.VITE_SUPABASE_URL ||
    env.NEXT_PUBLIC_SUPABASE_URL ||
    env.SUPABASE_URL ||
    '';
  const publicSupabaseAnonKey =
    env.VITE_SUPABASE_ANON_KEY ||
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    env.SUPABASE_ANON_KEY ||
    env.SUPABASE_KEY ||
    env.VITE_SUPABASE_KEY ||
    env.SUPABASE_PUBLISHABLE_KEY ||
    env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    '';

  return {
    envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(publicSupabaseUrl),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(publicSupabaseAnonKey),
    },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      // Allow the live-preview host (and any other origin) so the dev server
      // doesn't reject requests in hosted/preview environments.
      allowedHosts: true as const,
    },
  };
});
