import { createClient } from '@supabase/supabase-js';

// Static references are required for Vite build-time AST replacement of import.meta.env.VITE_*
const getViteEnv = () => {
  try {
    return {
      // @ts-ignore
      url: import.meta.env ? import.meta.env.VITE_SUPABASE_URL : undefined,
      // @ts-ignore
      key: import.meta.env ? import.meta.env.VITE_SUPABASE_ANON_KEY : undefined,
    };
  } catch {
    return { url: undefined, key: undefined };
  }
};

const viteEnv = getViteEnv();

const supabaseUrl = 
  viteEnv.url ||
  (typeof process !== 'undefined' && process.env && (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL));

const supabaseAnonKey = 
  viteEnv.key ||
  (typeof process !== 'undefined' && process.env && (process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY));

const isRealSupabase = supabaseUrl && supabaseUrl.trim() !== '' && !supabaseUrl.includes('placeholder');

export const supabase = createClient(
  isRealSupabase ? supabaseUrl : 'https://placeholder-project.supabase.co', 
  isRealSupabase ? supabaseAnonKey : 'placeholder-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    }
  }
);

// Helper to check if we should even attempt a real database call
export const isMockSupabase = !isRealSupabase;

if (isMockSupabase) {
  console.warn('Supabase keys are missing or using placeholders. App will run in mock mode with limited persistence.');
}
