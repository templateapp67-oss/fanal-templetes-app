import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  const publicSupabaseUrl =
    process.env.VITE_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    '';
  const publicSupabaseAnonKey =
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
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
